-- 2026-07-01  Add is_individual to ws_package
--
-- Differentiates label-based packages from goal-level ("individual") packages:
--   is_individual = 0 (default) → package targets goal_id + goal_label_id (label-based)
--   is_individual = 1           → package targets goal_id only, goal_label_id IS NULL
--                                 (used for goals that have no labels)
-- The admin write path sets this automatically from the target goal's labels:
-- goal has labels → label required, is_individual=0; goal has no labels → is_individual=1.
--
-- Idempotent.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_package'
    AND COLUMN_NAME = 'is_individual'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `ws_package` ADD COLUMN `is_individual` TINYINT(1) NOT NULL DEFAULT 0 AFTER `goal_label_id`',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
