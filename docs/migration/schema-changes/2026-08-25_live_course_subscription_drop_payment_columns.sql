-- 2026-08-25 — ws_live_course_subscription: drop the payment columns
--
-- ⚠⚠ STATUS 2026-08-26: ALREADY APPLIED ON PRODUCTION, ahead of the code step below.
-- That combination 500'd every read of ws_live_course_subscription (Prisma kept
-- selecting the dropped columns) until the code was caught up on 2026-08-26 — see
-- MIGRATION_QUERY_CHANGES "Live-course payment columns: code caught up with the drop".
-- The "remove the code that still reads these columns" list further down is DONE; the
-- fallbacks it names no longer exist. Confirm `order_id IS NULL` is 0 per environment
-- before applying this anywhere it has not run yet.
--
-- Original header follows.
--
-- ⚠⚠ DO NOT APPLY THIS YET. ⚠⚠
--
-- This is the SECOND half of the live-course order split and is deliberately kept
-- as its own file so the first half can ship, be verified, and be rolled back
-- without data loss. Applying it early makes the migration irreversible.
--
-- APPLY ONLY WHEN ALL OF THESE ARE TRUE, IN EVERY ENVIRONMENT:
--   1. 2026-08-25_create_ws_live_course_order.sql is applied.
--   2. scripts/backfill-live-course-orders.ts has run to completion, and
--        SELECT COUNT(*) FROM ws_live_course_subscription WHERE order_id IS NULL;
--      returns 0.
--   3. The application code that reads payment from ws_live_course_order has been
--      deployed and running long enough to trust (at least one full billing/report
--      cycle is the safe bar — the admin reports and receipts are the consumers
--      most likely to surface a gap).
--   4. You have a backup. These columns hold the ONLY copy of historical payment
--      data if the backfill was wrong; there is no way to reconstruct them.
--
-- BEFORE APPLYING, remove the code that still reads these columns. Each of the
-- following has a deliberate fallback for rows the backfill has not reached
-- (`order_id IS NULL`), which becomes dead — and misleading — once that cannot
-- happen. Search for the phrase "pre-backfill" to find them all:
--   - admin-live-course.repository.ts   LIVE_SUB_PURCHASED (the OR's second branch)
--                                        + aggSubs (the `fromLegacy` half)
--   - client-purchase-history.repository.ts  liveSubscriptionPurchasedWhere
--   - admin-live-course.service.ts      payOf / payStatusOf fallbacks,
--                                        updateSubscription's data.paymentStatus write,
--                                        and the `?? "verified"` in the my-courses card
--   - client-purchase-history.service.ts     getLiveCourseReceiptMysql `pay` fallback
--   - admin-customer-details.transformer.ts  toLiveCourseDto `pay` fallback
--   - libs/core/generate.ts             the live-course receipt merge
--   - utils/planUsage.ts                the `orphanLiveSubs` half of the livePlan count
-- Then drop the matching fields from `model LiveCourseSubscription` in
-- prisma/schema.prisma and regenerate.
--
-- NOT DROPPED HERE (they belong to the subscription, not the payment):
--   start_at, end_at, status, with_material, customer_shipping_id, tracking_id,
--   tracking_status, remarks, created_by, updated_by, order_id.
--
-- `with_material` / `customer_shipping_id` / `remarks` intentionally exist on BOTH
-- tables: the order records what was BOUGHT, the subscription what was GRANTED. They
-- are copied forward at fulfilment, not shared.


-- ── Drop, guarded so a re-run is a no-op ────────────────────────────────────
-- Guard on payment_status specifically: it is the last one dropped below, so its
-- absence means the whole statement already ran.
SET @already := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ws_live_course_subscription'
    AND COLUMN_NAME  = 'payment_status'
);

-- The index on (created_at, payment_status) must go first — MySQL refuses to drop a
-- column an index still references.
SET @ddl := IF(
  @already > 0,
  'ALTER TABLE ws_live_course_subscription
     DROP INDEX idx_lcs_created_payment,
     DROP COLUMN promocode,
     DROP COLUMN refferalcode,
     DROP COLUMN wallet_coin,
     DROP COLUMN original_amount,
     DROP COLUMN paid_amount,
     DROP COLUMN payment_method,
     DROP COLUMN razorpay_order_id,
     DROP COLUMN razorpay_payment_id,
     DROP COLUMN bank_transaction_id,
     DROP COLUMN paid_at,
     DROP COLUMN payment_status',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- Replacement for the dropped index: the admin dashboard and the subscription
-- reports still window on created_at.
SET @has_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ws_live_course_subscription'
    AND INDEX_NAME   = 'idx_lcs_created'
);
SET @ddl := IF(
  @has_idx = 0,
  'ALTER TABLE ws_live_course_subscription ADD KEY `idx_lcs_created` (`created_at`)',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
