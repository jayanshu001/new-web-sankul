import type { Book } from "@prisma/client";
import type { BookDto } from "./catalog-book.types";
import { signMediaToken } from "../../utils/mediaToken";

/** The Mongo defaults for the SQL-absent `publication` / `deliveryEta` fields. */
const DEFAULT_PUBLICATION = "WebSankul Publication";
const DEFAULT_DELIVERY_ETA = "5-7 days";

/**
 * `ws_book` row → DTO, shape-compatible with the Mongo `Book` document (data
 * fields only). `opts.fallbackTerms` is the module-level T&C the service resolved
 * once for the request; it is used only when the book row itself has none.
 * Field renames per types.ts; `isTrending` synthesized false;
 * `publication`/`deliveryEta` synthesized to the Mongo defaults (no SQL columns).
 * The Mongo-only `packageIds[]` and order/cart-derived fields are NOT produced.
 */
export const toBookDto = (
  row: Book,
  opts: { customerId?: number | null; fallbackTerms?: string } = {}
): BookDto => {
  // No raw demo PDF URL. The demo is PUBLIC content, so its short-lived encrypted
  // token is always emitted when a demo PDF exists — independent of login OR
  // purchase (null only when there is no demo). It is customer-bound when a viewer
  // id is known (else a public `0` sentinel); the resolver does not gate the demo
  // on that binding. Exchanged at /media/resolve (utils/mediaToken.ts, k="bookDemo").
  const demoMediaToken = row.demo_url ? signMediaToken({ k: "bookDemo", id: row.id, free: true, cust: opts.customerId ?? 0 }) : null;
  return {
  _id: String(row.id),
  name: row.name,
  thumbnail: row.thumbnail ?? null,
  author: row.author ?? null,
  image: row.image ?? null,
  description: row.description ?? null,
  // Per-book T&C wins; when the book has none (null, or whitespace-only — the
  // admin form posts "" for an untouched editor) fall back to the module-level
  // `ws_termsandcondition` row for module='book', supplied by the service.
  // Still null → "" at the end so the client always gets a string, matching the
  // ebook contract.
  termsAndConditions: row.termsAndConditions?.trim()
    ? row.termsAndConditions
    : opts.fallbackTerms ?? "",
  demoMediaToken,
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
  };
};
