-- customer-address: add `label`, `is_default`, `city_id` to ws_customer_address.
--
-- Prisma's CustomerAddress model maps these three columns (see schema.prisma).
-- The legacy websankul_staging.sql dump predates them — the live production DB
-- has them, but runbook-built databases restored from the dump do not. Until
-- added, every address read/write 500s with "Unknown column 'label'" (Prisma
-- selects all mapped fields on findMany).
-- Idempotent — safe to re-run on DBs that already have the columns.

-- Step 1 — `label` (home/work/other — freeform VARCHAR, mirrors Mongo enum as string).
SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_customer_address'
    AND COLUMN_NAME = 'label'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `ws_customer_address` ADD COLUMN `label` VARCHAR(20) NULL DEFAULT NULL AFTER `pincode`',
  'SELECT "ws_customer_address.label already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 2 — `is_default` (one default address per customer; used by setDefault transaction).
SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_customer_address'
    AND COLUMN_NAME = 'is_default'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `ws_customer_address` ADD COLUMN `is_default` TINYINT(1) NULL DEFAULT 0 AFTER `label`',
  'SELECT "ws_customer_address.is_default already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3 — `city_id` (OfflineCity FK; NULL in legacy rows — freeform `city` VARCHAR used instead).
SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_customer_address'
    AND COLUMN_NAME = 'city_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `ws_customer_address` ADD COLUMN `city_id` INT NULL DEFAULT NULL AFTER `is_default`',
  'SELECT "ws_customer_address.city_id already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
