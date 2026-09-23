import type { DownloadEncryptionKeyDto } from "./client-download-key.types";

/**
 * Stored key → API DTO.
 *
 * Takes the key alone rather than a `Customer` row, on purpose: the row carries
 * `password`, `otp` and the rest of the account, and a transformer that accepts
 * the whole row is one careless spread away from returning it. Nothing but the
 * 64 hex characters can reach this function.
 */
export const toDownloadEncryptionKeyDto = (keyHex: string): DownloadEncryptionKeyDto => ({
  key: keyHex,
});
