import type { EBookSubscription } from "@prisma/client";
import type { EbookSubscriptionDto } from "./commerce-ebook-sub.types";

/** Owner id → string, treating SQL's `0` sentinel as "unset" (→ null). */
const ownerId = (v: number | null): string | null =>
  v != null && v > 0 ? String(v) : null;

/**
 * `ws_ebook_subscription` row → entitlement DTO, shape-compatible with the
 * Mongo `EbookSubscription` document.
 *
 *  - `customerId` stays an int (the migrated id-space).
 *  - `price` (Decimal) → number.
 *  - `status` is nullable in SQL (default 1); a NULL is treated as `true`
 *    (active) to match the Mongo default and the "entitled unless explicitly
 *    revoked" intent.
 *  - Mongo-only promo fields (promocodeId/promoterId/referrerId) live on the
 *    order row / are 3b → not produced.
 */
export const toEbookSubscriptionDto = (row: EBookSubscription): EbookSubscriptionDto => ({
  _id: String(row.id),
  orderId: ownerId(row.orderId),
  customerId: row.customerId ?? 0,
  ebookId: ownerId(row.ebookId),
  price: row.price != null ? Number(row.price) : 0,
  startAt: row.startAt ?? null,
  endAt: row.endAt ?? null,
  remarks: row.remarks ?? null,
  paymentType: row.payment_type,
  status: row.status ?? true,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});
