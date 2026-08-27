-- 2026-08-27 (b) — ws_live_course_subscription: adopt the
--                  ws_package_course_subscription shape
--
-- Companion to 2026-08-27_live_course_order_match_package_shape.sql, which did the
-- same for the order tables. ws_package_course_subscription IS THE STANDARD.
--
-- ⚠ THIS FILE ALSO APPLIES THE OVERDUE 2026-08-25 DROP (step 1). PROD already ran
-- 2026-08-25_live_course_subscription_drop_payment_columns.sql (that is what the
-- 2026-08-26 incident was about) but STAGING never did — it still carries all 11
-- legacy payment columns and idx_lcs_created_payment, while `schema.prisma` has
-- assumed the post-drop shape since 2026-08-26. Step 1 is guarded, so it no-ops on
-- prod and converges staging. Leaving the two environments diverged is exactly the
-- condition that produced the incident.
--
-- SAFE TO DROP: the payment data those columns held now lives on
-- ws_live_course_order. Verify `SELECT COUNT(*) FROM ws_live_course_subscription
-- WHERE order_id IS NULL` is 0 before applying — a row without an order has not been
-- backfilled and its payment data would be lost.
-- ⚠ scripts/backfill-live-course-orders.ts CANNOT currently do that backfill (it
-- reads columns schema.prisma no longer declares, so every value comes back
-- undefined). If the count is non-zero, STOP and fix the script first.
--
--
-- THREE GROUPS OF CHANGE
--
--   2. RENAMES to the package names (requested):
--        customer_shipping_id → shipping
--        tracking_id          → tracking
--      `plan_id` is deliberately NOT renamed to package's `pcb_id` — see the
--      DELIBERATE DEVIATIONS note below.
--
--   3. ADDS the 8 package columns live course was missing:
--        pc_material_id, amount, course_amount, material_amount,
--        payment_type, promoter_id, promoter_percentage, paid_amount
--
--   4. `pc_material_id` needs a SOURCE. On package the kit id is copied off
--      ws_course.pc_material_id / ws_package.pc_material_id. ws_live_course had no
--      such column, so the field could only ever be NULL. Step 4 adds it, mirroring
--      the other two catalog tables exactly, so the value logic is real.
--
--
-- DELIBERATE DEVIATIONS (both documented, neither is an oversight)
--
--   * `live_course_id` has no package counterpart — package identifies its product
--     with package_id / course_id. It is the product FK and must stay.
--
--   * `plan_id` is NOT renamed to `pcb_id`. `pcb_id` is a legacy name unique to
--     ws_package_course_subscription: BOTH order tables
--     (ws_package_course_order, ws_live_course_order) already call this column
--     `plan_id`, so `plan_id` is the majority spelling and `pcb_id` is the outlier.
--     Renaming live course TO the outlier would undo the consistency the
--     2026-08-27 order work established.
--
--   * `customer_id` and `status` keep their NOT NULL constraints. Package has them
--     NULLABLE, but that is legacy laxity, not intent — measured on staging,
--     0 of 561,051 ws_package_course_subscription rows have a NULL in either column.
--     The underlying TYPES are already identical (int / tinyint); only the
--     constraint differs, and loosening it would import a defect: a NULL `status`
--     is neither true nor false and the entitlement gate reads `status = 1`.
--     Tightening PACKAGE to NOT NULL is the correct fix and is out of scope here
--     (561k-row live table).
--
--   * `with_material` and `tracking_status` stay. Package expresses the first via
--     pc_material_id/material_amount and the second via its separate
--     ws_package_course_subscription_tracking table; live course has no tracking
--     table (the AWB is inline), so removing them would lose real state.
--
--
-- IDEMPOTENT. Every step is guarded on information_schema; re-running is a no-op.
--
-- AFTER THIS FILE:
--   1. yarn prisma:generate  →  RESTART the process
--   2. deploy the application code (it writes the new columns at verify + grant)
-- Step 6 backfills the new columns for rows that already exist, so no separate
-- backfill script is needed.


