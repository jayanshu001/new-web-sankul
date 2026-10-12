-- Rank predictor: what to suggest to a student next, by the marks they scored.
--
-- One row per suggestion per paper. A row applies when
--   (min_marks IS NULL OR raw_score >= min_marks) AND (max_marks IS NULL OR raw_score < max_marks)
-- and points either at a store product (`kind = 'product'`: product_type + product_id)
-- or at any https page (`kind = 'link'`: url + title + image, the image a public
-- Spaces URL under uploads/rank-suggestions).
--
-- New table only — nothing existing is altered. Deleting a paper removes its
-- suggestions through the foreign key.
-- Apply this one file by name — NOT `yarn db:migrate` (see docs/rank-predictor.md §7).

CREATE TABLE IF NOT EXISTS `ws_ocr_suggestions` (
  `id`           bigint unsigned NOT NULL AUTO_INCREMENT,
  `exam_id`      bigint unsigned NOT NULL,
  `kind`         varchar(16)     NOT NULL COMMENT 'product | link',
  `product_type` varchar(16)     DEFAULT NULL COMMENT 'package | course | live_course | book | ebook',
  `product_id`   bigint unsigned DEFAULT NULL,
  `url`          varchar(2048)   DEFAULT NULL,
  `title`        varchar(255)    DEFAULT NULL,
  `image`        varchar(1000)   DEFAULT NULL COMMENT 'required for a link',
  `description`  varchar(500)    DEFAULT NULL,
  `cta_label`    varchar(60)     DEFAULT NULL,
  `min_marks`    decimal(10,4)   DEFAULT NULL COMMENT 'inclusive; NULL = no lower bound',
  `max_marks`    decimal(10,4)   DEFAULT NULL COMMENT 'exclusive; NULL = no upper bound',
  `sort_order`   int             NOT NULL DEFAULT '0',
  `is_active`    tinyint(1)      NOT NULL DEFAULT '1',
  `created_at`   timestamp       NULL DEFAULT NULL,
  `updated_at`   timestamp       NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ocr_suggestions_exam` (`exam_id`,`is_active`,`sort_order`),
  CONSTRAINT `fk_ocr_suggestions_exam` FOREIGN KEY (`exam_id`)
    REFERENCES `ws_ocr_exams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
