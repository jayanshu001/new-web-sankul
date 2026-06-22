-- catalog-package migration.
--
-- The package -> category link tables ALREADY EXIST in SQL and hold data:
--   ws_package_specific_subject   (video categories)  — 1620 rows
--   ws_material_category_package  (material cats)      — 13 rows
--   ws_exam_category_package      (exam cats)          — 66 rows
-- (Prisma models: PackageSpecificSubject / MaterialCategoryPackage / ExamCategoryPackage.)
--
-- The ONLY missing piece is the package -> goal-label link. Mongo stores it as
-- `Package.goalLabelId` (ObjectId into Goal.labels[]). The migrated `goal` module
-- assigns stable per-goal INTEGER label ids by name, so we store that synthetic
-- integer here (resolved during backfill: Mongo ObjectId -> label name -> SQL id).
-- Additive only; no data loss.

ALTER TABLE ws_package ADD COLUMN goal_label_id INT NULL;
ALTER TABLE ws_package ADD KEY idx_package_goal_label (goal_label_id);

-- Mongo-only Package fields the package detail/list DTO emits but ws_package lacks.
-- (withMaterialText/withoutMaterialText already live in with_material/without_material;
--  subtitle + examCountdown arrays are absent in real docs → "" / [] by default, no col.)
ALTER TABLE ws_package ADD COLUMN goal_id          INT        NULL;     -- -> goal:{_id,title}
ALTER TABLE ws_package ADD COLUMN is_paid          TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE ws_package ADD COLUMN is_smart_course  TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ws_package ADD COLUMN is_planner_course TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ws_package ADD KEY idx_package_goal (goal_id);
