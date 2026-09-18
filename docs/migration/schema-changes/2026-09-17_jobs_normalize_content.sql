-- 2026-09-17 — Jobs Management: normalize wsj_contents card/detail JSON into
-- relational tables
--
-- WHY. wsj_contents (job/result/admit_card/answer_key/syllabus/other/
-- exam_calendar) currently packs every type-specific field into two JSON
-- columns (`card`, `detail`), SEO only exists inside detail.seo for the `job`
-- type, categories are effectively single-select despite a multi-select admin
-- UI, and wsj_previous_papers.pdf_url is a plain-URL-or-JSON-array string in
-- one VARCHAR column. The new admin (websankul-backend + websankul-admin)
-- replaces this with typed columns, a real many-to-many category join, a
-- shared media table, and ordered child tables for every repeater. Full
-- old -> new field mapping: docs/migration/JOBS_NORMALIZATION.md
--
-- NOTHING IS DROPPED OR RENAMED. This file only creates new tables and adds
-- four nullable FK columns to existing tables. `card`, `detail`, `pdf_url`,
-- `job_ids`, `recruitment_id`, `logo_url`, `logo_alt`, `preview_url` are left
-- in place — a separate follow-up migration drops them once
-- scripts/backfill-jobs-normalize.ts has been run and verified.
--
-- SAFE TO APPLY BEFORE THE CODE. Every new FK column is nullable with no
-- default; no existing read/write path references any table or column below
-- until the jobs-* backend modules are deployed.
--
-- All new tables match the existing wsj_* convention: InnoDB,
-- utf8mb4/utf8mb4_unicode_ci, unsigned bigint surrogate keys, cascade-delete
-- from the owning wsj_contents/wsj_previous_papers row (same pattern already
-- used by wsj_previous_paper_tags -> wsj_previous_papers).

