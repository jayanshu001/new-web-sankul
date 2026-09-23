-- 2026-06-19 — C8: net-new SQL tables for referral content (admin-managed
-- terms + FAQs shown on the referral screen). Mongo collections
-- ws_referral_terms / ws_referral_faqs. Naming follows the existing SQL referral
-- convention (double-f: ws_refferal_program/transaction). Additive, idempotent.

CREATE TABLE IF NOT EXISTS `ws_refferal_term` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `text`       VARCHAR(1000) NOT NULL,
  `order_by`   INT NOT NULL DEFAULT 0,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_refferal_term_status_order` (`status`, `order_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ws_refferal_faq` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `question`   VARCHAR(500) NOT NULL,
  `answer`     TEXT NOT NULL,
  `order_by`   INT NOT NULL DEFAULT 0,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_refferal_faq_status_order` (`status`, `order_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
