import type { MediaDto } from "../jobs-media/media.types";

export interface CategoryDto {
  _id: string;
  slug: string;
  label: string;
  organizationId?: string;
  organization?: { _id: string; name: string };
  sortOrder: number;
  image?: MediaDto;
  showOnHome: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CategoryCreateInput {
  slug?: string;
  label: string;
  organizationId?: bigint | null;
  sortOrder?: number;
  imageMediaId?: bigint | null;
  showOnHome?: boolean;
  isActive?: boolean;
}

export interface CategoryUpdateInput {
  slug?: string;
  label?: string;
  organizationId?: bigint | null;
  sortOrder?: number;
  imageMediaId?: bigint | null;
  showOnHome?: boolean;
  isActive?: boolean;
}

export interface CategoryListQuery {
  search?: string;
  organizationId?: bigint;
  skip: number;
  take: number;
}
