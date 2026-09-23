-- 2026-08-05 — Drop the "Most Popular" admin override column.
--
-- Added 2026-06-30 (2026-06-30_most_popular_plan_flags.sql) as a manual override:
-- a pinned plan would win the "Most Popular" badge for its product regardless of
-- sales. The admin UI that would have driven it was never built, so the column's
-- only writer (`setPinned()` → POST /admin/plan-popularity/pin) was unreachable
-- and every row stayed 0. The ranking has always been purely sales-driven.
--
-- Decision 2026-08-05: the badge stays fully automatic (most all-time paid orders
-- per product). Override removed rather than left dormant.
--
-- `is_most_popular` — the effective, computed flag the API reads — is UNCHANGED
-- and stays on all three tables.
--
-- SAFE TO RUN AFTER THE CODE DEPLOY (and safe to run before): the application
-- stopped selecting this column in the same release, and Prisma ignores DB
-- columns absent from schema.prisma. No backfill, no data loss — every value is 0.
--
-- Apply with:
--   npx prisma db execute --file docs/migration/schema-changes/2026-08-05_drop_most_popular_pinned.sql --schema prisma/schema.prisma

ALTER TABLE ws_package_course_ebook_price
  DROP COLUMN most_popular_pinned;

ALTER TABLE ws_live_course_plan
  DROP COLUMN most_popular_pinned;

ALTER TABLE ws_test_series_price
  DROP COLUMN most_popular_pinned;
