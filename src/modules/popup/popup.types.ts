// Popups: DTO and input types.
export interface PopupDto {
  _id: string;
  title: string;
  description: string;
  image: string;
  discount: string;
  promocode: string;
  promoExpireAt: Date | null;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PopupCreateInput {
  title: string;
  description: string;
  image: string;
  discount?: string;
  promocode?: string;
  /** ISO date string or Date; persisted to a MySQL `date` column. */
  promoExpireAt: string | Date;
  status?: boolean;
}

export interface PopupUpdateInput {
  title?: string;
  description?: string;
  image?: string;
  discount?: string;
  promocode?: string;
  promoExpireAt?: string | Date;
  status?: boolean;
}
