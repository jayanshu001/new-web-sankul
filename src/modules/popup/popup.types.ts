/**
 * Popup notification — stable API shape (Mongo-compatible for admin / client).
 *
 * Field-name divergences (handled by the transformer):
 *   API `promoExpireAt`         ↔ MySQL `promo_expire_at` (a nullable `date`)
 *   API `createdAt`/`updatedAt` ↔ MySQL `created_at`/`updated_at`
 *
 * Client "active popup" = status:true AND promo_expire_at > now, newest first.
 */

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
  /** ISO date string or Date; persisted to the MySQL `date` column. */
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
