-- 2026-07-23 — index for the `hasNotes` flag on GET /client/video-categories/:id/videos
--
-- Both note tables are queried per page as
--   WHERE customer_id = ? AND video_id IN (<page ids>)
-- and neither table carries ANY secondary index today, so this is a full scan per
-- listing request. The notes-list endpoint (customer + lecture_type + video_id) is
-- served by the same leading columns.
--
-- Index-only additive DDL; safe to run online. Re-runnable guards omitted (MySQL 8
-- has no CREATE INDEX IF NOT EXISTS) — check SHOW INDEX first if re-applying.

ALTER TABLE ws_lecture_note
  ADD INDEX idx_lecture_note_customer_video (customer_id, video_id);

ALTER TABLE ws_lecture_audio_note
  ADD INDEX idx_lecture_audio_note_customer_video (customer_id, video_id);
