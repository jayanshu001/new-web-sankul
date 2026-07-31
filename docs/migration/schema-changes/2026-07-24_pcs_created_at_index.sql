-- 2026-07-24  ws_package_course_subscription: covering index for admin dashboard/analytics
--
-- WHY: k6 load testing (Phase 7 fix loop) identified full table scans (~598,743 rows)
-- as the dominant DB cost. The admin dashboard + subscription-aggregate queries filter
-- on `created_at` range (+ `course_id IS [NOT] NULL`) and aggregate `amount`, but the
-- only indexes were PRIMARY(id) and idx_pcs_promoter(promoter_id, created_at) — neither
-- usable for a bare created_at range. Every dashboard hit → ALL-rows scan + temporary.
--
-- Covering index (created_at, course_id, amount) turns the date-bounded aggregates from
-- type=ALL rows=598743 into type=range rows=1 "Using index" (index-only).
--
-- MEASURED (identical cold k6 scenario, PM2 2-worker, before → after):
--   group:analytics p95  4.84s → 343ms   (~14x)
--   global p95           2.33s → 355ms   (~6.6x)
--   group:dashboard p95  2.02s → 406ms   (~5x)
--
-- NOTE: the admin subscription *list* query (wide/absent date range) still scans the
-- table — an index can't help a non-selective range; that needs app-level date-scoping
-- / pagination (follow-up, not this DDL).
--
-- Apply:  npx prisma db execute --file docs/migration/schema-changes/2026-07-24_pcs_created_at_index.sql --schema prisma/schema.prisma
-- Mirrored in prisma/schema.prisma as @@index([createdAt, courseId, amount], name: "idx_pcs_created_course_amount").
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `CREATE INDEX IF NOT EXISTS`, so the add is
-- guarded on information_schema.STATISTICS and becomes a no-op if already applied
-- (fixes "Duplicate key name" on a re-run).

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_package_course_subscription' AND INDEX_NAME = 'idx_pcs_created_course_amount');
SET @ddl := IF(@exists = 0,
  'CREATE INDEX `idx_pcs_created_course_amount` ON `ws_package_course_subscription` (`created_at`, `course_id`, `amount`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
