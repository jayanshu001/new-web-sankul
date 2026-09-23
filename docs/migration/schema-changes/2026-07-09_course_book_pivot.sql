-- Course ↔ Book pivot for the admin Course-Detail "Material (Book)" tab
-- (the course analogue of the Package → Books tab). Links physical books
-- (ws_book) to a course with a per-course display order. Mirrors
-- ws_exam_category_course. Read-only for now (GET /admin/courses/:id/books);
-- the linking/write flow is a follow-up.
CREATE TABLE IF NOT EXISTS `ws_course_book` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `course_id`  INT NULL,
  `book_id`    INT NULL,
  `order`      INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_course_book_course` (`course_id`),
  KEY `idx_course_book_book` (`book_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
