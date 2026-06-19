-- 2026-06-19 — C8: permission categories. The admin-UI Permission model (Mongo
-- collection ws_permissions) added `categoryId` on top of the Laravel spatie
-- permissions row; the categories live in a net-new table. So:
--   1) net-new ws_permission_category
--   2) ws_permissions ADD category_id  (link + per-category count)
-- Additive, prod-safe.

CREATE TABLE IF NOT EXISTS `ws_permission_category` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `title`      VARCHAR(255) NOT NULL,
  `slug`       VARCHAR(255) NOT NULL,
  `order_by`   INT NOT NULL DEFAULT 0,
  `status`     TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permission_category_slug` (`slug`),
  KEY `idx_permission_category_status_order` (`status`, `order_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `ws_permissions`
  ADD COLUMN `category_id` INT NULL,
  ADD KEY `idx_permissions_category` (`category_id`);
