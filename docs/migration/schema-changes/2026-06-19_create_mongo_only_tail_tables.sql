-- 2026-06-19 — net-new SQL tables for the remaining Mongo-only DATA models
-- (the realtime/streaming stack stays Mongo by design). Conventions match
-- Wave 7/8: INT PKs; FKs are plain INT (no hard constraint, sentinel-tolerant);
-- timestamps nullable to mirror Mongo timestamps:true. New tables use the
-- SINGULAR ws_<name> mapping (live Mongo collections are plural).

-- ── 1. ws_exam_countdown_category (ExamCountdownCategory) ─────────────────────
-- Mongo ws_exam_countdown_categories: name(unique, ci), colorHex(#RRGGBB),
-- order, status, timestamps.
CREATE TABLE IF NOT EXISTS `ws_exam_countdown_category` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(60) NOT NULL,
  `color_hex`  VARCHAR(7) NOT NULL,
  `order_by`   INT NOT NULL DEFAULT 0,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ecc_name` (`name`),
  KEY `idx_ecc_status_order` (`status`, `order_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. ws_exam_countdown (ExamCountdown) ─────────────────────────────────────
-- Mongo ws_exam_countdowns: title, categoryId→category_id(INT), examDate,
-- description, status, timestamps.
CREATE TABLE IF NOT EXISTS `ws_exam_countdown` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `title`       VARCHAR(200) NOT NULL,
  `category_id` INT NULL,
  `exam_date`   DATETIME NOT NULL,
  `description` TEXT NULL,
  `status`      TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`  DATETIME NULL,
  `updated_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ec_date_status`     (`exam_date`, `status`),
  KEY `idx_ec_category_date`   (`category_id`, `exam_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. ws_package_category (PackageCategory) ─────────────────────────────────
-- Mongo ws_package_categories: title, slug(unique), image, order, status, ts.
CREATE TABLE IF NOT EXISTS `ws_package_category` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `title`      VARCHAR(255) NOT NULL,
  `slug`       VARCHAR(255) NOT NULL,
  `image`      VARCHAR(512) NULL,
  `order_by`   INT NOT NULL DEFAULT 0,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pc_slug` (`slug`),
  KEY `idx_pc_status_order` (`status`, `order_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. ws_image_notification (ImageNotification) ─────────────────────────────
-- Mongo ws_image_notifications: image, redirectUrl, active. NO timestamps
-- (model has timestamps:false).
CREATE TABLE IF NOT EXISTS `ws_image_notification` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `image`        VARCHAR(512) NOT NULL,
  `redirect_url` VARCHAR(512) NULL,
  `active`       TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_in_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. ALTER ws_package — add package_category_id (additive, prod-safe) ───────
-- ws_package had NO category linkage; PackageCategory listing counts packages
-- per category. Nullable INT FK to ws_package_category.id (sentinel-tolerant,
-- no hard constraint). Backfilled from Mongo by package name + category slug.
ALTER TABLE `ws_package`
  ADD COLUMN `package_category_id` INT NULL AFTER `package_type_id`,
  ADD KEY `idx_pkg_category` (`package_category_id`);
