import { downloadKeyRepository } from "./client-download-key.repository";
import { toDownloadEncryptionKeyDto } from "./client-download-key.transformer";
import type { DownloadEncryptionKeyDto } from "./client-download-key.types";

/**
 * Offline-download encryption key — per-customer AES-256 key custody, stored on
 * `ws_customer.download_key_hex`.
 *
 * INVARIANT worth stating loudly: this key is the ONLY thing that can read a
 * user's already-downloaded `.wsenc` files. Handing back the wrong customer's
 * key, or silently replacing a key, bricks a user's offline library. Every
 * function here takes a numeric `customerId` derived from the Bearer token —
 * there is no code path that accepts a caller-supplied owner id.
 *
 * Living on the customer row means one key per account is guaranteed by the
 * existing primary key: there is no second row to race against and no join.
 */

/** `req.user.id` arrives as a string; reject anything that isn't a positive int. */
export const parseCustomerId = (id: string | undefined): number | null => {
  if (!id) return null;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export type GetDownloadKeyResult =
  | { ok: true; dto: DownloadEncryptionKeyDto }
  | { ok: false; reason: "customer_missing" | "no_key" };

/**
 * Read this customer's key.
 *
 * `no_key` becomes a 404, which is the app's signal to generate its
 * one-and-only key and PUT it. Because a 404 is what triggers key generation it
 * must NEVER stand in for a transient failure — a DB error propagates out of
 * here as an exception (→ 500) rather than being swallowed into `no_key`.
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
 * Store or replace this customer's key.
 *
 * Re-sending the key we already hold is a true no-op: no UPDATE is issued at
 * all. That matters more here than it would on a dedicated table — the key
 * shares `ws_customer.updated_at` with the rest of the profile, so a churning
 * re-PUT (the app retries after a failed sync) would otherwise make the
 * customer row look edited on every app launch.
 *
 * Comparison is case-insensitive because hex decodes identically either way,
 * but the value is stored EXACTLY as submitted — no case normalization — so
 * what the app PUTs is byte-for-byte what a later GET returns.
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

/** Account deletion cleanup — clears this customer's key only. */
export const clearDownloadKey = async (customerId: number): Promise<number> => {
  const res = await downloadKeyRepository.clearKey(customerId);
  return res.count;
};
