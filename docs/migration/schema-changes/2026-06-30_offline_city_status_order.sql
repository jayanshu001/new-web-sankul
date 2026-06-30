-- offline-city: add `status` + `order` to ws_offline_city.
--
-- Prisma's OfflineCity model selects `status` (Boolean) and `order` (Int) — see
-- model OfflineCity { status Boolean ...; order Int ... }. The legacy dump table
-- only has id/name/image/created_at/updated_at (+ `state` from the sibling DDL),
-- so the client `listActive` (where: { status: true }, orderBy: { order }) and the
-- admin list 500 with "Unknown column 'status'/'order'" until the columns exist.
-- Idempotent so it is safe to re-run / safe on DBs that already have the columns.

-- Step 1 — add the `status` column only if it does not already exist.
SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_offline_city'
    AND COLUMN_NAME = 'status'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `ws_offline_city` ADD COLUMN `status` TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT "ws_offline_city.status already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 2 — add the `order` column only if it does not already exist.
-- `order` is a reserved word → always backtick-quoted.
SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_offline_city'
    AND COLUMN_NAME = 'order'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `ws_offline_city` ADD COLUMN `order` INT NOT NULL DEFAULT 0',
  'SELECT "ws_offline_city.order already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
