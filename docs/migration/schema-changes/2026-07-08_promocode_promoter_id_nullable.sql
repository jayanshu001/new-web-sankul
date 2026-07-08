-- 2026-07-08 — Make ws_promocode.promoter_id nullable.
--
-- Part of the ws_promo_code → ws_promocode merge. The promoter promocode flow
-- always has a promoter, but the merged-in admin discount-rule codes (the
-- `promo-code` module) are NOT tied to a promoter and write promoter_id = NULL
-- (the former ws_promo_code.promoter_id was nullable). The Prisma model already
-- declares `promoterId Int?`; this aligns the physical column with it.

ALTER TABLE `ws_promocode`
  MODIFY COLUMN `promoter_id` INT NULL DEFAULT NULL;
