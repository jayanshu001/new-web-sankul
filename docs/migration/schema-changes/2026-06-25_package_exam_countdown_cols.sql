-- 2026-06-25 — Add exam-countdown linkage columns to ws_package.
-- Mirrors ws_live_course / ws_book / ws_ebook, which already carry these JSON
-- arrays. Needed so the client exam-countdown package listings
-- (/client/exam-countdown-categories/:id/packages and
--  /client/exam-countdown/:id/packages) can resolve package membership on MySQL
-- instead of Mongo (package.examCountdownCategoryIds / examCountdownIds).
-- Both nullable JSON (int[] of category / countdown ids); NULL == no linkage.

ALTER TABLE ws_package
  ADD COLUMN exam_countdown_category_ids JSON NULL AFTER package_category_id,
  ADD COLUMN exam_countdown_ids JSON NULL AFTER exam_countdown_category_ids;
