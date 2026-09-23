-- 2026-09-08 — add a `rejected` terminal state to referral withdrawals.
--
-- WHY: rejecting a withdrawal used to DELETE the ledger row, so neither the
-- customer nor finance could answer "what happened to my request?". The reject
-- path now terminates the row instead. `failed` was not reusable: it already
-- means "the payout was attempted and bounced" (retired RazorpayX path), and
-- merging the two makes "we never sent this" indistinguishable from "the bank
-- returned it".
--
-- Purely additive — widening an ENUM rewrites no existing row.
--
-- DEPLOY ORDER: THIS DDL FIRST, THEN THE BACKEND BUILD.
-- A widened ENUM is invisible to the old code. The reverse order is NOT safe:
-- the new build would write 'rejected' into a column that cannot hold it.

ALTER TABLE ws_refferal_transaction
  MODIFY COLUMN status ENUM('pending','successful','failed','rejected') NOT NULL;

-- Pre-flight (expect 0 rows; nothing should already claim the new value):
--   SELECT status, COUNT(*) FROM ws_refferal_transaction GROUP BY status;
