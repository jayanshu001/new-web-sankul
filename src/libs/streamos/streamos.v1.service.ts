// StreamOS v1: HTTP client for the v1 API (https://api.streamos.in/api/public/v1), a separate
// platform from streamos.service.ts (see docs/migration/STREAMOS_V1_CHANGE_MATRIX.md).
//  - `StreamosError` is reused from the legacy service: controllers branch on
//    `instanceof StreamosError`, and a second class would turn those into 500s.
//  - 503 means NO_SLOTS_AVAILABLE and is not retried; only network faults and
//    502/504 are.
//  - 429 fails fast with the server's Retry-After rather than holding the request.

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import logger from "../../utils/logger";
import { StreamosError, type QualityHlsUrls } from "./streamos.service";
import { streamosV1ApiKey, streamosV1Base } from "../../config/streamos";

export { StreamosError };

const RETRY_STATUSES = new Set([502, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

interface V1Envelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: unknown;
  error?: { code?: string; details?: unknown };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authHeader(): Record<string, string> {
  const key = streamosV1ApiKey();
  if (!key) {
    throw new StreamosError("StreamOS API key is not configured on the server.", 500);
  }
  return { Authorization: `Bearer ${key}` };
}

// Leads with v1's `error.code`, falling back to the HTTP status.
function mapV1Error(res: AxiosResponse): StreamosError {
  const { status, data } = res;
  const code = (data as V1Envelope<unknown>)?.error?.code ?? "";
  const upstreamMessage = (data as V1Envelope<unknown>)?.message;

  switch (code || String(status)) {
    case "INVALID_API_KEY":
    case "401":
      return new StreamosError("StreamOS rejected the API key (401).", 502, status, data);
    case "PERMISSION_DENIED":
    case "403":
      return new StreamosError("StreamOS denied permission for this action (403).", 502, status, data);
    case "NOT_FOUND":
    case "404":
      return new StreamosError("StreamOS resource not found (404).", 404, status, data);
    case "VALIDATION_ERROR":
    case "422":
      return new StreamosError(
        `StreamOS rejected the request: ${upstreamMessage ?? "validation failed"}.`,
        422,
        status,
        data
      );
    case "RATE_LIMITED":
    case "429": {
      const retryAfter = Number(res.headers?.["retry-after"]);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? `${retryAfter}s` : "a moment";
      return new StreamosError(`StreamOS is rate-limiting this key. Retry in ${wait}.`, 429, status, data);
    }
    case "NO_SLOTS_AVAILABLE":
    case "503":
      return new StreamosError(
        "StreamOS has no live-stream slots available. End an active stream or try again shortly.",
        503,
        status,
        data
      );
    case "TRANSCODE_QUEUE_FAILED":
    case "502":
      return new StreamosError("StreamOS could not queue the transcode (502).", 502, status, data);
    default:
      return new StreamosError(
        `StreamOS error (${status})${code ? ` [${code}]` : ""}.`,
        502,
        status,
        data
      );
  }
}

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios.request<V1Envelope<T>>({
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
        ...config,
        headers: { ...authHeader(), ...(config.headers ?? {}) },
      });

      if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        throw Object.assign(new Error(`Retryable status ${res.status}`), { __retryable: true, response: res });
      }
      if (res.status >= 400) throw mapV1Error(res);

      return (res.data?.data ?? (res.data as unknown)) as T;
    } catch (err: any) {
      lastError = err;
      const retryable =
        err?.__retryable === true ||
        (err instanceof AxiosError && (!err.response || RETRY_STATUSES.has(err.response.status)));

      if (!retryable || attempt === MAX_RETRIES) {
        if (err instanceof StreamosError) throw err;
        if (err?.response) throw mapV1Error(err.response);
        throw new StreamosError(`StreamOS request failed: ${err?.message ?? "unknown error"}`, 502);
      }

      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      logger.warn("StreamOS v1 retry", { attempt: attempt + 1, backoff, url: config.url });
      await sleep(backoff);
    }
  }

  throw lastError instanceof StreamosError ? lastError : new StreamosError("StreamOS request failed.", 502);
}

const url = (path: string) => `${streamosV1Base()}${path}`;

/**
 * v1 emits "P480"; every consumer (promotion picker, qualitiesFromSessionRecordings,
 * the app's quality menu) expects "480p", so normalise at the boundary. Unrecognised
 * labels pass through.
 */
