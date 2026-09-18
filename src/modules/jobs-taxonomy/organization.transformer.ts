import type { JobOrganization, Media } from "@prisma/client";
import { toMediaDto } from "../jobs-media/media.transformer";
import type { OrganizationDto } from "./organization.types";

type Row = JobOrganization & { logo?: Media | null };

export const toOrganizationDto = (row: Row): OrganizationDto => ({
  _id: String(row.id),
  name: row.name,
  slug: row.slug,
  logo: row.logo ? toMediaDto(row.logo) : undefined,
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
