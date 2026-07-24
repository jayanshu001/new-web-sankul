-- 2026-07-24 — Drop ws_customer_address.city_id
--
-- The customer address now stores the city as a plain name string
-- (`ws_customer_address.city` VARCHAR(20)). The `city_id` reference is no longer
-- used by any code path (client address APIs, admin subscription address APIs,
-- and cart shipping snapshot all read/write the `city` name string directly).
--
-- Safe to run: `city` (NOT NULL VARCHAR) already carries the city name for every
-- row, including legacy rows where `city_id` was NULL. No data is lost.
--
-- Apply AFTER deploying the matching backend build (which no longer writes
-- city_id). Idempotent guard included.

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_customer_address'
    AND COLUMN_NAME = 'city_id'
);

SET @ddl := IF(
  @col_exists > 0,
  'ALTER TABLE `ws_customer_address` DROP COLUMN `city_id`',
  'SELECT "ws_customer_address.city_id already dropped" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
