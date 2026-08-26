-- 2026-08-26 — purchase-history subscriptions: the three indexes it reads without
--
-- WHY. `GET /api/v1/client/purchase-history/subscriptions` issues 19 queries. Three of
-- them answer a per-customer question by reading rows the index cannot filter, so the
-- cost scales with the customer's history (and with table size) instead of staying flat.
-- Measured with Prisma query logging against staging + a 500k-row synthetic order table:
--
--   countOrderlessSubs   713 ms cold / 32 ms warm  → index-only after this file
--   listPurchaseOrders   134 ms @500k rows         → 0.7 ms after this file
--   countPurchaseOrders   62 ms @500k rows         → 0.5 ms after this file
--
-- SAFETY. Purely additive: three CREATE INDEX statements, no column or data changes,
-- each guarded so a re-run is a no-op. Safe to apply before the application code — the
-- code does not reference these index names, only the optimizer does.
--
-- COST. Each index adds write amplification on INSERT/UPDATE of its table and disk
-- space. `ws_package_course_subscription` is the largest (~561k rows on staging); the
-- new index is 4 small integer/date columns, so the footprint is modest. Build these
-- during a quiet window: MySQL 8 builds indexes online (no table lock) but the ALTER
-- still consumes IO for the duration.


-- ── 1. ws_package_course_subscription (customer_id, status, order_id, id) ────────
--
-- Serves BOTH order-less queries in the subscriptions tab:
--   listOrderlessSubs   WHERE customer_id=? AND status=? AND order_id IS NULL
--                       ORDER BY id DESC LIMIT ?
--   countOrderlessSubs  COUNT(*) same predicate
--
-- The existing idx_pcs_customer_status_endat (customer_id, status, end_at) resolves
-- customer_id + status from the index and then reads EVERY matching row off disk to
-- test order_id — ~16,400 row lookups for a heavy customer, to return one number.
-- Putting order_id in the index makes the COUNT index-only, and trailing `id` lets the
-- LIMIT 20 walk the index backwards instead of filesorting the matched set.
--
-- NOT a replacement for idx_pcs_customer_status_endat — that one serves the
-- active-entitlement reads that range on end_at (my-subscriptions, profile dashboard).
-- Both are needed; leave it in place.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_package_course_subscription'
    AND INDEX_NAME='idx_pcs_customer_status_order');
SET @ddl := IF(@has = 0,
  'ALTER TABLE ws_package_course_subscription
     ADD KEY `idx_pcs_customer_status_order` (`customer_id`,`status`,`order_id`,`id`)',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ── 2. ws_package_course_order (customer_id, status, id) ─────────────────────────
--
-- This table carried NO index on customer_id at all — only PRIMARY and UNIQUE(unique_id).
-- Every purchase-history request scans it twice:
--   listPurchaseOrders   WHERE customer_id=? AND status='complete' ORDER BY id DESC LIMIT ?
--   countPurchaseOrders  COUNT(*) WHERE customer_id=? AND status='complete'
-- Both are full table scans today, so their cost is the table's size, not the
-- customer's. Trailing `id` covers the ORDER BY id DESC so the LIMIT stops early.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_package_course_order'
    AND INDEX_NAME='idx_pco_user_status_id');
SET @ddl := IF(@has = 0,
  'ALTER TABLE ws_package_course_order
     ADD KEY `idx_pco_user_status_id` (`customer_id`,`status`,`id`)',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ── 3. ws_package_course_subscription_tracking (`order`) ─────────────────────────
--
-- NOTE the column is literally named `order` (Prisma maps it as orderId) — a reserved
-- word, hence the backticks.
--
-- pcTrackingByOrderIds does WHERE `order` IN (...) — one lookup per page of orders,
-- plus a second call from the tracking endpoint. The table had only PRIMARY, so each
-- IN-list lookup is a full scan.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_package_course_subscription_tracking'
    AND INDEX_NAME='idx_pcst_order');
SET @ddl := IF(@has = 0,
  'ALTER TABLE ws_package_course_subscription_tracking
     ADD KEY `idx_pcst_order` (`order`)',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
