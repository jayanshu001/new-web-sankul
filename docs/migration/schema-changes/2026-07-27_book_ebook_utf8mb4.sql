-- 2026-07-27 — ws_book / ws_ebook → utf8mb4 (Gujarati/Hindi PDF file names)
--
-- Problem: uploading a PDF whose file name is Gujarati or Hindi failed the whole
-- save. The file-name/url columns are latin1_swedish_ci, and with
-- STRICT_TRANS_TABLES on, MySQL throws instead of truncating:
--   INSERT INTO ws_ebook (demo_file_name) VALUES ('ગુજરાતી-પુસ્તક.pdf')
--     → ERROR 1366: Incorrect string value: '\xE0\xAA\x97\xE0\xAB\x81...'
--
-- Both tables are still latin1_swedish_ci at the TABLE level, so a full-table
-- conversion is cleaner than column-by-column and also fixes the default for any
-- column added later. Verified safe on the local clone:
--   • Neither table has any index other than PRIMARY(id) → no index-length risk
--     from the 1→4 bytes-per-char widening.
--   • ROW_FORMAT=Dynamic, InnoDB.
--   • Small tables (staging: ws_book 14 rows, ws_ebook 506) → fast rewrite.
--
-- Collation is **utf8mb4_0900_ai_ci**, NOT utf8mb4_unicode_ci as originally
-- requested: 0900_ai_ci is this DB's standard (see
-- 2026-07-16_search_columns_utf8mb4.sql and src/utils/searchFilter.ts). Mixing
-- collations across columns/tables makes MySQL throw error 3988 on comparisons
-- between them, which is exactly the class of bug that DDL was fixing.
--
-- Columns this converts (everything character-typed on both tables):
--   ws_book  : demo_file_name, demo_url, dynamic_link, language, thumbnail
--              (name/author/image/description are already utf8mb4)
--   ws_ebook : book_file_name, demo_file_name, book_url, demo_url,
--              book_upload_status, demo_upload_status, language (enum),
--              thumbnail (was utf8mb4_unicode_520_ci),
--              terms_and_conditions (was utf8mb3)
--
-- NOTE: ws_book has NO book_file_name / book_url columns — Book only has a demo
-- PDF slot (demo_url / demo_file_name). The original report listed
-- ws_book.book_file_name; it does not exist.
--
-- `language` on ws_ebook is enum('English','Gujarati','Hindi') — the labels are
-- ASCII, so the conversion preserves every stored value.
--
-- No column added or dropped; no data or API-shape change.

ALTER TABLE `ws_book`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `ws_ebook`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
