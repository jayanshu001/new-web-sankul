-- 2026-08-06 — indexes for the `is_login` reconcile sweep (otp-unblock.scheduler.ts).
--
-- The sweep clears `ws_customer.is_login` for customers holding no live token. As a
-- single table-wide UPDATE with a relation anti-join it ran long enough on production
-- that MySQL dropped the connection under it ("Server has closed the connection").
-- The sweep is now batched in the app (SELECT a page of ids → UPDATE that page), but
-- both halves still need index support or every page is a full scan of ws_customer
-- plus a scan of ws_customer_access_token:
--
--   SELECT id FROM ws_customer
--    WHERE is_login = 1 AND id > ? AND id NOT IN (
--      SELECT customer_id FROM ws_customer_access_token
--       WHERE active = 1 AND deleted = 0 AND expires_at > ?)
--    ORDER BY id LIMIT 500;
--
--   • idx_customer_is_login_id  — makes the candidate page a keyed range scan
--     (is_login is low-cardinality, but the TRUE side is the small side, and the
--     trailing id serves the keyset cursor + ORDER BY without a filesort).
--   • idx_cat_customer_live     — makes the anti-join a covering index lookup instead
--     of a scan; ws_customer_access_token has no index on customer_id today.
--
-- Additive and prod-safe, but ws_customer_access_token grows with every login — use
-- ALGORITHM=INPLACE, LOCK=NONE (or pt-online-schema-change) if it is large in prod.
-- Idempotent: re-running is a no-op.

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'ws_customer'
      AND index_name = 'idx_customer_is_login_id') > 0,
  'SELECT "idx_customer_is_login_id already exists" AS msg',
  'ALTER TABLE `ws_customer` ADD KEY `idx_customer_is_login_id` (`is_login`, `id`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'ws_customer_access_token'
      AND index_name = 'idx_cat_customer_live') > 0,
  'SELECT "idx_cat_customer_live already exists" AS msg',
  'ALTER TABLE `ws_customer_access_token` ADD KEY `idx_cat_customer_live` (`customer_id`, `active`, `deleted`, `expires_at`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
