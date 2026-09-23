-- Drop the multi-device FCM token table. The app now stores a single device
-- token per customer directly in ws_customer.device (the firebaseToken column),
-- last-device-wins — no separate table. Reverses
-- 2026-06-18_create_customer_device_token.sql.
--
-- Safety backfill FIRST: for any customer whose single `device` column is empty
-- but who still has a token row, copy the most-recently-updated token back into
-- ws_customer.device so no live device is silently dropped at cutover. (During
-- the dual-write window `device` was already kept in sync, so this is a no-op on
-- most rows; it only rescues rows that predate the sync.)
-- Correlated subquery (only_full_group_by-safe): pick each customer's most
-- recently updated token. ORDER BY … LIMIT 1 avoids grouping a non-aggregated
-- column, and the EXISTS guard skips customers with no token row.
UPDATE `ws_customer` c
SET c.`device` = (
      SELECT t.token
      FROM `ws_customer_device_token` t
      WHERE t.customer_id = c.id
      ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.id DESC
      LIMIT 1
    ),
    c.`updated_at` = NOW()
WHERE (c.`device` IS NULL OR c.`device` = '')
  AND EXISTS (SELECT 1 FROM `ws_customer_device_token` t2 WHERE t2.customer_id = c.id);

DROP TABLE IF EXISTS `ws_customer_device_token`;
