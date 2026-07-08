-- 2026-07-08 — Layer-2 enrollment resume pointer
--
-- Fixes: dashboard/resume + learning/progress/my resume cards mirrored each other
-- for videos shared across a course and a package, because ws_lecture_progress is
-- UNIQUE per (customer_id, video_id) and can hold only one last_watched_at.
--
-- This table stores a SEPARATE "last watched lecture" pointer per enrollment
-- (customer_id, scope_kind, scope_id). Video playback position stays global in
-- ws_lecture_progress; only the resume pointer is enrollment-scoped.
--
-- Prisma model: EnrollmentResume  (see prisma/schema.prisma)

CREATE TABLE IF NOT EXISTS `ws_enrollment_resume` (
  `id`               INT           NOT NULL AUTO_INCREMENT,
  `customer_id`      INT           NOT NULL,
  `scope_kind`       VARCHAR(191)  NOT NULL,  -- "course" | "package" | "liveCourse"
  `scope_id`         INT           NOT NULL,
  `video_id`         INT           NULL,
  `live_session_id`  INT           NULL,
  `last_watched_at`  DATETIME(0)   NULL,
  `created_at`       DATETIME(0)   NULL,
  `updated_at`       DATETIME(0)   NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_customer_scope` (`customer_id`, `scope_kind`, `scope_id`),
  KEY `idx_enrollment_resume_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Best-effort backfill from existing progress rows so returning users keep their
-- resume cards on day one. Old rows can't disambiguate which scope a shared video
-- was watched under (course_id + package_id may both be stamped on one row), so
-- this seeds a pointer per stamped container using that row's last_watched_at;
-- going-forward scoped heartbeats then correct each pointer independently.
-- Run scripts/backfill-enrollment-resume.ts instead of hand-running SQL if you
-- want the exact same collapse semantics as the app.