const normalizeQualityLabel = (raw: unknown): string => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = /^[pP](\d{3,4})$/.exec(s);      // "P480" → "480p"
  if (m) return `${m[1]}p`;
  const n = /^(\d{3,4})[pP]?$/.exec(s);      // "480" / "480p" → "480p"
  if (n) return `${n[1]}p`;
  return s;                                   // "auto", or anything unexpected
};

export type LiveStreamStatus = "SCHEDULED" | "READY_TO_STREAM" | "ENDED";

export interface LiveStreamV1 {
  publicId: string;
  // Empty until the stream is started.
  rtmpUrl: string | null;
  streamKey: string | null;
  // The push URL split into OBS's separate "server" and "stream key" fields.
  rtmpServerUrl: string | null;
  rtmpServerKey: string | null;
  pushDomain: string | null;
  // Ingest credentials expire ~24h after minting; re-start to mint fresh ones.
  pushExpiresAt: string | null;
  hlsUrl: string | null;
  // Per-quality live playback URLs, keyed by label.
  hlsUrls: QualityHlsUrls | null;
  // Null until the recording has finished processing.
  playbackUrl: string | null;
  status: LiveStreamStatus | string;
  latency: string | null;
  drmForRecording: boolean;
  recordedAssetId: string | null;
  tags: Record<string, unknown> | null;
  raw: unknown;
}

const toQualityMap = (raw: unknown): QualityHlsUrls | null => {
  if (!raw || typeof raw !== "object") return null;
  const out: QualityHlsUrls = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) out[normalizeQualityLabel(k) || k] = v;
  }
  return Object.keys(out).length ? out : null;
};

const toLiveStream = (p: any): LiveStreamV1 => ({
  publicId: String(p?.public_id ?? ""),
  rtmpUrl: p?.rtmp_url || null,
  streamKey: p?.stream_key || null,
  rtmpServerUrl: p?.rtmp_server_url || null,
  rtmpServerKey: p?.rtmp_server_key || null,
  pushDomain: p?.push_domain || null,
  pushExpiresAt: p?.push_expires_at || null,
  hlsUrl: p?.hls_url || null,
  hlsUrls: toQualityMap(p?.hls_urls),
  playbackUrl: p?.playback_url || null,
  status: p?.status ?? "",
  latency: p?.latency || null,
  drmForRecording: Boolean(p?.drm_for_recording),
  recordedAssetId: p?.recorded_asset_id ?? null,
  tags: p?.tags ?? null,
  raw: p,
});

export interface CreateLiveStreamInput {
  title: string;
  /** Leave false: StreamOS has no licence server yet, so DRM assets cannot be played. */
  drm?: boolean;
  latency?: "NORMAL" | "LOW";
  scheduledAt?: string;
  /** Max 20 pairs. Used to carry our session id through to the recording. */
  customTags?: Record<string, string>;
}

/** Immediately pushable (status READY_TO_STREAM). */
export async function createLiveStream(input: CreateLiveStreamInput): Promise<LiveStreamV1> {
  const payload = await request<any>({
    method: "POST",
    url: url("/livestreams/"),
    data: {
      title: input.title,
      drm: input.drm ?? false,
      ...(input.latency ? { latency: input.latency } : {}),
      ...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
      ...(input.customTags ? { customTags: input.customTags } : {}),
    },
  });
  const stream = toLiveStream(payload?.stream ?? payload);
  if (!stream.publicId) {
    throw new StreamosError("Unexpected response from StreamOS createLiveStream.", 502, 200, payload);
  }
  return stream;
}

/**
 * Reserves a future stream without minting ingest credentials, so the 24h push
 * expiry is survivable: schedule ahead, then `startLiveStream` at go-live.
 */
export async function scheduleLiveStream(
  input: CreateLiveStreamInput & { scheduledAt: string }
): Promise<LiveStreamV1> {
  const payload = await request<any>({
    method: "POST",
    url: url("/livestreams/schedule/"),
    data: {
      title: input.title,
      scheduled_at: input.scheduledAt,
      drm: input.drm ?? false,
      ...(input.latency ? { latency: input.latency } : {}),
      ...(input.customTags ? { customTags: input.customTags } : {}),
    },
  });
  const stream = toLiveStream(payload?.stream ?? payload);
  if (!stream.publicId) {
    throw new StreamosError("Unexpected response from StreamOS scheduleLiveStream.", 502, 200, payload);
  }
  return stream;
}

