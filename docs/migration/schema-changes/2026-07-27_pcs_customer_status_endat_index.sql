-- 2026-07-27  ws_package_course_subscription: customer-scoped active-sub index
--
-- WHY: k6 staging (STG-002/STG-013) showed my-subscriptions, dashboard ownership
-- decoration, and course-list purchase-state all filter:
--   WHERE customer_id = ? AND status = 1 AND end_at > NOW() [ORDER BY end_at DESC]
-- With ~497k rows and only PRIMARY + date-range indexes, EXPLAIN → type=ALL.
--
-- Covering index (customer_id, status, end_at) turns per-customer lookups into a
-- narrow range scan instead of a full table scan under load.
--
-- Apply: yarn db:migrate

CREATE INDEX idx_pcs_customer_status_endat
  ON ws_package_course_subscription (customer_id, status, end_at);
