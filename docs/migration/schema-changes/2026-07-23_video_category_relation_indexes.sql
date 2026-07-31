-- 2026-07-23 — indexes on ws_video_category_relation (parent, child)
--
-- This table is the source of truth for the VideoCategory DAG and is walked by a
-- RECURSIVE CTE (src/modules/catalog-category-tree/category-tree.service.ts) on
-- every catalog request — the recursion joins it once per depth level, up to
-- MAX_DEPTH. It also backs the per-category child-edge count on the catalog
-- listing (`parent IN (...)` GROUP BY parent).
--
-- Today the table has ONLY a PRIMARY KEY on `id`, so every one of those lookups
-- is a full table scan. Verified on staging:
--
--   EXPLAIN SELECT parent, COUNT(*) FROM ws_video_category_relation
--    WHERE parent IN (1,2,3) GROUP BY parent;
--   -> type: ALL, key: NULL, rows: 2456, Using where; Using temporary
--
-- Both directions are indexed because the DAG is walked BOTH ways:
--   parent -> child  (descendantsOf / descendantsByRoot, catalog listing counts)
--   child  -> parent (ancestorsOf, resolveVideoScope media-token gating)
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `CREATE INDEX IF NOT EXISTS`, so each add
-- is guarded on information_schema.STATISTICS and becomes a no-op if already applied
-- (fixes "Duplicate key name" on a re-run). Index-only additive DDL; safe online.

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_video_category_relation' AND INDEX_NAME = 'idx_vcr_parent');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_video_category_relation` ADD INDEX `idx_vcr_parent` (`parent`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_video_category_relation' AND INDEX_NAME = 'idx_vcr_child');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_video_category_relation` ADD INDEX `idx_vcr_child` (`child`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
