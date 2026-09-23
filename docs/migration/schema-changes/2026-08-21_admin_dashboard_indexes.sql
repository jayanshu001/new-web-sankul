-- 2026-08-21 — Indexes for GET /admin/dashboard.
--
-- WHY: the dashboard fires ~40 queries per request. Almost all of them are already
-- index-served — ws_package_course_subscription has idx_pcs_created_course_amount
-- (created_at, course_id, amount), which makes even a 149k-row year window a ~50ms
-- covering scan on staging. THREE query shapes are not, and they are the ones that
-- scale with the biggest tables:
--
--   1) "New Customers" list:
--        SELECT ... FROM ws_customer WHERE is_account_deleted = 0
--         ORDER BY created_at DESC LIMIT 7
--      EXPLAIN today: type=ALL, key=NULL, Extra="Using where; Using filesort".
--      On a 600k-row ws_customer that is a full scan plus a sort of every surviving
--      row — to return SEVEN. This does not depend on the date filter at all, which
--      is why the page is slow even before a year range is chosen.
--
--   2) The two customer counters (total + active), both type=ALL.
--
--   3) "Recent Ebook Subscriptions": ORDER BY created_at DESC LIMIT 7 with no
--      created_at index → filesort. Harmless while ws_ebook_subscription is small;
--      it degrades exactly like (1) as ebooks sell.
--
-- Together these are the difference between a dashboard that scales with the date
-- range and one that scales with total customer count.
--
-- VERIFY BEFORE RUNNING — these must show type=ALL / filesort today:
--
--   EXPLAIN SELECT id FROM ws_customer WHERE is_account_deleted = 0
--    ORDER BY created_at DESC LIMIT 7;
--   EXPLAIN SELECT COUNT(*) FROM ws_customer WHERE is_account_deleted = 0;
--
-- ⚠ ws_customer is ~600k rows on production. These are ONLINE (InnoDB
-- ALGORITHM=INPLACE, no table rebuild) but still write a new index — run them in a
-- low-traffic window and one at a time.

-- (1) + (2a): serves the ORDER BY without a filesort AND the total counter.
ALTER TABLE ws_customer
  ADD INDEX idx_customer_deleted_created (is_account_deleted, created_at);

-- (2b): the "active customers" counter. A separate index because the leading
-- equality on both columns is what makes it a pure index count; it cannot share
-- the one above (created_at sits between the two predicates there).
ALTER TABLE ws_customer
  ADD INDEX idx_customer_deleted_status (is_account_deleted, status);

-- (3): recent-ebook-subscription ordering.
ALTER TABLE ws_ebook_subscription
  ADD INDEX idx_ebook_sub_created (created_at);

-- VERIFY AFTER RUNNING — (1) must become type=ref + "Backward index scan", with NO
-- filesort; (2) must report "Using index":
--
--   EXPLAIN SELECT id FROM ws_customer WHERE is_account_deleted = 0
--    ORDER BY created_at DESC LIMIT 7;
--   EXPLAIN SELECT COUNT(*) FROM ws_customer WHERE is_account_deleted = 0;
--   EXPLAIN SELECT COUNT(*) FROM ws_customer WHERE is_account_deleted = 0 AND status = 1;
