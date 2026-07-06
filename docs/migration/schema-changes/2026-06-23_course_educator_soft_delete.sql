-- Educator admin delete parity. The Mongo CourseEducator model has a `deleted`
-- flag: delete sets { deleted: true, status: false } and the admin list filters
-- deleted=false, retaining the row so course/live-course/package/session
-- `courseEducatorId` references still resolve the educator's name. ws_course_educator
-- had no such column (delete only disabled, so "deleted" educators kept showing in
-- the list). This adds it. Hard delete is unsafe here (FK from ws_course.educator_id).
-- Additive only; defaults to 0 so existing rows stay visible.
ALTER TABLE ws_course_educator ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ws_course_educator ADD KEY idx_course_educator_deleted (deleted);
