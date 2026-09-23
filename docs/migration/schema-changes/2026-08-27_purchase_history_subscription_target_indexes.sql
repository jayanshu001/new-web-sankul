-- 2026-08-27 — purchase-history subscriptions: the two indexes the LEGACY window
--              fallback needs, after the unbounded target read was split up.
--
-- WHY. `GET /api/v1/client/purchase-history/subscriptions` had one query left whose
-- cost scaled with the customer's ENTIRE purchase history instead of with the page:
--
--   pcSubsForTargets
--     WHERE customer_id=? AND status=1
--       AND (course_id IN (…) OR package_id IN (…))
--
-- Neither side of that OR can be seeked. MySQL resolved (customer_id, status) from
-- idx_pcs_customer_status_endat and then read every matching row to test the OR.
-- EXPLAIN ANALYZE on staging (customer 472360, 19,655 subscriptions):
--
--   -> Filter: (course_id in (…) or package_id in (…))  (actual time=6.36..34.5 rows=15380)
--       -> Index lookup using idx_pcs_customer_status_endat (customer_id=…, status=1)
--          (actual time=5.93..32.7 rows=16773 loops=1)
--
--   16,773 rows read to decorate 20 cards — 34.5 ms of a 102 ms request, and the
--   single largest query in it. It was flagged as "known remaining, NOT changed" in
--   the 2026-08-26 (b) entry of docs/MIGRATION_QUERY_CHANGES.md; this is that pass.
--
-- The read is now three bounded lookups instead of one unbounded one:
--   1. order_id IN (page order ids)  — rides the existing idx_pcs_customer_status_order
--      (index range scan, 0.016 ms, 0 rows read on the same account). This answers
--      every SQL-native purchase, because one order = one subscription row since
--      2026-08-25.
--   2 + 3. course_id IN (…) / package_id IN (…) as SEPARATE queries — the legacy
--      fallback for pre-2026-08-25 folded validity extensions, which own no
--      subscription row. Issued ONLY for the orders step 1 came back empty for, so a
--      page of SQL-native purchases runs neither. Separate queries (not one OR) is
--      what lets each seek its own index — the two below.
--
-- Without these two indexes the fallback would land back on the (customer_id, status)
-- prefix and re-read the customer's whole history, so they are what keeps step 2/3
-- bounded on the pages that do need it.
--
-- SAFETY. Purely additive: two CREATE INDEX statements, no column or data changes,
-- each guarded so a re-run is a no-op. Safe to apply before the application code —
-- the code names no index, only the optimizer does.
--
-- COST. `ws_package_course_subscription` is ~561k rows on staging. Each new key is
-- three small integer/tinyint columns, so the footprint and the INSERT/UPDATE write
-- amplification are both modest. MySQL 8 builds these online (no table lock), but the
-- ALTER still consumes IO for its duration — build during a quiet window.
--
-- NOT a replacement for any existing index. idx_pcs_customer_status_endat still serves
-- the active-entitlement reads that range on end_at (my-subscriptions, profile
-- dashboard); idx_pcs_customer_status_order still serves the order-less list/count and
-- step 1 above. Leave both in place.


-- ── 1. ws_package_course_subscription (customer_id, status, course_id) ───────────
--
--   WHERE customer_id=? AND status=? AND course_id IN (…)
--
-- Also the natural index for any "does this customer hold course X" check.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_package_course_subscription'
    AND INDEX_NAME='idx_pcs_customer_status_course');
SET @ddl := IF(@has = 0,
  'ALTER TABLE ws_package_course_subscription
     ADD KEY `idx_pcs_customer_status_course` (`customer_id`,`status`,`course_id`)',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ── 2. ws_package_course_subscription (customer_id, status, package_id) ──────────
--
--   WHERE customer_id=? AND status=? AND package_id IN (…)
--
-- The existing idx_pcs_package_created (package_id, created_at) is the WRONG way round
-- for this read: it seeks the package first, so a popular package means walking every
-- subscriber to find the one customer. It stays — the package-detail Subscription tab
-- filters package_id and sorts created_at, which is exactly what it is for.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_package_course_subscription'
    AND INDEX_NAME='idx_pcs_customer_status_package');
SET @ddl := IF(@has = 0,
  'ALTER TABLE ws_package_course_subscription
     ADD KEY `idx_pcs_customer_status_package` (`customer_id`,`status`,`package_id`)',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
