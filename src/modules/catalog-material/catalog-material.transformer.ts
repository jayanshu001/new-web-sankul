import type { MaterialCategory } from "@prisma/client";
import type { MaterialCategoryDto } from "./catalog-material.types";

/** `ws_material_category` row → DTO (Mongo `MaterialCategory`-shaped). */
export const toMaterialCategoryDto = (row: MaterialCategory): MaterialCategoryDto => ({
  _id: String(row.id),
  title: row.name,
  slug: row.slug,
  image: row.image ?? null,
  parent: row.parent,
  order: row.order_by,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
