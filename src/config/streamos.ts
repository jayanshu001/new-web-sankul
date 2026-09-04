// src/config/streamos.ts
//
// StreamOS provider configuration.
//
// StreamOS shipped a NEW API on a new host (https://api.streamos.in/api/public/v1)
// that shares nothing with the platform we integrated against
// (https://streamapi.streamos.co/streamos) — different auth, paths, payloads and
// webhook format. See docs/migration/STREAMOS_V1_CHANGE_MATRIX.md.
//
// Both clients therefore run side by side, selected by STREAMOS_PROVIDER:
//   - "legacy" (default) → src/admin/live/streamos.service.ts
//   - "v1"               → src/admin/live/streamos.v1.service.ts
//
// The default is deliberately "legacy": existing ws_live_session rows hold
// legacy stream ids and legacy CDN URLs, so flipping this must be a conscious
// deploy-time decision, never a side effect of shipping the new client.

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
 * Which deployment this process is. Stamped onto every v1 stream we create and
 * checked on every v1 webhook delivery.
 *
 * StreamOS confirmed staging and production share ONE organisation and ONE API
 * key. That means both environments' streams live in the same StreamOS account,
 * and a webhook registered for one environment can receive the other's
 * recordings. Without a discriminator, a staging test recording delivered to
 * production would be hunted for among production's sessions — and on an id
 * collision could attach to the wrong class.
 *
 * Defaults to NODE_ENV so an unset var still separates prod from dev.
 */
export const streamosEnvTag = (): string =>
  process.env.STREAMOS_ENV_TAG?.trim() || process.env.NODE_ENV?.trim() || "development";

/** HMAC signing secret returned once by POST /webhooks/. */
export const streamosV1WebhookSecret = (): string =>
  process.env.STREAMOS_WEBHOOK_SIGNING_SECRET?.trim() ?? "";
