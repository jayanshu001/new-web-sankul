-- 2026-09-23 — Move the existing report permissions under the "Reports" category.
--
-- DML only, no DDL. Run AFTER the deploy has booted once: the boot seeder creates the
-- `reports` ws_permission_category row and the 4 new keys
-- (subscriptions.material-report.view, live-courses.report.view, test-series.report.view;
-- subscriptions.reports.view already exists). The seeder never re-categorises rows that
-- already exist, so these three keep their old category until this runs.
-- Idempotent; a no-op if the `reports` category is missing.

UPDATE ws_permissions p
JOIN ws_permission_category c ON c.slug = 'reports'
SET p.category_id = c.id
WHERE p.guard_name = 'web'
  AND p.name IN (
    'ebooks.subscriptions.view',
    'books.orders.view',
    'subscriptions.reports.view'
  );
