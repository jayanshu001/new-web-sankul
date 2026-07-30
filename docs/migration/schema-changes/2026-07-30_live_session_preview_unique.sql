-- 2026-07-30  ws_live_session_preview: one preview row per (customer, session)
--
-- WHY: the 3-minute live-session preview must be non-resettable — reopening the
-- player, switching devices, reinstalling, or entering the SAME shared session
-- through a different unpurchased live course all have to continue the original
-- window. Preview is therefore keyed on (customer_id, live_session_id) only, but
-- the table had no constraint backing that: two simultaneous first-opens could
-- each INSERT a row.
--
-- The application layer is already race-tolerant (it always reads the OLDEST row,
-- so a duplicate cannot restart the clock — see resolveLivePreviewStateSql /
-- previewLevelMapSql). This index makes the invariant structural, and lets the
-- duplicate INSERT fail fast instead of writing a dead row.
--
-- Step 1 collapses any duplicates that already exist, KEEPING THE EARLIEST row
-- per pair (lowest id) — never the newest, which would hand back preview time.
-- Rows with a NULL customer_id / live_session_id are untouched: the columns are
-- nullable and MySQL allows multiple NULLs under a UNIQUE index.
--
-- Apply: yarn db:migrate   (or: npx prisma db execute --file <this file>)
--
-- NOTE: no prisma/schema.prisma change — nothing in the code reads this index by
-- name and no Prisma query shape depends on it, so there is no client to
-- regenerate and no schema drift to introduce.

-- 1. dedupe: drop every row that is not the earliest for its (customer, session)
DELETE p FROM ws_live_session_preview p
JOIN (
  SELECT customer_id, live_session_id, MIN(id) AS keep_id
  FROM ws_live_session_preview
  WHERE customer_id IS NOT NULL AND live_session_id IS NOT NULL
  GROUP BY customer_id, live_session_id
  HAVING COUNT(*) > 1
) d
  ON p.customer_id = d.customer_id
 AND p.live_session_id = d.live_session_id
 AND p.id <> d.keep_id;

-- 2. enforce it going forward
CREATE UNIQUE INDEX uq_live_session_preview_customer_session
  ON ws_live_session_preview (customer_id, live_session_id);
