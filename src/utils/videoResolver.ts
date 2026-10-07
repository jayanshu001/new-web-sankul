// Video resolver: YouTube/AWS/Vimeo id to playable HLS and progressive sources (cached).
import axios from "axios";
import ytdl from "@distube/ytdl-core";
import fs from "fs";
import { redisClient } from "../config/redis";
import { decrypt, generateKey, generateVector } from "./videoEncryption";
import logger from "./logger";
import { callOutbound } from "../libs/outbound";

// YouTube rotates which innertube clients pass bot protection; ytdl-core's default
// WEB fails most often, so try mobile clients first and WEB last.
const YT_PLAYER_CLIENTS = ["IOS", "ANDROID", "WEB_EMBEDDED", "TV", "WEB"] as const;

// Optional cookie jar (Chrome "EditThisCookie" JSON export) so age-gated and
// bot-checked videos resolve.
let cachedAgent: ReturnType<typeof ytdl.createAgent> | null = null;
function getYtAgent(): ReturnType<typeof ytdl.createAgent> | undefined {
  if (cachedAgent) return cachedAgent;
  const path = process.env.YT_COOKIES_PATH;
  if (!path) return undefined;
  try {
    const raw = fs.readFileSync(path, "utf8");
    const cookies = JSON.parse(raw);
    cachedAgent = ytdl.createAgent(cookies);
    return cachedAgent;
  } catch (err) {
    logger.warn("Failed to load YT cookies", { path, error: (err as Error).message });
    return undefined;
  }
}

// `bitrate` / `hasAudio` / `hasVideo` are required by the FE download flow: it drops
// entries lacking hasAudio+hasVideo and estimates size as bitrate × duration / 8.
export interface ResolvedQuality {
  qualityLabel: string; // "720p" | "480p" | ...
  quality: string;      // duplicate of qualityLabel, kept for the client contract
  height: number;
  url: string;          // raw, ready-to-play URL (mp4 or m3u8 variant)
  bitrate: number;      // bits/sec; estimated from height when upstream omits it
  hasAudio: boolean;
  hasVideo: boolean;
}

// Rough H.264 muxed bitrate by height; only feeds the FE size estimate.
function estimateBitrateForHeight(height: number): number {
  if (height >= 1080) return 4_500_000;
  if (height >= 720)  return 2_500_000;
  if (height >= 480)  return 1_200_000;
  if (height >= 360)  return 700_000;
  if (height >= 240)  return 400_000;
  return 300_000;
}

// One media playlist from an HLS master; `url` is absolute and must be used verbatim.
// The filename cannot be rebuilt from the label: VideoCrypt appends the frame rate
// (`…_VOD480p30.m3u8`) while the label is normalised to "480p", and a missing key on
// their CloudFront origin returns 403 AccessDenied (no s3:ListBucket), not 404.
export interface ResolvedHlsVariant {
  qualityLabel: string; // "480p" — normalised, matches progressive[].qualityLabel
  quality: string;      // duplicate, for parity with ResolvedQuality
  height: number;
  bandwidth: number;    // bits/sec, from the master's BANDWIDTH attribute
  url: string;
}

export interface ResolvedSource {
  hlsUrl: string | null;
  // Best-effort parse of `hlsUrl`'s master; empty when absent or unparseable, and
  // never blocks playback.
  hlsVariants: ResolvedHlsVariant[];
  progressive: ResolvedQuality[];
  // When false the player must not offer 720p (AWS-only; kept uniform across platforms).
  allow720: boolean;
}

const VIDEOCRYPT_URL = process.env.VIDEOCRYPT_URL || "";
const VIDEOCRYPT_ACCESS_KEY = process.env.VIDEOCRYPT_ACCESS_KEY || "";
const VIDEOCRYPT_SECRET_KEY = process.env.VIDEOCRYPT_SECRET_KEY || "";
const VIDEOCRYPT_ALLOW_720 = String(process.env.VIDEOCRYPT_ALLOW_720).toLowerCase() === "true";

// YouTube progressive URLs expire after ~6h; VideoCrypt URLs are signed for ~24h.
const CACHE_TTL_SECONDS = {
  youtube: 4 * 60 * 60,
  aws: 24 * 60 * 60,
};

