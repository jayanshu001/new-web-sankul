-- 2026-06-19 — net-new SQL tables for lecture notes + audio notes (C1, zero-Mongo
-- push). Per-customer notes pinned to a timestamp inside a video/live-session.
-- customer_id/video_id/live_session_id/course_id are INT (best-effort scalar FKs);
-- live_course_ids[] → JSON. Timestamps nullable (Mongo timestamps:true).

-- ── ws_lecture_note (LectureNote) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_lecture_note` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `customer_id`      INT NOT NULL,
  `lecture_type`     ENUM('recorded','live') NOT NULL,
  `video_id`         INT NULL,
  `live_session_id`  INT NULL,
  `course_id`        INT NULL,
  `live_course_ids`  JSON NULL,
  `timestamp_sec`    INT NOT NULL DEFAULT 0,
  `content`          TEXT NOT NULL,
  `created_at`       DATETIME NULL,
  `updated_at`       DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ln_cust_video`   (`customer_id`, `video_id`, `timestamp_sec`),
  KEY `idx_ln_cust_session` (`customer_id`, `live_session_id`, `timestamp_sec`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ws_lecture_audio_note (LectureAudioNote) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_lecture_audio_note` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `customer_id`      INT NOT NULL,
  `lecture_type`     ENUM('recorded','live') NOT NULL,
  `video_id`         INT NULL,
  `live_session_id`  INT NULL,
  `course_id`        INT NULL,
  `live_course_ids`  JSON NULL,
  `timestamp_sec`    INT NOT NULL DEFAULT 0,
  `title`            VARCHAR(200) NULL,
  `audio_url`        VARCHAR(1000) NOT NULL,
  `audio_key`        VARCHAR(1000) NOT NULL,
  `mime_type`        VARCHAR(100) NULL,
  `size_bytes`       INT NULL,
  `duration_sec`     INT NULL,
  `created_at`       DATETIME NULL,
  `updated_at`       DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_lan_cust_video`   (`customer_id`, `video_id`, `timestamp_sec`),
  KEY `idx_lan_cust_session` (`customer_id`, `live_session_id`, `timestamp_sec`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
