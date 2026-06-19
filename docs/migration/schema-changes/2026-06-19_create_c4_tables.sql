-- 2026-06-19 — net-new SQL tables for C4 (zero-Mongo push). All FK-ish columns
-- are INT best-effort scalars (no hard FK), matching the rest of the migrated
-- schema. Timestamps nullable (Mongoose timestamps:true). Idempotent.
--
-- Unblocks:
--   ws_test_series_content_category + ws_test_series_exam → test-series detail + papers
--   ws_wishlist                                           → client wishlist
--
-- After applying: add the Prisma models (already in prisma/schema.prisma), run
-- `yarn prisma:generate`, backfill (scripts/backfill-c4-*.ts), then flip the flags.

-- ── ws_test_series_content_category (TestSeriesContentCategory) ──────────────
-- Series-scoped "Test Content" tab rows. Flat list per series.
CREATE TABLE IF NOT EXISTS `ws_test_series_content_category` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `test_series_id` INT NOT NULL,
  `name`           VARCHAR(255) NOT NULL,
  `icon`           VARCHAR(500) NULL,
  `order_by`       INT NOT NULL DEFAULT 0,
  `status`         TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`     DATETIME NULL,
  `updated_at`     DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tscc_series_status_order` (`test_series_id`, `status`, `order_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ws_test_series_exam (TestSeriesExam) ────────────────────────────────────
-- One row per paper inside a series. (test_series_id, exam_id) is unique.
CREATE TABLE IF NOT EXISTS `ws_test_series_exam` (
  `id`                  INT NOT NULL AUTO_INCREMENT,
  `test_series_id`      INT NOT NULL,
  `content_category_id` INT NOT NULL,
  `exam_id`             INT NOT NULL,
  `order_by`            INT NOT NULL DEFAULT 0,
  `status`              TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`          DATETIME NULL,
  `updated_at`          DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tse_series_exam` (`test_series_id`, `exam_id`),
  KEY `idx_tse_series_cat_order` (`test_series_id`, `content_category_id`, `order_by`),
  KEY `idx_tse_exam` (`exam_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ws_wishlist (Wishlist) ──────────────────────────────────────────────────
-- Per-customer saved items across 4 entity types. (customer_id,item_type,item_id)
-- is unique so a re-add is a no-op (mirrors the Mongo upsert-ish behaviour).
CREATE TABLE IF NOT EXISTS `ws_wishlist` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `customer_id` INT NOT NULL,
  `item_type`   ENUM('course','package','ebook','book') NOT NULL,
  `item_id`     INT NOT NULL,
  `created_at`  DATETIME NULL,
  `updated_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wishlist_cust_item` (`customer_id`, `item_type`, `item_id`),
  KEY `idx_wishlist_cust_type` (`customer_id`, `item_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
