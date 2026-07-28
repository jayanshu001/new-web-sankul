-- 2026-07-27 — Make ws_exam.end_date NULLable (open-ended quizzes)
--
-- A quiz can now be "ongoing forever": no end time at all. Until today that was
-- impossible to express. `end_date` was NOT NULL, so the create path in
-- src/modules/admin-exam/admin-exam.service.ts defaulted a missing end time to
-- `now()` just to satisfy the constraint. The effect was worse than a hard
-- error: the quiz saved fine, then one second later failed the
-- `endAt >= now` window filter in
-- src/modules/client-exam/client-exam.repository.ts (examsByCategoryPaged /
-- countExamsByCategoryPaged) and vanished from the paginated category listing
-- while still appearing in the non-paginated one. It looked like a data bug.
--
-- After this migration NULL means "no end date — always open". The read paths
-- that gate on the window already treat NULL that way
-- (`{ OR: [{ endAt: null }, { endAt: { gte: now } }] }`); the client dashboard's
-- daily-test lookup is updated in the same change set to match.
--
-- `start_date` is deliberately left NOT NULL — a quiz always has a start.
--
-- Daily tests still REQUIRE an end time (enforced in
-- src/admin/exam/exam.validation.ts and exam.controller.ts): the daily-slot
-- overlap check compares two windows and cannot run against an open-ended one.
-- Only subject / mock / weekly quizzes can be open-ended.
--
-- Existing rows are untouched. Widening NOT NULL → NULL is non-destructive and
-- takes no rewrite lock on MySQL 8 (ALGORITHM=INSTANT for a nullability
-- widening on a datetime column). Apply BEFORE or WITH the matching backend
-- build; the old build never writes NULL, so ordering is not critical.

SET @is_nullable := (
  SELECT IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_exam'
    AND COLUMN_NAME = 'end_date'
);

SET @ddl := IF(
  @is_nullable = 'NO',
  'ALTER TABLE `ws_exam` MODIFY COLUMN `end_date` DATETIME NULL',
  'SELECT "ws_exam.end_date already nullable" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
