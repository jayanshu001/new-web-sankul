import type { EBook } from "@prisma/client";
import type { EbookDto, EbookPlanDto } from "./catalog-ebook.types";
import type { PriceDto } from "../commerce-price/commerce-price.types";

/**
 * `ws_ebook` row → DTO, shape-compatible with the Mongo `Ebook` document.
 * Field renames: terms_and_conditions→termsAndConditions, order_by→order,
 * demo_url→demoUrl, book_url→bookUrl, link→link (kept; the handler overrides
 * shareableLink per-request). `isTrending` is synthesized false (no SQL column).
 */
export const toEbookDto = (row: EBook): EbookDto => ({
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
  demoUrl: row.bookDemoUrl,
  bookUrl: row.bookUrl,
  link: row.shareableLink,
  status: row.active,
  isTrending: false,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

/**
 * A shared-price row (PriceDto, ebook-owned) → the Mongo `EbookPrice` subset.
 * The ebook listing only needs {_id, ebookId, name, duration, price, isDefault,
 * status, timestamps} — the commerce-price PriceDto is a superset.
 */
export const toEbookPlanDto = (p: PriceDto): EbookPlanDto => ({
  _id: p._id,
  ebookId: p.ebookId,
  name: p.name,
  duration: p.duration,
  price: p.price,
  isDefault: p.isDefault,
  status: p.status,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});
