-- 2026-08-31 — ws_test_series_subscription: adopt the ws_package_course_subscription
-- naming, and gain the promoter-attribution columns
--
-- Companion to 2026-08-31_test_series_order_match_package_shape.sql. Apply that file
-- FIRST: the promoter backfill in step 5 reads ws_test_series_order.promocode, which
-- only exists after it.
--
-- WHY. This table was created net-new on 2026-06-18 alongside the order table and had
-- the same problem — its names came off the Mongoose model, not off
-- ws_package_course_subscription. It is much closer to the standard than the order
-- table was: 12 of its 16 columns already carry the package name. Only ONE column is
-- actually misnamed.
--
-- SCOPE RULE (unchanged): a column is adopted only if a value is available and
-- WRITTEN, and that rule governs additions only. NOTHING IS DROPPED.
--
-- FOUR GROUPS OF CHANGE
--   1. RENAME — the single misnamed column:
--        price → amount   (decimal(10,2) → double, package's type)
--   2. ADDS the 3 package columns that are now fillable:
--        promoter_id, promoter_percentage, paid_amount
--   3. TYPE MATCH on 2 shared columns:
--        payment_type  varchar(16)  → enum('backend','online')
--        remarks       varchar(255) → text
--   4. INDEX idx_tss_promoter (promoter_id, created_at) — mirrors idx_pcs_promoter
--      and idx_lcs_promoter.
--
-- ⚠ `plan_id` IS NOT RENAMED, deliberately. ws_package_course_subscription calls this
-- `pcb_id`, but package is the OUTLIER: both order tables and
-- ws_live_course_subscription all say `plan_id`, and the 2026-08-27 live-course
-- reshape explicitly chose `plan_id` over `pcb_id` for exactly this reason. Renaming
-- test series to `pcb_id` would spread the legacy name, not the standard. If anything
-- is ever realigned here it is package, not this table.
--
-- NOT ADOPTED (they would be stale columns here — same rule as the order table)
--   * `pc_material_id`, `shipping`, `tracking` — a test series is 100% digital. There
--     is no material kit, no dispatch address and no AWB. client-purchase-history
--     hardcodes `withMaterial: false` for this product.
--   * `course_amount` / `material_amount` — the digital/physical split of `amount`.
--     With no material, course_amount would be identical to amount on every row and
--     material_amount NULL on every row. Two columns encoding nothing.
--   * `package_id` / `course_id` — the product FK is `test_series_id`, which this
--     table already has.
--
-- NOTHING IS DROPPED. `promocode_id` in particular STAYS: verify copies it off the
-- order (test-series-order.service.ts) and the admin report resolves it to a code
-- string. ws_package_course_subscription has no equivalent only because it treats the
-- order's JSON snapshot as the sole record of the code; here the column is populated
-- and read, so it is kept.
--
-- WHY promoter_id / promoter_percentage ARE ONLY NOW POSSIBLE. They are denormalised
-- out of the ORDER's frozen promocode snapshot — `$.promoterId` and
-- `$.promotedPackageCourseEbook[0].promoterPercentage`, the two paths
-- modules/promoter-data reads. ws_test_series_order had no `promocode` column until
-- the companion file added it today, so before that there was no source and these two
-- columns would have been exactly the stale columns this migration refuses to create.
--
-- ⚠ SCOPE HONESTY: this puts the DATA in place, it does not by itself make test
-- series appear on the promoter dashboard. admin-promoter.service.ts queries
-- ws_package_course_subscription ONLY — it does not read ws_live_course_subscription
-- either, even though that table has carried these columns since 2026-08-27.
-- Extending the dashboard to union the other product tables is a separate change that
-- would cover live course and test series together. This file makes test series ready
-- for it, on the same footing as live course.
--
-- DECIMAL → DOUBLE on `price`/`amount`. ws_package_course_subscription.amount is
-- `double`; this column is decimal(10,2). Widening, so no value is at risk.
--
--   Sanity check — run before applying; a non-zero result is informational only
--   (double represents these fine), not a stop condition:
--
--     SELECT COUNT(*) FROM ws_test_series_subscription WHERE price <> ROUND(price);
--
-- IDEMPOTENT + ENVIRONMENT-AGNOSTIC. Every step is guarded on information_schema.
--   * Fresh DB (table absent): step 1 creates it in the final shape; steps 2-6 no-op.
--   * Staging/prod (2026-06-18 shape): step 1 no-ops; steps 2-6 migrate it.
--   Re-running is a no-op either way.
--
-- ⚠ APPLY WITH THE APPLICATION CODE, NEVER AHEAD OF IT. `price` → `amount` is a
-- rename, and to Prisma a rename is an add plus a drop: a client still declaring
-- `price` SELECTs it and 1054s on every read (the 2026-08-26 live-course outage).
--
-- AFTER THIS FILE:
--   1. yarn prisma:generate   then RESTART the process
--   2. deploy the application code


-- ══ 1. Fresh environments: create the table already in its FINAL shape ══════════

CREATE TABLE IF NOT EXISTS `ws_test_series_subscription` (
  `id`                  int NOT NULL AUTO_INCREMENT,
  `order_id`            int DEFAULT NULL,
  `customer_id`         int NOT NULL,
  `test_series_id`      int NOT NULL,
  -- NOT `pcb_id` — see the header. plan_id is the standard, package is the outlier.
  `plan_id`             int DEFAULT NULL,
  `start_at`            datetime DEFAULT NULL,
  `end_at`              datetime DEFAULT NULL,
  -- Charged amount for THIS row (was `price`). Never a running total: one order =
  -- one subscription row, so summing a customer's rows must not double-count.
  `amount`              double DEFAULT NULL,
  `status`              tinyint(1) NOT NULL DEFAULT 1,
  `remarks`             text,
  `payment_type`        enum('backend','online') NOT NULL DEFAULT 'online',
  -- Promoter attribution, denormalised from ws_test_series_order.promocode.
  -- A REFERRAL snapshot deliberately yields NULL here: its earner is a CUSTOMER, not
  -- a ws_promoter, and booking one as the other would pay referral rewards as
  -- promoter commission.
  `promoter_id`         int DEFAULT NULL,
  `promoter_percentage` decimal(10,2) DEFAULT NULL,
  -- Reporting mirror of `amount`; the column admin-promoter's commission math reads
  -- on the package table.
  `paid_amount`         decimal(10,2) DEFAULT NULL,
  -- NOT ON PACKAGE, retained deliberately (see header): the promocode FK verify
  -- copies off the order and the admin report resolves to a code string.
  `promocode_id`        int DEFAULT NULL,
  `created_at`          datetime DEFAULT NULL,
  `updated_at`          datetime DEFAULT NULL,
  `created_by`          int DEFAULT NULL,
  `updated_by`          int DEFAULT NULL,

  PRIMARY KEY (`id`),
  KEY `idx_tss_created` (`created_at`),
  -- Mirrors idx_pcs_promoter / idx_lcs_promoter: the promoter dashboard filters
  -- promoter_id and sorts created_at.
  KEY `idx_tss_promoter` (`promoter_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ══ 2. RENAME — the one misnamed column ════════════════════════════════════════
-- Guarded on the OLD name still existing, so this no-ops on a table created by step 1
-- and on a re-run. decimal(10,2) → double is a widening conversion.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_subscription' AND COLUMN_NAME='price');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_test_series_subscription CHANGE COLUMN `price` `amount` double DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 3. ADD the 3 package columns that are now fillable ═════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_subscription' AND COLUMN_NAME='promoter_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_test_series_subscription ADD COLUMN `promoter_id` int DEFAULT NULL AFTER `payment_type`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_subscription' AND COLUMN_NAME='promoter_percentage');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_test_series_subscription ADD COLUMN `promoter_percentage` decimal(10,2) DEFAULT NULL AFTER `promoter_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_subscription' AND COLUMN_NAME='paid_amount');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_test_series_subscription ADD COLUMN `paid_amount` decimal(10,2) DEFAULT NULL AFTER `promoter_percentage`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 4. DATA PREP before the type changes in step 6 ═════════════════════════════

-- payment_type becomes enum('backend','online'); normalise anything outside the pair
-- so the MODIFY cannot truncate a row to ''. Only these two values are ever written
-- (test-series-order.service.ts writes "online", admin grant writes "backend").
UPDATE ws_test_series_subscription SET payment_type = 'online'
 WHERE payment_type IS NULL OR payment_type NOT IN ('backend','online');


-- ══ 5. BACKFILL the three new columns ══════════════════════════════════════════

-- 5a. paid_amount mirrors amount. Meaningful on every existing row.
UPDATE ws_test_series_subscription SET paid_amount = amount
 WHERE paid_amount IS NULL AND amount IS NOT NULL;

-- 5b. Promoter attribution from the order's frozen snapshot.
--
-- ⚠ Expect this to update ZERO rows on staging and prod, and that is CORRECT, not a
-- failure. ws_test_series_order.promocode was added today, so every historical order
-- has it NULL — there is no snapshot to denormalise from. The statement is here so a
-- database that DOES have snapshots (a fresh environment, or a re-run after orders
-- have been placed) converges to the same state as the write path.
--
-- JSON_UNQUOTE before CAST: JSON_EXTRACT returns a JSON scalar, and casting that
-- directly yields NULL for a quoted string like "12". The percentage is stored as a
-- string ("12") because that is how the legacy ORM serialized decimals.
UPDATE ws_test_series_subscription s
  JOIN ws_test_series_order o ON o.id = s.order_id
   SET s.promoter_id = CAST(JSON_UNQUOTE(JSON_EXTRACT(o.promocode, '$.promoterId')) AS UNSIGNED),
       s.promoter_percentage = CAST(JSON_UNQUOTE(
         JSON_EXTRACT(o.promocode, '$.promotedPackageCourseEbook[0].promoterPercentage')) AS DECIMAL(10,2))
 WHERE s.promoter_id IS NULL
   AND o.promocode IS NOT NULL
   AND JSON_EXTRACT(o.promocode, '$.promoterId') IS NOT NULL;


-- ══ 6. TYPE MATCH — the 2 shared columns that differed from package ════════════

ALTER TABLE ws_test_series_subscription
  MODIFY COLUMN `payment_type` enum('backend','online') NOT NULL DEFAULT 'online',
  MODIFY COLUMN `remarks`      text;


-- ══ 7. NO COLUMN IS DROPPED BY THIS FILE ═══════════════════════════════════════
-- `promocode_id` is the only column ws_package_course_subscription does not have (the
-- product FK `test_series_id` aside), and it is actively written and read. It stays.


-- ══ 8. INDEX for the promoter dashboard ════════════════════════════════════════
-- Mirrors idx_pcs_promoter (package) and idx_lcs_promoter (live course): filter
-- promoter_id, sort created_at.

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_test_series_subscription' AND INDEX_NAME='idx_tss_promoter');
SET @ddl := IF(@idx=0,
  'ALTER TABLE ws_test_series_subscription ADD KEY `idx_tss_promoter` (`promoter_id`,`created_at`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
