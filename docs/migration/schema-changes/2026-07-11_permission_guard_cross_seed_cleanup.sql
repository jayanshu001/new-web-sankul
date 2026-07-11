-- 2026-07-11 — Permission guard cross-seed cleanup (OPTIONAL, cosmetic)
--
-- Context: the permission catalog is now guard-scoped. The seeder previously
-- seeded EVERY catalog key under ALL three guards (web/educator/promoter), so on
-- existing DBs the promoter and educator guards hold web-guard permission rows
-- (goals.*, courses.*, …) that don't belong to them. After the guard-aware
-- seeder change these show up in the catalog endpoint's `deprecated[]` for those
-- guards. They are harmless (a promoter role never references them) but noisy.
--
-- This DELETE removes ONLY the cross-seeded rows that are NOT referenced by any
-- role or model assignment, so no real grant is ever touched. It is safe to run
-- multiple times (idempotent) and safe to skip entirely — the reported bug
-- (promoter permissions missing from the tree) is fixed purely by the code
-- change; this only tidies the deprecated warning list.
--
-- Legit keys kept per portal guard:
--   promoter: promoter, promoter.dashboard, promoter.customers,
--             promoter.customers.read, promoter.promocodes, promoter.promocodes.read
--   educator: educator.dashboard
--
-- Run AFTER deploying the guard-aware seeder and verifying the promoter tree
-- renders correctly.

DELETE p FROM `ws_permissions` p
WHERE p.`guard_name` = 'promoter'
  AND p.`name` NOT IN (
    'promoter',
    'promoter.dashboard',
    'promoter.customers',
    'promoter.customers.read',
    'promoter.promocodes',
    'promoter.promocodes.read'
  )
  AND NOT EXISTS (
    SELECT 1 FROM `ws_role_has_permissions` rp WHERE rp.`permission_id` = p.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `ws_model_has_permissions` mp WHERE mp.`permission_id` = p.`id`
  );

DELETE p FROM `ws_permissions` p
WHERE p.`guard_name` = 'educator'
  AND p.`name` NOT IN (
    'educator.dashboard'
  )
  AND NOT EXISTS (
    SELECT 1 FROM `ws_role_has_permissions` rp WHERE rp.`permission_id` = p.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `ws_model_has_permissions` mp WHERE mp.`permission_id` = p.`id`
  );
