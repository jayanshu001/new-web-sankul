-- offline-city: add `state` to ws_offline_city (State → City dependent dropdown).
--
-- Prisma's OfflineCity model selects `state` (model OfflineCity { state Int? ... }),
-- so city queries 500 with "Unknown column 'state'" until the column exists. The
-- original DDL lived at prisma/sql/2026_add_offline_city_state.sql — OUTSIDE the
-- docs/migration/schema-changes/ folder that `yarn db:migrate` (apply-ddl.ts) scans,
-- so it was never applied on runbook-built databases. This relocates it here, made
-- idempotent so it is safe on DBs that already ran the old file manually.

-- Step 1 — add the `state` column only if it does not already exist.
SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_offline_city'
    AND COLUMN_NAME = 'state'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `ws_offline_city` ADD COLUMN `state` INT NULL',
  'SELECT "ws_offline_city.state already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 2 — add the FK to ws_customer_state only if it is not already present.
SET @fk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_offline_city'
    AND CONSTRAINT_NAME = 'fk_ws_offline_city_state'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE `ws_offline_city` ADD CONSTRAINT `fk_ws_offline_city_state` FOREIGN KEY (`state`) REFERENCES `ws_customer_state`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT "fk_ws_offline_city_state already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill note: cities left with state = NULL will not appear under any ?stateId=
-- filter. Populate via the admin City form or per-city UPDATEs from the legacy source.
