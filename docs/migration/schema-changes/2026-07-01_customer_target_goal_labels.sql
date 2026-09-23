-- 2026-07-01  Add labels to customer target goals
-- A target goal (ws_customer_target_goal) may optionally carry a set of labels,
-- mirroring ws_goal.labels. Stored as JSON array of { id, name } (ids assigned by
-- the admin target-goal service). Customers select a target goal plus, optionally,
-- specific labels within it; the selection is persisted on ws_customer.goal as
-- [{ "goalId": <id>, "labelIds": [<id>...] }] (legacy flat [<id>...] still read).
--
-- Idempotent: guarded so re-running is safe.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_customer_target_goal'
    AND COLUMN_NAME = 'labels'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `ws_customer_target_goal` ADD COLUMN `labels` JSON NULL AFTER `image`',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
