-- Rank predictor: score a Digialm response sheet against the key printed on the
-- sheet itself, mark by syllabus subject, and rank by shift / category / subject.
--
-- Every column is nullable or defaulted, so an existing paper keeps behaving
-- exactly as it did: admin-uploaded key, no subjects, overall (+ category) rank.
-- Apply this one file by name — NOT `yarn db:migrate` (see docs/rank-predictor.md §7).

ALTER TABLE `ws_ocr_exams`
  ADD COLUMN `key_source`    varchar(16)   NOT NULL DEFAULT 'admin_key' COMMENT 'admin_key = key uploaded by an admin; sheet = correct answers colour-coded on the student''s own sheet; marks_only = no sheet or key, students type their total',
  ADD COLUMN `marks_correct` decimal(10,4) DEFAULT NULL COMMENT 'Marking when scoring against the sheet''s own key; NULL = 1',
  ADD COLUMN `marks_wrong`   decimal(10,4) DEFAULT NULL COMMENT 'Negative marking when scoring against the sheet''s own key; NULL = 0',
  ADD COLUMN `syllabus`      json          DEFAULT NULL COMMENT '[{name, marks?, section?, from_question?, to_question?}]; NULL/empty = subjects are the sections printed on the sheet',
  ADD COLUMN `rank_by`       json          DEFAULT NULL COMMENT 'Breakdowns switched on: any of shift, category, subject. NULL = legacy (category only)',
  ALGORITHM=INSTANT;

ALTER TABLE `ws_ocr_submissions`
  ADD COLUMN `shift_key`     varchar(16) DEFAULT NULL COMMENT 'Slot the sheet was sat in, YYYY-MM-DDTHH:MM, read off the sheet',
  ADD COLUMN `candidate`     json        DEFAULT NULL COMMENT 'Header read from the sheet: participant id, name, centre, date, time',
  ADD COLUMN `question_meta` json        DEFAULT NULL COMMENT 'Per-question detail from the sheet: section, question/option ids, the sheet''s correct option',
  ADD COLUMN `entry_mode`    varchar(8)  NOT NULL DEFAULT 'sheet' COMMENT 'sheet = scored from an uploaded response sheet; marks = the student typed their total (self-reported, never re-marked)',
  ALGORITHM=INSTANT;

-- A sheet scored against its own key has no admin key row to point at.
ALTER TABLE `ws_ocr_scores`
  MODIFY COLUMN `answer_key_id` bigint unsigned NULL,
  ADD COLUMN `shift_key` varchar(16) DEFAULT NULL COMMENT 'Copied from the submission so a shift rank is one indexed count',
  ADD KEY `idx_ocr_scores_shift` (`exam_id`,`shift_key`,`raw_score`);

CREATE TABLE IF NOT EXISTS `ws_ocr_subject_scores` (
  `score_id`   bigint unsigned NOT NULL,
  `exam_id`    bigint unsigned NOT NULL,
  `subject`    varchar(100)    NOT NULL,
  `position`   int             NOT NULL DEFAULT '0' COMMENT 'Order the subject has on the paper / syllabus',
  `correct`    int             NOT NULL,
  `wrong`      int             NOT NULL,
  `unanswered` int             NOT NULL,
  `score`      decimal(10,4)   NOT NULL,
  `max_marks`  decimal(10,4)   NOT NULL,
  PRIMARY KEY (`score_id`,`subject`),
  KEY `idx_ocr_subject_scores_board` (`exam_id`,`subject`,`score`),
  CONSTRAINT `fk_ocr_subject_scores_score` FOREIGN KEY (`score_id`)
    REFERENCES `ws_ocr_scores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
