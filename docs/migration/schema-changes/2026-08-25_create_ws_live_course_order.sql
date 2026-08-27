-- 2026-08-25 — ws_live_course_order: give live courses a real order table
--
-- ⚠ SUPERSEDED BY 2026-08-27_live_course_order_match_package_shape.sql, which
-- reshapes this table to match ws_package_course_order column for column (renames,
-- 7 added columns, 3 type changes, 5 drops). That file is self-contained: on a
-- database that never got THIS file it creates the table in the final shape and adds
-- ws_live_course_subscription.order_id itself. Applying both in date order is also
-- correct. Do not "fix" this file — it is the record of what was applied on
-- 2026-08-25, and everything below describes the shape as it was then.
--
-- WHY. Live course was the ONLY product without an order table. The subscription
-- row doubled as the order: checkout INSERTed a `payment_status='pending'` row into
-- ws_live_course_subscription, and verify flipped that same row to 'verified'. That
-- design is what forced live-course renewals to FOLD (bump end_at on the existing
-- row and retire the pending one) instead of recording each purchase separately —
-- there was no second table to hold the second payment.
--
-- Every other product now follows ONE ORDER = ONE SUBSCRIPTION ROW (see
-- MIGRATION_QUERY_CHANGES 2026-08-25 (e)). This file is what lets live course join
-- them.
--
-- THE SPLIT. Agreed 2026-08-25: the ORDER owns payment, the SUBSCRIPTION owns
-- entitlement — the same division ws_package_course_order / _subscription already
-- uses. Payment columns (paid/original amount, wallet coin, code snapshots, method,
-- gateway + bank references, paid_at) belong to the order. The subscription keeps
-- the window, status, material flags and the shipment.
--
-- COLUMN TYPES are copied EXACTLY from ws_live_course_subscription so the backfill
-- is a straight column-to-column move with no coercion:
--   amounts are `int` (whole rupees, not Decimal — matches the existing table),
--   snapshots are `json`, gateway ids varchar(255), method/bank varchar(191).
--
-- `status` uses the ws_test_series_order vocabulary ('pending' | 'complete' |
-- 'failed'), NOT the subscription's payment_status vocabulary ('pending' |
-- 'verified' | 'failed'). The backfill maps 'verified' → 'complete'.
--
-- SAFETY. Purely additive: one CREATE TABLE and one nullable ADD COLUMN. Nothing is
-- dropped and no existing column changes type, so this file is safe to apply BEFORE
-- the application code that uses it. Both statements are guarded so re-running is a
-- no-op.
--
-- AFTER THIS FILE, IN ORDER:
--   1. yarn prisma:generate   (then RESTART the process — see the schema-drift note
--      in utils/prismaSchemaDrift.ts; `generate` writes into node_modules and does
--      NOT trip tsx watch)
--   2. scripts/backfill-live-course-orders.ts   (creates one order per historical
--      subscription and links it back via order_id)
--   3. deploy the application code
--   4. ONLY once all three are verified in an environment:
--      2026-08-25_live_course_subscription_drop_payment_columns.sql


-- ── 1. The order table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_live_course_order` (
  `id`                  int NOT NULL AUTO_INCREMENT,
  `customer_id`         int NOT NULL,
  `live_course_id`      int NOT NULL,
  `plan_id`             int DEFAULT NULL,

  -- Money. `original_amount` is the pre-promo price and is set ONLY when a promo
  -- was applied — that is what makes the discount derivable now that the old
  -- discount_amount column is gone (liveSubDiscountAmount is its exact inverse:
  -- discount = original - paid - wallet_coin).
  `paid_amount`         int DEFAULT NULL,
  `original_amount`     int DEFAULT NULL,
  `wallet_coin`         int DEFAULT NULL,

  -- Frozen purchase-time code snapshots. Exactly one is ever set. Kept as JSON
  -- (not FKs) because promocode percentages are editable and plans get repriced —
  -- commission and the reported discount must reflect the terms at purchase.
  `promocode`           json DEFAULT NULL,
  `refferalcode`        json DEFAULT NULL,

  `payment_method`      varchar(191) DEFAULT NULL,
  `razorpay_order_id`   varchar(255) DEFAULT NULL,
  `razorpay_payment_id` varchar(255) DEFAULT NULL,
  `bank_transaction_id` varchar(191) DEFAULT NULL,

  -- 'pending' | 'complete' | 'failed'  (ws_test_series_order vocabulary)
  `status`              varchar(20) NOT NULL DEFAULT 'pending',
  `paid_at`             datetime DEFAULT NULL,

  -- Carried on the order because they are chosen at CHECKOUT, before any
  -- subscription row exists; the fulfilled subscription copies them across.
  `with_material`       tinyint(1) NOT NULL DEFAULT '0',
  `customer_shipping_id` int DEFAULT NULL,

  `remarks`             text,
  `created_at`          timestamp NULL DEFAULT NULL,
  `updated_at`          timestamp NULL DEFAULT NULL,
  -- Acting admin on a manual grant (admin grants write an order too).
  `created_by`          int DEFAULT NULL,
  `updated_by`          int DEFAULT NULL,

  PRIMARY KEY (`id`),
  -- Verify looks the order up by gateway id alone (the razorpay webhook payload
  -- carries no customer), so this is the hot path.
  KEY `idx_lco_razorpay_order` (`razorpay_order_id`),
  KEY `idx_lco_customer_course` (`customer_id`,`live_course_id`),
  -- Admin dashboard revenue window + the purchase-history listing.
  KEY `idx_lco_created_status` (`created_at`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ── 2. Link the subscription back to the order that paid for it ─────────────
-- Nullable on purpose: pre-migration rows have no order until the backfill runs,
-- and purchase history already knows how to union in order-less legacy rows for
-- package/course and test-series.
SET @has_col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ws_live_course_subscription'
    AND COLUMN_NAME  = 'order_id'
);

SET @ddl := IF(
  @has_col = 0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `order_id` int DEFAULT NULL AFTER `plan_id`',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;


SET @has_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'ws_live_course_subscription'
    AND INDEX_NAME   = 'idx_lcs_order'
);

SET @ddl := IF(
  @has_idx = 0,
  'ALTER TABLE ws_live_course_subscription ADD KEY `idx_lcs_order` (`order_id`)',
  'DO 0'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