// Strips a stray trailing quote (`…m3u8"` / `%22`) some upstream rows carry; left in,
// it is a nonexistent key → 403 on the CDN.
const stripUrlArtifacts = (u: string): string => u.trim().replace(/(?:"|%22|%2522)+$/i, "");

// Variant URIs are usually relative; resolve them against the master URL.
const parseHlsMaster = (masterUrl: string, body: string): ResolvedHlsVariant[] => {
  const lines = body.split(/\r?\n/);
  const out: ResolvedHlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const uri = (lines[i + 1] ?? "").trim();
    if (!uri || uri.startsWith("#")) continue;
    const height = Number(/RESOLUTION=\d+x(\d+)/i.exec(line)?.[1] ?? 0);
    const bandwidth = Number(/[^-]BANDWIDTH=(\d+)/i.exec(`,${line}`)?.[1] ?? 0);
    let url: string;
    try {
      url = new URL(uri, masterUrl).toString();
    } catch {
      continue;
    }
    const label = height ? `${height}p` : "auto";
    out.push({ qualityLabel: label, quality: label, height, bandwidth, url });
  }
  return out.sort((a, b) => b.height - a.height);
};

const HLS_MASTER_TIMEOUT_MS = 8_000;

/**
 * Fetch and parse the master playlist. Never throws. `reachable`:
 *   true  — parsed; `variants` is usable
 *   false — definitive missing (any 4xx: VideoCrypt answers 403 for a missing key)
 *   null  — inconclusive (timeout/5xx/network); keep serving `hlsUrl`
 */
const fetchHlsVariants = async (
  masterUrl: string
): Promise<{ variants: ResolvedHlsVariant[]; reachable: boolean | null }> => {
  try {
    const res = await callOutbound(
      () =>
        axios.get(masterUrl, {
          timeout: HLS_MASTER_TIMEOUT_MS,
          responseType: "text",
          headers: { Accept: "*/*" },
          // 4xx is a real answer; 5xx still throws so callOutbound retries it.
          validateStatus: (s) => s < 500,
        }),
      { label: "hls.master", timeoutMs: HLS_MASTER_TIMEOUT_MS, attempts: 2 }
    );
    if (res.status >= 400) {
      logger.warn("HLS master is unreachable on the CDN; dropping hlsUrl for this video", {
        masterUrl,
        status: res.status,
      });
      return { variants: [], reachable: false };
    }
    const body = typeof res.data === "string" ? res.data : "";
    if (!body.includes("#EXTM3U")) {
      logger.warn("HLS master did not contain #EXTM3U; dropping hlsUrl for this video", { masterUrl, status: res.status });
      return { variants: [], reachable: false };
    }
    return { variants: parseHlsMaster(masterUrl, body), reachable: true };
  } catch (err) {
    logger.warn("HLS master probe inconclusive; serving hlsUrl without variants", {
      masterUrl,
      error: (err as Error).message,
    });
    return { variants: [], reachable: null };
  }
};

async function readCache(key: string): Promise<ResolvedSource | null> {
  try {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as ResolvedSource) : null;
  } catch (err) {
    logger.warn("videoResolver cache read failed", { key, error: (err as Error).message });
    return null;
  }
}

async function writeCache(key: string, value: ResolvedSource, ttlSeconds: number) {
  try {
    await redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    logger.warn("videoResolver cache write failed", { key, error: (err as Error).message });
  }
}

// Keeps only muxed (audio+video) formats; the FE runs no DASH player on this path.
async function resolveYoutube(youtubeId: string): Promise<ResolvedSource> {
  const cacheKey = `video-resolve:youtube:${youtubeId}`;
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  // A response without streamingData (bot protection) fails per client; first
  // unblocked client wins.
  const agent = getYtAgent();
  let lastErr: Error | null = null;
  let muxed: any[] = [];
  for (const client of YT_PLAYER_CLIENTS) {
    try {
      const info = await ytdl.getInfo(youtubeId, {
        playerClients: [client] as any,
        ...(agent ? { agent } : {}),
      });
      const candidate = info.formats.filter(
        (f) => f.hasAudio && f.hasVideo && typeof f.url === "string",
      );
      if (candidate.length > 0) {
        muxed = candidate;
        break;
      }
      lastErr = new Error(`No muxed formats from ${client} client`);
    } catch (err) {
      lastErr = err as Error;
    }
  }

  if (muxed.length === 0) {
    throw new Error(
      `ytdl-core: no playable formats for ${youtubeId} (last error: ${lastErr?.message ?? "unknown"})`,
    );
  }

  const progressive: ResolvedQuality[] = muxed
    .map((f) => {
      const heightNum = typeof f.height === "number" ? f.height : 0;
      const label = f.qualityLabel || (heightNum ? `${heightNum}p` : "auto");
      return {
        qualityLabel: label,
        quality: label,
        height: heightNum,
        url: f.url as string,
        bitrate: typeof f.bitrate === "number" && f.bitrate > 0
          ? f.bitrate
          : estimateBitrateForHeight(heightNum),
        hasAudio: f.hasAudio !== false,
        hasVideo: f.hasVideo !== false,
      };
    })
    // Highest first: the FE's default-quality pick takes the first entry.
    .sort((a, b) => b.height - a.height);

  const resolved: ResolvedSource = {
    hlsUrl: progressive[0]?.url ?? null,
    // YouTube's "hlsUrl" is a progressive MP4, not a master playlist.
    hlsVariants: [],
    progressive,
    allow720: true,
  };

  await writeCache(cacheKey, resolved, CACHE_TTL_SECONDS.youtube);
  return resolved;
}

