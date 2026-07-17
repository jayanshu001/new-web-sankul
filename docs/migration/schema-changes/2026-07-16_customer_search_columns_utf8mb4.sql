-- 2026-07-16 — Admin customer search: convert ws_customer searched columns to
-- utf8mb4 / utf8mb4_0900_ai_ci.
--
-- Root cause (same class as 2026-07-09_search_name_columns_utf8mb4.sql and
-- 2026-07-16_search_columns_utf8mb4.sql): Prisma binds `search` as utf8mb4, but
-- `ws_customer.full_name` / `phone` / `email_address` were still latin1_swedish_ci.
-- ASCII terms coerce fine (English search works); Gujarati/Hindi/emoji throw
-- MySQL error 3988:
--   Conversion from collation utf8mb4_general_ci into latin1_swedish_ci
--   impossible for parameter
--
-- The July-16 search-columns DDL converted ws_promoter (and others) but omitted
-- ws_customer — this file closes that gap for GET /admin/customers?search=...
-- (and any other path that contains-matches on customer name/phone/email).
--
-- Conversions are lossless (latin1 → utf8mb4 transcodes Latin data). Collation is
-- NOT tracked in schema.prisma — no db:pull / prisma:generate. Re-running is a
-- harmless no-op. Apply via `yarn db:migrate`.

-- ── ws_customer (admin + cross-table customer search fields) ─────────────────
ALTER TABLE `ws_customer`
  MODIFY COLUMN `full_name` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
  MODIFY COLUMN `phone` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN `email_address` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL;
