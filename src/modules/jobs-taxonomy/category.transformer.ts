import type { JobCategory, JobOrganization, Media } from "@prisma/client";
import { toMediaDto } from "../jobs-media/media.transformer";
import type { CategoryDto } from "./category.types";

type Row = JobCategory & { image?: Media | null; organization?: JobOrganization | null };

export const toCategoryDto = (row: Row): CategoryDto => ({
  _id: String(row.id),
  slug: row.slug,
  label: row.label,
  organizationId: row.organizationId ? String(row.organizationId) : undefined,
  organization: row.organization ? { _id: String(row.organization.id), name: row.organization.name } : undefined,
  sortOrder: row.sortOrder,
  image: row.image ? toMediaDto(row.image) : undefined,
  showOnHome: row.showOnHome,
  isActive: row.isActive,
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
