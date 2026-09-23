-- 2026-07-13 — Backfill NULL created_at / updated_at on ebook order + subscription
--
-- Context: ws_ebook_order and ws_ebook_subscription rows created before the schema
-- gained @default(now()) / @updatedAt landed with NULL created_at / updated_at
-- (see MIGRATION_QUERY_CHANGES.md 2026-07-13). This backfills the historical rows
-- using the best available PROXY timestamp — it is approximate, not the exact
-- original insert time (which was never recorded).
--
-- Proxy chosen:
--   * ws_ebook_subscription.created_at  ←  start_at   (access began ≈ purchase moment)
--   * ws_ebook_order.created_at         ←  its linked subscription's created_at/start_at
--     (the order has no date column of its own; only the subscription carries one)
--
-- Caveats:
--   * Rows whose start_at is itself NULL, and orders with no linked subscription
--     (e.g. failed/pending purchases), stay NULL — there is no signal to derive from.
--   * Admin backend grants that set a custom future start_at will get a created_at
--     equal to that start_at, which may differ slightly from the true grant time.
--
-- SAFETY: run on STAGING first and eyeball a few rows. Idempotent (WHERE ... IS NULL).
-- Apply with:  npx prisma db execute --file docs/migration/schema-changes/2026-07-13_ebook_timestamp_backfill.sql
-- Run STEP 1 before STEP 2 (step 2 reads the created_at that step 1 fills).

-- STEP 1 — subscriptions: created_at/updated_at from start_at
UPDATE ws_ebook_subscription
SET
  created_at = COALESCE(created_at, start_at),
  updated_at = COALESCE(updated_at, created_at, start_at)
WHERE created_at IS NULL OR updated_at IS NULL;

-- STEP 2 — orders: created_at/updated_at from the linked subscription
--          (earliest linked subscription per order).
UPDATE ws_ebook_order o
JOIN (
  SELECT order_id, MIN(COALESCE(created_at, start_at)) AS ts
  FROM ws_ebook_subscription
  WHERE order_id IS NOT NULL
  GROUP BY order_id
) s ON s.order_id = o.id
SET
  o.created_at = COALESCE(o.created_at, s.ts),
  o.updated_at = COALESCE(o.updated_at, o.created_at, s.ts)
WHERE o.created_at IS NULL OR o.updated_at IS NULL;

-- Verification (optional): how many rows still NULL after the backfill.
-- SELECT
--   (SELECT COUNT(*) FROM ws_ebook_subscription WHERE created_at IS NULL) AS sub_created_null,
--   (SELECT COUNT(*) FROM ws_ebook_order        WHERE created_at IS NULL) AS ord_created_null;
