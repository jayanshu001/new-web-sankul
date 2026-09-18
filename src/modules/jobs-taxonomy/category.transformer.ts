import type { JobCategory } from "@prisma/client";
import type { CategoryDto } from "./category.types";

export const toCategoryDto = (row: JobCategory): CategoryDto => ({
  _id: String(row.id),
  slug: row.slug,
  label: row.label,
  sortOrder: row.sortOrder,
  imageUrl: row.imageUrl ?? undefined,
  imageAlt: row.imageAlt ?? undefined,
  showOnHome: row.showOnHome,
  isActive: row.isActive,
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
