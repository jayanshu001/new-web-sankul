-- 2026-07-29 — ws_material / ws_exam → utf8mb4 (Gujarati/Hindi PDF file names)
--
-- Problem: POST /api/v1/admin/materials with a Gujarati PDF file name failed the
-- whole create:
--   Invalid `prisma.material.create()` invocation
--   MysqlError 3988: "Conversion from collation utf8mb4_general_ci into
--   latin1_swedish_ci impossible for parameter"
-- The Prisma driver sends parameters as utf8mb4; the target columns are
-- latin1_swedish_ci, so MySQL refuses the bind rather than truncating.
--
-- This is the exact same defect fixed for books/ebooks in
-- 2026-07-27_book_ebook_utf8mb4.sql — the tail of legacy latin1 tables that hold
-- uploaded file names. A grep of information_schema for latin1 file/name/title/
-- link columns leaves only ws_course.shareable_link, ws_customer.profile_picture
-- and ws_tag.tag_name (all system-generated / ASCII by construction).
--
-- Both tables are still latin1_swedish_ci at the TABLE level, so a full-table
-- conversion is cleaner than column-by-column and fixes the default for any
-- column added later. Verified safe on the local staging clone:
--   • Both tables have PRIMARY(id) and no other index → no index-length risk from
--     the 1→4 bytes-per-char widening.
--   • ROW_FORMAT=Dynamic, InnoDB.
--   • Small tables (staging: ws_material 231 rows, ws_exam 6) → fast rewrite.
--
-- Collation is **utf8mb4_0900_ai_ci** — this DB's standard (see
-- 2026-07-16_search_columns_utf8mb4.sql and src/utils/searchFilter.ts). Mixing
-- collations across columns is what makes MySQL throw 3988 on comparisons.
--
-- Columns this converts:
--   ws_material : direct_link, file, file_name, file_mime, thumbnail, language
--                 (title/description already utf8mb4_0900_ai_ci — untouched)
--   ws_exam     : solution_pdf, solution_pdf_name, type (enum)
--                 (title/description already utf8mb4_0900_ai_ci — untouched)
--
-- `ws_exam.type` is enum('daily','subject') — ASCII labels, so the conversion
-- preserves every stored value.
--
-- No column added or dropped; no data or API-shape change. Prisma's schema does
-- not model collation, so no schema.prisma edit and no client regeneration.

ALTER TABLE `ws_material`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

ALTER TABLE `ws_exam`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
