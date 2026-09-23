-- 2026-07-09 — Multilingual global search (English / Gujarati / Hindi)
--
-- GET /api/v1/client/search threw MySQL error 3988
--   "Conversion from collation utf8mb4_general_ci into latin1_swedish_ci
--    impossible for parameter"
-- whenever the search term contained non-Latin (Gujarati/Hindi) characters.
-- Root cause: Prisma sends the search string as utf8mb4, but `ws_course.name`
-- was latin1_swedish_ci — latin1 cannot represent (or store) Gujarati/Hindi,
-- so the LIKE comparison failed. ASCII (English) converts to latin1 fine, which
-- is why only non-Latin queries crashed, and only on courses.
--
-- Fix: normalize every searched `name` column to utf8mb4 (utf8mb4_0900_ai_ci,
-- matching ws_live_course.name which already worked). This lets the columns
-- both STORE and MATCH all three languages.
--   - latin1  -> utf8mb4 : MySQL transcodes the stored bytes (course names are
--                          Latin/ASCII, so this is lossless).
--   - utf8mb3 -> utf8mb4 : utf8mb4 is a strict superset of utf8mb3 (lossless).
-- Collation is NOT tracked in schema.prisma, so the Prisma client / introspection
-- are unaffected — no prisma:generate needed. (ws_live_course.name is already
-- utf8mb4_0900_ai_ci and is intentionally left untouched.)

ALTER TABLE `ws_course`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;

ALTER TABLE `ws_package`
  MODIFY COLUMN `name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

ALTER TABLE `ws_book`
  MODIFY COLUMN `name` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;

ALTER TABLE `ws_ebook`
  MODIFY COLUMN `name` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;
