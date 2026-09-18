import type { JobOrganization } from "@prisma/client";
import type { OrganizationDto } from "./organization.types";

export const toOrganizationDto = (row: JobOrganization): OrganizationDto => ({
  _id: String(row.id),
  name: row.name,
  slug: row.slug,
  logoUrl: row.logoUrl ?? undefined,
  logoAlt: row.logoAlt ?? undefined,
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
