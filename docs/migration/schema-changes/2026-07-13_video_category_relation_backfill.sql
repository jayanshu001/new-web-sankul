-- 2026-07-13 — Backfill ws_video_category_relation from the self-FK parent
--
-- The client catalog video tree reads ONLY the pivot table
-- ws_video_category_relation (havingChildDirectory, the descendantsOf drill-in
-- subtree, and counts). Admin, however, historically wrote parent/child links via
-- the single-parent self-FK ws_video_category.parent and never mirrored them into
-- the pivot — so admin-created subcategories were invisible client-side
-- (havingChildDirectory=false, child not reachable, wrong counts).
--
-- This backfills the missing pivot edges from the self-FK. NON-DESTRUCTIVE: inserts
-- only the (parent, child) edges that don't already exist; never deletes or
-- rewrites an existing edge (package composition — ws_video_category_package_relation
-- — references pivot edge ids, so existing edges must be preserved).
--
-- Idempotent / re-runnable (the NOT EXISTS guard).

INSERT INTO `ws_video_category_relation` (`parent`, `child`, `order`)
SELECT c.`parent`, c.`id`, COALESCE(c.`order_by`, 0)
FROM `ws_video_category` c
WHERE c.`parent` > 0
  AND NOT EXISTS (
    SELECT 1 FROM `ws_video_category_relation` r
    WHERE r.`parent` = c.`parent` AND r.`child` = c.`id`
  );
