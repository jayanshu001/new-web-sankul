// Ebook catalog: DTO and input types.
import type { EBookLanguage } from "@prisma/client";

export interface EbookDto {
  _id: string;
  name: string;
  thumbnail: string;
  image: string;
  description: string | null;
  termsAndConditions: string;
  author: string | null;
  publisher: string | null;
  language: EBookLanguage;
  order: number;
  /** Free sample PDF token for /media/resolve; null when absent or unauthenticated. */
  demoMediaToken: string | null;
  /** Book PDF token for /media/resolve; null unless purchased, or when no PDF is attached. */
  bookMediaToken: string | null;
  /**
   * Whether a book PDF is attached (`book_url` non-empty); same for every viewer.
   * Lets the client tell "not uploaded yet" apart from "not purchased" when
   * `bookMediaToken` is null.
   */
  hasBookFile: boolean;
  /** Usually overridden by a per-request deep link in the handler. */
  link: string;
  status: boolean;
  /** Always `false`: `ws_ebook` has no is_trending column. */
  isTrending: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface EbookPlanDto {
  _id: string;
  ebookId: string | null;
  name: string | null;
  duration: number;
  price: number;
  isDefault: boolean;
  status: boolean;
  /** Effective "Most Popular" flag (sales-driven or admin-pinned). */
  isMostPopular: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface EbookListItemDto extends EbookDto {
  plans: EbookPlanDto[];
  details: Array<{ id: number; mainText: string; subText: string | null }>;
  isPaid: boolean;
  isPurchased: boolean;
  isNew: boolean;
  subscriptionEndAt: Date | null;
  daysLeft: number | null;
  shareableLink: string;
}

export interface ListEbooksOptions {
  search?: string;
  language?: EBookLanguage;
  customerId?: number;
  /** Omit skip/take for the full unpaginated list. */
  skip?: number;
  take?: number;
}
