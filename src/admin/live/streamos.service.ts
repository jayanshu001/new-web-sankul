import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import logger from "../../utils/logger";

const STREAMOS_BASE = "https://streamapi.streamos.co/streamos";

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
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
    return new StreamosError("Streamos is rate limiting requests (429).", 429, status, data);
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
  streamId: number;
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
  const streamId = Number(payload.streamId ?? payload.streamID ?? payload.id);
  const rtmpUrl = payload.rtmpURL ?? payload.rtmpUrl;
  const hlsUrl  = payload.hlsURL  ?? payload.hlsUrl;

  if (!streamId || !rtmpUrl || !hlsUrl) {
    throw new StreamosError(
      "Unexpected response from Streamos createStream.",
      502,
      res.status,
      body
    );
  }

  return {
    streamId,
    rtmpUrl,
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
  raw: any;
}

export async function getStreamDetails(streamId: number): Promise<StreamDetailsResult> {
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
    raw: body,
  };
}

export async function endStream(streamId: number): Promise<any> {
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
