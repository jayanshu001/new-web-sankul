import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { RANK_ERROR } from "../modules/rank-predictor/rank-predictor.types";
import { renderPdfFromHtml } from "../libs/core/generate";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const PDF_MAGIC = "%PDF-";
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);
/**
 * Digialm (TCS iON) serves the response sheet as an HTML page, not a PDF. Only its
 * hosts are printed to PDF — the reader already knows that layout — so an arbitrary
 * page is never handed to the browser.
 */
const isDigialmHost = (host: string): boolean => host === "digialm.com" || host.endsWith(".digialm.com");

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
      lower.startsWith("ff") ||
      // NAT64 and 6to4 embed an IPv4 address that may be an internal one.
      lower.startsWith("64:ff9b:") ||
      lower.startsWith("2002:")
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
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
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

/**
 * DNS lookup for the socket itself, refusing internal addresses. The check in
 * assertPublicHttps runs on an earlier lookup; this one covers a host that
 * re-resolves to an internal address between the two (DNS rebinding).
 */
const publicOnlyLookup: LookupFunction = (hostname, options, callback) =>
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = addresses as unknown as { address: string; family: number }[];
    if (!list.length || list.some(({ address }) => isPrivateAddress(address))) {
      return callback(new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID), "", 4);
    }
    return options.all ? (callback as any)(null, list) : callback(null, list[0].address, list[0].family);
  });

const get = (url: URL): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    const req = request(url, {
      lookup: publicOnlyLookup,
      timeout: TIMEOUT_MS,
      // Some hosts refuse a request with no user agent; `fetch` used to send one.
      headers: { accept: "application/pdf, text/html;q=0.9", "user-agent": "WebSankul-RankPredictor/1.0" },
    });
    req.on("response", resolve);
    req.on("timeout", () => req.destroy(new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE)));
    req.on("error", reject);
    req.end();
  });

const readCapped = async (response: IncomingMessage): Promise<Buffer> => {
  const declared = Number(response.headers["content-length"] ?? 0);
  if (declared > MAX_BYTES) {
    response.destroy();
    throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID, "too large");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const deadline = setTimeout(() => response.destroy(new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE)), TIMEOUT_MS);
  try {
    for await (const chunk of response as AsyncIterable<Buffer>) {
      total += chunk.byteLength;
      if (total > MAX_BYTES) {
        response.destroy();
        throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID, "too large");
      }
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(deadline);
  }
  return Buffer.concat(chunks);
};

const fileNameOf = (url: URL): string => {
  let name = "sheet.pdf";
  try {
    name = decodeURIComponent(url.pathname.split("/").pop() || name);
  } catch {
    // A malformed %-escape is not worth failing the upload over.
  }
  // Only ever a label for the reader; keep it to plain characters.
  name = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120).replace(/\.html?$/i, ".pdf");
  return name.toLowerCase().endsWith(".pdf") ? name : "sheet.pdf";
};

/**
 * Download a response-sheet PDF a student pasted a link to. The link is
 * student-controlled, so it is https only, never resolves to an internal
 * address, follows each redirect through the same check, and is size- and
 * time-capped. The socket's own DNS lookup is checked too, so a host that
 * re-resolves to an internal address after the first check is still refused.
 * The body is only ever handed to the PDF reader, never echoed back. A Digialm
 * HTML response sheet is printed to PDF offline first, then goes the same way.
 */
export const fetchSheetPdf = async (rawUrl: string): Promise<{ buffer: Buffer; fileName: string }> => {
  let url = await assertPublicHttps(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: IncomingMessage;
    try {
      response = await get(url);
    } catch (error) {
      if (error instanceof SheetUrlError) throw error;
      throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);
    }

    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      response.resume();
      const location = response.headers.location;
      if (!location) throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);
      url = await assertPublicHttps(new URL(location, url).toString());
      continue;
    }

    if (status < 200 || status >= 300) {
      response.resume();
      throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);
    }

    const buffer = await readCapped(response).catch((error: unknown) => {
      throw error instanceof SheetUrlError ? error : new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE);
    });
    if (!buffer.subarray(0, 1024).toString("latin1").includes(PDF_MAGIC)) {
      const isHtml = String(response.headers["content-type"] ?? "").toLowerCase().startsWith("text/html");
      if (!isHtml || !isDigialmHost(url.hostname.toLowerCase())) {
        throw new SheetUrlError(RANK_ERROR.SHEET_URL_INVALID, "not a PDF");
      }
      const pdf = await renderPdfFromHtml(buffer.toString("utf8"), { offline: true }).catch(() => {
        throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE, "could not print the sheet");
      });
      return { buffer: pdf, fileName: fileNameOf(url) };
    }

    return { buffer, fileName: fileNameOf(url) };
  }

  throw new SheetUrlError(RANK_ERROR.SHEET_URL_UNREACHABLE, "too many redirects");
};
