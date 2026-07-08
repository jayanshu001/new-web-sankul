-- 2026-07-08 — Drop the unused `description` column from ws_exam_countdown.
--
-- The Exam Countdowns admin UI no longer captures or displays a description
-- (frontend request). Backend stopped accepting/persisting it and removed it from
-- the admin list + create/update + client responses. The column is used nowhere
-- else, so drop it.
--
-- DESTRUCTIVE (drops data in the column). Back up first if the values matter:
--   mysqldump ... ws_exam_countdown > ws_exam_countdown.backup.sql

ALTER TABLE `ws_exam_countdown`
  DROP COLUMN `description`;
