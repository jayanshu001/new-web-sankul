-- 2026-07-13 — Wallet ("coin") redemption in the payment create-order flow
--
-- Implements the wallet contract in docs/FE_WALLET_IN_PAYMENT.md (specced but
-- never actually built). The 5 create-order endpoints accept an optional `coin`
-- (integer rupees) redeemed from ws_customer.reward_points. Razorpay is charged
-- (planPrice − promoDiscount − coin); the coins are DEBITED at verify (not at
-- create-order), idempotently, with a ws_refferal_transaction DEBIT row tagged by
-- `source` (added 2026-07-13_referral_reward_on_purchase.sql).
--
-- Storage of the coin amount on the pending order so verify knows how much to debit:
--   * course + package → REUSE the existing ws_package_course_order.ws_coin column.
--   * ebook / live-course / test-series → NEW wallet_coin column below.
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so each
-- add is guarded on information_schema and becomes a no-op if already applied
-- (fixes "Duplicate column name" on a re-run).

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_ebook_order' AND COLUMN_NAME = 'wallet_coin');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_ebook_order` ADD COLUMN `wallet_coin` INT NULL AFTER `referrer_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'wallet_coin');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `wallet_coin` INT NULL AFTER `referrer_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_test_series_order' AND COLUMN_NAME = 'wallet_coin');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_test_series_order` ADD COLUMN `wallet_coin` INT NULL AFTER `referrer_id`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
