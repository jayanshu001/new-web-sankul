// Ebook subscriptions: DTO types.
/**
 * `ws_ebook_subscription` is the ebook entitlement source of truth: a customer can
 * download/read an ebook iff an active, unexpired row exists. This module only reads.
 *
 * `start_at`/`end_at` are nullable in the DDL, so a NULL-dated row must not crash a read.
 * Ids are returned as strings (frozen `_id` shape), except `customerId` which stays an int.
 */
import type { PackageCourseEbookPaymentType } from "@prisma/client";

export interface EbookSubscriptionDto {
  _id: string;
  orderId: string | null;
  customerId: number;
  ebookId: string | null;
  price: number;
  startAt: Date | null;
  endAt: Date | null;
  remarks: string | null;
  paymentType: PackageCourseEbookPaymentType;
  /** Nullable in SQL; NULL is treated as true. */
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
