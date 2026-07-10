-- 2026-07-10 — Drop Smart/Planner course flags from ws_package
--
-- Frontend reworked the Add/Edit Package form: the "Course Kind" (Smart/Planner/
-- None) control was removed, and the package DTO no longer returns these flags.
-- The Prisma model + all read/write code paths have already been updated to stop
-- referencing these columns (Prisma ignores unmapped columns, so this DROP can be
-- applied at deploy without a code freeze).
--
-- No data migration needed — the frontend already stopped reading/writing them.
-- Irreversible: the boolean values are discarded. Back up ws_package first if the
-- historical flag values must be retained.

ALTER TABLE `ws_package`
  DROP COLUMN `is_smart_course`,
  DROP COLUMN `is_planner_course`;
