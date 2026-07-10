-- Exam ↔ ExamCategory many-to-many pivot (production table missing from staging dump).
-- Links ws_exam rows to one or more ws_exam_category rows for catalog/navigation
-- (package/course test tabs, parent-level counts). Complements ws_exam.exam_category_id
-- (single primary/leaf category per exam).
--
-- Schema only — table starts EMPTY. Seed production rows separately:
--   old_db/ws_exam_category_pivot.sql (see EXAM_CATEGORY_PIVOT_API_HANDOFF.md).
--
-- API/query changes are a follow-up (same doc).

CREATE TABLE IF NOT EXISTS `ws_exam_category_pivot` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `exam_id`     INT NOT NULL,
  `category_id` INT NOT NULL,
  `created_at`  TIMESTAMP NULL DEFAULT NULL,
  `updated_at`  TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ws_exam_category_pivot_exam_id_category_id_unique` (`exam_id`, `category_id`),
  KEY `ws_exam_category_pivot_category_id_exam_id_index` (`category_id`, `exam_id`),
  CONSTRAINT `ws_exam_category_pivot_exam_id_foreign`
    FOREIGN KEY (`exam_id`) REFERENCES `ws_exam` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ws_exam_category_pivot_category_id_foreign`
    FOREIGN KEY (`category_id`) REFERENCES `ws_exam_category` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