-- ══ 1. The overdue 2026-08-25 drop (no-op on prod, converges staging) ═══════════
-- Also drops the LEGACY `paid_amount int`. Step 3 re-adds `paid_amount` as
-- decimal(10,2) — the package type. The drop MUST happen first: same name, and the
-- old int column would otherwise block the add.

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
               AND INDEX_NAME='idx_lcs_created_payment');
SET @ddl := IF(@idx=1, 'ALTER TABLE ws_live_course_subscription DROP INDEX idx_lcs_created_payment', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
               AND INDEX_NAME='idx_lcs_created');
SET @ddl := IF(@idx=0, 'ALTER TABLE ws_live_course_subscription ADD KEY `idx_lcs_created` (`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @n := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
             AND COLUMN_NAME IN ('promocode','refferalcode','wallet_coin','original_amount',
                                 'paid_amount','payment_method','razorpay_order_id',
                                 'razorpay_payment_id','bank_transaction_id','paid_at',
                                 'payment_status'));
SET @ddl := IF(@n=11,
  'ALTER TABLE ws_live_course_subscription
     DROP COLUMN promocode, DROP COLUMN refferalcode, DROP COLUMN wallet_coin,
     DROP COLUMN original_amount, DROP COLUMN paid_amount, DROP COLUMN payment_method,
     DROP COLUMN razorpay_order_id, DROP COLUMN razorpay_payment_id,
     DROP COLUMN bank_transaction_id, DROP COLUMN paid_at, DROP COLUMN payment_status',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 2. RENAMES to the package names ════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
               AND COLUMN_NAME='customer_shipping_id');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_live_course_subscription CHANGE COLUMN `customer_shipping_id` `shipping` int DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
               AND COLUMN_NAME='tracking_id');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_live_course_subscription CHANGE COLUMN `tracking_id` `tracking` bigint DEFAULT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 3. ADD the 8 package columns ═══════════════════════════════════════════════
