export interface CategoryDto {
  _id: string;
  slug: string;
  label: string;
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
  sortOrder?: number;
  imageUrl?: string | null;
  imageAlt?: string | null;
  showOnHome?: boolean;
  isActive?: boolean;
}

export interface CategoryUpdateInput {
  slug?: string;
  label?: string;
  sortOrder?: number;
  imageUrl?: string | null;
  imageAlt?: string | null;
  showOnHome?: boolean;
  isActive?: boolean;
}

export interface CategoryListQuery {
  search?: string;
  skip: number;
  take: number;
}
