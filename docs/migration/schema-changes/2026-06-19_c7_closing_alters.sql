-- 2026-06-19 — C7 closing ALTERs: the columns the live-recording-promotion +
-- ebook-PDF-upload secondary flows need so they can leave Mongo too (zero-Mongo).
-- All additive/nullable, prod-safe.

-- Recording → Video promotion traceability + subject-folder grouping
ALTER TABLE `ws_video`
  ADD COLUMN `live_session_id` INT NULL,
  ADD KEY `idx_video_live_session` (`live_session_id`);

ALTER TABLE `ws_video_category`
  ADD COLUMN `subject_key` VARCHAR(255) NULL,
  ADD KEY `idx_vcat_subject_key` (`subject_key`);

-- eBook PDF-upload status (the Edit-Ebook screen's Book/Demo PDF slots)
ALTER TABLE `ws_ebook`
  ADD COLUMN `book_file_name`       VARCHAR(500) NULL,
  ADD COLUMN `demo_file_name`       VARCHAR(500) NULL,
  ADD COLUMN `book_upload_status`   VARCHAR(20)  NULL,
  ADD COLUMN `demo_upload_status`   VARCHAR(20)  NULL,
  ADD COLUMN `book_upload_progress` INT NOT NULL DEFAULT 0,
  ADD COLUMN `demo_upload_progress` INT NOT NULL DEFAULT 0;
