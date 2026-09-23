-- 2026-09-01 — StreamOS v1: live-session provider columns + webhook idempotency
--
-- WHY. StreamOS shipped a NEW API on a new host (api.streamos.in) that shares
-- nothing with the platform ws_live_session was built against
-- (streamapi.streamos.co). Both clients now ship side by side, selected by the
-- STREAMOS_PROVIDER env flag, because existing rows hold LEGACY stream ids and
-- legacy CDN URLs that must keep resolving after the cutover.
-- Full old→new comparison: docs/migration/STREAMOS_V1_CHANGE_MATRIX.md
--
-- NOTHING IS DROPPED OR RENAMED. Four additive columns + one new table.
--
--   1. stream_provider    — which API this row's stream_id belongs to. Without it
--                           a stream_id is ambiguous: legacy ids look like
--                           "T_17787583234029", v1 ids are opaque public_ids, and
--                           resolving one against the wrong API 404s. NULL is read
--                           as 'legacy' so every existing row keeps working
--                           untouched — no backfill required.
--
--   2. stream_key         — v1 returns the channel key SEPARATELY from rtmp_url.
--                           The legacy API baked the push token into stream_id.
--
--   3. push_expires_at    — v1 ingest credentials expire ~24h after they are
--                           minted. The legacy URL was effectively permanent, so
--                           there was nothing to store. This is what lets us
--                           detect a stale rtmp_url and re-mint before go-live.
--
--   4. recorded_asset_id  — v1 recordings become LIBRARY ASSETS rather than a list
--                           of URLs in the webhook body. This is the pointer used
--                           to fetch the finished recording via GET /assets/{id}/,
--                           and the recovery path when a webhook is missed.
--
--   5. ws_streamos_webhook_delivery — v1 retries a failed delivery up to 6 times
--                           with the SAME X-Streamos-Delivery id. Recording
--                           handling auto-promotes a recording into a course
--                           folder (creates ws_video rows), so a replayed delivery
--                           would duplicate content. This table makes the handler
--                           idempotent. The legacy webhook never retried, so no
--                           such guard existed.
--
-- SAFE TO APPLY BEFORE THE CODE. Every column is nullable with no default, the new
-- table is unreferenced until the v1 client is wired up, and no existing read or
-- write touches any of them while STREAMOS_PROVIDER is unset/legacy.
--
-- ⚠ ORDER: apply this BEFORE deploying the code that declares these columns in
-- schema.prisma. Prisma selects every declared scalar, so code-ahead-of-DB raises
-- MySQL 1054 on every live-session read (see the 2026-08-26 live-course incident).

ALTER TABLE `ws_live_session`
  ADD COLUMN `stream_provider`   VARCHAR(16)  NULL AFTER `stream_id`,
  ADD COLUMN `stream_key`        VARCHAR(255) NULL AFTER `stream_provider`,
  ADD COLUMN `push_expires_at`   DATETIME     NULL AFTER `stream_key`,
  ADD COLUMN `recorded_asset_id` VARCHAR(64)  NULL AFTER `push_expires_at`;

-- Recovery/reconciliation lookups go asset_id → session.
CREATE INDEX `idx_live_session_recorded_asset`
  ON `ws_live_session` (`recorded_asset_id`);

-- Webhook replay guard. `delivery_id` is StreamOS's X-Streamos-Delivery header:
-- stable across retries of the same delivery, unique per distinct delivery.
CREATE TABLE IF NOT EXISTS `ws_streamos_webhook_delivery` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `delivery_id` VARCHAR(128) NOT NULL,
  `event`       VARCHAR(64)  NULL,
  `received_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_streamos_delivery` (`delivery_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Housekeeping note: `received_at` exists so old rows can be pruned on a schedule.
-- Nothing prunes them yet; the table grows by one row per webhook delivery.
