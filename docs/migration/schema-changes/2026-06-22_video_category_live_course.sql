-- Live-recording subsystem migration: live-course recording FOLDERS are
-- VideoCategory rows linked to the course via liveCourseId in Mongo. ws_video_category
-- had subject_key (c7) but no live_course_id, so the folder→course link had no SQL
-- home. This adds it. Promoted-recording videos already link via ws_video.live_session_id
-- + vcategory_id. Additive only.
ALTER TABLE ws_video_category ADD COLUMN live_course_id INT NULL;
ALTER TABLE ws_video_category ADD KEY idx_vcat_live_course (live_course_id);
