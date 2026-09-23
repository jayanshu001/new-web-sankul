-- 2026-06-19 — C6: add embedded examCountdown join columns to the catalog tables
-- so book/course/ebook detail responses can populate examCountdownIds[] +
-- examCountdownCategoryIds[] on SQL (ws_live_course already has these exact
-- columns — this mirrors it). Additive, nullable JSON, prod-safe. Idempotent
-- guards via INFORMATION_SCHEMA (MySQL has no ADD COLUMN IF NOT EXISTS pre-8.0.x
-- in all builds — these procedures are safe to re-run).

-- ws_book
ALTER TABLE `ws_book`
  ADD COLUMN `exam_countdown_ids`          JSON NULL,
  ADD COLUMN `exam_countdown_category_ids` JSON NULL;

-- ws_course
ALTER TABLE `ws_course`
  ADD COLUMN `exam_countdown_ids`          JSON NULL,
  ADD COLUMN `exam_countdown_category_ids` JSON NULL;

-- ws_ebook
ALTER TABLE `ws_ebook`
  ADD COLUMN `exam_countdown_ids`          JSON NULL,
  ADD COLUMN `exam_countdown_category_ids` JSON NULL;
