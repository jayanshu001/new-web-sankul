-- 2026-07-27 — Indexes for the quiz-attempt submit path
--
-- Problem: POST /client/quizzes/:id/attempts/:attemptId/submit ran THREE full
-- table scans per request and got slower as the tables grew, until it started
-- crossing the gateway timeout (observed as intermittent 500s on exam 11779).
--
-- Scans removed, in order of cost:
--   1. ws_exam_result_detail had ONLY a PRIMARY key. Every lookup by attempt
--      (`detailsForResult`, and `upsertAttemptDetail` on EVERY saved answer
--      during the quiz) scanned the largest table in the exam subsystem.
--   2. ws_exam_question had no index on exam_id — `questionIdsForExam` scanned
--      the entire question bank.
--   3. The rank query filters ws_exam_result on qresult_qtest_id alone. The
--      existing idx_exam_result_cust_exam_status leads with qresult_customer_id,
--      so MySQL could not use it → full scan.
--   4. ws_exam_result_detail_analytics had no index on userId, so the per-submit
--      analytics upsert scanned a one-row-per-customer table.
--
-- ⚠ ws_exam_result_detail is the big one. Check its row count before running:
--      SELECT TABLE_ROWS FROM information_schema.TABLES
--       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_exam_result_detail';
--   MySQL 8 builds secondary indexes ONLINE (writes keep working), but on a
--   multi-million-row table it is I/O heavy — run it off-peak, or use
--   pt-online-schema-change if the box is already saturated.
--
-- These are pure additions: no column, data, or API-shape change.
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `CREATE INDEX IF NOT EXISTS`, so each add
-- is guarded on information_schema.STATISTICS and becomes a no-op if already applied
-- (fixes "Duplicate key name" on a re-run).

-- 1. Attempt-scoped detail lookups + the (attempt, question) upsert probe.
--    The 2-column index also serves the 1-column lookup (leftmost prefix), so
--    only one index is needed.
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_exam_result_detail' AND INDEX_NAME = 'idx_exam_result_detail_attempt_question');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_exam_result_detail` ADD INDEX `idx_exam_result_detail_attempt_question` (`qresult_detail_qresult_id`, `qresult_detail_question_id`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Question bank per exam: `WHERE exam_id=? AND status=1`.
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_exam_question' AND INDEX_NAME = 'idx_exam_question_exam_status');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_exam_question` ADD INDEX `idx_exam_question_exam_status` (`exam_id`, `status`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Rank counters: `WHERE qresult_qtest_id=? AND qresult_status=1`
--    GROUP BY qresult_customer_id. Customer is included as a trailing column so
--    the GROUP BY / COUNT(DISTINCT) can be served index-only.
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_exam_result' AND INDEX_NAME = 'idx_exam_result_exam_status');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_exam_result` ADD INDEX `idx_exam_result_exam_status` (`qresult_qtest_id`, `qresult_status`, `qresult_customer_id`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. Per-customer analytics rollup row.
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_exam_result_detail_analytics' AND INDEX_NAME = 'idx_exam_result_analytics_user');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_exam_result_detail_analytics` ADD INDEX `idx_exam_result_analytics_user` (`userId`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
