-- 2026-09-14 — Covering index for GET /admin/customers?search=
--
-- WHY: the search is `full_name LIKE '%x%' OR phone LIKE '%x%' OR email_address
-- LIKE '%x%'` (leading wildcard — no B-tree index can seek it, and that is by
-- design: admins search by last-4 phone digits / name fragments). The list and
-- the pagination COUNT both walk every surviving row through
-- idx_customer_deleted_created (is_account_deleted, created_at) and then fetch
-- the FULL ROW (~720 B, ~32 columns, a TEXT and a JSON) just to evaluate three
-- LIKEs. On a 600k-row ws_customer that is a ~400 MB clustered-index read per
-- search — for COUNT always, for the list whenever the term is rare (the
-- ORDER BY created_at DESC LIMIT 10 walk only stops early when matches are
-- common). It does not fit the buffer pool alongside normal traffic, so it goes
-- to disk, and two admins searching at once queue on the Prisma pool → timeout.
--
-- FIX: make the scan a covering one. With `status` and the three searched columns
-- appended to the (is_account_deleted, created_at) index, MySQL evaluates the
-- status filter and the LIKEs from the secondary index alone ("Using index") —
-- ~40 MB instead of ~400 MB, sequential, and small enough to stay resident.
-- `status` (1 byte) is there so the admin's active/inactive filter combined with a
-- search stays covering too; without it that COUNT falls back to a full table scan
-- (measured 514 ms vs 220 ms). Measured on a 600k-row, 720 B/row copy of the
-- table (local MySQL 8.0, 128 MB buffer pool):
--
--                       before (row fetch)   after (covering)
--   list, rare term         4100 ms              240 ms
--   count, any term      300–4100 ms          190–220 ms
--   list, common term          1 ms                1 ms
--
-- ⚠ THE DROP IS NOT OPTIONAL. idx_customer_deleted_created is a strict prefix of
-- the new index, and with both present the optimizer keeps picking the narrower
-- one (verified after ANALYZE TABLE) — the covering index is never used. The new
-- index serves every query the old one did (same leading columns, same order),
-- including the 2026-08-21 dashboard queries it was built for.
--
-- Key length: 255+100+255 chars × 4 B (utf8mb4) + 5 + 1 + 1 + length bytes = ~2453 B,
-- under InnoDB's 3072 B limit for ROW_FORMAT=DYNAMIC (ws_customer is DYNAMIC).
--
-- VERIFY BEFORE RUNNING — must show key=idx_customer_deleted_created with NO
-- "Using index" in Extra:
--
--   EXPLAIN SELECT COUNT(*) FROM ws_customer
--    WHERE is_account_deleted = 0
--      AND (full_name LIKE '%zzq%' OR phone LIKE '%zzq%' OR email_address LIKE '%zzq%');
--
-- ⚠ ws_customer is ~600k rows on production. Both statements are ONLINE
-- (ALGORITHM=INPLACE, LOCK=NONE) but the ADD writes a ~40 MB index — run in a
-- low-traffic window. Order matters: ADD first, so the dashboard ORDER BY never
-- loses its index in between.

ALTER TABLE ws_customer
  ADD INDEX idx_customer_search (is_account_deleted, created_at, status, full_name, phone, email_address),
  ALGORITHM=INPLACE, LOCK=NONE;

-- Redundant once the above exists (strict prefix). Required for the optimizer to
-- pick idx_customer_search — see above.
ALTER TABLE ws_customer
  DROP INDEX idx_customer_deleted_created,
  ALGORITHM=INPLACE, LOCK=NONE;

-- VERIFY AFTER RUNNING — key=idx_customer_search, Extra contains "Using index";
-- the list must additionally show "Backward index scan" and no filesort:
--
--   EXPLAIN SELECT COUNT(*) FROM ws_customer
--    WHERE is_account_deleted = 0
--      AND (full_name LIKE '%zzq%' OR phone LIKE '%zzq%' OR email_address LIKE '%zzq%');
--   EXPLAIN SELECT id FROM ws_customer
--    WHERE is_account_deleted = 0
--      AND (full_name LIKE '%zzq%' OR phone LIKE '%zzq%' OR email_address LIKE '%zzq%')
--    ORDER BY created_at DESC LIMIT 10;
--   -- status filter + search must also be "Using index":
--   EXPLAIN SELECT COUNT(*) FROM ws_customer
--    WHERE is_account_deleted = 0 AND status = 1
--      AND (full_name LIKE '%zzq%' OR phone LIKE '%zzq%' OR email_address LIKE '%zzq%');
--   -- dashboard queries from 2026-08-21 must still be index-served:
--   EXPLAIN SELECT id FROM ws_customer WHERE is_account_deleted = 0
--    ORDER BY created_at DESC LIMIT 7;
--   EXPLAIN SELECT COUNT(*) FROM ws_customer WHERE is_account_deleted = 0;
--
-- ROLLBACK:
--   ALTER TABLE ws_customer
--     ADD INDEX idx_customer_deleted_created (is_account_deleted, created_at),
--     ALGORITHM=INPLACE, LOCK=NONE;
--   ALTER TABLE ws_customer DROP INDEX idx_customer_search, ALGORITHM=INPLACE, LOCK=NONE;
