-- 2026-07-07 — ws_material.is_paid: backfill existing to 1 + change default to 1
--
-- Business decision: materials are PAID by default. Two parts:
--   1) Seed all existing rows to is_paid = 1.
--   2) Change the column default 0 → 1 so new materials are paid unless
--      explicitly created as free. (schema.prisma Material.isPaid → @default(true).)
--
-- Idempotent: re-running sets the same value / same default.

UPDATE `ws_material` SET `is_paid` = 1;

ALTER TABLE `ws_material` ALTER COLUMN `is_paid` SET DEFAULT 1;
