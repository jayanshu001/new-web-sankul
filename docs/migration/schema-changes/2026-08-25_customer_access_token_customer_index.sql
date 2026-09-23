-- 2026-08-25 — ws_customer_access_token: index on customer_id
--
-- WHY (three reasons, one index):
--
-- 1. NEW HOT PATH. `authenticate` now treats the token rows as authoritative for
--    customers: every authenticated request resolves "does this customer still
--    have a live token row?". Without this index that is a FULL TABLE SCAN on
--    every single API call — unshippable on a table that only grows.
--
-- 2. EXISTING REFRESH PATH. `findActiveTokenByRefresh` (POST /client/auth/
--    token/refresh) already filters by customer_id and has been full-scanning
--    this table since day one. Cheap today, linear in table size forever.
--
-- 3. THE is_login SWEEP. `findStaleLoggedInIds` anti-joins ws_customer against
--    this table on customer_id. That is the same query shape implicated in the
--    2026-08-06 "Server has closed the connection" incident; it was made
--    keyset-paginated then, but the join column itself was still unindexed.
--
-- The table has ONLY a PRIMARY KEY on `id` today — verified on staging with
-- SHOW INDEX. There is no FK constraint, so MySQL never auto-created one.
--
-- Column order is chosen for the liveness probe
-- (customer_id = ? AND active = 1 AND deleted = 0 AND expires_at > NOW()):
-- equality columns first, the range column last, so the whole predicate is
-- satisfied from the index without touching the row.
--
-- Safe to re-run: guarded by an information_schema check because MySQL 8 has no
-- CREATE INDEX IF NOT EXISTS.

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name   = 'ws_customer_access_token'
    AND index_name   = 'idx_cust_access_token_live'
);

SET @ddl := IF(
  @exists = 0,
  'CREATE INDEX idx_cust_access_token_live ON ws_customer_access_token (customer_id, active, deleted, expires_at)',
  'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
