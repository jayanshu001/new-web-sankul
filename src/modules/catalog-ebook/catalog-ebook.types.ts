/**
 * Catalog · eBook (READ) — MySQL (Prisma) branch types.
 *
 * Table: `ws_ebook` (Phase: ebook vertical; flag OFF until the cluster flips).
 * 2 rows in staging. The ebook catalog master. The listing composes this with
 * commerce-price (ebook plans, in the shared `ws_package_course_ebook_price`)
 * and commerce-ebook-sub (entitlement) — NO separate ebook-price module is
 * needed (there is no `ws_ebook_price` table; pricing lives in the shared
 * table, already covered by commerce-price.listActivePricesByEbook).
 *
 * SCHEMA-DRIFT / FIELD NOTES (verified against the live DDL 2026-06-12):
 *
 *  - **Mongo-only fields ABSENT from `ws_ebook`:** `isTrending`, `isPaid`,
 *    `examCountdownCategoryId`, `demoFileName`, `bookFileName`. The SQL table has
 *    none of these columns. The listing computes **`isPaid` from the plans**
 *    (paid when ≥1 active plan price > 0) — which is exactly the controller's
 *    documented fallback when the Mongo `isPaid` field is absent — so the MySQL
 *    path is faithful. `isTrending` is synthesized `false` (Mongo default).
 *  - **`description`/`author` nullable (FIXED):** the DDL marks both `Null: YES`
 *    but Prisma typed them non-nullable → relaxed to optional. (No NULLs today.)
 *  - **Field renames (Prisma → Mongo):** `terms_and_conditions`→`termsAndConditions`,
 *    `order_by`→`order`, `demo_url`→`demoUrl`, `book_url`→`bookUrl`,
 *    `link`→`shareableLink` (note: the controller OVERRIDES shareableLink with a
 *    built deep-link URL per request, so the column value is not surfaced as-is),
 *    `status`→`active`/`status`.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */
import type { EBookLanguage } from "@prisma/client";

/** `ws_ebook` row → DTO (Mongo `Ebook`-shaped; computed fields added by the listing). */
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
  demoUrl: string;
  bookUrl: string;
  /** SQL `link` — usually overridden by a per-request deep link in the handler. */
  link: string;
  status: boolean;
  /** Synthesized `false` — `ws_ebook` has no `is_trending` column. */
  isTrending: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** One ebook plan (subset of the shared price row), Mongo `EbookPrice`-shaped. */
export interface EbookPlanDto {
  _id: string;
  ebookId: string | null;
  name: string | null;
  duration: number;
  price: number;
  isDefault: boolean;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** An ebook list item as `listEbooks` returns it (ebook + plans + purchase state). */
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

/** Options for the ebook listing (from the query string). */
export interface ListEbooksOptions {
  search?: string;
  language?: EBookLanguage;
  /** Resolved int customer id for purchase-state (C3 boundary). */
  customerId?: number;
}
