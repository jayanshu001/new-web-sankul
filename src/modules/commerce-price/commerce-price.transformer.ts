// Commerce prices: row to DTO mapping (response shape is frozen).
import type { PackageCourseEbookPrice } from "@prisma/client";
import type { PriceDto } from "./commerce-price.types";

/**
 * Owner ids use `0` (not only NULL) as the "not this owner" sentinel in SQL;
 * exactly one owner is set per row. `0`/null → null.
 */
const ownerId = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

export const toPriceDto = (row: PackageCourseEbookPrice): PriceDto => ({
  _id: String(row.id),
  packageId: ownerId(row.packageId),
  courseId: ownerId(row.courseId),
  ebookId: ownerId(row.ebookId),
  name: row.name ?? null,
  duration: row.duration,
  price: row.price,
  withMaterial: row.withMaterial,
  materialPrice: row.materialPrice ?? 0,
  isDefault: row.isDefault,
  status: row.status,
  // Effective flag: computed from sales or admin pin.
  isMostPopular: (row as any).isMostPopular ?? false,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
