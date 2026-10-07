// Book catalog: DTO and input types.
export interface BookDto {
  _id: string;
  name: string;
  thumbnail: string | null;
  author: string | null;
  image: string | null;
  description: string | null;
  /**
   * Same key and type as the ebook DTO so the client renders both with one code
   * path: "" (never null) when unset, since this column is nullable.
   */
  termsAndConditions: string;
  // Short-lived media token for the free demo PDF (exchanged at POST
  // /client/media/resolve); the raw demo URL is never emitted. Null when there is no demo PDF.
  demoMediaToken: string | null;
  weight: number | null;
  pages: number;
  dynamicLink: string | null;
  listPrice: number;
  discountedPrice: number;
  shippingPrice: number;
  orderBy: number;
  language: string;
  isMagazine: boolean;
  isCombo: boolean;
  /** Always `false`: `ws_book` has no is_trending column. */
  isTrending: boolean;
  /** Synthesized defaults; no columns. */
  publication: string;
  deliveryEta: string;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Cart `qty` and `isPurchased` are added by the caller. */
export interface BookListItemDto extends BookDto {
  key: "combo" | "individual";
  isPaid: boolean;
  /** One-time purchase, no expiry. */
  daysLeft: null;
  isNew: boolean;
  shareableLink: string;
}

/** Mutually exclusive buckets: magazine → is_magazine, combo → isCombo, regular → neither. */
export type BookType = "magazine" | "combo" | "regular";

export interface ListBooksOptions {
  search?: string;
  language?: string;
  type?: BookType;
  skip?: number;
  take?: number;
}
