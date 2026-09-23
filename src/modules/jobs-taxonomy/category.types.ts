export interface CategoryDto {
  _id: string;
  slug: string;
  label: string;
  organizationId?: string;
  organization?: { _id: string; name: string };
  sortOrder: number;
  imageUrl?: string;
  imageAlt?: string;
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
  imageUrl?: string | null;
  imageAlt?: string | null;
  showOnHome?: boolean;
  isActive?: boolean;
}

export interface CategoryUpdateInput {
  slug?: string;
  label?: string;
  organizationId?: bigint | null;
  sortOrder?: number;
  imageUrl?: string | null;
  imageAlt?: string | null;
  showOnHome?: boolean;
  isActive?: boolean;
}

export interface CategoryListQuery {
  search?: string;
  organizationId?: bigint;
  skip: number;
  take: number;
}