/** Mints ingest credentials for a SCHEDULED stream. Call this at go-live, not before. */
export async function startLiveStream(publicId: string): Promise<LiveStreamV1> {
  const payload = await request<any>({
    method: "POST",
    url: url(`/livestreams/${encodeURIComponent(publicId)}/start/`),
  });
  return toLiveStream(payload?.stream ?? payload);
}

/** Ends the stream and frees its concurrency slot. */
export async function endLiveStream(publicId: string): Promise<LiveStreamV1> {
  const payload = await request<any>({
    method: "POST",
    url: url(`/livestreams/${encodeURIComponent(publicId)}/end/`),
  });
  return toLiveStream(payload?.stream ?? payload);
}

export async function getLiveStream(publicId: string): Promise<LiveStreamV1> {
  const payload = await request<any>({
    method: "GET",
    url: url(`/livestreams/${encodeURIComponent(publicId)}/`),
  });
  return toLiveStream(payload?.stream ?? payload);
}

export async function listLiveStreams(): Promise<LiveStreamV1[]> {
  const payload = await request<any>({ method: "GET", url: url("/livestreams/") });
  const arr = Array.isArray(payload) ? payload : payload?.streams ?? payload?.results ?? [];
  return (Array.isArray(arr) ? arr : []).map(toLiveStream);
}

export type AssetStatus = "QUEUED" | "TRANSCODING" | "COMPLETED" | "ERROR";

export interface AssetRendition {
  quality: string;
  url: string | null;
  dashUrl: string | null;
}

