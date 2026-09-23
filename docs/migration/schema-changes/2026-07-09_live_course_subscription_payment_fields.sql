-- Add Subscription: standardized payment section for Live Course grants.
-- The admin Live Course grant is being extended from a free-grant to a full
-- paid grant. ws_live_course_subscription already stores razorpay_order_id /
-- razorpay_payment_id / paid_amount / payment_status inline; add the remaining
-- payment columns so the granular method + bank reference + a remark persist on
-- the subscription row (this table has no sibling order table).
--
-- IDEMPOTENT: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so each add is guarded
-- on information_schema and becomes a no-op if already applied (fixes
-- "Duplicate column name" on a re-run).

-- payment_method --------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'payment_method');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `payment_method` VARCHAR(191) NULL AFTER `payment_status`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- bank_transaction_id ---------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'bank_transaction_id');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `bank_transaction_id` VARCHAR(191) NULL AFTER `razorpay_payment_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- remarks ---------------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'remarks');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `remarks` TEXT NULL AFTER `bank_transaction_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
