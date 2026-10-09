// StreamOS config: provider switch and v1 API settings.
// StreamOS has two incompatible APIs (legacy streamapi.streamos.co vs v1
// api.streamos.in; see docs/migration/STREAMOS_V1_CHANGE_MATRIX.md), selected by
// STREAMOS_PROVIDER: "legacy" → libs/streamos/streamos.service.ts, "v1" →
// libs/streamos/streamos.v1.service.ts. Default stays "legacy" because existing
// ws_live_session rows hold legacy stream ids and CDN URLs.

export type StreamosProvider = "legacy" | "v1";

const DEFAULT_V1_BASE = "https://api.streamos.in/api/public/v1";

/** Which StreamOS API new streams are created against. */
export const streamosProvider = (): StreamosProvider =>
  process.env.STREAMOS_PROVIDER?.trim().toLowerCase() === "v1" ? "v1" : "legacy";

export const isStreamosV1 = (): boolean => streamosProvider() === "v1";

/** Base URL for the v1 API, without a trailing slash. */
export const streamosV1Base = (): string =>
  (process.env.STREAMOS_API_BASE?.trim() || DEFAULT_V1_BASE).replace(/\/+$/, "");

/** `sk_live_…` key. Empty string when unset — callers raise a 500 with a clear message. */
export const streamosV1ApiKey = (): string => process.env.STREAMOS_API_KEY?.trim() ?? "";

/**
 * Deployment tag stamped on every v1 stream and checked on every v1 webhook.
 * Staging and production share one StreamOS organisation and API key, so a
 * webhook can receive the other environment's recordings; without this tag an
 * id collision could attach a recording to the wrong class. Defaults to NODE_ENV.
 */
export const streamosEnvTag = (): string =>
  process.env.STREAMOS_ENV_TAG?.trim() || process.env.NODE_ENV?.trim() || "development";

/** HMAC signing secret returned once by POST /webhooks/. */
export const streamosV1WebhookSecret = (): string =>
  process.env.STREAMOS_WEBHOOK_SIGNING_SECRET?.trim() ?? "";