-- Types copied EXACTLY from ws_package_course_subscription: money is double for the
-- amount split (legacy) and decimal(10,2) for paid_amount / promoter_percentage.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='pc_material_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `pc_material_id` int DEFAULT NULL AFTER `plan_id`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='amount');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `amount` double DEFAULT NULL AFTER `end_at`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='course_amount');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `course_amount` double DEFAULT NULL AFTER `amount`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='material_amount');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `material_amount` double DEFAULT NULL AFTER `course_amount`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='payment_type');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `payment_type` enum(''backend'',''online'') NOT NULL DEFAULT ''online'' AFTER `remarks`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='promoter_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `promoter_id` int DEFAULT NULL', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='promoter_percentage');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `promoter_percentage` decimal(10,2) DEFAULT NULL', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND COLUMN_NAME='paid_amount');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course_subscription ADD COLUMN `paid_amount` decimal(10,2) DEFAULT NULL', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 4. Give pc_material_id a real source on the catalog table ══════════════════
-- Mirrors ws_course.pc_material_id / ws_package.pc_material_id → ws_package_course_material.
-- Without this the subscription column could only ever be NULL. Admin live-course
-- create/update does not expose it yet — that is a follow-up; the plumbing is here.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course' AND COLUMN_NAME='pc_material_id');
SET @ddl := IF(@col=0,
  'ALTER TABLE ws_live_course ADD COLUMN `pc_material_id` int DEFAULT NULL AFTER `with_material`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 5. Promoter index (mirrors idx_pcs_promoter) ═══════════════════════════════

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription' AND INDEX_NAME='idx_lcs_promoter');
SET @ddl := IF(@idx=0,
  'ALTER TABLE ws_live_course_subscription ADD KEY `idx_lcs_promoter` (`promoter_id`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 6. BACKFILL the new columns for rows that already exist ════════════════════
-- Every value comes from the order this subscription is already linked to, plus its
-- plan. Rows with no order (order_id IS NULL) are left alone — there is nothing to
-- read them from.

-- 6a. amount / paid_amount = what the order charged (ws_live_course_order.discount_price).
UPDATE ws_live_course_subscription s
  JOIN ws_live_course_order o ON o.id = s.order_id
   SET s.amount      = COALESCE(o.discount_price, 0),
       s.paid_amount = COALESCE(o.discount_price, 0)
 WHERE s.amount IS NULL;

-- 6b. payment_type: an order with a gateway id was paid online; anything else
--     (admin grant, cash, bank transfer) is a backend entry. Same rule the
--     live-course report already uses to label activationType.
UPDATE ws_live_course_subscription s
  JOIN ws_live_course_order o ON o.id = s.order_id
   SET s.payment_type = IF(o.razorpay_order_id IS NULL OR o.razorpay_order_id = '', 'backend', 'online');

-- 6c. course/material split — the SQL twin of computeMaterialSplit()
--     (commerce-order.service.ts). MIN_COURSE_AMOUNT = 100.
--       no material            → course = amount, material = NULL
--       amount − matPrice ≥100 → course = that, material = the residual
--       otherwise              → course = min(100, max(amount−1, 0)), material = residual
--     Material is kept at ≥1 so a real material order never reads as "Without
--     Material" in the dispatch report. Keeping material as the RESIDUAL guarantees
--     course + material == amount exactly.
UPDATE ws_live_course_subscription s
  JOIN ws_live_course_order o ON o.id = s.order_id
  LEFT JOIN ws_live_course_plan p ON p.id = s.plan_id
   SET s.course_amount = IF(
         s.with_material = 0 OR p.id IS NULL OR p.with_material = 0,
         COALESCE(s.amount, 0),
         IF(COALESCE(s.amount,0) - COALESCE(p.material_price,0) >= 100,
            COALESCE(s.amount,0) - COALESCE(p.material_price,0),
            LEAST(100, GREATEST(COALESCE(s.amount,0) - 1, 0)))),
       s.material_amount = IF(
         s.with_material = 0 OR p.id IS NULL OR p.with_material = 0,
         NULL,
         COALESCE(s.amount,0) - IF(COALESCE(s.amount,0) - COALESCE(p.material_price,0) >= 100,
            COALESCE(s.amount,0) - COALESCE(p.material_price,0),
            LEAST(100, GREATEST(COALESCE(s.amount,0) - 1, 0))))
 WHERE s.course_amount IS NULL;

-- 6d. promoter attribution, denormalised out of the order's frozen promocode
--     snapshot — the same two JSON paths modules/promoter-data already reads
--     (`$.promoterId`, `$.promotedPackageCourseEbook[0].promoterPercentage`).
--     A REFERRAL snapshot deliberately yields nothing: the earner there is a
--     CUSTOMER, not a ws_promoter, and crediting one as the other would book
--     customer referral rewards as promoter commission.
UPDATE ws_live_course_subscription s
  JOIN ws_live_course_order o ON o.id = s.order_id
   SET s.promoter_id = CAST(JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promoterId')) AS UNSIGNED),
       s.promoter_percentage =
         CAST(JSON_UNQUOTE(JSON_EXTRACT(o.promocode,'$.promotedPackageCourseEbook[0].promoterPercentage')) AS DECIMAL(10,2))
 WHERE s.promoter_id IS NULL
   AND o.promocode IS NOT NULL
   AND JSON_EXTRACT(o.promocode,'$.promoterId') IS NOT NULL;

-- 6e. pc_material_id — copied from the live course, exactly as package copies it
--     from ws_course / ws_package. No-op until a live course has a kit configured.
UPDATE ws_live_course_subscription s
  JOIN ws_live_course lc ON lc.id = s.live_course_id
   SET s.pc_material_id = lc.pc_material_id
 WHERE s.pc_material_id IS NULL AND lc.pc_material_id IS NOT NULL;
