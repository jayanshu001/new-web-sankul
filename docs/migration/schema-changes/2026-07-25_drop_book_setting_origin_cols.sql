-- 2026-07-25 — Drop ws_book_setting.origin_city and ws_book_setting.origin_hub
--
-- Both columns were created with the table (2026-06-22_book_setting.sql) in
-- anticipation of a courier pickup-origin feature that was never built. Audit
-- 2026-07-25: neither is read by any code path. The courier integration
-- (`src/config/courier.ts`, `src/libs/courier/tracking.ts`) has no
-- origin/pickup/hub concept at all, so there is nothing they could be wired to.
-- Their only references were the admin settings CRUD echoing them back —
-- `PUT /admin/books/settings` accepted them, stored them, and nothing ever read
-- them again.
--
-- Safe to run: both columns are NULLable with no default, no index, no FK, and
-- are NULL on every row in staging (the table holds a single 'default' config
-- row). No data is lost that anything consumes.
--
-- The other unused columns on this table (gst_rate, support_phone,
-- terms_and_conditions) are deliberately RETAINED — gst_rate reflects a likely
-- future tax requirement, and the other two are customer-facing content that
-- needs a client endpoint rather than deletion. See
-- docs/MIGRATION_QUERY_CHANGES.md (2026-07-25).
--
-- Apply AFTER deploying the matching backend build (which no longer selects or
-- writes these columns). Idempotent guards included.

SET @origin_city_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_book_setting'
    AND COLUMN_NAME = 'origin_city'
);

SET @ddl := IF(
  @origin_city_exists > 0,
  'ALTER TABLE `ws_book_setting` DROP COLUMN `origin_city`',
  'SELECT "ws_book_setting.origin_city already dropped" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @origin_hub_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_book_setting'
    AND COLUMN_NAME = 'origin_hub'
);

SET @ddl := IF(
  @origin_hub_exists > 0,
  'ALTER TABLE `ws_book_setting` DROP COLUMN `origin_hub`',
  'SELECT "ws_book_setting.origin_hub already dropped" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
