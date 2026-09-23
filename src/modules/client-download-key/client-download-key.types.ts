

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
