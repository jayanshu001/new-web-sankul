-- Wave 7 — net-new SQL tables for the previously Mongo-only-blocked surfaces.
-- INT PKs throughout (matches ws_customer/ws_video/ws_ebook/... which are INT @id).
-- FKs to already-migrated tables are plain INT columns (no hard FK constraint, to
-- tolerate the 0/null owner sentinels seen elsewhere in this migration). Polymorphic
-- refs (folder_item.ref_id) and embedded arrays (test_series.exam_category_ids JSON)
-- stay single-column / JSON, matching the Mongo shape (read consumers route by kind).
-- All timestamps nullable to mirror the Mongo timestamps:true behaviour.

-- ── 1. ws_lecture_progress ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_lecture_progress` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `customer_id`      INT NOT NULL,
  `video_id`         INT NULL,
  `live_session_id`  INT NULL,
  `course_id`        INT NULL,
  `live_course_id`   INT NULL,
  `package_id`       INT NULL,
  `source`           VARCHAR(16) NULL,            -- 'free' | NULL
  `position_sec`     INT NOT NULL DEFAULT 0,
  `duration_sec`     INT NOT NULL DEFAULT 0,
  `completed`        TINYINT(1) NOT NULL DEFAULT 0,
  `completed_at`     DATETIME NULL,
  `last_watched_at`  DATETIME NULL,
  `created_at`       DATETIME NULL,
  `updated_at`       DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_customer_video` (`customer_id`, `video_id`),
  UNIQUE KEY `uniq_customer_live_session` (`customer_id`, `live_session_id`),
  KEY `idx_lp_course`     (`customer_id`, `course_id`, `last_watched_at`),
  KEY `idx_lp_livecourse` (`customer_id`, `live_course_id`, `last_watched_at`),
  KEY `idx_lp_package`    (`customer_id`, `package_id`, `last_watched_at`),
  KEY `idx_lp_completed`  (`customer_id`, `completed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. ws_notification (singular, matches Prisma model mapping) ───────────────
-- NB: the Mongo collection is `ws_notifications` (plural). We map the Prisma model
-- to this new singular table to avoid clashing with the live Mongo-mirrored name;
-- the migration reads/writes go here. customer_id NULL = broadcast row.
CREATE TABLE IF NOT EXISTS `ws_notification` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `customer_id`      INT NULL,
  `title`            VARCHAR(255) NOT NULL,
  `body`             TEXT NOT NULL,
  `image`            VARCHAR(512) NULL,
  `type`             VARCHAR(50) NOT NULL DEFAULT 'general',
  `deep_link`        VARCHAR(512) NULL,
  `data`             JSON NULL,
  `is_read`          TINYINT(1) NOT NULL DEFAULT 0,
  `read_at`          DATETIME NULL,
  `broadcast`        TINYINT(1) NOT NULL DEFAULT 0,
  `status`           VARCHAR(16) NOT NULL DEFAULT 'sent',  -- sent|scheduled|failed|cancelled
  `scheduled_at`     DATETIME NULL,
  `sent_at`          DATETIME NULL,
  `failure_reason`   VARCHAR(512) NULL,
  `recipient_count`  INT NOT NULL DEFAULT 0,
  `audience`         JSON NULL,
  `created_at`       DATETIME NULL,
  `updated_at`       DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notif_customer`  (`customer_id`, `created_at`),
  KEY `idx_notif_broadcast` (`broadcast`, `created_at`),
  KEY `idx_notif_unread`    (`customer_id`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. ws_folder ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_folder` (
  `id`                INT NOT NULL AUTO_INCREMENT,
  `customer_id`       INT NOT NULL,
  `name`              VARCHAR(120) NOT NULL,
  `type`              VARCHAR(16) NOT NULL,        -- 'video' | 'material'
  `is_default_folder` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`        DATETIME NULL,
  `updated_at`        DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_folder_customer_type_name` (`customer_id`, `type`, `name`),
  KEY `idx_folder_customer_type` (`customer_id`, `type`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. ws_folder_item ─────────────────────────────────────────────────────────
-- ref_id is polymorphic (kind: material→ws_materials, video→ws_video, ebook→ws_ebook).
-- Single column, no FK constraint (read consumers route by kind).
CREATE TABLE IF NOT EXISTS `ws_folder_item` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `folder_id`    INT NOT NULL,
  `customer_id`  INT NOT NULL,
  `kind`         VARCHAR(16) NOT NULL,             -- 'material' | 'video' | 'ebook'
  `ref_id`       INT NOT NULL,
  `added_at`     DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_folder_kind_ref` (`folder_id`, `kind`, `ref_id`),
  KEY `idx_fi_folder_added` (`folder_id`, `added_at`),
  KEY `idx_fi_customer_kind` (`customer_id`, `kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. ws_ebook_download ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_ebook_download` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `customer_id`   INT NOT NULL,
  `ebook_id`      INT NOT NULL,
  `downloaded_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_dl_customer_ebook` (`customer_id`, `ebook_id`),
  KEY `idx_dl_customer_at` (`customer_id`, `downloaded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 6. ws_test_series ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_test_series` (
  `id`                 INT NOT NULL AUTO_INCREMENT,
  `title`              VARCHAR(255) NOT NULL,
  `description`        TEXT NULL,
  `thumbnail`          VARCHAR(512) NULL,
  `exam_category_ids`  JSON NULL,                  -- array of exam-category ids
  `exam_category_id`   INT NULL,                   -- deprecated single ref
  `language`           VARCHAR(16) NOT NULL DEFAULT 'gu',
  `paper_count`        INT NOT NULL DEFAULT 0,
  `is_free`            TINYINT(1) NOT NULL DEFAULT 0,
  `instructions`       TEXT NULL,
  `policy`             TEXT NULL,
  `order_by`           INT NOT NULL DEFAULT 0,
  `status`             TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`         DATETIME NULL,
  `updated_at`         DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ts_status_order` (`status`, `order_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 7. ws_test_series_price ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_test_series_price` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `test_series_id`  INT NOT NULL,
  `name`            VARCHAR(200) NULL,
  `duration_days`   INT NOT NULL,
  `price`           DECIMAL(10,2) NOT NULL,
  `original_price`  DECIMAL(10,2) NULL,
  `is_default`      TINYINT(1) NOT NULL DEFAULT 0,
  `status`          TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`      DATETIME NULL,
  `updated_at`      DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tsp_series_status` (`test_series_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 8. ws_test_series_order ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_test_series_order` (
  `id`                  INT NOT NULL AUTO_INCREMENT,
  `customer_id`         INT NOT NULL,
  `test_series_id`      INT NOT NULL,
  `plan_id`             INT NULL,
  `payment_method`      VARCHAR(50) NOT NULL,
  `order_type`          VARCHAR(50) NOT NULL DEFAULT 'purchase',
  `order_price`         DECIMAL(10,2) NOT NULL,
  `base_price`          DECIMAL(10,2) NOT NULL DEFAULT 0,
  `discount_amount`     DECIMAL(10,2) NOT NULL DEFAULT 0,
  `gst_amount`          DECIMAL(10,2) NOT NULL DEFAULT 0,
  `handling_fee`        DECIMAL(10,2) NOT NULL DEFAULT 0,
  `promocode_id`        INT NULL,
  `razorpay_order_id`   VARCHAR(255) NULL,
  `razorpay_payment_id` VARCHAR(255) NULL,
  `ip_address`          VARCHAR(45) NULL,
  `transaction_id`      VARCHAR(255) NULL,
  `status`              VARCHAR(16) NOT NULL DEFAULT 'pending',  -- cancel|complete|pending
  `created_at`          DATETIME NULL,
  `updated_at`          DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tso_customer` (`customer_id`),
  KEY `idx_tso_series`   (`test_series_id`),
  KEY `idx_tso_razorpay` (`razorpay_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 9. ws_test_series_subscription ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_test_series_subscription` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `order_id`        INT NULL,
  `customer_id`     INT NOT NULL,
  `test_series_id`  INT NOT NULL,
  `plan_id`         INT NULL,
  `price`           DECIMAL(10,2) NOT NULL,
  `start_at`        DATETIME NULL,
  `end_at`          DATETIME NULL,
  `remarks`         VARCHAR(255) NULL,
  `payment_type`    VARCHAR(16) NOT NULL DEFAULT 'online',
  `status`          TINYINT(1) NOT NULL DEFAULT 1,
  `promocode_id`    INT NULL,
  `created_at`      DATETIME NULL,
  `updated_at`      DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tss_customer_series` (`customer_id`, `test_series_id`),
  KEY `idx_tss_active` (`customer_id`, `status`, `end_at`),
  KEY `idx_tss_series` (`test_series_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 10. ws_book_order alter — paid_at column for the webhook book branch ───────
-- (webhook.controller writes bookOrder.paidAt on fulfillment; the migrated
-- ws_book_order had no such column.)
ALTER TABLE `ws_book_order` ADD COLUMN IF NOT EXISTS `paid_at` DATETIME NULL AFTER `status`;