// VideoCrypt returns an HLS master plus per-quality MP4s. VIDEOCRYPT_ALLOW_720=false
// strips 720p from both lists.
async function resolveAws(awsId: string): Promise<ResolvedSource> {
  const cacheKey = `video-resolve:aws:${awsId}`;
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  if (!VIDEOCRYPT_URL) {
    throw new Error("VIDEOCRYPT_URL is not configured.");
  }

  // callOutbound so a VideoCrypt outage doesn't pin every lecture request for 15s.
  const response = await callOutbound(
    () =>
      axios.post(
        VIDEOCRYPT_URL,
        { id: awsId },
        {
          headers: {
            accessKey: VIDEOCRYPT_ACCESS_KEY,
            secretKey: VIDEOCRYPT_SECRET_KEY,
            "Content-Type": "application/json",
          },
          timeout: 15_000,
        }
      ),
    { label: "videocrypt.resolve", timeoutMs: 15_000, attempts: 3 }
  );

  const body = response.data;
  if (!body || body.result === -1 || !body.data) {
    throw new Error(body?.msg || "VideoCrypt returned no data for this id.");
  }

  const data = body.data;
  const downloads: Array<{ title: string; url: string }> = Array.isArray(data.download_url)
    ? data.download_url
    : [];

  // VideoCrypt AES-encrypts each download URL with a key/IV derived from their
  // per-response `data.token`. Unwrap here, or clients get double-encrypted URLs.
  const vcToken = typeof data.token === "string" ? data.token : "";
  const vcKey = vcToken ? generateKey(vcToken) : null;
  const vcIv = vcToken ? generateVector(vcToken) : null;

  const progressive: ResolvedQuality[] = downloads
    // `title` is height+fps (e.g. "480p30"); normalise the label to "480p".
    .map((d) => {
      const heightMatch = String(d.title).match(/^(\d+)/);
      const height = heightMatch ? Number(heightMatch[1]) : 0;

      let plainUrl = d.url;
      if (vcKey && vcIv && d.url) {
        try {
          plainUrl = decrypt(d.url, vcKey, vcIv);
        } catch (err) {
          logger.warn("VideoCrypt URL decrypt failed; passing through ciphertext", {
            title: d.title,
            error: (err as Error).message,
          });
        }
      }

      return {
        qualityLabel: `${height}p`,
        quality: `${height}p`,
        height,
        url: plainUrl,
        // VideoCrypt MP4s are always muxed and ship no bitrate.
        bitrate: estimateBitrateForHeight(height),
        hasAudio: true,
        hasVideo: true,
      };
    })
    .filter((p) => (VIDEOCRYPT_ALLOW_720 ? true : p.height !== 720))
    .sort((a, b) => b.height - a.height);

  const rawHlsUrl = typeof data.file_url_hls === "string" && data.file_url_hls
    ? stripUrlArtifacts(data.file_url_hls)
    : null;
  const probe = rawHlsUrl ? await fetchHlsVariants(rawHlsUrl) : { variants: [], reachable: null as boolean | null };
  // VideoCrypt returns `file_url_hls` even when no HLS rendition exists. Drop it only
  // when provably absent so the client falls back to `progressive[]`; an
  // inconclusive probe keeps the URL.
  const hlsUrl = probe.reachable === false ? null : rawHlsUrl;
  const hlsVariants = probe.variants.filter((v) => (VIDEOCRYPT_ALLOW_720 ? true : v.height !== 720));

  const resolved: ResolvedSource = {
    hlsUrl,
    hlsVariants,
    progressive,
    allow720: VIDEOCRYPT_ALLOW_720,
  };

  await writeCache(cacheKey, resolved, CACHE_TTL_SECONDS.aws);
  return resolved;
}

// Throws on an unsupported platform or missing id; callers map it to an HTTP error.
export async function resolveVideoSource(v: {
  platform: string;
  youtube_id?: string | null;
  aws_id?: string | null;
  vimeo_id?: string | null;
}): Promise<ResolvedSource> {
  if (v.platform === "youtube") {
    if (!v.youtube_id) throw new Error("Video is missing youtube_id.");
    return resolveYoutube(v.youtube_id);
  }
  if (v.platform === "aws") {
    if (!v.aws_id) throw new Error("Video is missing aws_id.");
    return resolveAws(v.aws_id);
  }
  if (v.platform === "vimeo") {
    // Passthrough keeping the shape uniform; the FE handles vimeo ids directly.
    if (!v.vimeo_id) throw new Error("Video is missing vimeo_id.");
    return {
      hlsUrl: null,
      hlsVariants: [],
      progressive: [{
        qualityLabel: "auto",
        quality: "auto",
        height: 0,
        url: v.vimeo_id,
        bitrate: 0,
        hasAudio: true,
        hasVideo: true,
      }],
      allow720: true,
    };
  }
  throw new Error(`Unsupported platform: ${v.platform}`);
}
