-- 2026-07-16 — Uniform Unicode + case-insensitive search: convert the REMAINING
-- searched text columns to utf8mb4 / utf8mb4_0900_ai_ci.
--
-- Root cause (same class as 2026-07-09_search_name_columns_utf8mb4.sql, now generalized
-- from `name` to EVERY searchable column): legacy ws_* columns have mixed charsets.
--   - latin1  : cannot store emoji OR Gujarati/Hindi. A Prisma (utf8mb4) LIKE param
--               against a latin1 column throws MySQL error 3988 for any non-Latin term.
--   - utf8mb3 : stores Gujarati/Hindi but NOT 4-byte emoji (🔥).
-- Converting to utf8mb4 lets each column both STORE and MATCH English / Gujarati /
-- Hindi / emoji, and utf8mb4_0900_ai_ci makes `col LIKE '%term%'` case- AND
-- accent-insensitive with no LOWER()/BINARY (indexes still apply).
--
-- Conversions are lossless: latin1 -> utf8mb4 transcodes stored bytes (Latin data);
-- utf8mb3 -> utf8mb4 is a strict superset. Per-column MODIFY (not table-wide CONVERT TO)
-- to avoid rewriting non-searched columns and to sidestep index key-length surprises.
--
-- SCOPE: the set of *searched* columns still on latin1/utf8mb3, audited against
-- websankul_staging_1. Before deploy to another environment, re-run the audit and add
-- any columns that are still non-utf8mb4 there:
--   SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME
--   FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND CHARACTER_SET_NAME NOT IN ('utf8mb4')
--     AND COLUMN_NAME IN ('name','title','description','discription','author','topic',
--       'question','answer','slug','key','order_items','email','email_address','phone',
--       'mobile','promocode','link','image','publisher','state_code','referral_code');
--
-- Collation is NOT tracked in schema.prisma — no db:pull / prisma:generate / code change
-- results from this DDL.
--
-- IDEMPOTENT / environment-safe: each MODIFY is guarded on information_schema.COLUMNS
-- (table + column must exist), so re-running is a harmless no-op AND environments that
-- lack a table/column (e.g. no ws_user_inquiry) are skipped instead of erroring P1014.

-- Helper convention per column:
--   check the (table, column) exists → MODIFY only then, else DO 0.

-- ── ws_material ──────────────────────────────────────────────────────────────
SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_material' AND COLUMN_NAME='description');
SET @q := IF(@e>0,'ALTER TABLE `ws_material` MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- ── ws_popup_notification ────────────────────────────────────────────────────
SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_popup_notification' AND COLUMN_NAME='title');
SET @q := IF(@e>0,'ALTER TABLE `ws_popup_notification` MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_popup_notification' AND COLUMN_NAME='description');
SET @q := IF(@e>0,'ALTER TABLE `ws_popup_notification` MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_popup_notification' AND COLUMN_NAME='promocode');
SET @q := IF(@e>0,'ALTER TABLE `ws_popup_notification` MODIFY COLUMN `promocode` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_popup_notification' AND COLUMN_NAME='image');
SET @q := IF(@e>0,'ALTER TABLE `ws_popup_notification` MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- ── ws_promocode ─────────────────────────────────────────────────────────────
SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_promocode' AND COLUMN_NAME='promocode');
SET @q := IF(@e>0,'ALTER TABLE `ws_promocode` MODIFY COLUMN `promocode` VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_promocode' AND COLUMN_NAME='description');
SET @q := IF(@e>0,'ALTER TABLE `ws_promocode` MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- ── ws_promoter ──────────────────────────────────────────────────────────────
SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_promoter' AND COLUMN_NAME='full_name');
SET @q := IF(@e>0,'ALTER TABLE `ws_promoter` MODIFY COLUMN `full_name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_promoter' AND COLUMN_NAME='email');
SET @q := IF(@e>0,'ALTER TABLE `ws_promoter` MODIFY COLUMN `email` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_promoter' AND COLUMN_NAME='phone');
SET @q := IF(@e>0,'ALTER TABLE `ws_promoter` MODIFY COLUMN `phone` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_promoter' AND COLUMN_NAME='image');
SET @q := IF(@e>0,'ALTER TABLE `ws_promoter` MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- ── ws_user_inquiry (absent in some environments — guard skips it) ────────────
SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_user_inquiry' AND COLUMN_NAME='name');
SET @q := IF(@e>0,'ALTER TABLE `ws_user_inquiry` MODIFY COLUMN `name` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_user_inquiry' AND COLUMN_NAME='email');
SET @q := IF(@e>0,'ALTER TABLE `ws_user_inquiry` MODIFY COLUMN `email` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- ── ws_video ─────────────────────────────────────────────────────────────────
SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_video' AND COLUMN_NAME='title');
SET @q := IF(@e>0,'ALTER TABLE `ws_video` MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_video' AND COLUMN_NAME='topic');
SET @q := IF(@e>0,'ALTER TABLE `ws_video` MODIFY COLUMN `topic` VARCHAR(25) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_video' AND COLUMN_NAME='slug');
SET @q := IF(@e>0,'ALTER TABLE `ws_video` MODIFY COLUMN `slug` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

-- ── ws_video_category ────────────────────────────────────────────────────────
SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_video_category' AND COLUMN_NAME='title');
SET @q := IF(@e>0,'ALTER TABLE `ws_video_category` MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_video_category' AND COLUMN_NAME='slug');
SET @q := IF(@e>0,'ALTER TABLE `ws_video_category` MODIFY COLUMN `slug` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;

SET @e := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ws_video_category' AND COLUMN_NAME='image');
SET @q := IF(@e>0,'ALTER TABLE `ws_video_category` MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL','DO 0');
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;
