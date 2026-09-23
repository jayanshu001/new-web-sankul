-- 2026-08-24 — Notifications: per-customer read state + a signup cut-off watermark.
--
-- TWO BUGS THIS CLOSES
--
-- 1) READ STATE WAS GLOBAL ON BROADCASTS.
--    `ws_notification.is_read` / `read_at` live on the notification row itself. For a
--    broadcast (broadcast = 1) that row is SHARED by the whole user base, so
--    `markRead` — a plain UPDATE of the row — marked it read for EVERY customer.
--    Measured on staging before this change: 60 of 63 broadcasts already carried
--    is_read = 1, so a brand-new account's feed showed 63 items with an unread badge
--    of 3. Dismissals already got this right (ws_notification_dismissal, 2026-07-20);
--    read state never did. This table is the exact mirror of that one.
--
-- 2) NEW ACCOUNTS SAW THE ENTIRE BROADCAST HISTORY.
--    The visibility filter is (customer_id = me OR broadcast = 1) with NO date bound,
--    so every account — brand new, or re-registered after an account deletion — saw
--    every broadcast ever sent. Fixed in code, not here: broadcasts are now filtered
--    to `notification.created_at >= customer.created_at`. No DDL needed for that;
--    ws_customer.created_at already exists.
--
-- WHY A WATERMARK COLUMN AS WELL AS A TABLE
--    `notifications_read_before` = "every notification created at or before this
--    instant is read for this customer". It exists for two reasons:
--      a) CUTOVER. Dropping the shared is_read makes every broadcast unread again for
--         EXISTING customers, i.e. a platform-wide badge storm on deploy. Stamping the
--         watermark once at migration time suppresses that in a single UPDATE per
--         customer instead of a (customers x notifications) cross-product — which on a
--         600k-row ws_customer would have been ~37M rows.
--      b) MARK-ALL-READ becomes O(1): set the watermark, drop the now-redundant
--         per-row marks. Without it, "read all" would insert one row per visible
--         notification, forever.
--    NULL = no watermark (nothing pre-read). New customers are left NULL on purpose:
--    the signup cut-off already hides pre-signup broadcasts, so they need no stamp.
--
-- Per the ws_customer scalar rule: this is one scalar per customer with no lifecycle
-- of its own, so it is a COLUMN here, while (customer x notification) read marks are a
-- genuine 1:N and get their own table.
--
-- ORDER: run 1 then 2 then 3. Steps 1 and 2 are online-safe (new table, new nullable
-- column). Step 3 is bounded by the notification count, not the customer count.
--
-- Rollback:
--   ALTER TABLE `ws_customer` DROP COLUMN `notifications_read_before`;
--   DROP TABLE IF EXISTS `ws_notification_read`;
--   (`ws_notification.is_read` / `read_at` are left in place and untouched by this
--    change, so the old code path still works if you need to roll the app back.)

-- ── 1. Per-customer read marks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ws_notification_read` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `customer_id`     INT NOT NULL,
  `notification_id` INT NOT NULL,
  `read_at`         DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_notif_read` (`customer_id`, `notification_id`),
  KEY `idx_notif_read_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 2. Cutover / mark-all-read watermark ─────────────────────────────────────────
ALTER TABLE `ws_customer`
  ADD COLUMN `notifications_read_before` DATETIME NULL AFTER `download_key_hex`;

-- ── 3. Backfill: preserve genuine PERSONAL read state ────────────────────────────
-- Personal rows (broadcast = 0) are single-owner, so their is_read WAS accurate —
-- carry it across so nobody's already-read personal notifications come back unread.
-- Broadcast is_read is deliberately NOT backfilled: it records "somebody, somewhere
-- read this", which is exactly the corruption being removed. Bounded by the
-- notification count.
--
-- IST NOTE: timestamps are STORED as IST (Prisma $use shifts on write). Raw SQL does
-- not go through that middleware, so NOW() is wrong here — use UTC + 330 minutes.
INSERT IGNORE INTO `ws_notification_read` (`customer_id`, `notification_id`, `read_at`)
SELECT `customer_id`, `id`, COALESCE(`read_at`, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 330 MINUTE))
FROM `ws_notification`
WHERE `broadcast` = 0 AND `is_read` = 1 AND `customer_id` IS NOT NULL;

-- ── 4. Stamp the cutover watermark ───────────────────────────────────────────────
-- DO NOT run this as a single unbounded UPDATE over ws_customer — a prior unbounded
-- sweep over that 600k-row table took production down ("Server has closed the
-- connection"). Run the PK-batched script instead:
--
--   npx tsx scripts/backfill-notification-read-watermark.ts
--
-- It pages by primary key and stamps `notifications_read_before` only where NULL.
