-- 2026-06-19 — C5: let ws_promoted_package_course_ebook represent live-course +
-- test-series plan links (not just package_course_ebook_price). The Mongo
-- PromotedPackageCourseEbook carries `planKind` (price | livePlan); SQL only had
-- pcb_price_id. Add plan_kind so `pcb_price_id` can hold a ws_live_course_plan /
-- ws_test_series_price id when plan_kind != 'price'. Additive, prod-safe.

ALTER TABLE `ws_promoted_package_course_ebook`
  ADD COLUMN `plan_kind` VARCHAR(20) NOT NULL DEFAULT 'price';
