-- ─────────────────────────────────────────────────────────────────────────────
-- Wave 6 — LiveCourse / LiveSession SQL tables (additive; CREATE IF NOT EXISTS).
-- Mirrors the live MongoDB collections (see LIVE_COURSE_DESIGN.md, signed off
-- 2026-06-18). ObjectId → INT AUTO_INCREMENT; embedded arrays → JSON or child
-- tables; sessions↔courses is many-to-many (join table). All ids surfaced as
-- strings by the modules (like every other migrated table). Backfilled from
-- Mongo by scripts/backfill-live-course-to-sql.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. ws_live_course (core) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_course (
  id                           INT NOT NULL AUTO_INCREMENT,
  name                         VARCHAR(255) NOT NULL,
  subtitle                     VARCHAR(255) NULL,
  description                  TEXT NULL,
  image                        VARCHAR(500) NULL,
  ordered                      INT NOT NULL DEFAULT 0,
  shareable_link               VARCHAR(500) NULL,
  with_material                TEXT NULL,
  without_material             TEXT NULL,
  level                        VARCHAR(50) NULL,
  class_type                   VARCHAR(20) NOT NULL DEFAULT 'live',
  status                       TINYINT(1) NOT NULL DEFAULT 1,
  is_paid                      TINYINT(1) NOT NULL DEFAULT 1,
  is_popular                   TINYINT(1) NOT NULL DEFAULT 0,
  educator_id                  INT NULL,
  course_subject_category_id   INT NULL,
  video_category_id            INT NULL,
  package_category_id          INT NULL,
  created_by                   INT NULL,
  start_time                   DATETIME NULL,
  schedule_entries             JSON NULL,
  schedule_folders             JSON NULL,
  timetable_files              JSON NULL,
  exam_countdown_category_ids  JSON NULL,
  exam_countdown_ids           JSON NULL,
  created_at                   TIMESTAMP NULL,
  updated_at                   TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lc_status_ordered (status, ordered),
  KEY idx_lc_subject (course_subject_category_id),
  KEY idx_lc_vcat (video_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. ws_live_course_plan ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_course_plan (
  id              INT NOT NULL AUTO_INCREMENT,
  live_course_id  INT NOT NULL,
  name            VARCHAR(255) NULL,
  duration        INT NOT NULL,            -- ⚠ MONTHS (not DAYS) — see DESIGN §3
  price           INT NOT NULL,
  original_price  INT NULL,
  is_default      TINYINT(1) NOT NULL DEFAULT 0,
  status          TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NULL,
  updated_at      TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lcp_course_status (live_course_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. ws_live_course_subscription ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_course_subscription (
  id                  INT NOT NULL AUTO_INCREMENT,
  customer_id         INT NOT NULL,
  live_course_id      INT NOT NULL,
  plan_id             INT NULL,
  start_at            DATETIME NULL,
  end_at              DATETIME NULL,
  status              TINYINT(1) NOT NULL DEFAULT 1,
  promocode_id        INT NULL,
  original_amount     INT NULL,
  discount_amount     INT NULL,
  paid_amount         INT NULL,
  payment_status      VARCHAR(20) NULL,
  razorpay_order_id   VARCHAR(255) NULL,
  razorpay_payment_id VARCHAR(255) NULL,
  paid_at             DATETIME NULL,
  created_at          TIMESTAMP NULL,
  updated_at          TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lcs_customer_course (customer_id, live_course_id),
  KEY idx_lcs_course_status (live_course_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. ws_live_session + ws_live_session_course (many-to-many) ────────────────────
CREATE TABLE IF NOT EXISTS ws_live_session (
  id                          INT NOT NULL AUTO_INCREMENT,
  title                       VARCHAR(255) NULL,
  subject                     VARCHAR(255) NULL,
  educator_id                 INT NULL,
  scheduled_at                DATETIME NULL,
  end_at                      DATETIME NULL,
  status                      VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  stream_id                   VARCHAR(100) NULL,
  rtmp_url                    VARCHAR(500) NULL,
  hls_url                     VARCHAR(500) NULL,
  hls_urls                    JSON NULL,
  recordings                  JSON NULL,
  recording_target_folder_id  INT NULL,
  created_at                  TIMESTAMP NULL,
  updated_at                  TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_ls_status_sched (status, scheduled_at),
  KEY idx_ls_stream (stream_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ws_live_session_course (
  id              INT NOT NULL AUTO_INCREMENT,
  live_session_id INT NOT NULL,
  live_course_id  INT NOT NULL,
  created_at      TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lsc (live_session_id, live_course_id),
  KEY idx_lsc_course (live_course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. ws_live_course_category (thin master; currently empty in Mongo) ────────────
CREATE TABLE IF NOT EXISTS ws_live_course_category (
  id          INT NOT NULL AUTO_INCREMENT,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) NULL,
  image       VARCHAR(500) NULL,
  parent      INT NOT NULL DEFAULT 0,
  order_by    INT NOT NULL DEFAULT 0,
  status      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NULL,
  updated_at  TIMESTAMP NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. ws_live_chat_message ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_chat_message (
  id            INT NOT NULL AUTO_INCREMENT,
  live_class_id VARCHAR(100) NOT NULL,    -- string room key (NOT a session FK)
  customer_id   INT NULL,
  admin_id      INT NULL,
  is_admin      TINYINT(1) NOT NULL DEFAULT 0,
  user_name     VARCHAR(255) NULL,
  message       TEXT NULL,
  deleted_at    DATETIME NULL,
  deleted_by    INT NULL,
  created_at    TIMESTAMP NULL,
  updated_at    TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lcm_class (live_class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. ws_live_chat_ban (empty in Mongo; from model) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_chat_ban (
  id            INT NOT NULL AUTO_INCREMENT,
  live_class_id VARCHAR(100) NOT NULL,
  customer_id   INT NULL,
  banned_by     INT NULL,
  reason        VARCHAR(255) NULL,
  created_at    TIMESTAMP NULL,
  updated_at    TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lcb_class (live_class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. ws_live_poll + ws_live_poll_option (embedded options[] → child) ────────────
CREATE TABLE IF NOT EXISTS ws_live_poll (
  id              INT NOT NULL AUTO_INCREMENT,
  live_class_id   VARCHAR(100) NOT NULL,
  question        VARCHAR(500) NOT NULL,
  total_votes     INT NOT NULL DEFAULT 0,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by      INT NULL,
  created_by_name VARCHAR(255) NULL,
  closed_at       DATETIME NULL,
  created_at      TIMESTAMP NULL,
  updated_at      TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lp_class (live_class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ws_live_poll_option (
  id           INT NOT NULL AUTO_INCREMENT,
  poll_id      INT NOT NULL,
  option_index INT NOT NULL,
  text         VARCHAR(255) NULL,
  votes        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_lpo_poll (poll_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. ws_live_poll_vote ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_poll_vote (
  id           INT NOT NULL AUTO_INCREMENT,
  poll_id      INT NOT NULL,
  customer_id  INT NOT NULL,
  option_index INT NOT NULL,
  created_at   TIMESTAMP NULL,
  updated_at   TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lpv (poll_id, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. ws_live_session_attendance ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_session_attendance (
  id              INT NOT NULL AUTO_INCREMENT,
  stream_id       VARCHAR(100) NULL,
  live_session_id INT NULL,
  customer_id     INT NULL,
  user_name       VARCHAR(255) NULL,
  joined_at       DATETIME NULL,
  left_at         DATETIME NULL,
  duration_sec    INT NULL,
  created_at      TIMESTAMP NULL,
  updated_at      TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lsa_session (live_session_id),
  KEY idx_lsa_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 11. ws_live_session_reminder (Mongo: livesessionreminders) ────────────────────
CREATE TABLE IF NOT EXISTS ws_live_session_reminder (
  id                   INT NOT NULL AUTO_INCREMENT,
  live_session_id      INT NULL,
  live_course_id       INT NULL,
  customer_id          INT NULL,
  minutes_before       INT NULL,
  notification_id      INT NULL,
  remind_at            DATETIME NULL,
  session_scheduled_at DATETIME NULL,
  status               VARCHAR(20) NULL,
  created_at           TIMESTAMP NULL,
  updated_at           TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lsr_session (live_session_id),
  KEY idx_lsr_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 12. ws_live_session_preview ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ws_live_session_preview (
  id              INT NOT NULL AUTO_INCREMENT,
  live_session_id INT NULL,
  customer_id     INT NULL,
  started_at      DATETIME NULL,
  created_at      TIMESTAMP NULL,
  updated_at      TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_lsp_session (live_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
