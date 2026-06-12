/**
 * Catalog · Book (READ) — MySQL (Prisma) branch types.
 *
 * Table: `ws_book` (10 rows; flag OFF). The physical-book store catalogue.
 *
 * ⚠ SCOPE — built dual-path but NOT wired this pass (like catalog-package):
 * the client `listBooks`/`getBookDetail` handlers enrich each book with
 * per-customer cart `qty` (`ws_book_cart*`) and `isPurchased` (`ws_book_order*`
 * by order status) — and those order/cart tables are NOT migrated. With book on
 * MySQL (int ids) but orders/cart still on Mongo (ObjectId), the purchased/cart
 * keys wouldn't match the int book ids. So this module supplies the book DATA +
 * the data-only computed fields; it flips together with the book-order/cart
 * migration. Verify via live-DB tsx, not HTTP.
 *
 * COMPUTED fields reproducible from the row alone (same rules as the handler):
 *  - `isPaid` = discountedPrice > 0  (0 = free)
 *  - `key`    = isCombo ? "combo" : "individual"
 *  - `daysLeft` = null (one-time purchase, no expiry)
 *  - `isNew`  = createdAt within the NEW window (caller passes `now`)
 * The order/cart-derived `qty` + `isPurchased` are LEFT to the caller.
 *
 * SCHEMA / FIELD NOTES (verified against the live DDL 2026-06-12):
 *  - Schema fix: `order_by` nullable in the DDL but Prisma typed non-null →
 *    relaxed to `Int?` (no NULLs today).
 *  - Mongo-only fields ABSENT from `ws_book`: `packageIds[]` (embedded M:N for
 *    the package-detail "material(Book)" tab — appliesTo-style, not reproducible
 *    from SQL), `examCountdownCategoryId`, `termsAndConditions`, `bookUrl`,
 *    `publication`, `deliveryEta`, `isTrending`. `isTrending` synthesized false;
 *    `publication`/`deliveryEta` synthesized to the Mongo defaults so the
 *    response shape stays stable.
 *  - Field renames: `demo_url`→`demoUrl`, `dynamic_link`→`dynamicLink`,
 *    `list_price`→`listPrice`, `discounted_price`→`discountedPrice`,
 *    `shipping_price`→`shippingPrice`, `order_by`→`orderBy`, `is_magazine`→
 *    `isMagazine`, `is_combo`→`isCombo`, `status`→`status`.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_book` row → DTO (Mongo `Book`-shaped, data fields only). */
export interface BookDto {
  _id: string;
  name: string;
  thumbnail: string | null;
  author: string | null;
  image: string | null;
  description: string | null;
  demoUrl: string | null;
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
  /** Synthesized `false` — `ws_book` has no is_trending column. */
  isTrending: boolean;
  /** Synthesized to the Mongo defaults (no SQL columns). */
  publication: string;
  deliveryEta: string;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Book + the data-only computed fields (cart/purchase state added by caller). */
export interface BookListItemDto extends BookDto {
  /** isCombo ? "combo" : "individual". */
  key: "combo" | "individual";
  /** discountedPrice > 0. */
  isPaid: boolean;
  /** Always null — one-time purchase, no expiry. */
  daysLeft: null;
  isNew: boolean;
  shareableLink: string;
}

/** Options for the book listing (from the query string). */
export interface ListBooksOptions {
  search?: string;
  language?: string;
}
