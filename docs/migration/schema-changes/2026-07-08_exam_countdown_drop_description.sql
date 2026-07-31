-- 2026-07-08 — Drop the unused `description` column from ws_exam_countdown.
--
-- The Exam Countdowns admin UI no longer captures or displays a description
-- (frontend request). Backend stopped accepting/persisting it and removed it from
-- the admin list + create/update + client responses. The column is used nowhere
-- else, so drop it.
--
-- DESTRUCTIVE (drops data in the column). Back up first if the values matter:
--   mysqldump ... ws_exam_countdown > ws_exam_countdown.backup.sql
--
-- IDEMPOTENT: MySQL 8 has no `DROP COLUMN IF EXISTS`, so guard on
-- information_schema. If the column is already gone (this DDL ran before) it
-- becomes a no-op instead of erroring "Can't DROP 'description'".

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_exam_countdown'
    AND COLUMN_NAME = 'description'
);

SET @ddl := IF(
  @col_exists > 0,
  'ALTER TABLE `ws_exam_countdown` DROP COLUMN `description`',
  'DO 0'  -- column already absent; no-op
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
