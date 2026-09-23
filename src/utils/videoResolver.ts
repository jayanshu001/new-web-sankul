import axios from "axios";
import ytdl from "@distube/ytdl-core";
import fs from "fs";
import { redisClient } from "../config/redis";
import { decrypt, generateKey, generateVector } from "./videoEncryption";
import logger from "./logger";
import { callOutbound } from "../libs/outbound";

// YouTube rotates which "innertube clients" pass bot protection from minute to
// minute. ytdl-core defaults to WEB, which fails most often; iterating through
// the alternatives is the canonical workaround. Order matters — start with the
// mobile clients, fall back to WEB last.
const YT_PLAYER_CLIENTS = ["IOS", "ANDROID", "WEB_EMBEDDED", "TV", "WEB"] as const;

// Optional cookie jar — feeds login state to ytdl so age-gated and bot-checked
// videos resolve. The file is the Chrome "EditThisCookie" JSON export shape.
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

// A single quality variant the client can play directly. Shape mirrors the
// old project's `progressive` entry so the FE contract stays familiar.
//
// `bitrate` / `hasAudio` / `hasVideo` are required by the FE download flow:
// VideoScreen.mapLessonItem filters out entries that lack hasAudio+hasVideo, and
// uses bitrate × duration / 8 to estimate file size. We populate sensible
// defaults when upstream doesn't return them.
export interface ResolvedQuality {
  qualityLabel: string; // "720p" | "480p" | ...
  quality: string;      // duplicate of qualityLabel — kept for parity with old shape
  height: number;       // 720, 480, ...
  url: string;          // raw, ready-to-play URL (mp4 or m3u8 variant)
  bitrate: number;      // bits per second — best-effort, defaulted per height when unknown
  hasAudio: boolean;
  hasVideo: boolean;
}

// Rough bitrate (bits/sec) for a given video height when upstream doesn't tell
// us. Used for FE size-estimate display only — picked to match common H.264
// muxed encodes so the "≈ 250 MB" hint isn't wildly off.
function estimateBitrateForHeight(height: number): number {
  if (height >= 1080) return 4_500_000;
  if (height >= 720)  return 2_500_000;
  if (height >= 480)  return 1_200_000;
  if (height >= 360)  return 700_000;
  if (height >= 240)  return 400_000;
  return 300_000;
}

// One variant (media playlist) listed inside an HLS master. `url` is ABSOLUTE and
// ready to GET as-is.
//
// This exists because the per-quality playlist filename CANNOT be derived from the
// quality label. VideoCrypt names its variants with the frame rate attached
// (`…_video_VOD480p30.m3u8`) while we normalise the label to "480p" for the picker,
// so anything built from the label — e.g. `…_video_VOD480p.m3u8` — is a key that
// does not exist. Their CloudFront origin has no s3:ListBucket, so a missing key
// comes back as `403 AccessDenied`, not `404 NoSuchKey`, which reads like a
// permissions problem but is not one. Clients must use these URLs verbatim.
export interface ResolvedHlsVariant {
  qualityLabel: string; // "480p" — normalised, matches progressive[].qualityLabel
  quality: string;      // duplicate, for parity with ResolvedQuality
  height: number;       // 480, 360, ...
  bandwidth: number;    // bits/sec, straight from the master's BANDWIDTH attribute
  url: string;          // absolute media-playlist URL — use as-is, never rebuild
}

// What the resolver hands back to encryptLecture. The HLS URL is optional
// because YouTube (via ytdl-core) doesn't ship a true HLS master — only muxed
// progressive formats are usable as a single playable URL.
export interface ResolvedSource {
  hlsUrl: string | null;
  // Variants parsed out of `hlsUrl`'s master playlist. Empty when there is no
  // master, or when the master couldn't be fetched/parsed (best-effort — a failure
  // here never blocks playback, the client can still use `hlsUrl` directly).
  hlsVariants: ResolvedHlsVariant[];
  progressive: ResolvedQuality[];
  // Hint the FE/player can use: when false, the player should not offer 720p
  // even if it appears in the list (AWS-specific concern, kept here so the
  // contract is platform-uniform).
  allow720: boolean;
}

const VIDEOCRYPT_URL = process.env.VIDEOCRYPT_URL || "";
const VIDEOCRYPT_ACCESS_KEY = process.env.VIDEOCRYPT_ACCESS_KEY || "";
const VIDEOCRYPT_SECRET_KEY = process.env.VIDEOCRYPT_SECRET_KEY || "";
const VIDEOCRYPT_ALLOW_720 = String(process.env.VIDEOCRYPT_ALLOW_720).toLowerCase() === "true";

// YouTube's progressive URLs expire roughly every 6 hours; cache aggressively
// under that ceiling so the next viewer doesn't re-pay the ytdl-core cost.
// VideoCrypt URLs are signed for ~24h so we cache the full day.
const CACHE_TTL_SECONDS = {
  youtube: 4 * 60 * 60, // 4h
  aws: 24 * 60 * 60,    // 24h
};

// Some upstream rows/responses carry a stray trailing quote artifact on the path
// (`…m3u8"` / `…m3u8%22`). The same strip already guards StreamOS recording paths;
// an unstripped one is a nonexistent key → 403 AccessDenied on the CDN.
const stripUrlArtifacts = (u: string): string => u.trim().replace(/(?:"|%22|%2522)+$/i, "");

/**
 * Pull the variant list out of an HLS master playlist. Each `#EXT-X-STREAM-INF`
 * line is followed by the variant's URI, which is usually RELATIVE — resolved
 * against the master's own URL so what we hand out is absolute.
 */
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
      continue; // unparseable URI — skip rather than emit something unfetchable
    }
    const label = height ? `${height}p` : "auto";
    out.push({ qualityLabel: label, quality: label, height, bandwidth, url });
  }
  return out.sort((a, b) => b.height - a.height);
};

