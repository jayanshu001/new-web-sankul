-- 2026-08-05 — the package-detail Subscription tab (GET /admin/packages/:id/subscribers)
-- was reordered from `id DESC` to `created_at DESC, id DESC`. ws_package_course_subscription
-- had NO index on package_id at all: the old query got away with it by walking the PK
-- backwards and stopping early, but ordering by created_at turned it into a full scan +
-- filesort over ~600k rows (EXPLAIN: type=ALL, Using filesort; 126ms/page, growing with
-- the table). This composite covers both the filter and the sort — EXPLAIN becomes
-- "Backward index scan; Using index", 1ms on page 1 and 3ms at offset 4990.
--
-- Additive, prod-safe. ~1.3s to build on 600k rows locally; use pt-online-schema-change
-- or ALGORITHM=INPLACE, LOCK=NONE if the prod table is much larger.

ALTER TABLE `ws_package_course_subscription`
  ADD KEY `idx_pcs_package_created` (`package_id`, `created_at`);
