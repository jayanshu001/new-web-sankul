// src/admin/live/streamos.v1.service.ts
//
// Client for the NEW StreamOS API (https://api.streamos.in/api/public/v1).
//
// This is a separate platform from the one `streamos.service.ts` talks to — not a
// version bump. Auth, paths, payload shapes and the webhook contract all differ.
// Full old→new comparison: docs/migration/STREAMOS_V1_CHANGE_MATRIX.md
//
// Deliberate choices worth knowing before editing:
//
//  - `StreamosError` is imported from the LEGACY service rather than redefined.
//    Controllers branch on `err instanceof StreamosError` to map an upstream
//    failure onto an HTTP status; a second error class would silently downgrade
//    every one of those branches to a generic 500.
//
//  - 503 is NOT retried. On this API it means NO_SLOTS_AVAILABLE (live
//    concurrency exhausted), which retrying cannot fix — it just delays an
//    actionable error. Only network faults and 502/504 are retried.
//
//  - 429 fails fast, surfacing the server's `Retry-After` instead of a
//    hardcoded back-off. Holding an admin request open is worse than a clear
//    "try again in N seconds".

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import logger from "../../utils/logger";
import { StreamosError, type QualityHlsUrls } from "./streamos.service";
import { streamosV1ApiKey, streamosV1Base } from "../../config/streamos";

export { StreamosError };

// Transient only. 503 is excluded on purpose (see header).
const RETRY_STATUSES = new Set([502, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

// ── Envelope ────────────────────────────────────────────────────────────────
// Every v1 response is { success, message, data, meta, error }.
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

// Maps a v1 error response onto a StreamosError. The v1 API names its failures
// via `error.code`, so we lead with that and fall back to the status.
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
      // `details` is a field→message map; surface it so the admin sees which field.
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

      // Unwrap the envelope. `data` is the payload on every documented endpoint.
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
 * Normalise a v1 quality label to the `<height>p` form used everywhere else.
 *
 * v1 emits `"P480"`; every consumer in this codebase — the promotion picker's
 * QUALITY_PREFERENCE list, `qualitiesFromSessionRecordings`, the app's quality
 * menu — expects `"480p"`. Converting here, at the API boundary, means none of
 * them need a v1 special case. Anything unrecognised is passed through as-is.
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

// ── Live streams ────────────────────────────────────────────────────────────

export type LiveStreamStatus = "SCHEDULED" | "READY_TO_STREAM" | "ENDED";

export interface LiveStreamV1 {
  publicId: string;
  // Empty until the stream is started — a SCHEDULED stream has no ingest yet.
  rtmpUrl: string | null;
  streamKey: string | null;
  // The push URL split into its parts. Encoders like OBS ask for "server" and
  // "stream key" in separate boxes, so surfacing these saves the admin from
  // having to split `rtmpUrl` by hand.
  rtmpServerUrl: string | null;
  rtmpServerKey: string | null;
  pushDomain: string | null;
  // Ingest credentials expire ~24h after they are minted. A stream provisioned
  // days ahead CANNOT be pushed to; re-start it to mint fresh credentials.
  pushExpiresAt: string | null;
  hlsUrl: string | null;
  // Per-quality live playback URLs keyed by label. v1 DOES provide these —
  // despite serving one adaptive master — so the app's quality picker keeps a
  // source instead of falling back to auto-only.
  hlsUrls: QualityHlsUrls | null;
  // Recording manifest. Null until the recording has finished processing.
  playbackUrl: string | null;
  status: LiveStreamStatus | string;
  latency: string | null;
  drmForRecording: boolean;
  // Populated once a recording of this stream lands in the library.
  recordedAssetId: string | null;
  tags: Record<string, unknown> | null;
  raw: unknown;
}

/** Keys are quality labels, normalised to `<height>p`. */
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

/** Creates a stream that is immediately pushable (status READY_TO_STREAM). */
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
 * Reserves a stream for a future time WITHOUT minting ingest credentials
 * (status SCHEDULED, empty rtmp_url). This is what makes the 24h push expiry
 * survivable: schedule far ahead, then `startLiveStream` at go-live.
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

// ── Assets (library / recordings) ───────────────────────────────────────────

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
  /** StreamOS returns this as a decimal STRING; coerced to a number here. */
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
  // `renditions` sits at the ROOT of the asset, NOT inside `video` — only
  // `hls_manifest_url` and `drm_content_id` live there. Reading the root is
  // the documented shape; the `video` fallback is kept purely defensively.
  const rawRends = Array.isArray(p?.renditions)
    ? p.renditions
    : Array.isArray(video?.renditions)
      ? video.renditions
      : [];
  const rends: AssetRendition[] = rawRends
    .map((r: any) => ({
      quality: normalizeQualityLabel(r?.quality),
      url: r?.url || null,
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

/**
 * Internals exposed for `scripts/verify-streamos-v1.ts` only.
 *
 * Both of these had a wrong assumption baked in on first implementation —
 * renditions were read from the wrong nesting level, and v1's "P480" labels did
 * not match the "<height>p" form every consumer expects. Neither failure would
 * have shown up in a typecheck, so they are asserted directly.
 */
export const __test__ = { normalizeQualityLabel, toAsset };

// ── Webhooks ────────────────────────────────────────────────────────────────

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

/**
 * Registered webhook endpoints.
 *
 * This is what makes a registration verifiable: the recording-health check can
 * confirm our URL is actually subscribed, rather than reporting "unknown".
 */
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

// ── Video upload (presign → PUT → register) ─────────────────────────────────

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
