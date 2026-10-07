// Download encryption key: DTO type and key format.
export const DOWNLOAD_KEY_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Shared by GET and PUT. Deliberately just `{ key }`: no owner id or timestamps,
 * so nothing extra can leak into logs or crash reports.
 */
export interface DownloadEncryptionKeyDto {
  key: string;
}
