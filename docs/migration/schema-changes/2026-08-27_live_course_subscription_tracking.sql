-- 2026-08-27 (c) — ws_live_course_subscription_tracking: give live course a real
--                  shipment-tracking table
--
-- WHY. Live course was the only product carrying its dispatch state INLINE on the
-- entitlement row: `tracking` (a synthetic AWB) + `tracking_status`. Every other
-- product keeps it in a side table — ws_package_course_subscription_tracking — and
-- that table is the reference for every column here.
--
-- This closes the last two shape deviations left by 2026-08-27 (b):
-- `tracking_status` had no package counterpart precisely because package keeps status
-- in the tracking row. After this file, ws_live_course_subscription differs from
-- ws_package_course_subscription only by its product FK (live_course_id), the
-- plan_id/pcb_id naming decision, with_material, and the two NOT NULL constraints —
-- all four documented in 2026-08-27_live_course_subscription_match_package_shape.sql.
--
-- REFERENCE TABLE, COLUMN FOR COLUMN:
--   id         bigint NOT NULL AUTO_INCREMENT   (PK; doubles as the AWB — see below)
--   `order`    int NOT NULL                     (the ORDER id, NOT the subscription id)
--   status     varchar(25) NOT NULL DEFAULT 'pending'
--   created_at timestamp NULL
--   updated_at timestamp NULL
--   KEY on `order`
--
-- ⚠ `order` IS THE ORDER ID, NOT THE SUBSCRIPTION ID. This is the one thing that is
-- easy to get wrong: the column name reads like a sort order, and the row hangs off
-- the entitlement, but ws_package_course_subscription_tracking.`order` stores
-- ws_package_course_order.id (see the verifyCourseTx comment in
-- commerce-order.repository.ts). Live course follows suit: it stores
-- ws_live_course_order.id.
--
-- ⚠ THE PK DOUBLES AS THE AWB. `ws_package_course_subscription.tracking` is an FK to
-- this table's id AND the value the courier layer treats as the AWB number
-- (`awb: Number(sub.trackingId)`, `courierForAwb(...)` routes on the Tirupati
-- threshold). Live course already used its own subscription id the same way. That is
-- why step 2 migrates existing rows with an EXPLICIT id rather than letting
-- AUTO_INCREMENT assign a fresh one: an AWB already handed to a courier must not
-- change underneath a shipment in flight.
--
-- IDEMPOTENT. Guarded on information_schema throughout; re-running is a no-op.
--
-- AFTER THIS FILE:
--   1. yarn prisma:generate  →  RESTART the process
--   2. deploy the application code
-- Step 2 migrates existing rows, so no separate backfill script is needed.


-- ══ 1. The tracking table ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `ws_live_course_subscription_tracking` (
  `id`         bigint NOT NULL AUTO_INCREMENT,
  -- ws_live_course_order.id — NOT the subscription id. See the header.
  `order`      int NOT NULL,
  `status`     varchar(25) NOT NULL DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  -- Looked up by order id on every purchase-history page (the reference table had
  -- only a PK until 2026-08-26_purchase_history_indexes.sql fixed exactly that).
  KEY `idx_lcst_order` (`order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- ══ 2. Migrate the inline dispatch state into rows ═════════════════════════════
-- One row per subscription that already has an AWB, inserted with its EXISTING
-- `tracking` value as the PK so the AWB is preserved byte-for-byte. `subscription.
-- tracking` therefore does NOT change and stays a valid FK.
--
-- Guarded on tracking_status still existing (i.e. this file has not run yet).

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
               AND COLUMN_NAME='tracking_status');
SET @ddl := IF(@col=1,
  'INSERT IGNORE INTO ws_live_course_subscription_tracking (id, `order`, status, created_at, updated_at)
     SELECT s.tracking,
            s.order_id,
            COALESCE(NULLIF(s.tracking_status, ""), "pending"),
            s.created_at,
            s.updated_at
       FROM ws_live_course_subscription s
      WHERE s.tracking IS NOT NULL AND s.order_id IS NOT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Push AUTO_INCREMENT past every explicitly-inserted id so the next allocated AWB
-- cannot collide with a migrated one.
SET @next := (SELECT COALESCE(MAX(id), 0) + 1 FROM ws_live_course_subscription_tracking);
SET @ddl := CONCAT('ALTER TABLE ws_live_course_subscription_tracking AUTO_INCREMENT = ', @next);
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- A subscription whose AWB could not be migrated (no order_id) would keep a dangling
-- `tracking` value pointing at no row. Clear it — the shipment is unrecoverable
-- either way, and a dangling FK breaks the join that renders the tracking card.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
               AND COLUMN_NAME='tracking_status');
SET @ddl := IF(@col=1,
  'UPDATE ws_live_course_subscription s
      LEFT JOIN ws_live_course_subscription_tracking t ON t.id = s.tracking
        SET s.tracking = NULL
      WHERE s.tracking IS NOT NULL AND t.id IS NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;


-- ══ 3. Drop the inline status column ═══════════════════════════════════════════
-- It now lives on the tracking row, exactly as it does for package/course.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_live_course_subscription'
               AND COLUMN_NAME='tracking_status');
SET @ddl := IF(@col=1,
  'ALTER TABLE ws_live_course_subscription DROP COLUMN `tracking_status`', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
