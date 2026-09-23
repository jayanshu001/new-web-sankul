-- 2026-07-08 — Merge the discount-rule promocode (ws_promo_code / PromoCodeRule)
-- into ws_promocode (Promocode), then drop ws_promo_code.
--
-- WHY: two tables held two overlapping "promo code" features:
--   * ws_promocode   (Promocode)     — promoter promo codes + plan-link %/split
--                                       (ws_promoted_package_course_ebook)
--   * ws_promo_code  (PromoCodeRule) — admin discount rules (percentage/flat +
--                                       appliesTo targeting), the `promo-code` module
-- They are consolidated onto ws_promocode. The four discount/appliesTo columns
-- below are added to ws_promocode; the promo-code module + admin-promoter
-- getPromoterPromocodes + catalog availablePromo now read/write ws_promocode.
--
-- The `type` values written by the module ("public"/"private") already match the
-- ws_promocode `type` ENUM(private,public). `description` is left UNCHANGED (per
-- client request) — this migration only ADDs the four discount/appliesTo columns.
--
-- DEPLOY ORDER:
--   1) Apply THIS file (adds columns; non-destructive).
--   2) yarn prisma:generate (schema.prisma already updated).
--   3) Deploy the re-pointed code.
--   4) Run: npx tsx scripts/backfill-merge-promo-code.ts
--      (copies ws_promo_code rows into ws_promocode AND remaps
--       ws_promoted_package_course_ebook.promocode_id old→new).
--   5) Verify, then apply 2026-07-08_drop_ws_promo_code.sql.
--
-- IDEMPOTENT: MySQL 8 has no ADD COLUMN / CREATE INDEX "IF NOT EXISTS", so each
-- add is guarded on information_schema and becomes a no-op if already applied
-- (fixes "Duplicate column name" / "Duplicate key name" on a re-run).

-- discount_type ---------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_promocode' AND COLUMN_NAME = 'discount_type');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_promocode` ADD COLUMN `discount_type` VARCHAR(32) NOT NULL DEFAULT ''percentage'' AFTER `status`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- discount_value --------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_promocode' AND COLUMN_NAME = 'discount_value');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_promocode` ADD COLUMN `discount_value` DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER `discount_type`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- applies_to_type -------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_promocode' AND COLUMN_NAME = 'applies_to_type');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_promocode` ADD COLUMN `applies_to_type` VARCHAR(32) NULL AFTER `discount_value`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- applies_to_ids --------------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_promocode' AND COLUMN_NAME = 'applies_to_ids');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_promocode` ADD COLUMN `applies_to_ids` JSON NULL AFTER `applies_to_type`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Indexes mirror the ones dropped with ws_promo_code (idx_promo_code_code /
-- idx_promo_code_type_status).
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_promocode' AND INDEX_NAME = 'idx_ws_promocode_code');
SET @ddl := IF(@exists = 0,
  'CREATE INDEX `idx_ws_promocode_code` ON `ws_promocode` (`promocode`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_promocode' AND INDEX_NAME = 'idx_ws_promocode_type_status');
SET @ddl := IF(@exists = 0,
  'CREATE INDEX `idx_ws_promocode_type_status` ON `ws_promocode` (`type`, `status`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
