-- 2026-07-20 — Per-platform notification formatting: store the rich (HTML) title/body
-- alongside the plain text so pushes can be split per device platform at send time.
--
-- WHY: the admin "Send Notification" composer is a rich-text editor. Push trays must
-- show Android the FORMATTED (HTML) title/body and iOS PLAIN text (iOS banners render
-- plain only — raw <p>/<b> tags would leak to users). The split can only happen at the
-- backend at send time (per-device platform). The frontend sends both versions:
--   title / body           -> PLAIN (tag-stripped), ALWAYS present.
--   title_html / body_html -> raw editor HTML, present ONLY when real formatting exists.
--
-- These columns persist both so the in-app inbox and any re-send keep the formatting.
-- Both nullable: existing rows + unformatted notifications simply have NULL html.
--
-- Rollback:
--   ALTER TABLE `ws_notification` DROP COLUMN `title_html`, DROP COLUMN `body_html`;
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so each add is
-- guarded on information_schema and becomes a no-op if already applied (fixes
-- "Duplicate column name" on a re-run).

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_notification' AND COLUMN_NAME = 'title_html');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_notification` ADD COLUMN `title_html` TEXT NULL AFTER `title`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_notification' AND COLUMN_NAME = 'body_html');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_notification` ADD COLUMN `body_html` TEXT NULL AFTER `body`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
