-- 2026-08-31 — ws_test_series_order: adopt the ws_package_course_order naming
--
-- WHY. ws_test_series_order was created net-new on 2026-06-18
-- (2026-06-18_create_wave7_blocked_tables.sql) by snake-casing the field names off
-- the Mongoose model src/models/testSeries/TestSeriesOrder.model.ts. It never looked
-- at ws_package_course_order, so it ended up as a second order vocabulary for the
-- same six concepts. ws_live_course_order was the third; 2026-08-27 folded that one
-- onto the package shape. This file does the same for test series — it is the last
-- non-conforming order table.
--
-- ws_package_course_order IS THE STANDARD.
--
-- SCOPE RULE FOR THIS FILE: a column is adopted only if a value is actually
-- AVAILABLE and WRITTEN. Shape parity is not worth a column that is NULL forever, so
-- two package columns are deliberately NOT added (see NOT ADOPTED below). The rule
-- cuts one way only: it governs what this file ADDS, never what it removes. Nothing
-- is dropped (step 7).
--
-- FOUR GROUPS OF CHANGE
--   1. RENAMES to the package names (all 5 carry live values today):
--        base_price       → price               (decimal(10,2) → double)
--        order_price      → discount_price      (decimal(10,2) → int)
--        discount_amount  → code_discount       (decimal(10,2) → int NOT NULL DEFAULT 0)
--        wallet_coin      → ws_coin             (+ NOT NULL DEFAULT 0)
--        transaction_id   → bank_transaction_id (varchar(255))
--   2. ADDS the 4 package columns test series was missing AND can populate:
--        unique_id      ← the receipt id checkout already generates and returns to
--                         the client (`ts-<epoch>-<rand>`, test-series-payment
--                         .controller.ts) but had nowhere to store. The admin grant
--                         path now mints one too, so the column is never NULL.
--        promocode      ← purchase-time code snapshot (json)
--        refferalcode   ← purchase-time referral snapshot (json)
--        razorpay_order ← the full gateway order response, JSON string
--   3. TYPE MATCH on the 4 shared columns that differed from package:
--        payment_method  varchar(50)  → varchar(100)
--        order_type      varchar(50)  → enum('purchase') NOT NULL DEFAULT 'purchase'
--        ip_address      varchar(45)  → varchar(255)
--        status          varchar(16)  → enum('cancel','complete','pending')
--   4. DROPS NOTHING. `gst_amount` / `handling_fee` are the two columns package does
--      not have; dropping them was proposed and explicitly declined. They stay
--      declared, written and read exactly as today — see step 7.
--
-- NOT ADOPTED (deliberate — they would be stale columns here)
--   * `generate_from`  — there is no app-vs-web signal anywhere on the request in
--                        this codebase. ws_package_course_order does not write it
--                        either and ws_live_course_order only declared it for
--                        readability. A column that can only ever hold its own
--                        DEFAULT is not consistency, it is noise.
--   * `shipping`       — a test series is 100% digital. There is no material kit, no
--                        dispatch and no ws_customer_shipping row to point at;
--                        client-purchase-history hardcodes `withMaterial: false` for
--                        this product. Nothing could ever write it.
--
-- TWO DELIBERATE DEVIATIONS FROM PACKAGE
--   * `test_series_id` stays. The product FK — package derives its product through
--     plan_id, test series cannot, because ws_test_series_price is a separate table
--     with an id space overlapping ws_package_course_ebook_price. Exactly the reason
--     ws_live_course_order keeps `live_course_id`.
--   * `promocode_id` stays. Package has no such column because it denormalises
--     promoter attribution onto ws_package_course_subscription
--     (promoter_id / promoter_percentage) and treats the JSON snapshot as the only
--     record of the code. ws_test_series_subscription has neither of those columns —
--     it copies the ORDER's promocode_id at verify
--     (test-series-order.service.ts) and the admin report resolves that id to a code
--     string. Dropping it would make the subscription's promocode link depend on a
--     snapshot that is legitimately null whenever the promocode row was later
--     deleted, i.e. it would trade a populated column for a lossy one. Reshaping
--     ws_test_series_subscription onto ws_package_course_subscription is the change
--     that would retire it; that is a separate file.
--
-- DECIMAL → INT. `order_price` and `discount_amount` are decimal(10,2); their package
-- counterparts are whole-rupee ints. Every writer is integral already — plan prices
-- are entered in rupees and computeBreakdown/resolveWalletUsage only ever add and
-- subtract them — so this is a no-op in practice. MySQL ROUNDS on this conversion
-- rather than truncating, so a stray paise would round to the nearest rupee, not
-- vanish downward.
--
--   Safety check — run on prod BEFORE applying; a non-zero result means the money
--   columns really do carry paise, so STOP and keep them decimal:
--
--     SELECT COUNT(*) FROM ws_test_series_order
--      WHERE order_price <> ROUND(order_price)
--         OR discount_amount <> ROUND(discount_amount)
--         OR base_price <> ROUND(base_price);
--
-- IDEMPOTENT + ENVIRONMENT-AGNOSTIC. Every step is guarded on information_schema.
--   * Fresh DB (table absent): step 1 creates it in the final shape; steps 2-7 no-op.
--   * Staging/prod (table present in the 2026-06-18 shape): step 1 no-ops; steps 2-7
--     migrate it.
--   Re-running is a no-op either way.
--
-- ⚠ APPLY WITH THE APPLICATION CODE, NEVER AHEAD OF IT. This file RENAMES columns,
-- and to Prisma a rename is an add plus a drop: a client that still declares the OLD
-- scalar SELECTs it and 1054s on every read — that is exactly the 2026-08-26
-- live-course payment outage (docs/MIGRATION_QUERY_CHANGES.md). The reverse is just
-- as true, so the DDL and the deploy go together, not one ahead of the other.
--
-- ⚠ NO DATA IS DISCARDED. Every one of the 5 renames is an ALTER ... CHANGE COLUMN,
-- which carries the existing values across under the new name. Nothing is dropped.
--
-- AFTER THIS FILE:
--   1. yarn prisma:generate   then RESTART the process (generate writes into
--      node_modules and does NOT trip tsx watch — utils/prismaSchemaDrift.ts)
--   2. deploy the application code
--   No backfill script: every value the new columns need is either already in the row
--   (step 5) or only exists for orders placed after the deploy.


