-- 2026-07-27 — Drop ws_live_course.level
--
-- Live courses no longer carry a difficulty Level. The admin "Add/Edit Live
-- Course" modal required it on create, but the value was never used to filter,
-- sort or group anything: it was written by the admin form, echoed back in the
-- live-course DTO, and rendered raw ("1"/"2"/"3", never even mapped to
-- Beginner/Intermediate/Advanced) in the admin table and detail header.
--
-- Removed from the backend in the same change set:
--   src/admin/live-course/live-course.validation.ts   (create + update schemas)
--   src/modules/admin-live-course/admin-live-course.service.ts   (DTO, create,
--     update, my-live-courses card, my-schedule select/DTO)
--   src/modules/admin-live-course/admin-live-course.repository.ts (select)
--   src/client/live-course/live-course.controller.ts  (omit lists)
--   src/modules/exam-countdown/exam-countdown.client.ts (live-course DTO)
--   src/modules/admin-customer/admin-customer-details.{repository,transformer}.ts
--
-- NOTE: `ws_course.level` (the non-live Course product) is deliberately
-- RETAINED — only the live-course column is dropped here.
--
-- Safe to run: the column is NULLable with no default, no index and no FK.
-- Apply AFTER deploying the matching backend build (which no longer selects or
-- writes it). Idempotent guard included.

SET @level_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_live_course'
    AND COLUMN_NAME = 'level'
);

SET @ddl := IF(
  @level_exists > 0,
  'ALTER TABLE `ws_live_course` DROP COLUMN `level`',
  'SELECT "ws_live_course.level already dropped" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
