import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { Promoter } from "@prisma/client";

/**
 * Promoter profile DTO — same shape the Mongo `buildProfile` returns so the API
 * contract is unchanged. `id` is the stringified SQL int (Mongo returned the
 * ObjectId). `password` is NEVER surfaced.
 */
export interface PromoterDto {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  image: string;
  status: boolean;
}

export const toPromoterAuthDto = (row: Promoter): PromoterDto => ({
  id: String(row.id),
  fullName: row.full_name ?? "",
  email: row.email ?? "",
  phone: row.phone ?? "",
  image: row.image ?? "",
  status: row.status,
});

/**
 * Verify a plaintext password against the stored hash. ws_promoter currently
 * holds bcrypt only (1/114 rows has a password), but legacy Laravel rows could
 * be MD5 — so mirror the educator helper: bcrypt first, then 32-char-hex MD5.
 * Empty/NULL password → never matches (promoter has no login).
 */
export const verifyPromoterPassword = async (
  plain: string,
  stored: string
): Promise<boolean> => {
  if (!stored) return false;
  if (stored.startsWith("$2")) return bcrypt.compare(plain, stored);
  if (/^[a-f0-9]{32}$/i.test(stored)) {
    const md5 = crypto.createHash("md5").update(plain).digest("hex");
    return md5.toLowerCase() === stored.toLowerCase();
  }
  return false;
};
