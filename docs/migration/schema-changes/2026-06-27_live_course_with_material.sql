-- ─────────────────────────────────────────────────────────────────────────────
-- "With Material / Without Material" for Live Courses (parity with Course/Package)
--
-- LiveCourse already carries the label strings (with_material/without_material).
-- This adds the PER-PLAN material flag + price (mirrors ws_package_course_ebook_price)
-- and the LIGHTWEIGHT subscription fulfillment fields (mirrors the Mongo
-- LiveCourseSubscription: a withMaterial flag + the chosen delivery address).
-- Live courses have no physical material-kit link (no pc_material_id), so we do
-- NOT add course_amount/material_amount splits — see C-decision in the migration log.
-- ─────────────────────────────────────────────────────────────────────────────

-- Per-plan material variant on the pricing plan.
ALTER TABLE `ws_live_course_plan`
  ADD COLUMN `with_material`  TINYINT(1) NOT NULL DEFAULT 0 AFTER `original_price`,
  ADD COLUMN `material_price` INT NULL                      AFTER `with_material`;

-- Lightweight fulfillment on the (single-table) subscription.
ALTER TABLE `ws_live_course_subscription`
  ADD COLUMN `with_material`        TINYINT(1) NOT NULL DEFAULT 0 AFTER `paid_at`,
  ADD COLUMN `customer_shipping_id` INT NULL                      AFTER `with_material`;
