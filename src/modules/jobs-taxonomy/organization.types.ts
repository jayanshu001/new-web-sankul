export interface OrganizationDto {
  _id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  logoAlt?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OrganizationCreateInput {
  name: string;
  slug?: string;
  logoUrl?: string | null;
  logoAlt?: string | null;
}

export interface OrganizationUpdateInput {
  name?: string;
  slug?: string;
  logoUrl?: string | null;
  logoAlt?: string | null;
}

export interface OrganizationListQuery {
  search?: string;
  page: number;
  limit: number;
  skip: number;
}
