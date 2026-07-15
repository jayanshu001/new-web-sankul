-- 2026-07-15 — Make ws_exam start_date / end_date nullable (clearable window).
--
-- PUT /admin/exams/:id must be able to CLEAR the availability window (endAt/startAt),
-- the same way the solution PDF (solution_pdf, already NULLable) can be cleared. The
-- Prisma model already maps these as DateTime? (nullable), but the real MySQL columns
-- were DATETIME NOT NULL, so nulling them threw a constraint violation. Widen to NULL.
--
-- Only non-daily exams may have an empty window; daily tests still require both ends
-- (enforced in the admin update controller). createExam still defaults missing values
-- to "now", so new rows are unaffected. No backfill needed.
--
-- Idempotent-safe apply on staging:
--   npx prisma db execute --file docs/migration/schema-changes/2026-07-15_exam_start_end_nullable.sql

ALTER TABLE ws_exam
  MODIFY COLUMN start_date DATETIME NULL,
  MODIFY COLUMN end_date   DATETIME NULL;
