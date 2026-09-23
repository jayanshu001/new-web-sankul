-- 2026-08-27 — ws_live_course_order: adopt the ws_package_course_order shape verbatim
--
-- WHY. `ws_live_course_order` was created 2026-08-25 by copying COLUMN TYPES out of
-- ws_live_course_subscription (so the backfill could be a straight column-to-column
-- move) and the status vocabulary out of ws_test_series_order. The result was a THIRD
-- order shape: same architecture as ws_package_course_order (order owns payment,
-- subscription owns entitlement) but different column names, different types and a
-- different status vocabulary.
--
-- ws_package_course_order IS THE STANDARD. This file makes ws_live_course_order match
-- it column-for-column, plus `live_course_id` (the product FK — package derives its
-- product through plan_id, live course cannot because ws_live_course_plan is a
-- separate table with an overlapping id space).
--
-- FOUR GROUPS OF CHANGE
--   1. RENAMES to the package names:
--        original_amount      → price          (int → double, package's type)
--        paid_amount          → discount_price
--        wallet_coin          → ws_coin        (+ NOT NULL DEFAULT 0)
--        customer_shipping_id → shipping
--   2. ADDS the 7 package columns live course was missing:
--        unique_id, order_type, generate_from, referrer_id,
--        code_discount, razorpay_order, ip_address
--   3. TYPE MATCH on the 3 shared columns that differed:
--        payment_method      varchar(191) NULL   → varchar(100) NOT NULL
--        bank_transaction_id varchar(191)        → varchar(255)
--        status              varchar(20)         → enum('cancel','complete','pending')
--   4. DROPS the 5 columns package does not have:
--        paid_at, with_material, remarks, created_by, updated_by
--
-- THE ONE DELIBERATE DEVIATION: `customer_id` stays `int NOT NULL`. On
-- ws_package_course_order it is `varchar(255)` — Mongo-ObjectId residue that the
-- application already does NOT honour (prisma/schema.prisma has always declared
-- PackageCourseOrder.userId as `Int`). Copying the varchar would break
-- idx_lco_customer_course, force a CAST on every join to ws_customer (int PK) and
-- re-import a legacy defect. ws_package_course_order should be narrowed to int
-- separately; that is a change to a 600k-row live table and is out of scope here.
--
-- WHERE THE DROPPED COLUMNS' VALUES NOW COME FROM (no information is lost):
--   paid_at       → `updated_at`. Verify writes paid_at and updated_at in the SAME
--                   statement with the same `now`, so they are already equal. This is
--                   how the package receipt has always sourced paidAt
--                   (client-purchase-history.service.ts: `paidAt: order.updatedAt`).
--   with_material → `ws_live_course_plan.with_material` via plan_id. It was never a
--                   free checkout choice: the controller sets it from
--                   `planSql.withMaterial` (live-course-payment.controller.ts). This
--                   is how package sources it too (ws_package_course_ebook_price).
--                   The value also remains stored on ws_live_course_subscription.
--   remarks,      → already written to ws_live_course_subscription by the same admin
--   created_by,     grant call (admin-live-course.service.ts grantSubscription writes
--   updated_by      both rows). Nothing read the order's copies.
--
-- STATUS VOCABULARY. 'failed' → 'cancel'. The API is UNCHANGED: both readers already
-- translate the order vocabulary to the wire vocabulary
-- (ORDER_STATUS_TO_PAYMENT_STATUS in live-course-order.service.ts, payStatusOf in
-- admin-live-course.service.ts). Those maps now emit "failed" for 'cancel'.
--
-- IDEMPOTENT + ENVIRONMENT-AGNOSTIC. Every step is guarded on information_schema.
--   * PROD (table absent): step 1 creates it in the final shape; steps 2-9 no-op.
--   * STAGING (table present in the 2026-08-25 shape): step 1 no-ops; steps 2-9 migrate it.
-- Re-running is a no-op either way.
--
-- ORDER OF APPLICATION relative to 2026-08-25_create_ws_live_course_order.sql: this
-- file may be applied INSTEAD of it on an environment that never got it, or AFTER it.
-- It does NOT replace 2026-08-25's second half — the
-- `ws_live_course_subscription.order_id` column + idx_lcs_order — which is repeated
-- here (guarded) so this file alone is sufficient.
--
-- AFTER THIS FILE:
--   1. yarn prisma:generate   then RESTART the process (generate writes into
--      node_modules and does NOT trip tsx watch — utils/prismaSchemaDrift.ts)
--   2. scripts/backfill-live-course-orders.ts   (only where it has not already run)
--   3. deploy the application code


-- ══ 1. Fresh environments: create the table already in its FINAL shape ══════════
-- Column order mirrors ws_package_course_order exactly, with live_course_id placed
-- next to plan_id (its only structural addition).

CREATE TABLE IF NOT EXISTS `ws_live_course_order` (
  `id`                  int NOT NULL AUTO_INCREMENT,
  -- Business key = the receipt id the checkout already generates and already returns
  -- to the client (`live-<epoch>-<rand>`); it simply was not persisted before.
  `unique_id`           varchar(255) DEFAULT NULL,
  -- DEVIATION FROM PACKAGE (deliberate, see header): int, not varchar(255).
  `customer_id`         int NOT NULL,
  `live_course_id`      int NOT NULL,
  `payment_method`      varchar(100) NOT NULL,
  `order_type`          enum('purchase') NOT NULL DEFAULT 'purchase',
  `generate_from`       enum('app','web') NOT NULL DEFAULT 'app',
  -- Frozen purchase-time code snapshots. Exactly one is ever set. Kept as JSON
  -- (not FKs) because promocode percentages are editable and plans get repriced.
  `promocode`           json DEFAULT NULL,
  `refferalcode`        json DEFAULT NULL,
  -- The referring CUSTOMER. Denormalised out of the refferalcode snapshot so the
  -- referral credit and the reports can key on a column, exactly like package.
  `referrer_id`         int DEFAULT NULL,
  `plan_id`             int DEFAULT NULL,
  -- FK to ws_customer_shipping, NEVER ws_customer_address.
  `shipping`            int DEFAULT NULL,
  -- Plan list price, ALWAYS written (package semantics). Under the old
  -- `original_amount` it was written only when a promo applied and NULL meant
  -- "no promo"; `code_discount` now carries that signal explicitly.
  `price`               double DEFAULT NULL,
  `code_discount`       int NOT NULL DEFAULT 0,
  `ws_coin`             int NOT NULL DEFAULT 0,
  -- Amount actually charged (post-promo, post-coin).
  `discount_price`      int DEFAULT NULL,
  `razorpay_order_id`   varchar(255) DEFAULT NULL,
  `razorpay_payment_id` varchar(255) DEFAULT NULL,
  -- Full Razorpay order response, JSON string.
  `razorpay_order`      text,
  `ip_address`          varchar(255) DEFAULT NULL,
  `bank_transaction_id` varchar(255) DEFAULT NULL,
  `status`              enum('cancel','complete','pending') NOT NULL DEFAULT 'pending',
  `created_at`          timestamp NULL DEFAULT NULL,
  `updated_at`          timestamp NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  KEY `lco_unique_id` (`unique_id`),
  -- Verify looks the order up by gateway id alone (the razorpay webhook payload
  -- carries no customer), so this is the hot path.
  KEY `idx_lco_razorpay_order` (`razorpay_order_id`),
  KEY `idx_lco_customer_course` (`customer_id`,`live_course_id`),
  -- Admin dashboard revenue window + the purchase-history listing.
  KEY `idx_lco_created_status` (`created_at`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ══ 2. RENAMES — the 4 columns that carried a non-package name ══════════════════
-- Each guarded on the OLD name still existing, so this is a no-op on a table created
-- by step 1 and on a re-run.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='original_amount');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_live_course_order CHANGE COLUMN `original_amount` `price` double DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='paid_amount');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_live_course_order CHANGE COLUMN `paid_amount` `discount_price` int DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Renamed NULLABLE here on purpose; the NOT NULL DEFAULT 0 is applied in step 6,
-- after step 5 has filled the existing NULLs.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='wallet_coin');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_live_course_order CHANGE COLUMN `wallet_coin` `ws_coin` int DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='customer_shipping_id');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_live_course_order CHANGE COLUMN `customer_shipping_id` `shipping` int DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 3. ADD the 7 package columns that were missing ══════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='unique_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_order ADD COLUMN `unique_id` varchar(255) DEFAULT NULL AFTER `id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='order_type');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_order ADD COLUMN `order_type` enum(''purchase'') NOT NULL DEFAULT ''purchase'' AFTER `payment_method`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='generate_from');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_order ADD COLUMN `generate_from` enum(''app'',''web'') NOT NULL DEFAULT ''app'' AFTER `order_type`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='referrer_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_order ADD COLUMN `referrer_id` int DEFAULT NULL AFTER `refferalcode`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='code_discount');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_order ADD COLUMN `code_discount` int NOT NULL DEFAULT 0 AFTER `price`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='razorpay_order');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_order ADD COLUMN `razorpay_order` text AFTER `razorpay_payment_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='ip_address');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_order ADD COLUMN `ip_address` varchar(255) DEFAULT NULL AFTER `razorpay_order`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 4. DATA PREP on the legacy shape, before the type changes in step 6 ═════════

-- paid_at → updated_at. Verify wrote both with the same `now`, so on every row
-- produced by the application these are already equal; this only rescues a row where
-- updated_at was somehow left behind. Guarded because paid_at is gone in step 7.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='paid_at');
SET @ddl := IF(@col=1,
  'UPDATE ws_live_course_order SET updated_at = paid_at WHERE paid_at IS NOT NULL AND (updated_at IS NULL OR updated_at < paid_at)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ws_coin is NOT NULL DEFAULT 0 on package; clear the NULLs before step 6 tightens it.
UPDATE ws_live_course_order SET ws_coin = 0 WHERE ws_coin IS NULL;

-- payment_method is NOT NULL on package. Live checkout always writes "online" and the
-- admin grant always writes a method, so this only covers a hand-inserted row.
UPDATE ws_live_course_order SET payment_method = 'online'
 WHERE payment_method IS NULL OR payment_method = '';

-- Status vocabulary: the package enum has no 'failed'. 'cancel' is its equivalent and
-- BOTH readers map it back to the wire value "failed", so no API response changes.
UPDATE ws_live_course_order SET status = 'cancel' WHERE status = 'failed';


-- ══ 5. BACKFILL the two columns whose semantics changed ═════════════════════════
--
-- Under the old shape `original_amount` was written ONLY when a promo applied, and
-- the discount was DERIVED as (original - paid - wallet). Package instead stores the
-- list price in `price` ALWAYS and the discount in `code_discount` explicitly.
--
-- Order matters: materialise code_discount from the rows that still carry the old
-- "NULL price == no promo" signal FIRST, then fill the remaining prices.

-- 5a. Rows that HAD a promo (price = the old original_amount): recover the discount.
UPDATE ws_live_course_order
   SET code_discount = GREATEST(0, CAST(price AS SIGNED) - COALESCE(discount_price,0) - COALESCE(ws_coin,0))
 WHERE price IS NOT NULL AND code_discount = 0;

-- 5b. Rows that had NO promo (price was NULL): the list price is the plan's price.
--     Falls back to the charged amount when the plan row is gone.
UPDATE ws_live_course_order o
  LEFT JOIN ws_live_course_plan p ON p.id = o.plan_id
   SET o.price = COALESCE(p.price, o.discount_price)
 WHERE o.price IS NULL;


-- ══ 6. TYPE MATCH — the 3 shared columns that differed from package ═════════════
-- Plus ws_coin, tightened now that step 4 cleared its NULLs.

ALTER TABLE ws_live_course_order
  MODIFY COLUMN `payment_method`      varchar(100) NOT NULL,
  MODIFY COLUMN `bank_transaction_id` varchar(255) DEFAULT NULL,
  MODIFY COLUMN `ws_coin`             int NOT NULL DEFAULT 0,
  MODIFY COLUMN `status`              enum('cancel','complete','pending') NOT NULL DEFAULT 'pending';


-- ══ 7. DROP the 5 columns ws_package_course_order does not have ═════════════════
-- See the header for where each value now comes from. None of them is read anywhere
-- once the 2026-08-27 application code is deployed — apply this file WITH that code,
-- never ahead of it (a Prisma client that still declares a dropped scalar SELECTs it
-- and 1054s on every read — the 2026-08-26 live-course incident).

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='paid_at');
SET @ddl := IF(@col=1, 'ALTER TABLE ws_live_course_order DROP COLUMN `paid_at`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='with_material');
SET @ddl := IF(@col=1, 'ALTER TABLE ws_live_course_order DROP COLUMN `with_material`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='remarks');
SET @ddl := IF(@col=1, 'ALTER TABLE ws_live_course_order DROP COLUMN `remarks`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='created_by');
SET @ddl := IF(@col=1, 'ALTER TABLE ws_live_course_order DROP COLUMN `created_by`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND COLUMN_NAME='updated_by');
SET @ddl := IF(@col=1, 'ALTER TABLE ws_live_course_order DROP COLUMN `updated_by`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 8. INDEX on the new business key ════════════════════════════════════════════
-- Non-unique, matching ws_package_course_order.rorder_unique_id's role as a lookup
-- key. (That one is UNIQUE; live-course legacy rows are all NULL and MySQL permits
-- repeated NULLs, but a non-unique key avoids any risk of a manual re-issue failing.)

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_order' AND INDEX_NAME='lco_unique_id');
SET @ddl := IF(@idx=0, 'ALTER TABLE ws_live_course_order ADD KEY `lco_unique_id` (`unique_id`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 9. ws_live_course_subscription.order_id ═════════════════════════════════════
-- Repeated from 2026-08-25_create_ws_live_course_order.sql (guarded, so it no-ops
-- where that file already ran) so THIS file alone is sufficient on a fresh database.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='order_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `order_id` int DEFAULT NULL AFTER `plan_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND INDEX_NAME='idx_lcs_order');
SET @ddl := IF(@idx=0, 'ALTER TABLE ws_live_course_subscription ADD KEY `idx_lcs_order` (`order_id`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
