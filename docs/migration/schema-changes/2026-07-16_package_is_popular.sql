-- Package "isPopular" flag (admin panel).
-- Adds a non-null boolean column to ws_package, mirroring is_paid/is_individual.
-- Default 0 (false) so existing rows are unaffected.
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so the add
-- is guarded on information_schema and becomes a no-op if already applied (fixes
-- "Duplicate column name" on a re-run).

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_package' AND COLUMN_NAME = 'is_popular');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_package` ADD COLUMN `is_popular` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_paid`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
