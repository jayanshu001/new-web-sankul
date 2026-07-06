-- admin-auth: admin JWT/refresh token store (ws_admin_access_tokens).
-- This table shipped in the legacy MySQL dump, so it was never given its own
-- DDL. Databases imported from a partial/older dump are missing it, which
-- breaks admin login at adminAccessToken.create() (P2021: table does not exist).
-- Mirrors ws_promoter_access_tokens / ws_educator_access_tokens and the Prisma
-- model AdminAccessToken. Additive, prod-safe, idempotent — run once.
CREATE TABLE IF NOT EXISTS `ws_admin_access_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `admin_user_id` BIGINT UNSIGNED NOT NULL,
  `token` TEXT NOT NULL,
  `refresh_token` TEXT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_admin_user_id` (`admin_user_id`),
  KEY `idx_active_deleted` (`active`, `deleted`),
  CONSTRAINT `fk_admin_access_tokens_user`
    FOREIGN KEY (`admin_user_id`) REFERENCES `ws_users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
