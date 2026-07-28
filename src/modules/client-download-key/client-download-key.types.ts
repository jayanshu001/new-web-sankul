/**
 * Offline-download encryption key — per-customer AES-256 key custody.
 *
 * The mobile app generates 32 random bytes ONCE per user, hex-encodes them, and
 * parks the result here so the same key can be restored after logout /
 * reinstall / local-cache expiry. The server is pure custody: it never decrypts
 * anything and never needs to understand the `.wsenc` container.
 *
 * Storage: `ws_customer.download_key_hex` — one key per account comes free from
 * the customer primary key. NULL means "never stored" (the API's 404 state).
 */

/** Exactly 32 bytes, hex-encoded → 64 hex characters (AES-256). */
export const DOWNLOAD_KEY_HEX_LENGTH = 64;

/** Canonical validation for the key material. Case-insensitive hex. */
export const DOWNLOAD_KEY_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Stable API shape for both GET and PUT.
 *
 * Deliberately just `{ key }` — no `_id`, no timestamps, no `customerId`.
 * Echoing back the owner id would only invite the client to key its local cache
 * on a server-supplied value, and every extra field is one more place a secret
 * can leak into a log or a crash report.
 */
export interface DownloadEncryptionKeyDto {
  key: string;
}
