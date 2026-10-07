// Book catalog: row to DTO mapping (response shape is frozen).
import type { Book } from "@prisma/client";
import type { BookDto } from "./catalog-book.types";
import { signMediaToken } from "../../utils/mediaToken";

/** Defaults for `publication` / `deliveryEta`, which have no columns. */
const DEFAULT_PUBLICATION = "WebSankul Publication";
const DEFAULT_DELIVERY_ETA = "5-7 days";

/** `opts.fallbackTerms` is used only when the book row has no T&C of its own. */
export const toBookDto = (
  row: Book,
  opts: { customerId?: number | null; fallbackTerms?: string } = {}
): BookDto => {
  // The demo is public content: its token is emitted whenever a demo PDF exists,
  // regardless of login or purchase. It is bound to the viewer id when known
  // (else a public `0` sentinel); the resolver does not gate the demo on it.
  const demoMediaToken = row.demo_url ? signMediaToken({ k: "bookDemo", id: row.id, free: true, cust: opts.customerId ?? 0 }) : null;
  return {
  _id: String(row.id),
  name: row.name,
  thumbnail: row.thumbnail ?? null,
  author: row.author ?? null,
  image: row.image ?? null,
  description: row.description ?? null,
  // Blank per-book T&C (the admin form posts "" for an untouched editor) falls
  // back to the module-level terms supplied by the service, then to "".
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
