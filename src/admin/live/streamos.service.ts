import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import logger from "../../utils/logger";

const STREAMOS_BASE = "https://streamapi.streamos.co/streamos";
// VOD (recording) metadata lives at the API ROOT, NOT under /streamos — the
// /streamos-prefixed variant 404s. This is what resolves a finished recording
// into its playable master HLS + per-quality mp4/m3u8 URLs.
const STREAMOS_ROOT = "https://streamapi.streamos.co";

// Only transient gateway blips are retried inline (fast, small backoff).
// 429 is deliberately excluded: per the Streamos docs it means the org has
// exceeded its stream capacity and they ask for a ~30s back-off — far too
// long to hold an admin HTTP request open. We fail fast on 429 instead and
// return an actionable error so the admin can retry shortly.
const RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export class StreamosError extends Error {
  status: number;
  upstreamStatus?: number;
  upstreamBody?: unknown;

  constructor(message: string, status: number, upstreamStatus?: number, upstreamBody?: unknown) {
    super(message);
    this.name = "StreamosError";
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.upstreamBody = upstreamBody;
  }
}

function getCreds(): { accessKey: string; accessSecret: string } {
  const accessKey = process.env.STREAMOS_ACCESS_KEY;
  const accessSecret = process.env.STREAMOS_ACCESS_SECRET;
  if (!accessKey || !accessSecret) {
    throw new StreamosError(
      "Streamos credentials are not configured on the server.",
      500
    );
  }
  return { accessKey, accessSecret };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await axios.request<T>({
        timeout: 15_000,
        validateStatus: () => true,
        ...config,
      }).then((res) => {
        if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
          throw Object.assign(new Error(`Retryable status ${res.status}`), { __retryable: true, response: res });
        }
        if (res.status >= 400) {
          throw mapHttpError(res);
        }
        return res;
      });
    } catch (err: any) {
      lastError = err;
      const retryable = err?.__retryable === true ||
        (err instanceof AxiosError && (!err.response || RETRY_STATUSES.has(err.response.status)));

      if (!retryable || attempt === MAX_RETRIES) {
        if (err instanceof StreamosError) throw err;
        if (err?.response) throw mapHttpError(err.response);
        throw new StreamosError(
          `Streamos request failed: ${err?.message ?? "unknown error"}`,
          502
        );
      }

      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      logger.warn("Streamos retry", { attempt: attempt + 1, backoff, url: config.url });
      await sleep(backoff);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new StreamosError("Streamos request failed.", 502);
}

function mapHttpError(res: AxiosResponse): StreamosError {
  const { status, data } = res;
  if (status === 403) {
    return new StreamosError("Streamos rejected credentials (403).", 502, status, data);
  }
  if (status === 404) {
    return new StreamosError("Streamos service unavailable (404).", 502, status, data);
  }
  if (status === 429) {
    // Per Streamos docs: exceeded stream capacity / servers overloaded.
    return new StreamosError(
      "Streamos is at capacity or rate-limiting (429). Please wait ~30s and try again.",
      429,
      status,
      data
    );
  }
  return new StreamosError(
    `Streamos error (${status}).`,
    502,
    status,
    data
  );
}

export interface StreamosRecording {
  quality: string;
  file_size?: number;
  path: string;
}

export interface QualityHlsUrls {
  [resolution: string]: string;
}

function normalizeRecordings(raw: unknown): StreamosRecording[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r: any) => r && typeof r.path === "string" && r.path.length > 0)
    .map((r: any) => ({
      quality: typeof r.quality === "string" ? r.quality : "",
      file_size: typeof r.file_size === "number" ? r.file_size : Number(r.file_size) || undefined,
      path: r.path,
    }));
}

// Populate `file_size` (bytes) on MP4 entries by reading Content-Length via a HEAD
// request. Best-effort + concurrent; never throws — an entry keeps its existing
// file_size (or null) on any failure. Only MP4 is sized: an m3u8's Content-Length
// is just the manifest text, not the video, so HLS entries are skipped. Generic so
// it works on both StreamosRecording and the controller's ILiveSessionRecording.
export async function enrichMp4Sizes<T extends { path?: string; file_size?: number | null }>(
  recs: T[]
): Promise<T[]> {
  if (!Array.isArray(recs) || recs.length === 0) return recs ?? [];
  return Promise.all(
    recs.map(async (r) => {
      if (typeof r.file_size === "number" && r.file_size > 0) return r;
      if (!r.path || !/\.mp4(\?|$)/i.test(r.path)) return r;
      try {
        const res = await axios.head(r.path, { timeout: 10_000, validateStatus: () => true });
        const len = Number(res.headers["content-length"]);
        return Number.isFinite(len) && len > 0 ? { ...r, file_size: len } : r;
      } catch {
        return r;
      }
    })
  );
}

