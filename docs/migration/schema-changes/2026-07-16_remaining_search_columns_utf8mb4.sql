-- 2026-07-16 — Sweep remaining searched text columns to utf8mb4 / utf8mb4_0900_ai_ci.
--
-- Follow-up to:
--   2026-07-09_search_name_columns_utf8mb4.sql
--   2026-07-16_search_columns_utf8mb4.sql
--   2026-07-16_customer_search_columns_utf8mb4.sql
--
-- Audit (websankul_staging): after those three files, ~50 free-text columns used by
-- buildPrismaSearch / buildLikeTokens / contains-match were still latin1 or utf8mb3.
-- Symptoms in logs (MySQL 3988):
--   course/ebook emoji search → utf8mb3_general_ci impossible
--   book author / banner image+key / customer cross-search → latin1_swedish_ci impossible
--
-- SCOPE: searched (or search-adjacent free-text) columns only — not IDs, tokens,
-- passwords, payment JSON, or enums. Per-column MODIFY (lossless latin1→utf8mb4 /
-- utf8mb3→utf8mb4). Collation NOT in schema.prisma. Re-run is a no-op.
-- Apply via yarn db:migrate.
--
-- Audit query for other environments:
--   SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME
--   FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND CHARACTER_SET_NAME NOT IN ('utf8mb4')
--     AND DATA_TYPE NOT IN ('enum','set')
--     AND COLUMN_NAME IN (
--       'name','title','description','discription','author','topic','question','answer',
--       'slug','key','order_items','order_id','email','email_address','phone','mobile',
--       'promocode','link','image','publisher','state_code','referral_code','full_name',
--       'tag_name','text','body','content','query'
--     );


-- ── ws_banner_slider ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_banner_slider`
  MODIFY COLUMN `image` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `key` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_book ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_book`
  MODIFY COLUMN `author` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `image` VARCHAR(250) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_book_order ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_book_order`
  MODIFY COLUMN `order_id` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `order_items` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_book_order_item ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_book_order_item`
  MODIFY COLUMN `order_id` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_book_tracking ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_book_tracking`
  MODIFY COLUMN `order_id` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_course ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_course`
  MODIFY COLUMN `image` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_course_subject_category ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_course_subject_category`
  MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `slug` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_customer ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_customer`
  MODIFY COLUMN `referral_code` VARCHAR(15) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_customer_address ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_customer_address`
  MODIFY COLUMN `name` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `email` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_customer_distict ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_customer_distict`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_customer_education ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_customer_education`
  MODIFY COLUMN `name` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_customer_shipping ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_customer_shipping`
  MODIFY COLUMN `name` VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `email` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_customer_state ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_customer_state`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `state_code` VARCHAR(55) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_customer_target_goal ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_customer_target_goal`
  MODIFY COLUMN `name` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_department ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_department`
  MODIFY COLUMN `name` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `decscription` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_department_contact ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_department_contact`
  MODIFY COLUMN `mobile` VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_ebook ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_ebook`
  MODIFY COLUMN `image` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `author` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `publisher` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `link` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_exam ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_exam`
  MODIFY COLUMN `title` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_exam_category ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_exam_category`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_image_notification ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_image_notification`
  MODIFY COLUMN `image` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_material ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_material`
  MODIFY COLUMN `title` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_material_category ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_material_category`
  MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `slug` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_offline_banner_slider ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_offline_banner_slider`
  MODIFY COLUMN `image` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `key` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_offline_batch ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_offline_batch`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `discription` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_offline_center ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_offline_center`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_offline_city ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_offline_city`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_package ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_package`
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_package_course_material ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_package_course_material`
  MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_tag ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_tag`
  MODIFY COLUMN `tag_name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;
