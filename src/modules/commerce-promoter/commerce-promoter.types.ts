/**
 * Commerce · Promoter (READ) — MySQL (Prisma) branch types.
 *
 * Table: `ws_promoter` (Phase 3a, READ-ONLY; flag OFF until the commerce-wave
 * flip). 114 rows. The promocode OWNER master — a promoter owns promocodes and
 * earns the `promoter_percentage` on promoted plans. Read-only here (the
 * promoter auth/portal is out of this wave's scope).
 *
 * SCHEMA-DRIFT / FIELD NOTES (verified against the live DDL 2026-06-12):
 *
 *  - **`password` + `last_seen_at` are auth fields** present in the DDL but the
 *    Prisma model omits `last_seen_at`. `password` (varchar) DOES exist in the
 *    Prisma model — it is **NEVER surfaced** in the DTO (the Mongo model marks
 *    it `select:false`). Like `ws_course_educator`, this is a full entity, not a
 *    join table; we read only the public master fields.
 *  - **`full_name`/`email`/`phone` nullable (FIXED):** the DDL marks all three
 *    `Null: YES` but the Prisma model typed them non-nullable `String`. Relaxed
 *    to `String?` so a NULL row can't crash a read (no NULLs in current data).
 *  - **Name casing:** Mongo uses camelCase (`fullName`, `isDelete`); the DTO
 *    uses the Mongo names. Mongo also has `lastLoginDate`/`lastLoginIp` which do
 *    NOT map to the SQL `last_seen_at` (different concept) — not produced.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_promoter` row → DTO (Mongo `Promoter`-shaped, password excluded). */
export interface PromoterDto {
  _id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  status: boolean;
  isDelete: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
