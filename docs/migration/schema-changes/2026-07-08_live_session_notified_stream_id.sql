-- 2026-07-08 — Track "buyers notified" per live-session stream run.
--
-- When an admin flips a session live (POST /admin/live-sessions/:id/start), the
-- backend fans out a `general` push to every customer with an active subscription
-- to any of the session's live courses. This must be idempotent per stream run:
-- a retried /start, or a stop→restart that REUSES the already-provisioned StreamOS
-- stream, must NOT re-spam the same buyers.
--
-- `notified_stream_id` records the stream_id we last notified for. The start path
-- claims it with a conditional UPDATE ... WHERE notified_stream_id <> stream_id
-- (Prisma `not` also matches NULL), so only the first start of a given stream run
-- sends. A genuinely NEW StreamOS stream (different stream_id) re-notifies.

ALTER TABLE `ws_live_session`
  ADD COLUMN `notified_stream_id` VARCHAR(191) NULL DEFAULT NULL AFTER `stream_id`;
