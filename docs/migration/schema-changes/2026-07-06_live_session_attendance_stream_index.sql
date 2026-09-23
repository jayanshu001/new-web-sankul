-- 2026-07-06 — Index ws_live_session_attendance.stream_id.
--
-- The live socket now emits `viewer_stats` (active/unique/joins) on every viewer
-- join/leave. `unique` + `joins` are COUNT(*) / COUNT(DISTINCT customer_id)
-- filtered by stream_id (getViewerStatsCounts). Without an index these
-- table-scan the whole attendance table on every presence change. The REST
-- attendance summary (getAttendance) also filters by stream_id, so this index
-- benefits both paths.

ALTER TABLE `ws_live_session_attendance`
  ADD INDEX `idx_lsa_stream` (`stream_id`);
