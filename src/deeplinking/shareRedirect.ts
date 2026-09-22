import fs from "fs";
import path from "path";
import crypto from "crypto";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "src",
  "deeplinking",
  "templates",
  "share-redirect.html"
);

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate && process.env.NODE_ENV === "production") return cachedTemplate;
  cachedTemplate = fs.readFileSync(TEMPLATE_PATH, "utf8");
  return cachedTemplate;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

const APP_SCHEME = process.env.APP_SCHEME || "com.gpscvideo.gpsc";
const APP_WEB_HOST = (process.env.APP_WEB_HOST || "https://com.gpscvideo.com").replace(/\/+$/, "");
const PLAY_STORE_URL =
  process.env.PLAY_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.gpscvideo.gpsc&hl=en";
const APP_STORE_URL =
  process.env.APP_STORE_URL || "https://apps.apple.com/us/app/gpsc/id6751284655";
const FALLBACK_URL = process.env.SHARE_FALLBACK_URL || "https://www.gpscvideo.com/";

// Key/IV are per resource, so the same id gives a different token per resource.
const SHARE_ID_SECRET =
  process.env.SHARE_ID_SECRET || process.env.JWT_ACCESS_SECRET || "ws-share";

function shareCipherParams(resource: string): { key: Buffer; iv: Buffer } {
  const h = crypto
    .createHash("sha256")
    .update(`${SHARE_ID_SECRET}:${resource}`)
    .digest();
  return { key: h.subarray(0, 16), iv: h.subarray(16, 32) };
}

/** Integer id → 7-char base64url token (salt byte + uint32 BE, AES-128-CTR). */
export function encodeShareId(resource: string, id: string | number): string {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || n > 0xffffffff) return String(id);
  const { key, iv } = shareCipherParams(resource);
  for (let salt = 0; salt < 256; salt++) {
    const plain = Buffer.alloc(5);
    plain.writeUInt8(salt, 0);
    plain.writeUInt32BE(n, 1);
    const c = crypto.createCipheriv("aes-128-ctr", key, iv);
    const token = Buffer.concat([c.update(plain), c.final()]).toString("base64url");
    // Never all-digits, so a token can't be mistaken for a legacy plain id.
    if (!/^\d+$/.test(token)) return token;
  }
  return String(id);
}

/** Inverse of `encodeShareId`. Null when `token` is not one of ours. */
export function decodeShareId(resource: string, token: string): string | null {
  if (!/^[A-Za-z0-9_-]{7}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== 5) return null;
  const { key, iv } = shareCipherParams(resource);
  const d = crypto.createDecipheriv("aes-128-ctr", key, iv);
  const plain = Buffer.concat([d.update(raw), d.final()]);
  const n = plain.readUInt32BE(1);
  return n > 0 ? String(n) : null;
}

/**
 * "<base>/share/<resource>/<token>" — `base` comes from each controller's
 * `resolveBase(req)` (the `ORIGIN` env var, or the request host).
 */
export function buildShareUrl(
  resource: string,
  id: string,
  base?: string
): string {
  const cleanResource = resource.replace(/^\/+|\/+$/g, "");
  const cleanBase = (base || "").replace(/\/+$/, "");
  return `${cleanBase}/share/${cleanResource}/${encodeShareId(cleanResource, id)}`;
}

export interface ShareTargets {
  /** com.gpscvideo.gpsc://ebook/120 */
  appLink: string;
  /** https://com.gpscvideo.com/ebook/120 */
  webLink: string;
}

/** Used by both the redirect page and /share/resolve, so they can't disagree. */
export function buildShareTargets(deepPath: string, id: string): ShareTargets {
  const path = `${deepPath.replace(/^\/+|\/+$/g, "")}/${id}`;
  return {
    appLink: `${APP_SCHEME}://${path}`,
    webLink: `${APP_WEB_HOST}/${path}`,
  };
}

export interface RenderedShare {
  html: string;
  nonce: string;
}

export function renderShareRedirect(deepPath: string, id: string): RenderedShare {
  const { appLink, webLink } = buildShareTargets(deepPath, id);
  const nonce = crypto.randomBytes(16).toString("base64");

  const values: Record<string, string> = {
    APP_LINK: escapeHtml(appLink),
    WEB_LINK: escapeHtml(webLink),
    PLAY_STORE_URL: escapeHtml(PLAY_STORE_URL),
    APP_STORE_URL: escapeHtml(APP_STORE_URL),
    FALLBACK_URL: escapeHtml(FALLBACK_URL),
    NONCE: nonce,
  };

  const html = loadTemplate().replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
  return { html, nonce };
}
