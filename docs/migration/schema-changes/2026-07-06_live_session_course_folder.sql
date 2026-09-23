-- 2026-07-06 — Per-course recording folder selection for live sessions.
--
-- The admin "New live session" flow replaced the single `subject` (which
-- auto-created/looked-up a folder named after it) with an explicit folder
-- picked per linked live course. Recordings are now filed into that exact
-- folder instead of a subject-named one.
--
-- ws_live_session_course is the session <-> course join. We add a nullable
-- `folder_id` so each link also records WHICH ws_video_category folder this
-- session's recordings should be promoted into for that course. NULL = no
-- folder chosen for that course (auto-promotion skips it, best-effort).
--
-- `subject` / `educator_id` columns on ws_live_session are intentionally
-- RETAINED (nullable) for historical data; the app no longer writes/reads them.

ALTER TABLE `ws_live_session_course`
  ADD COLUMN `folder_id` INT NULL AFTER `live_course_id`;

-- Optional integrity: index the new column for the auto-promote lookup.
ALTER TABLE `ws_live_session_course`
  ADD INDEX `idx_lsc_folder` (`folder_id`);
