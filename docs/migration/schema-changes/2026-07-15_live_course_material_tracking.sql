-- 2026-07-15 — Live-course material shipment tracking (Track Order parity with Books).
--
-- ws_live_course_subscription had with_material + customer_shipping_id but NO place
-- to store a shipment AWB/status (unlike ws_book_order.tracking_id and
-- ws_package_course_subscription.tracking, which already carry it). Add two inline
-- columns so with-material live-course orders can surface Track Order in
-- GET client/purchase-history/subscriptions and the tracking-detail endpoint.
--
-- tracking_id is a synthetic AWB allocated at payment-verify (below the Tirupati
-- INITIAL_Number threshold → generic/Mahavir trackingUrl), mirroring how SQL book
-- AWBs work today. NULL until the sub is a paid with-material order.
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so each add
-- is guarded on information_schema and becomes a no-op if already applied (fixes
-- "Duplicate column name" on a re-run).

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'tracking_id');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `tracking_id` BIGINT NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'tracking_status');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `tracking_status` VARCHAR(20) NULL',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
