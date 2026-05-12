import { Request, Response } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { Innertube, Log } from "youtubei.js";

Log.setLevel(Log.Level.ERROR);

// Secret is generated once per process. Tokens minted in one run won't survive
// a restart, but they're short-lived anyway (6h).
const PROXY_SECRET = randomBytes(32);
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

let cached: Promise<InstanceType<typeof Innertube>> | undefined;
function getInnertube() {
  if (!cached) cached = Innertube.create();
  return cached;
}

interface YtTokenPayload {
  v: string;
  i: number;
  e: number;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function signYoutubeStream(youtubeId: string, itag: number): string {
  const payload: YtTokenPayload = { v: youtubeId, i: itag, e: Date.now() + TOKEN_TTL_MS };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", PROXY_SECRET).update(body).digest();
  return `${body}.${b64urlEncode(sig)}`;
}

function verifyToken(t: string): YtTokenPayload | null {
  const dot = t.indexOf(".");
  if (dot <= 0) return null;
  const body = t.slice(0, dot);
  const sig = t.slice(dot + 1);
  const expected = createHmac("sha256", PROXY_SECRET).update(body).digest();
  const got = b64urlDecode(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  let payload: YtTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.v || typeof payload.i !== "number" || !payload.e) return null;
  if (Date.now() > payload.e) return null;
  return payload;
}

async function resolveFreshUrl(youtubeId: string, itag: number): Promise<string | null> {
  const yt = await getInnertube();
  const clientsToTry = ["IOS", "ANDROID", "WEB_EMBEDDED", "TV", "WEB"] as const;
  let fallbackUrl: string | null = null;
  for (const client of clientsToTry) {
    try {
      const info: any = await yt.getInfo(youtubeId, client as any);
      const sd = info?.streaming_data;
      if (!sd) continue;
      const all = [...(sd.formats ?? []), ...(sd.adaptive_formats ?? [])];
      const match = all.find((f: any) => f.itag === itag && f.url);
      if (match?.url) return match.url as string;
      if (!fallbackUrl) {
        const anyWithUrl = all.find((f: any) => f.url);
        if (anyWithUrl?.url) fallbackUrl = anyWithUrl.url as string;
      }
    } catch {
      // try next client
    }
  }
  return fallbackUrl;
}

// GET /client/yt-proxy?t=<signed-token>
export const youtubeStreamProxy = async (req: Request, res: Response) => {
  const t = String(req.query.t ?? "");
  if (!t) {
    res.status(400).json({ success: false, message: "Missing token." });
    return;
  }

  const payload = verifyToken(t);
  if (!payload) {
    res.status(403).json({ success: false, message: "Invalid or expired token." });
    return;
  }

  let upstreamUrl: string | null;
  try {
    upstreamUrl = await resolveFreshUrl(payload.v, payload.i);
  } catch (err: any) {
    console.error("[yt-proxy] resolve failed", { youtube_id: payload.v, itag: payload.i, error: err?.message });
    res.status(502).json({ success: false, message: "Failed to resolve stream." });
    return;
  }
  if (!upstreamUrl) {
    res.status(502).json({ success: false, message: "No playable format." });
    return;
  }

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (req.headers.range) headers["Range"] = String(req.headers.range);

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await fetch(upstreamUrl, { headers });
  } catch (err: any) {
    console.error("[yt-proxy] fetch failed", { error: err?.message });
    res.status(502).json({ success: false, message: "Upstream fetch failed." });
    return;
  }

  res.status(upstream.status);
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"]) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  res.on("close", () => {
    reader.cancel().catch(() => {});
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
  } catch (err: any) {
    console.error("[yt-proxy] stream error", { error: err?.message });
  } finally {
    res.end();
  }
};
