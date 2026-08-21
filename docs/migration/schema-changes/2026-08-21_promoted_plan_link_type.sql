-- 2026-08-21 — Give every ws_promoted_package_course_ebook row a real product type.
--
-- WHY: the promocode→plan link table has TWO discriminators and neither one alone
-- answers "what is this link for":
--
--   `plan_kind`  (NOT NULL, added with the live-course port) says which TABLE
--                `pcb_price_id` points at: price | livePlan | testSeriesPrice.
--                "price" covers package AND course AND ebook, so it cannot tell
--                a course link from an ebook link.
--   `type`       was the legacy Mongo-era product type: 'P'/'C'/'B' single
--                letters. The migration never wrote it, so live courses — and in
--                fact almost everything — sat at NULL.
--
-- Staging before this change (144 rows):
--   plan_kind  type   n
--   price      NULL   101
--   price      p        5
--   livePlan   NULL     4
--
-- AFTER: `type` is one of package | course | ebook | live_course | test_series on
-- every row, written on every sync by syncPlanLinksSql. `test_series` is included
-- deliberately — leaving it NULL would keep NULL ambiguous and defeat the point of
-- the column.
--
-- The column stays varchar + NULLable rather than becoming an ENUM NOT NULL:
--   - the 5 legacy 'p' rows would fail an ENUM conversion, and
--   - `plan_kind` next to it is already a plain varchar(20) — matching it keeps the
--     two discriminators consistent, with the value set enforced in app code
--     (PLAN_LINK_TYPES in src/modules/promo-code/promo-code.service.ts).
-- Read paths must therefore keep treating NULL as "unknown → fall back to
-- plan_kind", never as a product type.
--
-- VERIFY BEFORE RUNNING — expected to show the NULL/legacy spread above:
--
--   SELECT plan_kind, type, COUNT(*) n FROM ws_promoted_package_course_ebook
--   GROUP BY plan_kind, type ORDER BY n DESC;
--
-- IDEMPOTENT: every statement is a targeted UPDATE; re-running is a no-op.

-- 1. Narrow the column to match plan_kind's width. varchar(255) was inherited from
--    the legacy single-letter column and nothing needs more than 12 chars.
ALTER TABLE ws_promoted_package_course_ebook
  MODIFY COLUMN `type` varchar(20)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci DEFAULT NULL
  COMMENT 'package|course|ebook|live_course|test_series — product the link is for (plan_kind says which plan TABLE)';

-- 2. Backfill the two single-table kinds — plan_kind alone is decisive here.
UPDATE ws_promoted_package_course_ebook
   SET `type` = 'live_course'
 WHERE plan_kind = 'livePlan';

UPDATE ws_promoted_package_course_ebook
   SET `type` = 'test_series'
 WHERE plan_kind = 'testSeriesPrice';

-- 3. Backfill the price kind from the plan row it points at. ws_package_course_ebook_price
--    holds all three products, keyed by whichever of package_id/course_id/ebook_id
--    is set — that column IS the product type.
--
--    Scoped to plan_kind = 'price' so a live-course link whose id happens to collide
--    with a price-plan id is not mistyped: live plan ids are 1-4 and price plan ids
--    1-4 both exist, and promocode JAL links both.
UPDATE ws_promoted_package_course_ebook l
  JOIN ws_package_course_ebook_price p ON p.id = l.pcb_price_id
   SET l.`type` = CASE
         WHEN p.package_id IS NOT NULL THEN 'package'
         WHEN p.course_id  IS NOT NULL THEN 'course'
         WHEN p.ebook_id   IS NOT NULL THEN 'ebook'
       END
 WHERE l.plan_kind = 'price'
   AND (p.package_id IS NOT NULL OR p.course_id IS NOT NULL OR p.ebook_id IS NOT NULL);

-- VERIFY AFTER RUNNING — (a) no row should be left NULL or holding a legacy letter:
--
--   SELECT plan_kind, type, COUNT(*) n FROM ws_promoted_package_course_ebook
--   GROUP BY plan_kind, type ORDER BY n DESC;
--
-- (b) type and plan_kind must never disagree — this must return no rows:
--
--   SELECT id, plan_kind, type FROM ws_promoted_package_course_ebook
--    WHERE (plan_kind = 'livePlan'        AND type <> 'live_course')
--       OR (plan_kind = 'testSeriesPrice' AND type <> 'test_series')
--       OR (plan_kind = 'price'           AND type NOT IN ('package','course','ebook'));
--
-- (c) any row still NULL is an ORPHAN link — its pcb_price_id no longer resolves in
--     ws_package_course_ebook_price. Those are already invisible to the app
--     (loadPlanLinksSql renders planId: null for them); list them for cleanup:
--
--   SELECT l.id, l.promocode_id, l.pcb_price_id, l.plan_kind
--     FROM ws_promoted_package_course_ebook l
--     LEFT JOIN ws_package_course_ebook_price p ON p.id = l.pcb_price_id
--    WHERE l.type IS NULL AND p.id IS NULL;
