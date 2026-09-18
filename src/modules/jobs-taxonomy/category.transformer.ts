import type { JobCategory, JobOrganization } from "@prisma/client";
import type { CategoryDto } from "./category.types";

type Row = JobCategory & { organization?: JobOrganization | null };

export const toCategoryDto = (row: Row): CategoryDto => ({
  _id: String(row.id),
  slug: row.slug,
  label: row.label,
  organizationId: row.organizationId ? String(row.organizationId) : undefined,
  organization: row.organization ? { _id: String(row.organization.id), name: row.organization.name } : undefined,
  sortOrder: row.sortOrder,
  imageUrl: row.imageUrl ?? undefined,
  imageAlt: row.imageAlt ?? undefined,
  showOnHome: row.showOnHome,
  isActive: row.isActive,
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
