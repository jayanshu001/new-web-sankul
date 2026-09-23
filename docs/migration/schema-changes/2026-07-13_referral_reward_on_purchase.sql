-- 2026-07-13 — Referral reward on purchase (creditReferrer wiring)
--
-- Wires the referrer-reward credit into the purchase verify flow. When a buyer
-- checks out with someone's referral code, the referrer is credited
-- ReferralProgram.refferalReward % of the paid amount into their wallet
-- (ws_customer.reward_points) with a ws_refferal_transaction credit row.
--
-- Two structural changes are required:
--
-- 1. referrer_id on each referral-eligible order table — stamped at create-order
--    when a referral code resolves, read back at verify to know whom to credit.
--    (Referral codes are NOT promocodes, so promocode_id cannot carry this.)
--
-- 2. source on ws_refferal_transaction — order ids are per-table (a course order
--    #100 and an ebook order #100 are different purchases). The credit
--    idempotency key becomes (source, order_id, referrer) so cross-table id
--    collisions don't wrongly dedupe or mis-credit. NOTE: order_id has NO
--    physical FK to ws_package_course_order in this DB (the Prisma relation is
--    logical only), so nothing needs to be dropped — order_id is now polymorphic
--    across the 5 order tables, discriminated by `source`.
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no ADD COLUMN / ADD INDEX "IF NOT
-- EXISTS", so each add is guarded on information_schema and becomes a no-op if
-- already applied (fixes "Duplicate column name" on a re-run).

-- ── 1. referrer_id on the 5 referral-eligible order tables ──────────────────
-- course + package share ws_package_course_order (one id space).
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_package_course_order' AND COLUMN_NAME = 'referrer_id');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_package_course_order` ADD COLUMN `referrer_id` INT NULL AFTER `refferalcode`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_ebook_order' AND COLUMN_NAME = 'referrer_id');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_ebook_order` ADD COLUMN `referrer_id` INT NULL AFTER `promocode`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'referrer_id');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `referrer_id` INT NULL AFTER `promocode_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_test_series_order' AND COLUMN_NAME = 'referrer_id');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_test_series_order` ADD COLUMN `referrer_id` INT NULL AFTER `promocode_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── 2. source discriminator on the reward ledger ────────────────────────────
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_refferal_transaction' AND COLUMN_NAME = 'source');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_refferal_transaction` ADD COLUMN `source` VARCHAR(20) NULL AFTER `order_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Helps the (source, order_id, customer) idempotency probe on credit writes.
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_refferal_transaction' AND INDEX_NAME = 'idx_refferal_txn_credit_dedupe');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_refferal_transaction` ADD INDEX `idx_refferal_txn_credit_dedupe` (`customer_id`, `source`, `order_id`, `type`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
