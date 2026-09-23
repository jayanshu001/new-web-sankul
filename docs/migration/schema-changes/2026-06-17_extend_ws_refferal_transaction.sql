-- Wave 2 (referral): add provider_ref (RazorpayX payout id) + failure_reason to
-- support the withdrawal → payout → webhook flow on SQL. The webhook keys off
-- provider_ref. Additive, prod-safe, run once. (Mongo stored these as fields;
-- the legacy SQL table never had them.)
ALTER TABLE `ws_refferal_transaction`
  ADD COLUMN `provider_ref` VARCHAR(255) NULL AFTER `status`,
  ADD COLUMN `failure_reason` VARCHAR(500) NULL AFTER `provider_ref`;
