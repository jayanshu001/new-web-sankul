-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-07-31 — ws_material_category_live_course (live-course ↔ material-category
-- pivot). Closes the Wave-6 drift that made study materials read as unpurchased
-- for live-course buyers.
--
-- Course and Package attach material categories through real pivot tables
-- (ws_material_category_course / ws_material_category_package), which is what
-- client-material.getPurchasedMaterialIds joins to resolve `isPurchased`.
-- LiveCourse instead kept its attachments in the JSON column
-- ws_live_course.material_categories, so the entitlement join could never see
-- them → a verified, active live-course subscription never unlocked a material
-- (isPurchased:false + mediaToken:null → the PDF would not open either).
--
-- This table gives LiveCourse the same shape as the other two containers.
-- Column names mirror ws_material_category_course exactly (mcategory_id,
-- `order`) so the three pivots stay interchangeable.
--
-- The JSON column stays the admin write/read shape (unchanged API contract) and
-- is kept in sync by admin-live-course; the pivot is what entitlement reads —
-- the same "column still written, relation table read" split used by
-- ws_video_category_relation.
--
-- Additive + idempotent. No FKs, consistent with the rest of the ws_live_course_*
-- block (see 2026-06-18_create_ws_live_course_tables.sql).
--
-- After applying:
--   yarn prisma:generate && restart the app   (stale in-memory client otherwise)
--   npx tsx scripts/backfill-material-category-live-course.ts --dry
--   npx tsx scripts/backfill-material-category-live-course.ts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ws_material_category_live_course (
  id              INT NOT NULL AUTO_INCREMENT,
  live_course_id  INT NOT NULL,
  mcategory_id    INT NOT NULL,
  `order`         INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NULL,
  updated_at      TIMESTAMP NULL,
  PRIMARY KEY (id),
  -- One row per (course, category): makes the backfill + the admin re-save
  -- idempotent and lets entitlement dedupe for free.
  UNIQUE KEY uniq_mclc_course_cat (live_course_id, mcategory_id),
  -- Entitlement reads category → courses (the hot direction).
  KEY idx_mclc_cat (mcategory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
