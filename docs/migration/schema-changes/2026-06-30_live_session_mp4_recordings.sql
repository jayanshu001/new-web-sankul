-- 2026-06-30 — live-course recordings: store StreamOS mp4Links alongside the
-- DRM-HLS `recordings` so the client can be served a plain MP4 URL in addition
-- to the m3u8 (no transcoding — StreamOS already produces the MP4).
--
-- Shape mirrors `recordings`: JSON array of { quality, file_size, path } where
-- path is the un-DRM'd .mp4 (from StreamOS mp4Links). Nullable — recordings that
-- predate this column, or for which StreamOS produced no mp4, simply have NULL
-- and the client falls back to the HLS `recordings`.

ALTER TABLE ws_live_session
  ADD COLUMN mp4_recordings JSON NULL AFTER recordings;
