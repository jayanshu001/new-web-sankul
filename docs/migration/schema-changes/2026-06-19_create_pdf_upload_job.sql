-- 2026-06-19 — C7: net-new ws_pdf_upload_job (admin single-PDF→ebook BullMQ job
-- lifecycle; the DB row is the source of truth the admin UI renders, BullMQ is
-- just the runner). Mongo collection ws_pdf_upload_jobs. The BullMQ/Redis queue
-- + Socket.io progress transport are unchanged — only the persistence moves to SQL.

CREATE TABLE IF NOT EXISTS `ws_pdf_upload_job` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `batch_id`       VARCHAR(100) NOT NULL,
  `idx`            INT NOT NULL DEFAULT 0,            -- position in batch (Mongo `index`)
  `uploaded_by`    INT NULL,                          -- admin id from JWT
  `ebook_id`       INT NULL,
  `target_field`   VARCHAR(20) NOT NULL DEFAULT 'bookUrl',  -- bookUrl | demoUrl
  `file_name`      VARCHAR(500) NOT NULL,
  `temp_path`      VARCHAR(1000) NOT NULL,
  `file_size`      BIGINT NOT NULL DEFAULT 0,
  `status`         VARCHAR(20) NOT NULL DEFAULT 'queued',    -- queued|in_progress|completed|failed
  `progress`       INT NOT NULL DEFAULT 0,
  `file_url`       VARCHAR(1000) NULL,
  `failure_reason` VARCHAR(1000) NULL,
  `started_at`     DATETIME NULL,
  `finished_at`    DATETIME NULL,
  `created_at`     DATETIME NULL,
  `updated_at`     DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pdf_job_batch` (`batch_id`, `idx`),
  KEY `idx_pdf_job_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
