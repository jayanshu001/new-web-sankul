-- ─────────────────────────────────────────────────────────────────────────────
-- Soft-delete re-signup support for ws_customer
--
-- Requirement: deleting a user is ALWAYS a soft delete (is_account_deleted = 1).
-- A phone may then sign up again as a brand-new, separate account, leaving every
-- previously-deleted account intact. This can repeat any number of times, so a
-- single phone can own N rows of which EXACTLY ONE is active (is_account_deleted = 0).
--
-- The old global `UNIQUE (phone)` made this impossible (re-signup hit a dup-key
-- error). MySQL has no native partial/filtered unique index, so we emulate one:
-- a STORED generated column `phone_active` that equals `phone` while the row is
-- active and NULL once it is soft-deleted. A UNIQUE index over `phone_active`
-- then constrains only active rows (NULLs are never compared), allowing unlimited
-- soft-deleted duplicates while guaranteeing one active account per phone.
--
-- NOTE: because the generated column is STORED and derived from is_account_deleted,
-- flipping is_account_deleted (the admin "revive an old account" toggle) auto-
-- recomputes phone_active and keeps the uniqueness invariant correct. When reviving
-- an old account, ALWAYS soft-delete the current active row FIRST, then clear
-- is_account_deleted on the old row — otherwise the two-active transient violates
-- uq_customer_phone_active.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1 — drop the existing global unique index on `phone` (name varies by dump,
-- e.g. `phone` or `ws_customer_phone_key`). Resolved dynamically so the script is
-- portable across environments.
SET @idx := (
  SELECT INDEX_NAME
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_customer'
    AND COLUMN_NAME = 'phone'
    AND NON_UNIQUE = 0
  LIMIT 1
);
SET @sql := IF(@idx IS NOT NULL,
  CONCAT('ALTER TABLE `ws_customer` DROP INDEX `', @idx, '`'),
  'SELECT "no unique index on phone — nothing to drop"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 2 — generated column: phone while active, NULL once soft-deleted.
ALTER TABLE `ws_customer`
  ADD COLUMN `phone_active` VARCHAR(11)
  GENERATED ALWAYS AS (
    CASE WHEN `is_account_deleted` = 0 THEN `phone` ELSE NULL END
  ) STORED;

-- Step 3 — uniqueness among active rows only (NULLs ignored → soft-deleted dups OK).
ALTER TABLE `ws_customer`
  ADD UNIQUE KEY `uq_customer_phone_active` (`phone_active`);
