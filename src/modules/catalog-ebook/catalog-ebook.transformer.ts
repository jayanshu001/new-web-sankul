// Ebook catalog: row to DTO mapping (response shape is frozen).
import type { EBook } from "@prisma/client";
import type { EbookDto, EbookPlanDto } from "./catalog-ebook.types";
import type { PriceDto } from "../commerce-price/commerce-price.types";
import { signMediaToken } from "../../utils/mediaToken";

/** `isTrending` has no column and is always false; the handler overrides `link` per request. */
export const toEbookDto = (
  row: EBook,
  opts: { customerId?: number | null; entitled?: boolean } = {}
): EbookDto => {
  // No raw PDF URL: the free sample gets a media token for any logged-in user,
  // the book PDF only when purchased. Both are exchanged at /media/resolve.
  const cust = opts.customerId ?? null;
  // `book_url` is NOT NULL, so "no PDF attached" is stored as "".
  const hasBookFile = !!row.bookUrl;
  const demoMediaToken = cust != null && row.bookDemoUrl ? signMediaToken({ k: "ebookDemo", id: row.id, free: true, cust }) : null;
  const bookMediaToken = cust != null && opts.entitled && hasBookFile ? signMediaToken({ k: "ebook", id: row.id, scope: { kind: "ebook", id: row.id }, cust }) : null;
  return {
  _id: String(row.id),
  name: row.name,
  thumbnail: row.thumbnail,
  image: row.image,
  description: row.description ?? null,
  termsAndConditions: row.termsAndConditions,
  author: row.author ?? null,
  publisher: row.publisher ?? null,
  language: row.language,
  order: row.orderby,
  demoMediaToken,
  bookMediaToken,
  hasBookFile,
  link: row.shareableLink,
  status: row.active,
  isTrending: false,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
  };
};

export const toEbookPlanDto = (p: PriceDto): EbookPlanDto => ({
  _id: p._id,
  ebookId: p.ebookId,
  name: p.name,
  duration: p.duration,
  price: p.price,
  isDefault: p.isDefault,
  status: p.status,
  isMostPopular: p.isMostPopular,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});
