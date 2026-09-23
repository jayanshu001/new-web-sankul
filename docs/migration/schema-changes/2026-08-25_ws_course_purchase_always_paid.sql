-- 2026-08-25 — ws_course.purchase: normalise to '1' and default to '1'
--
-- BUSINESS RULE: a course can never be free. Every course is a paid product;
-- "free" content on this platform is videos / materials / tests / ebooks / books,
-- never a course. (Confirmed 2026-08-25.)
--
-- WHAT THE COLUMN IS. `purchase` enum('0','1') is the ONLY source of the `isPaid`
-- boolean on every course payload the API emits:
--   catalog-course.transformer.ts:72   → /client/courses list + detail
--   admin-course.service.ts:50         → admin course DTO
--   client-dashboard.service.ts:149    → dashboard trending courses
--   client-search.service.ts:107       → course search results
--   educator-details.transformer.ts:23 → an educator's courses
--   exam-countdown.client.ts:107       → countdown-attached courses
-- The column is KEPT (not dropped) because `isPaid` must stay in all six response
-- shapes regardless — dropping it would only move the answer from the database
-- into six hardcoded `true`s, and would have to be undone by DDL + backfill the
-- first time a free demo course is wanted.
--
-- WHAT THIS FILE CHANGES. Two things, in this order:
--
--   1. BACKFILL every '0' (free) and every NULL to '1' (paid), so the stored data
--      matches the rule. NULL is included because it was already READ as paid
--      (toIsPaid: `v !== "no"`, mirroring the old Mongo default of isPaid:true) —
--      this makes the storage agree with the read.
--
--   2. ADD A COLUMN DEFAULT of '1' and make the column NOT NULL, so any INSERT
--      that omits `purchase` — from this API, a legacy admin, or a manual query —
--      lands on paid instead of NULL. This is the "always 1" guarantee at the
--      storage layer.
--
-- ORDER MATTERS: step 2 cannot run before step 1. In strict mode MySQL refuses to
-- MODIFY a column to NOT NULL while NULL rows exist.
--
-- SIZE / SAFETY: ws_course is a small catalog table (4 rows on staging, low
-- hundreds in production) — unlike the 2026-08-06 ws_customer incident, a single
-- unbatched UPDATE here is not a risk. The ALTER is a table rebuild, but on a
-- table this size it is effectively instant.
--
-- Both steps are idempotent: the UPDATE matches nothing on a second run, and the
-- MODIFY is guarded by an information_schema check so re-running does not rebuild
-- the table again.
--
-- NOT COVERED HERE (deliberate): `is_featured` shares the same enum type and is
-- still nullable. It is a real two-state flag, so it is left alone.
--
-- FOLLOW-UP (optional, once this is applied on every environment): the Prisma
-- field is deliberately left NULLABLE in schema.prisma so the application code is
-- safe to deploy either before or after this DDL. It can be tightened to
-- non-nullable later; doing it now would make a code deploy that lands ahead of
-- this file throw on any NULL row.


-- ── 1. Backfill: no course may be stored as free ────────────────────────────
UPDATE ws_course
   SET purchase = '1'
 WHERE purchase = '0'
    OR purchase IS NULL;


-- ── 2. Default to paid, and forbid NULL ─────────────────────────────────────
SET @already := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA    = DATABASE()
    AND TABLE_NAME      = 'ws_course'
    AND COLUMN_NAME     = 'purchase'
    AND IS_NULLABLE     = 'NO'
    AND COLUMN_DEFAULT  = '1'
);

SET @ddl := IF(
  @already = 0,
  'ALTER TABLE ws_course MODIFY COLUMN purchase ENUM(''0'',''1'') NOT NULL DEFAULT ''1''',
  'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
