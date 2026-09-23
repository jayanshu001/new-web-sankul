-- 2026-09-08 — rename ws_refferal_transaction.provider_ref -> reference_number
--
-- WHY: the column was named for the retired RazorpayX integration, which wrote
-- its payout id there. Payouts are manual now and the column holds the bank
-- UTR / reference an admin types when marking a transfer paid. `reference_number`
-- is true for BOTH: legacy `pout_*` payout ids and new bank UTRs. (`utr` was
-- rejected precisely because it would be a lie for the legacy rows.)
--
-- Pure rename. No data is read, rewritten or lost; the type is unchanged.
--
-- DEPLOY ORDER: THIS DDL AND THE BACKEND BUILD MUST GO TOGETHER.
-- Unlike the additive ENUM change, a rename is NOT backward compatible in
-- either direction:
--   * DDL first, old code still running -> old code selects provider_ref -> 1054
--   * Build first, DDL not applied      -> new code selects reference_number -> 1054
-- Deploy them in one window. The admin panel ships with (or after) the backend;
-- it sends `referenceNumber` instead of `providerRef`.

ALTER TABLE ws_refferal_transaction
  RENAME COLUMN provider_ref TO reference_number;

-- Pre-flight — how many rows carry a value, and how many are legacy payout ids:
--   SELECT COUNT(*) AS with_ref,
--          SUM(provider_ref LIKE 'pout%') AS legacy_payout_ids
--     FROM ws_refferal_transaction WHERE provider_ref IS NOT NULL;
--
-- Post-check:
--   SHOW COLUMNS FROM ws_refferal_transaction LIKE 'reference_number';
