const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD_PCT = 5;
/** How long an upload request waits for its queued sheet before answering "queued". */
const DEFAULT_UPLOAD_WAIT_MS = 25_000;
/** Above this many sheets queued, an upload answers "queued" at once instead of waiting. */
const DEFAULT_UPLOAD_WAIT_MAX_BACKLOG = 20;

export const OCR_SERVICE = {
  BASE_URL: (process.env.OCR_SERVICE_URL || "").replace(/\/+$/, ""),
  INTERNAL_TOKEN: process.env.OCR_INTERNAL_TOKEN || "",
  TIMEOUT_MS: Number(process.env.OCR_EXTRACTION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  UPLOAD_WAIT_MS: Number(process.env.RANK_SHEET_UPLOAD_WAIT_MS) || DEFAULT_UPLOAD_WAIT_MS,
  UPLOAD_WAIT_MAX_BACKLOG:
    Number(process.env.RANK_SHEET_UPLOAD_WAIT_MAX_BACKLOG) || DEFAULT_UPLOAD_WAIT_MAX_BACKLOG,
  LOW_CONFIDENCE_THRESHOLD_PCT:
    Number(process.env.OCR_LOW_CONFIDENCE_THRESHOLD_PCT) || DEFAULT_LOW_CONFIDENCE_THRESHOLD_PCT,
} as const;

export const isOcrServiceConfigured = (): boolean =>
  Boolean(OCR_SERVICE.BASE_URL && OCR_SERVICE.INTERNAL_TOKEN);
