-- Rank predictor: keep the name printed on the response sheet in its own column,
-- and index the duplicate-sheet check every upload runs.
--
-- `candidate_name` is the name the sheet prints (Digialm header); NULL for sheets
-- that print none (OMR). It is also inside `candidate` JSON — this column makes it
-- searchable and showable without unpacking JSON. Backfilled from that JSON.
--
-- `idx_ocr_submissions_exam_roll` serves "has another account already sent this
-- participant's sheet?", which otherwise scans every sheet of the paper per upload.
--
-- Apply this one file by name — NOT `yarn db:migrate` (see docs/rank-predictor.md §7).

ALTER TABLE `ws_ocr_submissions`
  ADD COLUMN `candidate_name` varchar(255) DEFAULT NULL COMMENT 'Name printed on the response sheet, when it prints one' AFTER `candidate`,
  ALGORITHM=INSTANT;

UPDATE `ws_ocr_submissions`
   SET `candidate_name` = LEFT(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`candidate`, '$.name'))), 255)
 WHERE `candidate` IS NOT NULL
   AND JSON_TYPE(JSON_EXTRACT(`candidate`, '$.name')) = 'STRING';

ALTER TABLE `ws_ocr_submissions`
  ADD KEY `idx_ocr_submissions_exam_roll` (`exam_id`, `roll_number`);
