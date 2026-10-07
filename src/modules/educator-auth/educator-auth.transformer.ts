// Educator auth: educator DTOs and password verification.
import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { CourseEducator } from "@prisma/client";

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

/** Admin master-list DTO; password always omitted. */
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
  // The admin UI silently drops rows with a null updatedAt, and legacy rows have
  // NULL updated_at, so each timestamp falls back to the other.
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
 * Stored hashes are bcrypt (`$2y$`/`$2b$`) or legacy Laravel MD5 (32-char hex).
 * bcrypt first; MD5 only for 32-char hex. Empty-string MD5 (`d41d8cd9...`) never
 * matches a non-empty input, as intended.
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
  return false;
};
