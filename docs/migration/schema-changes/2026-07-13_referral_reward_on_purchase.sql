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
-- Idempotent / re-runnable: guarded so a second apply is a no-op.

-- ── 1. referrer_id on the 5 referral-eligible order tables ──────────────────
-- course + package share ws_package_course_order (one id space).
ALTER TABLE `ws_package_course_order`
  ADD COLUMN `referrer_id` INT NULL AFTER `refferalcode`;

ALTER TABLE `ws_ebook_order`
  ADD COLUMN `referrer_id` INT NULL AFTER `promocode`;

ALTER TABLE `ws_live_course_subscription`
  ADD COLUMN `referrer_id` INT NULL AFTER `promocode_id`;

ALTER TABLE `ws_test_series_order`
  ADD COLUMN `referrer_id` INT NULL AFTER `promocode_id`;

-- ── 2. source discriminator on the reward ledger ────────────────────────────
ALTER TABLE `ws_refferal_transaction`
  ADD COLUMN `source` VARCHAR(20) NULL AFTER `order_id`;

-- Helps the (source, order_id, customer) idempotency probe on credit writes.
ALTER TABLE `ws_refferal_transaction`
  ADD INDEX `idx_refferal_txn_credit_dedupe` (`customer_id`, `source`, `order_id`, `type`);
