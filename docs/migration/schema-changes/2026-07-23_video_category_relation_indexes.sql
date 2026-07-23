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
-- Index-only additive DDL; safe to run online. Re-runnable guards omitted (MySQL 8
-- has no CREATE INDEX IF NOT EXISTS) — check SHOW INDEX first if re-applying.

ALTER TABLE ws_video_category_relation
  ADD INDEX idx_vcr_parent (parent),
  ADD INDEX idx_vcr_child  (child);
