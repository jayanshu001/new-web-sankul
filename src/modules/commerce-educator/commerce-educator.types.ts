/**
 * Commerce · Educator (READ) — MySQL (Prisma) branch types.
 *
 * Table: `ws_course_educator` (Phase 3a, READ-ONLY; flag OFF until the
 * commerce-wave flip). 56 rows. A **full entity** (email/password/about/view/
 * last_seen_at) — NOT a join/relation table (it was mis-grouped as a "catalog
 * relation" earlier). Read-only master here; the educator auth/portal is out of
 * this wave. Course rows reference it via `Course.courseEducatorId`.
 *
 * SCHEMA-DRIFT / FIELD NOTES (verified against the live DDL 2026-06-12):
 *
 *  - **`id` is `bigint unsigned` but the Prisma model maps it as `Int`.** Current
 *    ids are 20–85 (56 rows, autoincrement) — NO overflow today. We deliberately
 *    KEEP `Int`: changing `CourseEducator.id Int→BigInt` would ripple into the
 *    `Course.courseEducatorId` FK and the already-built/verified catalog-course
 *    module for zero present benefit. ⚠ LATENT RISK logged: revisit (educator +
 *    Course FK together) only if ids ever approach 2^31.
 *  - **`image` nullable in DDL** (`Null: YES`) but Prisma typed it non-nullable
 *    `String`. No NULLs in current data; the DTO surfaces it as `string | null`
 *    defensively (the Mongo model marks `image` required, so embedded
 *    projections always have it for real rows).
 *  - **`password` is NEVER surfaced** — the client educator path does
 *    `.select("-password")`. The DTO excludes it entirely.
 *  - **SQL-only / Mongo-only field gaps:** the DDL has `last_seen_at` +
 *    `email_verified_at` (NOT in the Prisma model, not needed for the public
 *    master). The Mongo model has a `deleted` soft-delete flag that the SQL
 *    table LACKS (SQL has only `status`) — so the MySQL branch treats `status`
 *    as the sole visibility gate (active = status=true).
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_course_educator` row → DTO (Mongo `CourseEducator`-shaped, no password). */
export interface EducatorDto {
  _id: string;
  name: string;
  image: string | null;
  about: string;
  email: string;
  view: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Lightweight educator projection for embedding in course listings. */
export interface EducatorRefDto {
  _id: string;
  name: string;
  image: string | null;
}
