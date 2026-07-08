-- 2026-07-08 — Drop ws_promo_code (Prisma model PromoCodeRule), now merged into
-- ws_promocode. Run ONLY after:
--   * 2026-07-08_merge_promo_code_into_promocode.sql is applied,
--   * scripts/backfill-merge-promo-code.ts has completed successfully,
--   * the re-pointed code (no `prisma.promoCodeRule` references) is deployed and
--     verified against ws_promocode.
--
-- DESTRUCTIVE — take a backup of ws_promo_code first:
--   mysqldump ... ws_promo_code > ws_promo_code.backup.sql

DROP TABLE IF EXISTS `ws_promo_code`;