const HLS_MASTER_TIMEOUT_MS = 8_000;

/**
 * Fetch+parse the master playlist, and report whether it is actually THERE.
 *
 * `reachable`:
 *   true    — master fetched and parsed; `variants` is usable
 *   false   — the CDN gave a definitive "this object does not exist" (4xx). On the
 *             VideoCrypt origin a missing key answers `403 AccessDenied` rather than
 *             404, so any 4xx is treated as missing.
 *   null    — could not tell (timeout / 5xx / network). Do NOT punish a transient
 *             blip: keep serving `hlsUrl` and let the client parse the master itself.
 *
 * Never throws.
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
          // 4xx must NOT throw — it is a real answer we need to act on. 5xx still
          // throws so callOutbound retries it as the transient failure it is.
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
    // 2xx but not a playlist (error page, empty object) — also not usable HLS.
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

// Resolves a YouTube id via ytdl-core. Keeps only muxed (audio+video) formats —
// adaptive/DASH streams need a manifest player which the FE doesn't run for
// this path. The first muxed URL also doubles as the HLS-equivalent "default
// playback" target.
async function resolveYoutube(youtubeId: string): Promise<ResolvedSource> {
  const cacheKey = `video-resolve:youtube:${youtubeId}`;
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  // Cycle through innertube clients. ytdl-core throws "Failed to find any
  // playable formats" when YouTube returns a player response without
  // streamingData (usual bot-protection symptom). Each client reaches YouTube
  // through a different code path; whichever one isn't currently blocked wins.
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
      // No formats from this client — try the next one.
      lastErr = new Error(`No muxed formats from ${client} client`);
    } catch (err) {
      lastErr = err as Error;
      // try next client
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
      // ytdl-core gives us real bitrate + audio/video flags per format — use
      // them when present, fall back to estimates only when missing.
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
    // Highest resolution first so the FE's default-quality pick lands on the best.
    .sort((a, b) => b.height - a.height);

  const resolved: ResolvedSource = {
    hlsUrl: progressive[0]?.url ?? null,
    // YouTube's "hlsUrl" is really a progressive MP4, not a master playlist —
    // there are no variants to list.
    hlsVariants: [],
    progressive,
    allow720: true, // YouTube path has no 720p gating
  };

  await writeCache(cacheKey, resolved, CACHE_TTL_SECONDS.youtube);
  return resolved;
}

// Resolves an AWS/VideoCrypt id by calling VideoCrypt's getVideoDetails. The
// service returns a real HLS master plus a list of per-quality MP4 URLs.
// Honors VIDEOCRYPT_ALLOW_720 — when false, 720p is stripped from the
// progressive list and `allow720` is set so the FE quality menu also hides it.
async function resolveAws(awsId: string): Promise<ResolvedSource> {
  const cacheKey = `video-resolve:aws:${awsId}`;
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  if (!VIDEOCRYPT_URL) {
    throw new Error("VIDEOCRYPT_URL is not configured.");
  }

  // Wrapped in callOutbound so a VideoCrypt outage doesn't pin lecture
  // requests for 15s × every viewer. 3 attempts on network/5xx/429.
  // Resolved URLs are cached in Redis for 24h (see the caller); a transient
  // VideoCrypt blip stays invisible to clients with already-cached entries.
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

  // VideoCrypt encrypts each download URL with AES-128-CBC using a key/IV
  // derived from THEIR per-response token (`data.token`) and the same alphabet
  // scheme we use. They ship the ciphertext as `download_url[i].url`. We must
  // unwrap that here — otherwise downstream consumers receive double-encrypted
  // base64 (their layer + our layer) and decrypting once just yields the inner
  // ciphertext, not the URL.
  const vcToken = typeof data.token === "string" ? data.token : "";
  const vcKey = vcToken ? generateKey(vcToken) : null;
  const vcIv = vcToken ? generateVector(vcToken) : null;

  const progressive: ResolvedQuality[] = downloads
    // VideoCrypt's `title` is height+fps mashed (e.g. "480p30"); we extract the
    // leading digits to get the real height, and normalize the label to "480p"
    // so the FE quality picker matches the documented contract.
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
        // VideoCrypt doesn't ship bitrate or codec flags on download_url[]; the
        // MP4s are always muxed (audio+video) by the transcode pipeline, so we
        // hardcode the flags true and estimate bitrate from height for the FE
        // size hint.
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
  // Read the master ONCE here (result cached with the rest for 24h) so every client
  // gets exact, absolute per-quality playlist URLs instead of guessing filenames.
  const probe = rawHlsUrl ? await fetchHlsVariants(rawHlsUrl) : { variants: [], reachable: null as boolean | null };
  // VideoCrypt returns a conventional `file_url_hls` even for files whose HLS
  // rendition was never produced. Advertising it would hand the client a URL that
  // 403s on the device — the client cannot tell that apart from a permissions
  // problem, and the download just fails. If the master is provably absent we drop
  // the HLS offer entirely so the client falls back to `progressive[]` cleanly.
  // A merely INCONCLUSIVE probe (reachable === null) keeps the URL.
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

// Entry point. Routes on platform; safe to call with any Video document.
// Throws when the platform is unsupported or the id is missing — callers
// translate that into the appropriate HTTP error.
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
    // Vimeo path isn't part of the transcoding contract — keep as a passthrough
    // so the response shape stays uniform. The FE handles vimeo ids directly.
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
