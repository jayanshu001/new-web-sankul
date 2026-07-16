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
UPDATE `ws_customer` c
JOIN (
  SELECT t.customer_id, t.token
  FROM `ws_customer_device_token` t
  JOIN (
    SELECT customer_id, MAX(COALESCE(updated_at, created_at)) AS latest
    FROM `ws_customer_device_token`
    GROUP BY customer_id
  ) m ON m.customer_id = t.customer_id
     AND COALESCE(t.updated_at, t.created_at) = m.latest
  GROUP BY t.customer_id
) pick ON pick.customer_id = c.id
SET c.`device` = pick.token,
    c.`updated_at` = NOW()
WHERE (c.`device` IS NULL OR c.`device` = '');

DROP TABLE IF EXISTS `ws_customer_device_token`;
