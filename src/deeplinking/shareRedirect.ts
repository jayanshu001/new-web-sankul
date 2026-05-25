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

const SHARE_BASE_URL = (process.env.SHARE_BASE_URL || "").replace(/\/+$/, "");

/**
 * Build the public share URL for a resource, e.g. buildShareUrl("courses", id)
 * → "https://api.example.com/share/courses/<id>". Reads SHARE_BASE_URL from env;
 * caller can pass a request-derived base as a fallback.
 */
export function buildShareUrl(
  resource: string,
  id: string,
  fallbackBase?: string
): string {
  const base = SHARE_BASE_URL || (fallbackBase || "").replace(/\/+$/, "");
  const cleanResource = resource.replace(/^\/+|\/+$/g, "");
  return `${base}/share/${cleanResource}/${id}`;
}

export interface RenderedShare {
  html: string;
  nonce: string;
}

export function renderShareRedirect(deepPath: string, id: string): RenderedShare {
  const safeId = escapeHtml(id);
  const safeDeepPath = escapeHtml(deepPath.replace(/^\/+|\/+$/g, ""));
  const nonce = crypto.randomBytes(16).toString("base64");

  const values: Record<string, string> = {
    APP_LINK: `${escapeHtml(APP_SCHEME)}://${safeDeepPath}/${safeId}`,
    WEB_LINK: `${escapeHtml(APP_WEB_HOST)}/${safeDeepPath}/${safeId}`,
    PLAY_STORE_URL: escapeHtml(PLAY_STORE_URL),
    APP_STORE_URL: escapeHtml(APP_STORE_URL),
    FALLBACK_URL: escapeHtml(FALLBACK_URL),
    NONCE: nonce,
  };

  const html = loadTemplate().replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
  return { html, nonce };
}
