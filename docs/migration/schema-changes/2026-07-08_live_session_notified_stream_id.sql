-- 2026-07-08 — Track "buyers notified" per live-session stream run.
--
-- When an admin flips a session live (POST /admin/live-sessions/:id/start), the
-- backend fans out a `general` push to every customer with an active subscription
-- to any of the session's live courses. This must be idempotent per stream run:
-- a retried /start, or a stop→restart that REUSES the already-provisioned StreamOS
-- stream, must NOT re-spam the same buyers.
--
-- `notified_stream_id` records the stream_id we last notified for. The start path
-- claims it with a conditional UPDATE ... WHERE notified_stream_id <> stream_id
-- (Prisma `not` also matches NULL), so only the first start of a given stream run
-- sends. A genuinely NEW StreamOS stream (different stream_id) re-notifies.
--
-- IDEMPOTENT: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so guard on
-- information_schema. If the column already exists (this DDL ran before) it
-- becomes a no-op instead of erroring "Duplicate column name".

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_live_session'
    AND COLUMN_NAME = 'notified_stream_id'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `ws_live_session` ADD COLUMN `notified_stream_id` VARCHAR(191) NULL DEFAULT NULL AFTER `stream_id`',
  'DO 0'  -- column already present; no-op
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
