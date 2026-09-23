-- Live course material/exam categories parity with the Mongo LiveCourse schema.
-- The admin create/update accepts materialCategories / examCategories (arrays of
-- { category, order }); the SQL table had no home for them, so the strict SQL
-- Zod schema rejected the keys (422). Store them as JSON, mirroring the existing
-- exam_countdown_*_ids / schedule JSON columns.

ALTER TABLE `ws_live_course`
  ADD COLUMN `material_categories` JSON NULL AFTER `exam_countdown_ids`,
  ADD COLUMN `exam_categories`     JSON NULL AFTER `material_categories`;