// Picks per-quality HLS URLs out of a createStream payload — Streamos returns
// them as `hls{240,360,480,720}pURL` fields. Returns an object keyed by the
// numeric resolution (matches the shape of streamDetails.hlsUrls).
function pickQualityHlsUrls(payload: any): QualityHlsUrls | undefined {
  const out: QualityHlsUrls = {};
  const mapping: Array<[string, string]> = [
    ["240", "hls240pURL"],
    ["360", "hls360pURL"],
    ["480", "hls480pURL"],
    ["720", "hls720pURL"],
    ["1080", "hls1080pURL"],
  ];
  for (const [res, key] of mapping) {
    const v = payload?.[key];
    if (typeof v === "string" && v.length > 0) out[res] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeQualityHlsUrls(raw: unknown): QualityHlsUrls | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: QualityHlsUrls = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface CreateStreamResult {
  // Canonical Streamos stream id — a STRING, e.g. "T_17787583234029".
  streamId: string;
  // Full RTMP push URL (base + the push-token-carrying streamId string).
  rtmpUrl: string;
  hlsUrl: string;
  hlsUrls?: QualityHlsUrls;
  raw: any;
}

export async function createStream(title: string): Promise<CreateStreamResult> {
  const { accessKey, accessSecret } = getCreds();

  const res = await request<any>({
    method: "POST",
    url: `${STREAMOS_BASE}/createStream`,
    data: {
      accessKey,
      accessSecret,
      metadata: { title },
    },
  });

  const body = res.data ?? {};
  const payload = body.data ?? body;

  // Streamos returns `streamId` as a STRING that carries the RTMP push token:
  //   "T_17787583234029?txSecret=...&txTime=..."
  // The part before "?" is the canonical id used for streamDetails / endStream
  // lookups and stored on the session; the whole string is appended to the
  // base rtmpURL to form the URL an encoder pushes to.
  const rawStreamId = String(payload.streamId ?? payload.streamID ?? payload.id ?? "").trim();
  const streamId = rawStreamId.split("?")[0];
  const rtmpBase = String(payload.rtmpURL ?? payload.rtmpUrl ?? "").replace(/\/+$/, "");
  const hlsUrl = payload.hlsURL ?? payload.hlsUrl;

  if (!streamId || !rtmpBase || !hlsUrl) {
    throw new StreamosError(
      "Unexpected response from Streamos createStream.",
      502,
      res.status,
      body
    );
  }

  return {
    streamId,
    rtmpUrl: rawStreamId ? `${rtmpBase}/${rawStreamId}` : rtmpBase,
    hlsUrl,
    hlsUrls: pickQualityHlsUrls(payload),
    raw: body,
  };
}

export interface StreamDetailsResult {
  isLive: boolean;
  rtmpUrl?: string;
  hlsUrl?: string;
  hlsUrls?: QualityHlsUrls;
  recordings: StreamosRecording[];
  // Plain (un-DRM'd) MP4 variants StreamOS produces per recording — served to
  // the client alongside the DRM-HLS `recordings`. Same {quality,file_size,path}
  // shape; `path` is a .mp4. Empty when StreamOS produced no mp4.
  mp4Recordings: StreamosRecording[];
  raw: any;
}

export async function getStreamDetails(streamId: string): Promise<StreamDetailsResult> {
  const { accessKey } = getCreds();

  const res = await request<any>({
    method: "GET",
    url: `${STREAMOS_BASE}/streamDetails`,
    params: { streamId, accessKey },
  });

  const body = res.data ?? {};
  const payload = body.data ?? body;

  return {
    isLive:    Boolean(payload.isLive ?? payload.is_live ?? false),
    rtmpUrl:   payload.rtmpURL ?? payload.rtmpUrl,
    hlsUrl:    payload.hlsURL  ?? payload.hlsUrl,
    hlsUrls:   normalizeQualityHlsUrls(payload.hlsURLs ?? payload.hlsUrls),
    recordings: normalizeRecordings(payload.recordings),
    mp4Recordings: normalizeRecordings(payload.mp4Links ?? payload.mp4links),
    raw: body,
  };
}

export async function endStream(streamId: string): Promise<any> {
  const { accessKey, accessSecret } = getCreds();

  const res = await request<any>({
    method: "DELETE",
    url: `${STREAMOS_BASE}/endStream`,
    data: { streamId, accessKey, accessSecret },
  });

  return res.data;
}

export interface UploadedVideoDetailsResult {
  recordingId: string;
  hlsUrl?: string;
  status?: string;
  title?: string;
  dateAndTime?: string;
  recordings: StreamosRecording[];
  raw: any;
}

export async function getUploadedVideoDetails(recordingId: string): Promise<UploadedVideoDetailsResult> {
  const { accessKey } = getCreds();

  const res = await request<any>({
    method: "GET",
    url: `${STREAMOS_BASE}/uploadedVideoDetails`,
    params: { recordingId, accessKey },
  });

  const body = res.data ?? {};
  const payload = body.data ?? body;

  return {
    recordingId: String(payload.recordingId ?? recordingId),
    hlsUrl: payload.hlsURL ?? payload.hlsUrl,
    status: payload.status,
    title: payload.title,
    dateAndTime: payload.dateAndTime,
    recordings: normalizeRecordings(payload.recordings),
    raw: body,
  };
}

export interface VodStreamMetaResult {
  // Master HLS playlist for the whole recording (adaptive ladder).
  hlsUrl?: string;
  duration: number | null;
  // Per-quality entries split by container. `path` is the playable URL.
  hls: StreamosRecording[]; // type === "m3u8"
  mp4: StreamosRecording[]; // type === "mp4"
  raw: any;
}

// GET https://streamapi.streamos.co/get-vod-stream-meta?id=<streamId>&accessKey=…
// Resolves a FINISHED recording (VOD) into its playable URLs. Returns
// `{ data: { hls_url, duration, meta: [{ label, url, type, height, width }] } }`.
// We split `meta[]` into m3u8 (`hls`) and mp4 (`mp4`) per-quality lists. accessKey
// stays server-side — only the resolved URLs are ever handed to the client.
export async function getVodStreamMeta(streamId: string): Promise<VodStreamMetaResult> {
  const { accessKey } = getCreds();

  const res = await request<any>({
    method: "GET",
    url: `${STREAMOS_ROOT}/get-vod-stream-meta`,
    params: { id: streamId, accessKey },
  });

  const body = res.data ?? {};
  const payload = body.data ?? {};
  const metaArr: any[] = Array.isArray(payload.meta) ? payload.meta : [];

  const toRec = (m: any): StreamosRecording => ({
    quality: typeof m.label === "string" && m.label ? m.label : m.height ? `${m.height}p` : "",
    path: String(m.url ?? ""),
  });
  const withUrl = metaArr.filter((m) => m && typeof m.url === "string" && m.url.length > 0);
  const hls = withUrl.filter((m) => String(m.type).toLowerCase() === "m3u8").map(toRec).filter((r) => r.path);
  const mp4 = withUrl.filter((m) => String(m.type).toLowerCase() === "mp4").map(toRec).filter((r) => r.path);

  const dur = Number(payload.duration);
  return {
    hlsUrl: typeof payload.hls_url === "string" && payload.hls_url ? payload.hls_url : undefined,
    duration: Number.isFinite(dur) ? dur : null,
    hls,
    mp4,
    raw: body,
  };
}

export interface OrgDetailsResult {
  name?: string;
  accessKey?: string;
  recordingWebhook?: string;
  raw: any;
}

// Note: Streamos echoes `accessSecret` back; we do NOT pass it through.
export async function getOrgDetails(): Promise<OrgDetailsResult> {
  const { accessKey, accessSecret } = getCreds();

  const res = await request<any>({
    method: "GET",
    url: `${STREAMOS_BASE}/orgDetails`,
    params: { accessKey, accessSecret },
  });

  const body = res.data ?? {};
  const payload = body.data ?? body;

  return {
    name: payload.name,
    accessKey: payload.accessKey,
    recordingWebhook: payload.recordingWebhook,
    raw: body,
  };
}

export async function updateWebhook(webhook: string): Promise<any> {
  const { accessKey, accessSecret } = getCreds();

  const res = await request<any>({
    method: "POST",
    url: `${STREAMOS_BASE}/updateWebhook`,
    data: { accessKey, accessSecret, webhook },
  });

  return res.data;
}
