-- Async report-export jobs (generic, all report types).
-- Backs POST /admin/exports + GET /admin/exports/:jobId. A BullMQ worker generates
-- the CSV/XLSX off-request and streams it to Spaces (private); the poll endpoint
-- returns a freshly-signed download URL while the object lives (retention window).
-- Apply on deploy, then hand-add the ExportJob model to schema.prisma + prisma:generate.

CREATE TABLE IF NOT EXISTS `ws_export_job` (
  `id`           INT           NOT NULL AUTO_INCREMENT,
  `job_ref`      VARCHAR(40)   NOT NULL,                       -- public opaque id ("exp_...")
  `type`         VARCHAR(40)   NOT NULL,                       -- subscription|liveCourseSub|testSeriesSub|ebookSubscription|...
  `format`       VARCHAR(10)   NOT NULL DEFAULT 'excel',       -- csv | excel
  `params`       JSON          NULL,                           -- the report's filter object (page/limit stripped)
  `status`       VARCHAR(20)   NOT NULL DEFAULT 'pending',     -- pending|processing|ready|failed
  `progress`     INT           NOT NULL DEFAULT 0,             -- 0..100
  `row_count`    INT           NULL,
  `file_key`     VARCHAR(512)  NULL,                           -- Spaces object key (nulled on GC)
  `file_name`    VARCHAR(255)  NULL,                           -- friendly download filename
  `error`        VARCHAR(1000) NULL,
  `requested_by` INT           NULL,                           -- admin id (ownership)
  `expires_at`   DATETIME      NULL,                           -- when the stored file / signed URL stops being valid
  `started_at`   DATETIME      NULL,
  `finished_at`  DATETIME      NULL,
  `created_at`   DATETIME      NULL,
  `updated_at`   DATETIME      NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_export_job_ref` (`job_ref`),
  KEY `idx_export_job_status` (`status`),
  KEY `idx_export_job_requester` (`requested_by`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
