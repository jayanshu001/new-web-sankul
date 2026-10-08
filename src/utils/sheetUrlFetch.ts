import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { RANK_ERROR } from "../modules/rank-predictor/rank-predictor.types";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const PDF_MAGIC = "%PDF-";
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export class SheetUrlError extends Error {
  constructor(
    public code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "SheetUrlError";
  }
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges. */
const isPrivateAddress = (address: string): boolean => {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    // URL parsing rewrites ::ffff:127.0.0.1 as ::ffff:7f00:1, so read both spellings.
    const mapped = lower.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
    if (mapped) {
      if (mapped[1]) return isPrivateAddress(mapped[1]);
      const high = Number.parseInt(mapped[2], 16);
      const low = Number.parseInt(mapped[3], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("ff")
    );
  }

  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const assertPublicHttps = async (rawUrl: string): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID);
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID);
  }

  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID);
  }

  return url;
};

const readCapped = async (response: Response): Promise<Buffer> => {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID, "too large");
  if (!response.body) throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID, "too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Download a response-sheet PDF a student pasted a link to. The link is
 * student-controlled, so it is https only, never resolves to an internal
 * address, follows each redirect through the same check, and is size- and
 * time-capped. (A host that re-resolves between this check and the fetch is not
 * covered; the body is only ever handed to the PDF reader, never echoed back.)
 */
export const fetchSheetPdf = async (rawUrl: string): Promise<{ buffer: Buffer; fileName: string }> => {
  let url = await assertPublicHttps(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "application/pdf" },
      });
    } catch {
      throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);
      url = await assertPublicHttps(new URL(location, url).toString());
      continue;
    }

    if (!response.ok) throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);

    const buffer = await readCapped(response);
    if (buffer.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
      throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID, "not a PDF");
    }

    const name = decodeURIComponent(url.pathname.split("/").pop() || "sheet.pdf");
    return { buffer, fileName: name.toLowerCase().endsWith(".pdf") ? name : "sheet.pdf" };
  }

  throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE, "too many redirects");
};
