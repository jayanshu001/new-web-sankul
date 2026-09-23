import type { JobSuggestedProduct } from "@prisma/client";
import type { SuggestedProductDto } from "./suggested-product.types";

export const toSuggestedProductDto = (row: JobSuggestedProduct): SuggestedProductDto => ({
  _id: String(row.id),
  placementType: row.placementType,
  postId: row.postId ? String(row.postId) : undefined,
  productType: row.productType,
  productId: String(row.productId),
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  createdAt: row.createdAt ?? undefined,
});
