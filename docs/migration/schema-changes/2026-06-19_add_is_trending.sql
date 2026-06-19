-- 2026-06-19 — add is_trending to ws_book + ws_ebook (C3 client dashboard +
-- admin toggleTrending). The new-app trending flag was never in legacy SQL.
-- Additive + prod-safe: existing rows default 0 (not trending). Backfilled from
-- Mongo (ws_books.isTrending / ws_ebooks.isTrending) by name match.
ALTER TABLE `ws_book`  ADD COLUMN `is_trending` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `ws_ebook` ADD COLUMN `is_trending` TINYINT(1) NOT NULL DEFAULT 0;