export interface AssetV1 {
  publicId: string;
  status: AssetStatus | string;
  kind: "UPLOAD" | "LIVESTREAM_RECORDING" | string;
  durationSeconds: number | null;
  /** StreamOS returns a decimal string; coerced here. */
  sizeBytes: number | null;
  tags: Record<string, unknown> | null;
  /** Null on DRM assets — those emit DASH instead. */
  hlsManifestUrl: string | null;
  drmContentId: string | null;
  renditions: AssetRendition[];
  transcodeJob: unknown;
  raw: unknown;
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toAsset = (p: any): AssetV1 => {
  const video = p?.video ?? {};
  // `renditions` is documented at the asset root, not inside `video`; the `video`
  // fallback is defensive.
  const rawRends = Array.isArray(p?.renditions)
    ? p.renditions
    : Array.isArray(video?.renditions)
      ? video.renditions
      : [];
  const rends: AssetRendition[] = rawRends
    .map((r: any) => ({
      quality: normalizeQualityLabel(r?.quality),
      // The live API returns `playlist_url`, not the documented `url`; reading only
      // `url` drops every rendition below.
      url: r?.playlist_url || r?.url || null,
      dashUrl: r?.dash_url || null,
    }))
    .filter((r: AssetRendition) => r.url || r.dashUrl);

  return {
    publicId: String(p?.public_id ?? ""),
    status: p?.status ?? "",
    kind: p?.kind ?? "",
    durationSeconds: toNumber(p?.duration_seconds),
    sizeBytes: toNumber(p?.size_bytes),
    tags: p?.tags ?? null,
    hlsManifestUrl: video?.hls_manifest_url || null,
    drmContentId: video?.drm_content_id ?? null,
    renditions: rends,
    transcodeJob: p?.transcode_job ?? null,
    raw: p,
  };
};

export async function getAsset(publicId: string): Promise<AssetV1> {
  const payload = await request<any>({
    method: "GET",
    url: url(`/assets/${encodeURIComponent(publicId)}/`),
  });
  return toAsset(payload?.asset ?? payload);
}

export interface ListAssetsResult {
  assets: AssetV1[];
  folders: unknown[];
  raw: unknown;
}

export async function listAssets(folder?: string): Promise<ListAssetsResult> {
  const payload = await request<any>({
    method: "GET",
    url: url("/assets/"),
    ...(folder ? { params: { folder } } : {}),
  });
  const rawAssets = payload?.assets ?? payload?.videos ?? payload?.results ?? [];
  return {
    assets: (Array.isArray(rawAssets) ? rawAssets : []).map(toAsset),
    folders: Array.isArray(payload?.folders) ? payload.folders : [],
    raw: payload,
  };
}

/** Exposed for `scripts/verify-streamos-v1.ts` only (asserts what typecheck can't). */
export const __test__ = { normalizeQualityLabel, toAsset };

export type StreamosV1Event =
  | "VIDEO_UPLOADED"
  | "VIDEO_TRANSCODING_STARTED"
  | "VIDEO_TRANSCODING_COMPLETED"
  | "VIDEO_TRANSCODING_FAILED"
  | "LIVESTREAM_SCHEDULED"
  | "LIVESTREAM_ENDED"
  | "LIVESTREAM_RECORDING_READY";

export interface RegisterWebhookResult {
  /** Returned ONCE at creation. Persist it immediately — it cannot be re-read. */
  signingSecret: string | null;
  publicId: string | null;
  raw: unknown;
}

export async function registerWebhook(input: {
  url: string;
  events: StreamosV1Event[];
  fields?: string[];
  description?: string;
}): Promise<RegisterWebhookResult> {
  const payload = await request<any>({
    method: "POST",
    url: url("/webhooks/"),
    data: {
      url: input.url,
      events: input.events,
      ...(input.fields ? { fields: input.fields } : {}),
      ...(input.description ? { description: input.description } : {}),
    },
  });
  const hook = payload?.webhook ?? payload;
  return {
    signingSecret: hook?.signing_secret ?? null,
    publicId: hook?.public_id ?? null,
    raw: payload,
  };
}

export interface WebhookEndpointV1 {
  publicId: string | null;
  url: string | null;
  events: string[];
  description: string | null;
  raw: unknown;
}

const toWebhook = (w: any): WebhookEndpointV1 => ({
  publicId: w?.public_id ?? w?.id ?? null,
  url: w?.url ?? null,
  events: Array.isArray(w?.events) ? w.events.map((e: unknown) => String(e)) : [],
  description: w?.description ?? null,
  raw: w,
});

export async function listWebhooks(): Promise<WebhookEndpointV1[]> {
  const payload = await request<any>({ method: "GET", url: url("/webhooks/") });
  const arr = Array.isArray(payload) ? payload : payload?.webhooks ?? payload?.results ?? [];
  return (Array.isArray(arr) ? arr : []).map(toWebhook);
}

/** Removes a registered endpoint. Deliveries to it stop immediately. */
export async function deleteWebhook(endpointId: string): Promise<void> {
  await request<any>({
    method: "DELETE",
    url: url(`/webhooks/${encodeURIComponent(endpointId)}/`),
  });
}


export interface UploadUrlResult {
  uploadUrl: string | null;
  publicUrl: string | null;
  storageKey: string | null;
  raw: unknown;
}

export async function createVideoUploadUrl(fileName: string): Promise<UploadUrlResult> {
  const payload = await request<any>({
    method: "POST",
    url: url("/videos/upload-url/"),
    data: { file_name: fileName },
  });
  return {
    uploadUrl: payload?.upload_url ?? null,
    publicUrl: payload?.public_url ?? null,
    storageKey: payload?.storage_key ?? null,
    raw: payload,
  };
}

export interface RegisterVideoInput {
  title: string;
  sourceUrl: string;
  resolutions: Array<"240" | "360" | "480" | "720" | "1080">;
  generateSubtitles?: boolean;
  drm?: boolean;
  folderPublicId?: string;
  originalFilename?: string;
  contentType?: string;
  sizeBytes?: number;
  customTags?: Record<string, string>;
}

export async function registerVideo(input: RegisterVideoInput): Promise<AssetV1> {
  const payload = await request<any>({
    method: "POST",
    url: url("/videos/"),
    data: {
      title: input.title,
      source_url: input.sourceUrl,
      resolutions: input.resolutions,
      drm: input.drm ?? false,
      ...(input.generateSubtitles !== undefined ? { generate_subtitles: input.generateSubtitles } : {}),
      ...(input.folderPublicId ? { folder_public_id: input.folderPublicId } : {}),
      ...(input.originalFilename ? { original_filename: input.originalFilename } : {}),
      ...(input.contentType ? { content_type: input.contentType } : {}),
      ...(input.sizeBytes !== undefined ? { size_bytes: input.sizeBytes } : {}),
      ...(input.customTags ? { customTags: input.customTags } : {}),
    },
  });
  return toAsset(payload?.asset ?? payload);
}
