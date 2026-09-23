-- Wave 2 (referral): the Mongo RefferalTransactionStatus has 'failed' (set when a
-- payout fails) but the legacy SQL enum was only ('pending','successful').
-- Adding 'failed' is an additive enum widening (existing rows unaffected). Prod-safe.
ALTER TABLE `ws_refferal_transaction`
  MODIFY COLUMN `status` ENUM('pending','successful','failed') NOT NULL;
