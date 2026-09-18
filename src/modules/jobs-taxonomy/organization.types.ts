import type { MediaDto } from "../jobs-media/media.types";

export interface OrganizationDto {
  _id: string;
  name: string;
  slug: string;
  logo?: MediaDto;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OrganizationCreateInput {
  name: string;
  slug?: string;
  logoMediaId?: bigint | null;
}

export interface OrganizationUpdateInput {
  name?: string;
  slug?: string;
  logoMediaId?: bigint | null;
}

export interface OrganizationListQuery {
  search?: string;
  page: number;
  limit: number;
  skip: number;
}
