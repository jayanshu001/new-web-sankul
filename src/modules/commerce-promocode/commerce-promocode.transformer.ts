import type { Promocode, PromotedPackageCourseEbook } from "@prisma/client";
import type { PromocodeDto, PromotedPlanDto } from "./commerce-promocode.types";

/** Owner id → string, treating SQL's `0` sentinel as "unset" (→ null). */
const ownerId = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

/** `ws_promoted_package_course_ebook` row → DTO. Percentages are float/Decimal. */
export const toPromotedPlanDto = (row: PromotedPackageCourseEbook): PromotedPlanDto => ({
  _id: String(row.id),
  promocodeId: ownerId(row.promocodeId),
  planId: ownerId(row.planId),
  type: row.type ?? null,
  promoterPercentage: row.promoterPercentage != null ? Number(row.promoterPercentage) : 0,
  customerPercentage: row.customerPercentage != null ? Number(row.customerPercentage) : 0,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

/**
 * `ws_promocode` row → SQL-faithful DTO. When the row was read with its promoted
 * plans included, they are mapped onto `promotedPlans`. This is NOT the Mongo
 * `appliesTo`/`discountValue` shape (see types.ts divergence note).
 */
export const toPromocodeDto = (
  row: Promocode & { promotedPackageCourseEbook?: PromotedPackageCourseEbook[] }
): PromocodeDto => ({
  _id: String(row.id),
  promoterId: ownerId(row.promoterId),
  promocode: row.promocode ?? null,
  title: row.title ?? null,
  description: row.description ?? null,
  promoStartAt: row.promo_start_at ?? null,
  promoExpireAt: row.promo_expire_at ?? null,
  type: row.type,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
  ...(row.promotedPackageCourseEbook
    ? { promotedPlans: row.promotedPackageCourseEbook.map(toPromotedPlanDto) }
    : {}),
});
