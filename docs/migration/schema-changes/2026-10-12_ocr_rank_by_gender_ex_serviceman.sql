-- Rank predictor: gender / ex-servicemen boards an admin can switch.
--
-- `rank_by` gains "gender" and "ex_serviceman". Those boards used to be shown on
-- every paper with no switch; papers that already store a `rank_by` list get both
-- added so nothing a student sees today disappears. Papers with no list (NULL)
-- are covered in code (LEGACY_RANK_BY).
--
-- No DDL for date of birth: the tie-break on equal marks (elder ranks higher)
-- reads the customer's existing `ws_customer.dob`, which the first-visit dialog
-- now also writes.
--
-- Apply this one file by name — NOT `yarn db:migrate` (see docs/rank-predictor.md §7).

UPDATE `ws_ocr_exams`
   SET `rank_by` = JSON_ARRAY_APPEND(`rank_by`, '$', 'gender')
 WHERE `rank_by` IS NOT NULL AND JSON_TYPE(`rank_by`) = 'ARRAY'
   AND NOT JSON_CONTAINS(`rank_by`, '"gender"');

UPDATE `ws_ocr_exams`
   SET `rank_by` = JSON_ARRAY_APPEND(`rank_by`, '$', 'ex_serviceman')
 WHERE `rank_by` IS NOT NULL AND JSON_TYPE(`rank_by`) = 'ARRAY'
   AND NOT JSON_CONTAINS(`rank_by`, '"ex_serviceman"');
