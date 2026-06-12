/**
 * Commerce · Price — MySQL (Prisma) branch types.
 *
 * Table: `ws_package_course_ebook_price` (Phase 3a, read-only lookup; flag OFF
 * until the commerce-wave flip). 1353 rows. Pure plan/pricing lookup — the
 * single lowest-risk table in the commerce wave (no writes, no auth fields).
 *
 * SCOPE / DRIFT NOTES (verified against the live DDL on 2026-06-12):
 *
 *  - The Prisma `PackageCourseEbookPrice` model is a FAITHFUL 1:1 of the SQL
 *    table — all 13 columns present with correct `@map`s. No schema fix was
 *    required (unlike Package/Course).
 *
 *  - `duration` is stored in **DAYS**, not months (pinned by memory
 *    `project_plan_duration_unit`). Any consumer computing `endAt` from a plan
 *    must use the planDuration helper with `asDays: true` (→ `setDate`), NEVER
 *    `setMonth`. This module only surfaces the raw `duration` int; the endAt
 *    computation lives at the subscription/write boundary (Phase 3b).
 *
 *  - `material_price` is nullable in SQL (`Int?`) but the Mongo model defaults
 *    it to `0`. The transformer coalesces null → 0 to preserve the contract.
 *
 *  - Exactly one of `packageId` / `courseId` / `ebookId` is set per row (the
 *    Mongo model enforces this with a pre-validate hook). The SQL table does not
 *    enforce it, but the migrated data honours it; ids are surfaced as nullable
 *    strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_package_course_ebook_price` row → DTO. Mongo `PackageCourseEbookPrice`-shaped. */
export interface PriceDto {
  _id: string;
  packageId: string | null;
  courseId: string | null;
  ebookId: string | null;
  name: string | null;
  /** DAYS (not months) — see drift note. */
  duration: number;
  price: number;
  withMaterial: boolean;
  /** Coalesced null → 0 to match the Mongo default. */
  materialPrice: number;
  isDefault: boolean;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Which owning entity a price row belongs to. */
export type PriceOwner = "package" | "course" | "ebook";