-- ══ 1. Fresh environments: create the table already in its FINAL shape ══════════
-- Column order mirrors ws_package_course_order, with test_series_id placed next to
-- plan_id (its only structural addition) and promocode_id kept beside the snapshots.

CREATE TABLE IF NOT EXISTS `ws_test_series_order` (
  `id`                  int NOT NULL AUTO_INCREMENT,
  -- Business key = the receipt id checkout returns to the client (`ts-<epoch>-<rand>`).
  `unique_id`           varchar(255) DEFAULT NULL,
  `customer_id`         int NOT NULL,
  `test_series_id`      int NOT NULL,
  `order_type`          enum('purchase') NOT NULL DEFAULT 'purchase',
  `plan_id`             int DEFAULT NULL,
  -- Frozen purchase-time code snapshots. Exactly one is ever set. Kept as JSON (not
  -- FKs) because promocode percentages are editable and plans get repriced; the
  -- shape is the read contract modules/promoter-data JSON-path queries.
  `promocode`           json DEFAULT NULL,
  `refferalcode`        json DEFAULT NULL,
  -- The referring CUSTOMER, denormalised out of the refferalcode snapshot.
  `referrer_id`         int DEFAULT NULL,
  -- DEVIATION FROM PACKAGE (deliberate, see header): the FK the subscription copies.
  `promocode_id`        int DEFAULT NULL,
  -- Plan LIST price, always written.
  `price`               double NOT NULL DEFAULT 0,
  `code_discount`       int NOT NULL DEFAULT 0,
  `ws_coin`             int NOT NULL DEFAULT 0,
  -- Amount actually charged (post-promo, post-coin).
  `discount_price`      int NOT NULL DEFAULT 0,
  -- NOT ON PACKAGE, retained deliberately (see step 7). Both have only ever held 0 —
  -- GST_RATE and HANDLING_FEE are hardcoded 0 in testSeries.controller.ts — but they
  -- stay declared and written so switching either on is a rate change, not a DDL.
  `gst_amount`          decimal(10,2) NOT NULL DEFAULT 0.00,
  `handling_fee`        decimal(10,2) NOT NULL DEFAULT 0.00,
  `payment_method`      varchar(100) NOT NULL,
  `razorpay_order_id`   varchar(255) DEFAULT NULL,
  -- Full Razorpay order response, JSON string.
  `razorpay_order`      text,
  `razorpay_payment_id` varchar(255) DEFAULT NULL,
  `bank_transaction_id` varchar(255) DEFAULT NULL,
  `ip_address`          varchar(255) DEFAULT NULL,
  `status`              enum('cancel','complete','pending') NOT NULL DEFAULT 'pending',
  -- DEVIATION FROM PACKAGE (deliberate): datetime, not timestamp. Under the
  -- IST-in-DB storage rule (docs/migration/IST_STORAGE_MIGRATION.md) the stored
  -- wall-clock IS the value; DATETIME is timezone-inert and TIMESTAMP is not, so
  -- converting would make the column's meaning depend on the session time zone.
  `created_at`          datetime DEFAULT NULL,
  `updated_at`          datetime DEFAULT NULL,

  PRIMARY KEY (`id`),
  KEY `idx_tso_customer`  (`customer_id`),
  KEY `idx_tso_series`    (`test_series_id`),
  -- Verify + the webhook look the order up by gateway id alone (the razorpay payload
  -- carries no customer), so this is the hot path.
  KEY `idx_tso_razorpay`  (`razorpay_order_id`),
  KEY `idx_tso_unique_id` (`unique_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ══ 2. RENAMES — the 5 columns that carried a non-package name ══════════════════
-- Each guarded on the OLD name still existing, so this is a no-op on a table created
-- by step 1 and on a re-run. ws_coin is renamed NULLABLE here on purpose; the
-- NOT NULL DEFAULT 0 lands in step 6, after step 4 has cleared its NULLs.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='base_price');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_test_series_order CHANGE COLUMN `base_price` `price` double NOT NULL DEFAULT 0',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='order_price');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_test_series_order CHANGE COLUMN `order_price` `discount_price` int NOT NULL DEFAULT 0',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='discount_amount');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_test_series_order CHANGE COLUMN `discount_amount` `code_discount` int NOT NULL DEFAULT 0',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='wallet_coin');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_test_series_order CHANGE COLUMN `wallet_coin` `ws_coin` int DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='transaction_id');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_test_series_order CHANGE COLUMN `transaction_id` `bank_transaction_id` varchar(255) DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 3. ADD the 4 package columns that were missing AND are populated ════════════

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='unique_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_test_series_order ADD COLUMN `unique_id` varchar(255) DEFAULT NULL AFTER `id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='promocode');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_test_series_order ADD COLUMN `promocode` json DEFAULT NULL AFTER `plan_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='refferalcode');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_test_series_order ADD COLUMN `refferalcode` json DEFAULT NULL AFTER `promocode`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND COLUMN_NAME='razorpay_order');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_test_series_order ADD COLUMN `razorpay_order` text AFTER `razorpay_order_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 4. DATA PREP on the legacy shape, before the type changes in step 6 ═════════

-- ws_coin is NOT NULL DEFAULT 0 on package; clear the NULLs before step 6 tightens it.
UPDATE ws_test_series_order SET ws_coin = 0 WHERE ws_coin IS NULL;

-- payment_method is NOT NULL on package. Both writers always set it (checkout
-- "razorpay", admin grant "cash" or the chosen method), so this only covers a
-- hand-inserted row.
UPDATE ws_test_series_order SET payment_method = 'online'
 WHERE payment_method IS NULL OR payment_method = '';

-- Status vocabulary: the package enum has no 'failed'. Only 'pending' and 'complete'
-- are ever written by this module (test-series-order.service.ts,
-- admin-testseries.service.ts), so this covers a legacy or hand-set row only.
UPDATE ws_test_series_order SET status = 'cancel' WHERE status = 'failed';

-- order_type is enum('purchase') on package and the string 'purchase' is the only
-- value either writer passes; normalise anything else so step 6 cannot truncate.
UPDATE ws_test_series_order SET order_type = 'purchase'
 WHERE order_type IS NULL OR order_type <> 'purchase';


-- ══ 5. BACKFILL unique_id on the rows that predate the column ═══════════════════
--
-- The receipt id was generated at checkout and returned to the client but never
-- stored, so it cannot be recovered for a historical row. Mint a deterministic one
-- from the primary key instead: stable across re-runs, collision-free, and visibly
-- distinct from a live `ts-<epoch>-<rand>` so nobody mistakes it for the id the
-- customer was originally shown. This is what keeps the column NOT-NULL-in-practice
-- rather than half-populated.

UPDATE ws_test_series_order
   SET unique_id = CONCAT('ts-legacy-', id)
 WHERE unique_id IS NULL OR unique_id = '';


-- ══ 6. TYPE MATCH — the 4 shared columns that differed from package ═════════════
-- Plus ws_coin, tightened now that step 4 cleared its NULLs.

ALTER TABLE ws_test_series_order
  MODIFY COLUMN `payment_method` varchar(100) NOT NULL,
  MODIFY COLUMN `order_type`     enum('purchase') NOT NULL DEFAULT 'purchase',
  MODIFY COLUMN `ip_address`     varchar(255) DEFAULT NULL,
  MODIFY COLUMN `ws_coin`        int NOT NULL DEFAULT 0,
  MODIFY COLUMN `status`         enum('cancel','complete','pending') NOT NULL DEFAULT 'pending';


-- ══ 7. NO COLUMN IS DROPPED BY THIS FILE ═══════════════════════════════════════
--
-- `gst_amount` and `handling_fee` are the two columns ws_package_course_order does
-- not have, and they have only ever held 0 (GST_RATE / HANDLING_FEE are hardcoded 0
-- in src/client/testSeries/testSeries.controller.ts, and computeBreakdown is their
-- only writer). Dropping them was proposed and EXPLICITLY DECLINED — no column comes
-- off ws_test_series_order without the owner's consent.
--
-- They therefore remain fully live, not vestigial: still declared on
-- prisma/schema.prisma TestSeriesOrder, still written on every checkout, still read
-- by admin-testseries.service.ts orderDto. If GST or a handling fee is ever switched
-- on, the columns are already there and already wired.
--
-- Should that decision ever be revisited, this is the check to run first (a non-zero
-- result means the columns hold real money and must stay regardless):
--
--   SELECT COUNT(*) FROM ws_test_series_order
--    WHERE COALESCE(gst_amount,0) <> 0 OR COALESCE(handling_fee,0) <> 0;


-- ══ 8. INDEX on the new business key ════════════════════════════════════════════
-- Non-unique, matching the role ws_package_course_order.rorder_unique_id and
-- ws_live_course_order.lco_unique_id play as lookup keys.

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_order' AND INDEX_NAME='idx_tso_unique_id');
SET @ddl := IF(@idx=0, 'ALTER TABLE ws_test_series_order ADD KEY `idx_tso_unique_id` (`unique_id`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
