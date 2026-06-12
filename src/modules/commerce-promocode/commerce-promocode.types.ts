/**
 * Commerce · Promocode (READ) — MySQL (Prisma) branch types.
 *
 * Tables: `ws_promocode` (2 rows) + `ws_promoted_package_course_ebook` (5 rows)
 * (Phase 3a, READ-ONLY; flag OFF). The SQL-faithful promocode representation:
 * a promocode owned by a promoter, with a set of "promoted plans" each carrying
 * a per-plan `promoter_percentage` + `customer_percentage` split.
 *
 * ⚠ MODEL DIVERGENCE — DO NOT confuse with the client `applyPromocode` contract
 * ─────────────────────────────────────────────────────────────────────────────
 * The live Mongo `PromoCode` model (src/models/course/PromoCode.model.ts,
 * collection `ws_promo_codes`) uses a DIFFERENT, NEWER discount mechanism:
 *   - `discountType` (flat|percentage) + `discountValue`, and
 *   - `appliesTo: { type: package|course|liveCourse, ids: [] }`
 * The client `applyPromocode`/`listPromocodes` paths read THAT shape (via the
 * `promoCovers`/`computePromoDiscount` helpers). The SQL tables here have NONE
 * of those fields — no `discountType`/`discountValue`/`appliesTo`; the discount
 * lives per-plan in `ws_promoted_package_course_ebook` as a promoter/customer
 * percentage split keyed by `pcb_price_id` (the plan).
 *
 * Therefore the CLIENT promocode contract CANNOT be reproduced from these SQL
 * tables. This module builds the SQL-faithful reads (the legacy promoter-portal
 * / admin representation) ONLY, kept flag OFF. The `appliesTo` reconciliation is
 * a separate, later effort (decision: SQL-faithful reads, flag OFF — 2026-06-12).
 *
 * SCHEMA-DRIFT NOTES (verified against the live DDL 2026-06-12):
 *  - `promocode`, `promo_start_at`, `promo_expire_at` are nullable in the DDL
 *    but the Prisma model typed them non-nullable → relaxed to optional (FIXED).
 *  - `title`/`description` are NOT NULL in the DDL but Prisma had them optional
 *    (safe direction — non-null read into nullable).
 *  - `ws_promoted_package_course_ebook.pcb_price_id` → `planId` = the
 *    PackageCourseEbookPrice plan row; percentages are `float`/Decimal.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */
import type { PromocodeType } from "@prisma/client";

/** A single promoted-plan row (`ws_promoted_package_course_ebook`). */
export interface PromotedPlanDto {
  _id: string;
  promocodeId: string | null;
  /** The promoted plan (`pcb_price_id` → PackageCourseEbookPrice). */
  planId: string | null;
  type: string | null;
  promoterPercentage: number;
  customerPercentage: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** `ws_promocode` row → DTO (SQL-faithful; NOT the Mongo appliesTo shape). */
export interface PromocodeDto {
  _id: string;
  promoterId: string | null;
  promocode: string | null;
  title: string | null;
  description: string | null;
  promoStartAt: Date | null;
  promoExpireAt: Date | null;
  type: PromocodeType;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** The promoted plans (per-plan percentage split) — present on detail reads. */
  promotedPlans?: PromotedPlanDto[];
}
