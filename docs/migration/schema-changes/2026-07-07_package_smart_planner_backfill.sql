-- 2026-07-07 — Backfill ws_package.is_smart_course / is_planner_course from package_type_id
--
-- One-time DATA seed for EXISTING packages (no schema change; columns already exist).
-- Business rule: package_type_id = 1 ("Recorded Course")  → is_smart_course   = 1
--                package_type_id = 4 ("Planner Course")   → is_planner_course = 1
--
-- Going forward these flags stay a MANUAL admin toggle (create/update API) — this
-- file only seeds historical rows, it does NOT enforce the rule on new data.
--
-- Idempotent: re-running sets the same values. Only touches rows of the two types;
-- all other packages and their flags are left untouched.

UPDATE `ws_package` SET `is_smart_course`   = 1 WHERE `package_type_id` = 1;
UPDATE `ws_package` SET `is_planner_course` = 1 WHERE `package_type_id` = 4;
