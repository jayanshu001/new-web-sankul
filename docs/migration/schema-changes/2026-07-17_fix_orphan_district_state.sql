-- 2026-07-17 — Repair orphaned district → state reference
--
-- Problem: ws_customer_distict row id=1 (the legacy blank "unset" placeholder:
-- name='', active=0) carries state=0, but no ws_customer_state row with id=0 exists.
-- prisma/schema.prisma models CustomerDistict.state as a REQUIRED relation, so any
-- read that includes the state join and does not filter it out fails with:
--   "Inconsistent query result: Field state is required to return data, got `null`"
--
-- This broke GET /api/v1/admin/address/cities (listAdminDistricts), which by design
-- includes inactive rows. The client-facing list filters active=true and so never
-- surfaced it.
--
-- Fix: point the placeholder district at the matching placeholder STATE (id=1, also
-- name='', active=0) — same legacy "unset" convention. The row stays blank + inactive,
-- and the 24 ws_customer rows referencing district=1 are untouched.
--
-- Idempotent: guarded on state = 0, so re-running is a no-op.

UPDATE ws_customer_distict
   SET state = 1
 WHERE id = 1
   AND state = 0;
