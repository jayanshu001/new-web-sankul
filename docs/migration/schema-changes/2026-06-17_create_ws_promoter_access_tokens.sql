-- Wave 1 (promoter-auth): promoter JWT/refresh token store.
-- Mirrors ws_admin_access_tokens / ws_educator_access_tokens. Additive, prod-safe, run once.
CREATE TABLE IF NOT EXISTS `ws_promoter_access_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `promoter_id` BIGINT UNSIGNED NOT NULL,
  `token` TEXT NOT NULL,
  `refresh_token` TEXT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_promoter_id` (`promoter_id`),
  KEY `idx_active_deleted` (`active`, `deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
