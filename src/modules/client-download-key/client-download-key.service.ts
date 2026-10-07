// Download encryption key: get and save the per-user offline download key.
import { downloadKeyRepository } from "./client-download-key.repository";
import { toDownloadEncryptionKeyDto } from "./client-download-key.transformer";
import type { DownloadEncryptionKeyDto } from "./client-download-key.types";

/**
 * This key is the only thing that can read a user's downloaded `.wsenc` files;
 * returning the wrong customer's key or silently replacing it bricks their offline
 * library. `customerId` always comes from the Bearer token, never the caller.
 */

export const parseCustomerId = (id: string | undefined): number | null => {
  if (!id) return null;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export type GetDownloadKeyResult =
  | { ok: true; dto: DownloadEncryptionKeyDto }
  | { ok: false; reason: "customer_missing" | "no_key" };

/**
 * `no_key` becomes a 404, which tells the app to generate and PUT its key, so it
 * must never stand in for a transient failure: DB errors propagate (500).
 */
export const getDownloadKey = async (customerId: number): Promise<GetDownloadKeyResult> => {
  const row = await downloadKeyRepository.findByCustomer(customerId);
  if (!row) return { ok: false, reason: "customer_missing" };
  if (!row.downloadKeyHex) return { ok: false, reason: "no_key" };
  return { ok: true, dto: toDownloadEncryptionKeyDto(row.downloadKeyHex) };
};

export type SaveDownloadKeyResult =
  | { ok: true; dto: DownloadEncryptionKeyDto; changed: boolean }
  | { ok: false; reason: "customer_missing" };

/**
 * Re-sending the stored key issues no UPDATE: the key shares
 * `ws_customer.updated_at` with the profile, and the app retries PUTs after a
 * failed sync. Comparison is case-insensitive, but the value is stored exactly as
 * submitted so a later GET returns it byte-for-byte.
 */
export const saveDownloadKey = async (
  customerId: number,
  keyHex: string
): Promise<SaveDownloadKeyResult> => {
  const row = await downloadKeyRepository.findByCustomer(customerId);
  if (!row) return { ok: false, reason: "customer_missing" };

  if (row.downloadKeyHex && row.downloadKeyHex.toLowerCase() === keyHex.toLowerCase()) {
    return { ok: true, dto: toDownloadEncryptionKeyDto(row.downloadKeyHex), changed: false };
  }

  const res = await downloadKeyRepository.setKey(customerId, keyHex);
  if (res.count === 0) return { ok: false, reason: "customer_missing" };
  return { ok: true, dto: toDownloadEncryptionKeyDto(keyHex), changed: true };
};
