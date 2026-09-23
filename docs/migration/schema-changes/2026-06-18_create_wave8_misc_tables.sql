-- Wave 8 — net-new SQL tables + ALTERs for the misc/low-value modules.
-- Conventions match Wave 7: INT PKs; FKs to other tables are plain INT columns
-- (no hard FK constraint, tolerating 0/null sentinels); embedded arrays → JSON;
-- timestamps nullable to mirror Mongo timestamps:true. New tables use the
-- SINGULAR ws_<name> mapping (the live Mongo collections are plural, so the
-- migration reads/writes go to these fresh singular tables).

-- ── 1. ws_activity_log (tracking / ActivityLog) ──────────────────────────────
-- Mongo ws_activity_log: customerId, event, entityType, entityId, duration,
-- metadata(Mixed→JSON), ip, userAgent. customer_id/entity_id are INT (best-effort).
CREATE TABLE IF NOT EXISTS `ws_activity_log` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NULL,
  `event`       VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(50) NULL,
  `entity_id`   INT NULL,
  `duration`    INT NULL,
  `metadata`    JSON NULL,
  `ip`          VARCHAR(100) NULL,
  `user_agent`  VARCHAR(500) NULL,
  `created_at`  DATETIME NULL,
  `updated_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_al_event_created`    (`event`, `created_at`),
  KEY `idx_al_customer_created` (`customer_id`, `created_at`),
  KEY `idx_al_created`          (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. ws_goal (Goal) ────────────────────────────────────────────────────────
-- Mongo ws_goals: title, labels[{_id,name}]→JSON, image, isActive.
CREATE TABLE IF NOT EXISTS `ws_goal` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `title`      VARCHAR(255) NOT NULL,
  `labels`     JSON NULL,                 -- [{ name }] (embedded array)
  `image`      VARCHAR(512) NULL,
  `is_active`  TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_goal_active` (`is_active`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. ws_social_link_type (SocialLinkType) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_social_link_type` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `title`      VARCHAR(255) NOT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_slt_title` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. ws_social_link (SocialLink) ───────────────────────────────────────────
-- type_id → ws_social_link_type (plain INT, no hard FK).
CREATE TABLE IF NOT EXISTS `ws_social_link` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `type_id`    INT NOT NULL,
  `title`      VARCHAR(255) NOT NULL,
  `icon`       VARCHAR(500) NULL,
  `link`       VARCHAR(500) NOT NULL,
  `order_by`   INT NOT NULL DEFAULT 0,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sl_status_order` (`status`, `order_by`),
  KEY `idx_sl_type`         (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. ws_current_affair (CurrentAffair) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_current_affair` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `title`        VARCHAR(255) NOT NULL,
  `image`        VARCHAR(512) NOT NULL,
  `youtube_link` VARCHAR(512) NOT NULL,
  `status`       TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`   DATETIME NULL,
  `updated_at`   DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ca_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 6. ws_live_banner_slider (LiveBannerSlider) ──────────────────────────────
-- live_course_id → ws_live_course (plain INT, no hard FK). order_by drives the
-- list sort + reorder endpoint.
CREATE TABLE IF NOT EXISTS `ws_live_banner_slider` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `image`          VARCHAR(512) NOT NULL,
  `live_course_id` INT NOT NULL,
  `order_by`       INT NOT NULL DEFAULT 0,
  `created_at`     DATETIME NULL,
  `updated_at`     DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lbs_order`      (`order_by`),
  KEY `idx_lbs_livecourse` (`live_course_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 7. ALTER ws_website_inquiry (Inquiry) — add the 4 missing cols ───────────
-- The legacy table has name/mobile/email/city/course/mode only. Add the
-- customer link + description + message + source the Mongo model & admin reads
-- use. Existing NOT-NULL cols (name/mobile/email/city) are made nullable since
-- modern app rows only carry customer_id + description.
-- NB: this table's timestamp cols are `createdAt`/`updatedAt` (camelCase, no
-- snake mapping) — the index below references the real column name.
ALTER TABLE `ws_website_inquiry`
  ADD COLUMN `customer_id` INT NULL AFTER `id`,
  ADD COLUMN `description` VARCHAR(2000) NULL AFTER `customer_id`,
  ADD COLUMN `message`     VARCHAR(2000) NULL,
  ADD COLUMN `source`      VARCHAR(50) NULL DEFAULT 'app',
  MODIFY COLUMN `name`   VARCHAR(255) NULL,
  MODIFY COLUMN `mobile` VARCHAR(20) NULL,
  MODIFY COLUMN `email`  VARCHAR(255) NULL,
  MODIFY COLUMN `city`   VARCHAR(100) NULL,
  ADD KEY `idx_inq_customer` (`customer_id`),
  ADD KEY `idx_inq_created`  (`createdAt`);

-- ── 8. ALTER ws_offline_banner_slider — add order_by (sort + reorder) ────────
ALTER TABLE `ws_offline_banner_slider`
  ADD COLUMN `order_by` INT NOT NULL DEFAULT 0 AFTER `key_id`,
  ADD KEY `idx_obs_order` (`order_by`);
