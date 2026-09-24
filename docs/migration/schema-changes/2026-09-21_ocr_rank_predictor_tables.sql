CREATE TABLE IF NOT EXISTS `ws_ocr_exams` (
  `id`              bigint unsigned NOT NULL AUTO_INCREMENT,
  `code`            varchar(100)    NOT NULL,
  `name`            varchar(255)    NOT NULL,
  `total_questions` int             NOT NULL,
  `category`        varchar(255)    DEFAULT NULL,
  `exam_date`       date            DEFAULT NULL,
  `paper_series`    json            DEFAULT NULL,
  `is_active`       tinyint(1)      NOT NULL DEFAULT '1',
  `created_by`      int             DEFAULT NULL,
  `created_at`      timestamp       NULL DEFAULT NULL,
  `updated_at`      timestamp       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ocr_exams_code` (`code`),
  KEY `idx_ocr_exams_active_date` (`is_active`,`exam_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ws_ocr_answer_keys` (
  `id`             bigint unsigned NOT NULL AUTO_INCREMENT,
  `exam_id`        bigint unsigned NOT NULL,
  `version`        int             NOT NULL DEFAULT '1',
  `is_active`      tinyint(1)      NOT NULL DEFAULT '1',
  `series`         varchar(4)      DEFAULT NULL,
  `source_pdf_key` varchar(1000)   DEFAULT NULL,
  `keys_json`      json            NOT NULL,
  `marks_correct`  decimal(10,4)   NOT NULL DEFAULT '1.0000',
  `marks_wrong`    decimal(10,4)   NOT NULL DEFAULT '0.0000',
  `uploaded_by`    int             DEFAULT NULL,
  `created_at`     timestamp       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ocr_answer_keys_exam_version` (`exam_id`,`version`),
  KEY `idx_ocr_answer_keys_active` (`exam_id`,`series`,`is_active`),
  CONSTRAINT `fk_ocr_answer_keys_exam` FOREIGN KEY (`exam_id`)
    REFERENCES `ws_ocr_exams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ws_ocr_submissions` (
  `id`                       bigint unsigned NOT NULL AUTO_INCREMENT,
  `exam_id`                  bigint unsigned NOT NULL,
  `customer_id`              int             NOT NULL,
  `source_pdf_key`           varchar(1000)   DEFAULT NULL,
  `extraction_kind`          enum('text_layer','omr') DEFAULT NULL,
  `roll_number`              varchar(64)     DEFAULT NULL,
  `series`                   varchar(4)      DEFAULT NULL,
  `raw_answers`              json            NOT NULL,
  `low_confidence_questions` json            DEFAULT NULL,
  `status`                   enum('processing','processed','failed','needs_review')
                                             NOT NULL DEFAULT 'processing',
  `failure_code`             varchar(64)     DEFAULT NULL,
  `created_at`               timestamp       NULL DEFAULT NULL,
  `updated_at`               timestamp       NULL DEFAULT NULL,
  `active_customer_id`       int GENERATED ALWAYS AS
                               (IF(`status` <> 'failed', `customer_id`, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ocr_submissions_exam_active` (`exam_id`,`active_customer_id`),
  KEY `idx_ocr_submissions_customer` (`customer_id`,`created_at`),
  KEY `idx_ocr_submissions_exam_status` (`exam_id`,`status`),
  KEY `idx_ocr_submissions_review_queue` (`status`,`created_at`),
  CONSTRAINT `fk_ocr_submissions_exam` FOREIGN KEY (`exam_id`)
    REFERENCES `ws_ocr_exams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ws_ocr_scores` (
  `id`            bigint unsigned NOT NULL AUTO_INCREMENT,
  `submission_id` bigint unsigned NOT NULL,
  `exam_id`       bigint unsigned NOT NULL,
  `customer_id`   int             NOT NULL,
  `answer_key_id` bigint unsigned NOT NULL,
  `correct`       int             NOT NULL,
  `wrong`         int             NOT NULL,
  `unanswered`    int             NOT NULL,
  `raw_score`     decimal(10,4)   NOT NULL,
  `created_at`    timestamp       NULL DEFAULT NULL,
  `updated_at`    timestamp       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ocr_scores_submission` (`submission_id`),
  UNIQUE KEY `uq_ocr_scores_exam_customer` (`exam_id`,`customer_id`),
  KEY `idx_ocr_scores_leaderboard` (`exam_id`,`raw_score`),
  CONSTRAINT `fk_ocr_scores_submission` FOREIGN KEY (`submission_id`)
    REFERENCES `ws_ocr_submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ocr_scores_answer_key` FOREIGN KEY (`answer_key_id`)
    REFERENCES `ws_ocr_answer_keys` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ws_ocr_ranks` (
  `score_id`         bigint unsigned NOT NULL,
  `exam_id`          bigint unsigned NOT NULL,
  `rank_position`    int             NOT NULL,
  `total_candidates` int             NOT NULL,
  `percentile`       decimal(6,2)    NOT NULL,
  `computed_at`      datetime        NOT NULL,
  PRIMARY KEY (`score_id`),
  KEY `idx_ocr_ranks_exam` (`exam_id`),
  CONSTRAINT `fk_ocr_ranks_score` FOREIGN KEY (`score_id`)
    REFERENCES `ws_ocr_scores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ws_ocr_audit_logs` (
  `id`          bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_type`  enum('customer','admin','system') NOT NULL DEFAULT 'system',
  `actor_id`    int             DEFAULT NULL,
  `action`      varchar(64)     NOT NULL,
  `entity_type` varchar(32)     NOT NULL,
  `entity_id`   varchar(64)     DEFAULT NULL,
  `metadata`    json            DEFAULT NULL,
  `created_at`  timestamp       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ocr_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_ocr_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ws_ocr_profiles` (
  `customer_id`    int        NOT NULL,
  `show_real_name` tinyint(1) NOT NULL DEFAULT '0',
  `created_at`     timestamp  NULL DEFAULT NULL,
  `updated_at`     timestamp  NULL DEFAULT NULL,
  PRIMARY KEY (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
