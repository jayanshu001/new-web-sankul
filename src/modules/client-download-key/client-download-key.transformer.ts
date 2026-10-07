// Download encryption key: key to DTO mapping.
import type { DownloadEncryptionKeyDto } from "./client-download-key.types";

/**
 * Takes the key alone, not the `Customer` row, so the account's secrets
 * (`password`, `otp`, ...) can never be spread into the response.
 */
export const toDownloadEncryptionKeyDto = (keyHex: string): DownloadEncryptionKeyDto => ({
  key: keyHex,
});
