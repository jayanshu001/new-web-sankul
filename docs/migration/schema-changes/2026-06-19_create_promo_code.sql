-- 2026-06-19 — C5: net-new SQL table for the admin-UI PromoCode system
-- (Mongo collection `ws_promo_codes`, model src/models/course/PromoCode.model.ts).
-- This is the appliesTo/discount promocode model — DISTINCT from the legacy
-- `ws_promocode` (promoter-commission) already on SQL. appliesTo is stored the
-- codebase way: a scalar type column + a JSON id array (mirrors examCountdownIds,
-- scheduleEntries, etc.). VARCHARs (not ENUM) so Prisma maps them as plain String.
--
-- Plan-link percentages (PromotedPackageCourseEbook) and the picker reads are a
-- SEPARATE, larger port — see docs/migration/C4_BLOCKERS_DECISIONS.md (C5 plan).

CREATE TABLE IF NOT EXISTS `ws_promo_code` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `type`            VARCHAR(20)  NOT NULL,                 -- public | private
  `promocode`       VARCHAR(100) NOT NULL,
  `title`           VARCHAR(255) NULL,
  `description`     TEXT NULL,
  `promo_start_at`  DATETIME NULL,
  `promo_expire_at` DATETIME NULL,
  `status`          TINYINT(1) NOT NULL DEFAULT 1,
  `discount_type`   VARCHAR(20)  NOT NULL DEFAULT 'percentage',  -- flat | percentage
  `discount_value`  DECIMAL(10,2) NOT NULL DEFAULT 0,
  `promoter_id`     INT NULL,
  `applies_to_type` VARCHAR(20) NULL,                     -- package|course|liveCourse|ebook|testSeries
  `applies_to_ids`  JSON NULL,                            -- int[] of the targeted entity ids
  `created_at`      DATETIME NULL,
  `updated_at`      DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_promo_code_code`        (`promocode`),
  KEY `idx_promo_code_type_status` (`type`, `status`),
  KEY `idx_promo_code_applies`     (`applies_to_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
