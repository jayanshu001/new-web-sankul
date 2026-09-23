/**
 * Commerce · eBook Subscription (READ) — MySQL (Prisma) branch types.
 *
 * Table: `ws_ebook_subscription` (Phase 3a, READ-ONLY; flag OFF until the
 * commerce-wave flip). 1 row in staging. The **ebook entitlement source of
 * truth** — a customer can download/read an ebook iff an active, unexpired row
 * exists. WRITES (create on payment) are Phase 3b; this module only reads.
 *
 * SCHEMA-DRIFT / FIELD NOTES (verified against the live DDL 2026-06-12):
 *
 *  - **Prisma model was missing the entitlement flag (FIXED):** the DDL has
 *    `status` (tinyint) + `payment_type` (enum), both ABSENT from the Prisma
 *    `EBookSubscription` model. `status` is the active-entitlement flag — the
 *    read contract is impossible without it. Added `status Boolean?` +
 *    `payment_type PackageCourseEbookPaymentType` to the model.
 *  - **`start_at`/`end_at` nullable (FIXED):** the DDL marks both `Null: YES`,
 *    but Prisma typed them non-nullable `DateTime`. Relaxed to `DateTime?` so a
 *    NULL-dated row can't crash a read. The single staging row has both set.
 *  - **All owner ids INT + NOT NULL** in the DDL (`order_id`/`customer_id`/
 *    `ebook_id`). `customer_id` is int (the migrated id-space — same as
 *    package subscription; C3). The module takes/returns `customerId` as int.
 *  - **Mongo-only promo fields** (promocodeId/promoterId/referrerId) are NOT
 *    columns on this table (order row / 3b) → not produced.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible, EXCEPT
 * `customerId` which is an int in the migrated id-space.
 */
import type { PackageCourseEbookPaymentType } from "@prisma/client";

/** `ws_ebook_subscription` row → entitlement DTO (Mongo-named). */
export interface EbookSubscriptionDto {
  _id: string;
  orderId: string | null;
  /** Int in the migrated id-space (SQL `customer_id` is int). */
  customerId: number;
  ebookId: string | null;
  price: number;
  startAt: Date | null;
  endAt: Date | null;
  remarks: string | null;
  paymentType: PackageCourseEbookPaymentType;
  /** Entitlement flag (SQL `status` tinyint; nullable → defaults true). */
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
