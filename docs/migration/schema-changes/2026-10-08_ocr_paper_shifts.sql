-- Rank predictor: shifts an admin sets up on a paper, each with the questions the
-- board cancelled for that shift only.
--
-- A marks_only paper needs at least one (students pick their shift from this list);
-- on any other paper it is optional. A cancelled question is scored for no one who
-- sat that shift, exactly like `*` in an admin key.
--
-- Nullable, so every existing paper keeps behaving as it did.
-- Apply this one file by name — NOT `yarn db:migrate` (see docs/rank-predictor.md §7).

ALTER TABLE `ws_ocr_exams`
  ADD COLUMN `paper_shifts` json DEFAULT NULL COMMENT '[{key: YYYY-MM-DDTHH:MM, cancelled_questions: [question numbers]}]; required for marks_only',
  ALGORITHM=INSTANT;
