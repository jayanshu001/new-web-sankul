-- 2026-06-29  Exam attempt lifecycle (resumable attempts) — SQL port
--
-- The legacy ws_exam_result table was built for the OLD one-shot submit flow:
-- one row per COMPLETED attempt (qresult_status = 1). The client "attempt
-- lifecycle" (start → save-as-you-go → resume `active` → submit) needs to track
-- an IN-PROGRESS attempt (qresult_status = 0) plus per-attempt timing/number.
-- These columns did not exist; add them. All nullable / default so existing
-- completed rows are unaffected.
--
-- in-progress attempt  := qresult_status = 0  AND  qresult_in_progress = 1
-- completed attempt     := qresult_status = 1  (excluded from active lookups;
--                          already what history/rank/analytics filter on)

ALTER TABLE `ws_exam_result`
  ADD COLUMN `qresult_attempt_number` INT NULL AFTER `qresult_qtest_id`,
  ADD COLUMN `qresult_started_at` DATETIME NULL AFTER `qresult_created_date`,
  ADD COLUMN `qresult_submitted_at` DATETIME NULL AFTER `qresult_started_at`,
  ADD COLUMN `qresult_in_progress` TINYINT(1) NOT NULL DEFAULT 0 AFTER `qresult_submitted_at`;

-- Speeds up the "find this customer's in-progress / latest attempt for an exam"
-- lookups that run on every start/active/save/submit call.
CREATE INDEX `idx_exam_result_cust_exam_status`
  ON `ws_exam_result` (`qresult_customer_id`, `qresult_qtest_id`, `qresult_status`);
