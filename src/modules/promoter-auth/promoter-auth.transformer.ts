// Promoter auth: promoter DTO mapping and password verification.
import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { Promoter } from "@prisma/client";

/** `id` is the stringified SQL int; `password` is never surfaced. */
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
 * Bcrypt first, then legacy 32-char-hex MD5 (same as the educator helper).
 * An empty/NULL password never matches.
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