-- ---------------------------------------------------------------------------
-- Shared media table. Replaces bare *_url/*_alt string columns with a
-- reusable asset row (alt text, dimensions) referenced from organizations,
-- categories, content, previous papers and SEO OG images.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wsj_media` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `url`         VARCHAR(1000)   NOT NULL,
  `alt_text`    VARCHAR(255)    DEFAULT NULL,
  `width`       INT UNSIGNED    DEFAULT NULL,
  `height`      INT UNSIGNED    DEFAULT NULL,
  `mime_type`   VARCHAR(100)    DEFAULT NULL,
  `size_bytes`  INT UNSIGNED    DEFAULT NULL,
  `uploaded_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Real many-to-many category join, replacing wsj_contents.category_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wsj_content_categories` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT UNSIGNED NOT NULL,
  `category_id` BIGINT UNSIGNED NOT NULL,
  `sort_order`  INT             NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wsj_content_categories` (`content_id`, `category_id`),
  KEY `idx_wsj_content_categories_category` (`category_id`),
  CONSTRAINT `fk_wsj_content_categories_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wsj_content_categories_category`
    FOREIGN KEY (`category_id`) REFERENCES `wsj_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- SEO, uniform across all 7 content types (today only `job` has detail.seo).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wsj_content_seo` (
  `content_id`        BIGINT UNSIGNED NOT NULL,
  `seo_title`         VARCHAR(255) DEFAULT NULL,
  `meta_description`  VARCHAR(500) DEFAULT NULL,
  `meta_keywords`      VARCHAR(500) DEFAULT NULL,
  `canonical_url`      VARCHAR(500) DEFAULT NULL,
  `og_title`           VARCHAR(255) DEFAULT NULL,
  `og_description`     VARCHAR(500) DEFAULT NULL,
  `og_image_id`        BIGINT UNSIGNED DEFAULT NULL,
  `schema_type`        VARCHAR(50)  DEFAULT NULL,
  `robots_index`       TINYINT(1)   NOT NULL DEFAULT 1,
  `robots_follow`      TINYINT(1)   NOT NULL DEFAULT 1,
  `focus_keyword`      VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  KEY `idx_wsj_content_seo_og_image` (`og_image_id`),
  CONSTRAINT `fk_wsj_content_seo_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wsj_content_seo_og_image`
    FOREIGN KEY (`og_image_id`) REFERENCES `wsj_media` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Per-type detail tables, 1:1 on content_id. Replaces the freeform card/
-- detail JSON keys documented per type in docs/migration/JOBS_NORMALIZATION.md.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wsj_job_details` (
  `content_id`                 BIGINT UNSIGNED NOT NULL,
  `application_start`          DATE         DEFAULT NULL,
  `application_end`            DATE         DEFAULT NULL,
  `location`                   VARCHAR(255) DEFAULT NULL,
  `qualification`               VARCHAR(255) DEFAULT NULL,
  `excerpt`                     VARCHAR(500) DEFAULT NULL,
  `total_posts`                 VARCHAR(100) DEFAULT NULL,
  `apply_url`                   VARCHAR(1000) DEFAULT NULL,
  `official_notification_url`   VARCHAR(1000) DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  CONSTRAINT `fk_wsj_job_details_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_admit_card_details` (
  `content_id`       BIGINT UNSIGNED NOT NULL,
  `tier_label`        VARCHAR(100) DEFAULT NULL,
  `released_at`        DATE DEFAULT NULL,
  `exam_date_label`    VARCHAR(255) DEFAULT NULL,
  `release_status`     ENUM('released','coming_soon') NOT NULL DEFAULT 'coming_soon',
  `download_url`       VARCHAR(1000) DEFAULT NULL,
  `notify_url`         VARCHAR(1000) DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  CONSTRAINT `fk_wsj_admit_card_details_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_result_details` (
  `content_id`    BIGINT UNSIGNED NOT NULL,
  `declared_at`    DATE DEFAULT NULL,
  `official_url`   VARCHAR(1000) DEFAULT NULL,
  `download_url`   VARCHAR(1000) DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  CONSTRAINT `fk_wsj_result_details_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_answer_key_details` (
  `content_id`    BIGINT UNSIGNED NOT NULL,
  `key_status`     ENUM('final','provisional') NOT NULL DEFAULT 'provisional',
  `released_at`    DATE DEFAULT NULL,
  `download_url`   VARCHAR(1000) DEFAULT NULL,
  `tags`           JSON DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  CONSTRAINT `fk_wsj_answer_key_details_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_other_details` (
  `content_id`  BIGINT UNSIGNED NOT NULL,
  `summary`      TEXT DEFAULT NULL,
  `tags`         JSON DEFAULT NULL,
  `card_meta`    JSON DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  CONSTRAINT `fk_wsj_other_details_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_exam_calendar_details` (
  `content_id`         BIGINT UNSIGNED NOT NULL,
  `exam_date`           DATE DEFAULT NULL,
  `apply_start_date`    DATE DEFAULT NULL,
  `apply_end_date`      DATE DEFAULT NULL,
  `admit_card_date`     DATE DEFAULT NULL,
  `admit_card_note`     VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  CONSTRAINT `fk_wsj_exam_calendar_details_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_syllabus_details` (
  `content_id`      BIGINT UNSIGNED NOT NULL,
  `subtitle`         VARCHAR(255) DEFAULT NULL,
  `languages`        VARCHAR(255) DEFAULT NULL,
  `sections_count`   INT UNSIGNED DEFAULT NULL,
  `download_url`     VARCHAR(1000) DEFAULT NULL,
  PRIMARY KEY (`content_id`),
  CONSTRAINT `fk_wsj_syllabus_details_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Syllabus stage -> subject -> topic, 3-level nested repeater
-- (replaces the old JSON `stages[]`).
CREATE TABLE IF NOT EXISTS `wsj_syllabus_stages` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`   BIGINT UNSIGNED NOT NULL,
  `stage`        VARCHAR(255) NOT NULL,
  `description`  TEXT DEFAULT NULL,
  `mode`         VARCHAR(100) DEFAULT NULL,
  `medium`       VARCHAR(100) DEFAULT NULL,
  `total_marks`  VARCHAR(50) DEFAULT NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_syllabus_stages_content` (`content_id`),
  CONSTRAINT `fk_wsj_syllabus_stages_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_syllabus_subjects` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `stage_id`    BIGINT UNSIGNED NOT NULL,
  `subject`     VARCHAR(255) NOT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_syllabus_subjects_stage` (`stage_id`),
  CONSTRAINT `fk_wsj_syllabus_subjects_stage`
    FOREIGN KEY (`stage_id`) REFERENCES `wsj_syllabus_stages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_syllabus_topics` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_id`  BIGINT UNSIGNED NOT NULL,
  `topic`       VARCHAR(500) NOT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_syllabus_topics_subject` (`subject_id`),
  CONSTRAINT `fk_wsj_syllabus_topics_subject`
    FOREIGN KEY (`subject_id`) REFERENCES `wsj_syllabus_subjects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Shared repeaters, keyed on content_id. Replace sections[]/card_facts[]/
-- products[]/related_posts[]/steps[]/important_dates[]/application_fees[]/
-- payment_modes[]/notes[] JSON arrays with ordered rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wsj_content_sections` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT UNSIGNED NOT NULL,
  `title`       VARCHAR(255) DEFAULT NULL,
  `block_type`  ENUM('important_dates','table','list','steps','faq','rich_text','custom','related_posts','related_products') NOT NULL,
  `position`    ENUM('main','sidebar') NOT NULL DEFAULT 'main',
  `icon`        VARCHAR(50) DEFAULT NULL,
  `is_visible`  TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_sections_content` (`content_id`, `sort_order`),
  CONSTRAINT `fk_wsj_content_sections_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_content_section_items` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `section_id`  BIGINT UNSIGNED NOT NULL,
  `icon`        VARCHAR(50) DEFAULT NULL,
  `title`       VARCHAR(255) DEFAULT NULL,
  `value`       VARCHAR(1000) DEFAULT NULL,
  `extra`       TEXT DEFAULT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_section_items_section` (`section_id`, `sort_order`),
  CONSTRAINT `fk_wsj_content_section_items_section`
    FOREIGN KEY (`section_id`) REFERENCES `wsj_content_sections` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_content_facts` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT UNSIGNED NOT NULL,
  `icon`        VARCHAR(50) DEFAULT NULL,
  `meta_key`    VARCHAR(100) DEFAULT NULL,
  `meta_value`  VARCHAR(255) DEFAULT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_facts_content` (`content_id`, `sort_order`),
  CONSTRAINT `fk_wsj_content_facts_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attached catalog cross-sell. Reused by BOTH wsj_contents and
-- wsj_previous_papers — exactly one of content_id/paper_id is set per row
-- (enforced in the service layer; MySQL has no partial-unique/check support
-- via Prisma).
CREATE TABLE IF NOT EXISTS `wsj_content_products` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`    BIGINT UNSIGNED DEFAULT NULL,
  `paper_id`      BIGINT UNSIGNED DEFAULT NULL,
  `product_type`  ENUM('course','package','book','ebook') NOT NULL,
  `product_id`    BIGINT UNSIGNED NOT NULL,
  `is_featured`   TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order`    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_products_content` (`content_id`),
  KEY `idx_wsj_content_products_paper` (`paper_id`),
  CONSTRAINT `fk_wsj_content_products_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wsj_content_products_paper`
    FOREIGN KEY (`paper_id`) REFERENCES `wsj_previous_papers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_content_related_posts` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`          BIGINT UNSIGNED NOT NULL,
  `related_content_id`  BIGINT UNSIGNED NOT NULL,
  `sort_order`          INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wsj_content_related_posts` (`content_id`, `related_content_id`),
  KEY `idx_wsj_content_related_posts_related` (`related_content_id`),
  CONSTRAINT `fk_wsj_content_related_posts_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wsj_content_related_posts_related`
    FOREIGN KEY (`related_content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generic ordered step list. step_group tells the reader which of job's
-- selection_process / admit-card's download_steps / result's
-- how_to_check_steps / answer-key's objection_steps a row belongs to.
CREATE TABLE IF NOT EXISTS `wsj_content_steps` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`   BIGINT UNSIGNED NOT NULL,
  `step_group`   ENUM('selection_process','download_steps','how_to_check_steps','objection_steps') NOT NULL,
  `title`        VARCHAR(255) DEFAULT NULL,
  `description`  TEXT DEFAULT NULL,
  `sort_order`   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_steps_content` (`content_id`, `step_group`),
  CONSTRAINT `fk_wsj_content_steps_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_content_date_items` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT UNSIGNED NOT NULL,
  `label`       VARCHAR(255) NOT NULL,
  `date_value`  DATE DEFAULT NULL,
  `note`        VARCHAR(500) DEFAULT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_date_items_content` (`content_id`, `sort_order`),
  CONSTRAINT `fk_wsj_content_date_items_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_content_fee_items` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`      BIGINT UNSIGNED NOT NULL,
  `category_label`  VARCHAR(255) NOT NULL,
  `amount_label`    VARCHAR(100) NOT NULL,
  `sort_order`      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_fee_items_content` (`content_id`, `sort_order`),
  CONSTRAINT `fk_wsj_content_fee_items_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_content_payment_modes` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT UNSIGNED NOT NULL,
  `label`       VARCHAR(100) NOT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_payment_modes_content` (`content_id`, `sort_order`),
  CONSTRAINT `fk_wsj_content_payment_modes_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_content_notes` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content_id`  BIGINT UNSIGNED NOT NULL,
  `text`        VARCHAR(1000) NOT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_content_notes_content` (`content_id`, `sort_order`),
  CONSTRAINT `fk_wsj_content_notes_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Previous papers: replace the pdf_url URL-or-JSON-array hack and the
-- job_ids JSON array with real ordered/join tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wsj_previous_paper_files` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`    BIGINT UNSIGNED NOT NULL,
  `label`       VARCHAR(255) DEFAULT NULL,
  `url`         VARCHAR(1000) NOT NULL,
  `sort_order`  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_wsj_previous_paper_files_paper` (`paper_id`),
  CONSTRAINT `fk_wsj_previous_paper_files_paper`
    FOREIGN KEY (`paper_id`) REFERENCES `wsj_previous_papers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wsj_previous_paper_job_links` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`    BIGINT UNSIGNED NOT NULL,
  `content_id`  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wsj_previous_paper_job_links` (`paper_id`, `content_id`),
  KEY `idx_wsj_previous_paper_job_links_content` (`content_id`),
  CONSTRAINT `fk_wsj_previous_paper_job_links_paper`
    FOREIGN KEY (`paper_id`) REFERENCES `wsj_previous_papers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wsj_previous_paper_job_links_content`
    FOREIGN KEY (`content_id`) REFERENCES `wsj_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Additive FK columns on existing tables, all nullable — replace bare URL
-- strings with a Media reference. Old *_url/*_alt columns are left in place
-- (see header note).
-- ---------------------------------------------------------------------------
ALTER TABLE `wsj_contents`
  ADD COLUMN `featured_image_id` BIGINT UNSIGNED NULL AFTER `body_html`,
  ADD CONSTRAINT `fk_wsj_contents_featured_image`
    FOREIGN KEY (`featured_image_id`) REFERENCES `wsj_media` (`id`) ON DELETE SET NULL;

ALTER TABLE `wsj_organizations`
  ADD COLUMN `logo_media_id` BIGINT UNSIGNED NULL AFTER `logo_alt`,
  ADD CONSTRAINT `fk_wsj_organizations_logo_media`
    FOREIGN KEY (`logo_media_id`) REFERENCES `wsj_media` (`id`) ON DELETE SET NULL;

ALTER TABLE `wsj_categories`
  ADD COLUMN `image_media_id` BIGINT UNSIGNED NULL AFTER `image_alt`,
  ADD CONSTRAINT `fk_wsj_categories_image_media`
    FOREIGN KEY (`image_media_id`) REFERENCES `wsj_media` (`id`) ON DELETE SET NULL;

ALTER TABLE `wsj_previous_papers`
  ADD COLUMN `preview_media_id` BIGINT UNSIGNED NULL AFTER `preview_url`,
  ADD CONSTRAINT `fk_wsj_previous_papers_preview_media`
    FOREIGN KEY (`preview_media_id`) REFERENCES `wsj_media` (`id`) ON DELETE SET NULL;
