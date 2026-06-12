import type { Book } from "@prisma/client";
import type { BookDto } from "./catalog-book.types";

/** The Mongo defaults for the SQL-absent `publication` / `deliveryEta` fields. */
const DEFAULT_PUBLICATION = "WebSankul Publication";
const DEFAULT_DELIVERY_ETA = "5-7 days";

/**
 * `ws_book` row → DTO, shape-compatible with the Mongo `Book` document (data
 * fields only). Field renames per types.ts; `isTrending` synthesized false;
 * `publication`/`deliveryEta` synthesized to the Mongo defaults (no SQL columns).
 * The Mongo-only `packageIds[]` and order/cart-derived fields are NOT produced.
 */
export const toBookDto = (row: Book): BookDto => ({
  _id: String(row.id),
  name: row.name,
  thumbnail: row.thumbnail ?? null,
  author: row.author ?? null,
  image: row.image ?? null,
  description: row.description ?? null,
  demoUrl: row.demo_url ?? null,
  weight: row.weight ?? null,
  pages: row.pages ?? 0,
  dynamicLink: row.dynamic_link ?? null,
  listPrice: row.list_price,
  discountedPrice: row.discounted_price,
  shippingPrice: row.shipping_price,
  orderBy: row.order_by ?? 0,
  language: row.language,
  isMagazine: row.is_magazine,
  isCombo: row.isCombo,
  isTrending: false,
  publication: DEFAULT_PUBLICATION,
  deliveryEta: DEFAULT_DELIVERY_ETA,
  status: row.active,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
