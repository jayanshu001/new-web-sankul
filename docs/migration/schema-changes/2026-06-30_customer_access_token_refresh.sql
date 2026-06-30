-- customer-auth: add `refresh_token` to ws_customer_access_token.
--
-- Prisma's CustomerAccessToken model maps `refreshToken String? @map("refresh_token")`
-- (mirrors the legacy Mongo `refreshToken` field). The dump table predates the
-- token-pair change and lacks the column, so the OTP-validate / token-refresh
-- write path 500s with "The column refresh_token does not exist" until added.
-- Idempotent so it is safe to re-run / safe on DBs that already have the column.

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_customer_access_token'
    AND COLUMN_NAME = 'refresh_token'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE `ws_customer_access_token` ADD COLUMN `refresh_token` TEXT NULL AFTER `token`',
  'SELECT "ws_customer_access_token.refresh_token already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
