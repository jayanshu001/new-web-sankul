-- 2026-07-25 — Drop ws_course.featured_order
--
-- Dead column. Audit 2026-07-25 found ZERO code paths touching it: no read, no
-- write, no filter, no orderBy. Its only references in the repo were three
-- comments (two doc-comments in src/modules/catalog-course/, one historical note
-- in scripts/generate-migrated-modules.ts) plus the Prisma mapping itself —
-- `catalog-course.transformer.ts` even stated outright that it was "mapped in
-- Prisma but not surfaced (no consumer reads it)".
--
-- It implied a "featured course display order" capability that was never built:
-- ws_course.is_featured IS used (surfaced as the `isPopular` boolean and
-- filterable), but the accompanying ordering was not, so featured courses have
-- no defined order today.
--
-- Safe to run: NULLable int, no default, no index, no FK, and NULL on every row
-- (including the one row with is_featured='1'). No data is lost. `ws_course` is
-- the only table in the schema carrying this column name.
--
-- Apply AFTER deploying the matching backend build (which no longer maps the
-- column). Idempotent guard included.

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ws_course'
    AND COLUMN_NAME = 'featured_order'
);

SET @ddl := IF(
  @col_exists > 0,
  'ALTER TABLE `ws_course` DROP COLUMN `featured_order`',
  'SELECT "ws_course.featured_order already dropped" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
