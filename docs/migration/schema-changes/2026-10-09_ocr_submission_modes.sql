-- Rank predictor: an admin can switch off any of the three ways a student submits
-- on a paper — PDF upload ("pdf", the `file` field), sheet link ("url") and typed
-- marks ("marks"). A JSON array of the ones left ON.
--
-- Nullable, and NULL means all three, so every existing paper keeps behaving as it did.
-- Apply this one file by name — NOT `yarn db:migrate` (see docs/rank-predictor.md §7).

ALTER TABLE `ws_ocr_exams`
  ADD COLUMN `submission_modes` json DEFAULT NULL COMMENT '["pdf","url","marks"] subset students may use; NULL = all',
  ALGORITHM=INSTANT;
