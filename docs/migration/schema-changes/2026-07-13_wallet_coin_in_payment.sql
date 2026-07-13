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
-- Idempotent / re-runnable.

ALTER TABLE `ws_ebook_order`
  ADD COLUMN `wallet_coin` INT NULL AFTER `referrer_id`;

ALTER TABLE `ws_live_course_subscription`
  ADD COLUMN `wallet_coin` INT NULL AFTER `referrer_id`;

ALTER TABLE `ws_test_series_order`
  ADD COLUMN `wallet_coin` INT NULL AFTER `referrer_id`;
