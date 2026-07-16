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
-- SCOPE: this is the set of *searched* columns still on latin1/utf8mb3 in the current
-- app DB (audited against websankul_staging_1). Most searched columns — every `name`,
-- and course/book/ebook/package/exam text — are ALREADY utf8mb4 (from the 2026-07-09
-- change and earlier). Before deploy to another environment, re-run the audit and add
-- any columns that are still non-utf8mb4 there:
--   SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME
--   FROM information_schema.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND CHARACTER_SET_NAME NOT IN ('utf8mb4')
--     AND COLUMN_NAME IN ('name','title','description','discription','author','topic',
--       'question','answer','slug','key','order_items','email','email_address','phone',
--       'mobile','promocode','link','image','publisher','state_code','referral_code');
-- Re-running THIS file on an already-converted column is a harmless no-op.
--
-- Collation is NOT tracked in schema.prisma — no db:pull / prisma:generate / code change
-- results from this DDL. Apply on deploy via `yarn db:migrate` (or
-- `npx prisma db execute --file docs/migration/schema-changes/2026-07-16_search_columns_utf8mb4.sql`).

-- ── ws_material ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_material`
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_popup_notification ────────────────────────────────────────────────────
ALTER TABLE `ws_popup_notification`
  MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `promocode` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_promocode ─────────────────────────────────────────────────────────────
ALTER TABLE `ws_promocode`
  MODIFY COLUMN `promocode` VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `description` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_promoter ──────────────────────────────────────────────────────────────
ALTER TABLE `ws_promoter`
  MODIFY COLUMN `full_name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `email` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `phone` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

-- ── ws_user_inquiry ──────────────────────────────────────────────────────────
ALTER TABLE `ws_user_inquiry`
  MODIFY COLUMN `name` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `email` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_video ─────────────────────────────────────────────────────────────────
ALTER TABLE `ws_video`
  MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `topic` VARCHAR(25) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `slug` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

-- ── ws_video_category ────────────────────────────────────────────────────────
ALTER TABLE `ws_video_category`
  MODIFY COLUMN `title` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `slug` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `image` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;
