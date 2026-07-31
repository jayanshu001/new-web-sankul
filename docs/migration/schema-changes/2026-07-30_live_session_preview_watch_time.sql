-- 2026-07-30  ws_live_session_preview: wall-clock preview → WATCH-TIME preview
--
-- WHY: the 3-minute live-session preview expired 180 seconds after `started_at`,
-- i.e. on wall clock. Opening the player and walking away burnt the whole trial,
-- and a student who watched 70s then left came back to 0s instead of 110s. The
-- trial must represent 180 seconds of ACTUAL WATCH TIME.
--
-- New model (see resolveLivePreviewStateSql / previewHeartbeatSql):
--   consumed_seconds   committed watch time, only ever advanced by a heartbeat.
--   last_heartbeat_at  the charging CURSOR, and the "a window is open" flag:
--                      NULL  ⇒ nobody is watching, nothing is being consumed;
--                      set   ⇒ a window is open and the next heartbeat charges
--                              (now − last_heartbeat_at), capped at 20s.
--
-- `started_at` is KEPT and still written on insert. It is no longer the expiry
-- basis — it stays as the "when did this trial first begin" audit value, and the
-- backfill below reads it.
--
-- One shared cursor per (customer, session) is what makes concurrent devices
-- share one 180s allowance: two devices heartbeating simultaneously each advance
-- the SAME cursor, so consumption is bounded by wall-clock time in which at least
-- one device was playing — it cannot be multiplied by opening more devices.
-- The uniqueness this relies on is
-- `2026-07-30_live_session_preview_unique.sql` — APPLY THAT FILE FIRST.
--
-- Apply: yarn db:migrate   (or: npx prisma db execute --file <this file>)
-- Then:  yarn prisma:generate  AND RESTART the app (a regenerated client does not
--        trip `tsx watch`, so a running dev server keeps the stale one and 500s).

-- IDEMPOTENT / re-runnable: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`. Each add is
-- guarded on information_schema, AND the one-time backfill (step 2) is gated on
-- whether `consumed_seconds` was ABSENT before this run. This is critical: on a
-- re-run the column already exists and has REAL accumulated watch time — blindly
-- re-running the wall-clock backfill would OVERWRITE that live data. So the backfill
-- fires only on the first application (when the columns are freshly created).

-- 0. capture pre-state: was consumed_seconds absent before we (maybe) add it?
SET @was_absent := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_session_preview' AND COLUMN_NAME = 'consumed_seconds');

-- 1. columns (each guarded)
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_session_preview' AND COLUMN_NAME = 'consumed_seconds');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_session_preview` ADD COLUMN `consumed_seconds` INT NOT NULL DEFAULT 0 AFTER `started_at`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_session_preview' AND COLUMN_NAME = 'last_heartbeat_at');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_session_preview` ADD COLUMN `last_heartbeat_at` DATETIME NULL AFTER `consumed_seconds`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. backfill — ONLY on first application (see header). Carry over what each existing
--    trial had already burnt under the OLD wall-clock rule, so this migration never
--    hands preview time back to a student whose trial had already ended.
--
--    ⚠ TIMEZONE: `started_at` holds IST wall clock (the app's Prisma middleware
--    shifts every write +05:30 — see src/config/prisma.ts). Raw SQL bypasses that
--    middleware, so comparing against a bare NOW() would be wrong by however the
--    DB session tz is configured: on a UTC server every diff would come out 5.5h
--    too small, and every trial started within the last 5.5 hours would backfill
--    to 0 — i.e. a full free reset. UTC_TIMESTAMP() + 330 minutes reproduces the
--    exact value the app would have written, independent of @@session.time_zone.
SET @bf := IF(@was_absent,
  'UPDATE ws_live_session_preview SET consumed_seconds = LEAST(180, GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP() + INTERVAL 330 MINUTE))) WHERE started_at IS NOT NULL',
  'DO 0');
PREPARE s FROM @bf; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. no open windows exist yet — last_heartbeat_at stays NULL for every legacy
--    row, so no backfilled trial is treated as "currently being watched".
