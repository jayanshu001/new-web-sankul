import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { CourseEducator } from "@prisma/client";

/**
 * Educator profile DTO — same shape the Mongo `buildProfile` returns so the
 * API contract is unchanged across the migration. `id` is the stringified SQL
 * int (Mongo returned the ObjectId).
 */
export interface EducatorDto {
  id: string;
  name: string;
  email: string;
  image: string;
  about: string;
  view: number;
  status: boolean;
}

export const toEducatorDto = (row: CourseEducator): EducatorDto => ({
  id: String(row.id),
  name: row.name,
  email: row.email,
  image: row.image ?? "",
  about: row.about ?? "",
  view: row.view ?? 0,
  status: row.status,
});

/**
 * Admin master-list DTO. Mirrors the Mongo educator document shape the admin UI
 * expects (uses `_id`, carries status + timestamps; password always omitted).
 */
export interface EducatorListDto {
  _id: string;
  name: string;
  email: string;
  image: string;
  about: string;
  view: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export const toEducatorListDto = (row: CourseEducator): EducatorListDto => {
  // Mongo (timestamps:true) always populated both dates, so the admin UI assumes
  // a non-null updatedAt per row (it formats the date and silently drops rows it
  // can't). Legacy ws_course_educator rows have updated_at = NULL, which broke
  // that contract. Coalesce each timestamp to the other so a row that has either
  // reports both — restoring Mongo parity.
  const createdAt = row.createdAt ?? row.updatedAt ?? null;
  const updatedAt = row.updatedAt ?? row.createdAt ?? null;
  return {
    _id: String(row.id),
    name: row.name,
    email: row.email,
    image: row.image ?? "",
    about: row.about ?? "",
    view: row.view ?? 0,
    status: row.status,
    createdAt,
    updatedAt,
  };
};

/**
 * Verify a plaintext password against the stored hash. Legacy `ws_course_educator`
 * rows carry a mix of formats:
 *   - bcrypt (`$2y$`/`$2b$`, 60 chars) — modern rows
 *   - MD5 (32-char hex) — legacy Laravel rows
 * Try bcrypt first; fall back to MD5 only when the stored value is 32-char hex.
 * Empty-string MD5 (`d41d8cd9...`) means "no real password" — those never match
 * a non-empty input, which is the desired behavior.
 */
export const verifyEducatorPassword = async (
  plain: string,
  stored: string
): Promise<boolean> => {
  if (!stored) return false;
  if (stored.startsWith("$2")) {
    return bcrypt.compare(plain, stored);
  }
  if (/^[a-f0-9]{32}$/i.test(stored)) {
    const md5 = crypto.createHash("md5").update(plain).digest("hex");
    return md5.toLowerCase() === stored.toLowerCase();
  }
  // Unknown format — be safe and reject.
  return false;
};
