# IST-in-DB Storage Migration — Runbook

**Date:** 2026-07-16
**Goal (client requirement):** store timestamps as **IST wall-clock** in the DB (not UTC),
while the API continues to return IST and the app code keeps working in UTC internally.

---

## Architecture

| Layer | Timezone | How |
|---|---|---|
| **DB (MySQL)** | **IST** wall-clock | Prisma middleware shifts every write `+5:30` |
| **App (Node)** | **UTC** (unchanged) | Same middleware shifts every read `-5:30` back |
| **API responses** | **IST** (`+05:30`) | Existing global `istJsonReplacer` (unchanged) |

Because the middleware un-shifts reads, **all app logic, filters, sorting, and the
IST response serializer keep working exactly as before** — only the physical DB
values changed. The API contract is **unchanged**, so **no frontend changes are needed.**

### Code changes
1. `src/config/prisma.ts` — `$use` middleware: `shiftDates(args, +330m)` on write,
   `shiftDates(result, -330m)` on read. Recurses only into plain objects/arrays
   (Decimal/BigInt/Buffer untouched). **Also intercepts `$queryRaw*`** (verified), so
   raw Date params/results are auto-shifted too.
2. `src/modules/admin-dashboard/admin-dashboard.service.ts` — the ONE raw SQL that did
   `CONVERT_TZ(created_at,'+00:00','+05:30')` for IST bucketing now uses `created_at`
   directly (the column is already IST). This is the only SQL-side timezone function in
   the codebase; everything else is auto-handled by the middleware.
3. `scripts/backfill-ist-timestamps.ts` — one-time data shift (below).

---

## ⚠️ Deploy ordering (critical)

The code (middleware) and the data (backfill) must be **consistent**:
- New code + un-backfilled UTC data → reads are `-5:30` too early (wrong).
- Backfilled IST data + old code → reads have no un-shift (wrong).

**They must cut over together.** Recommended: a short **maintenance window**.

```
1. Enable maintenance / drain traffic.
2. Deploy code (build) but DO NOT start the new process yet, OR stop the app.
3. Run the backfill (below). Verify a couple of rows.
4. Start the app on the new build (middleware active).
5. Smoke-test (a created record shows correct IST in the API; an old record's
   IST time matches its known local time). Lift maintenance.
```

If a hard window isn't possible, accept a brief inconsistency window and run
backfill immediately before `pm2 reload`.

---

## The backfill

`scripts/backfill-ist-timestamps.ts` shifts **every `ws_*` datetime/timestamp column
+5:30** so legacy UTC rows match new IST writes.

```
IST_BACKFILL_CONFIRM=YES npx tsx scripts/backfill-ist-timestamps.ts
```

Safety built in (learned the hard way — the naive single-UPDATE version overflowed
the binlog and crashed the server on the 600k-row tables):
- **Batched by PK range** (20k rows/statement) → bounded binlog events, replication-safe.
- **Resumable** — per-column + `last_id` progress in the `_ist_backfill` ledger; a
  crash/re-run continues where it stopped and **never double-shifts**.
- Requires `IST_BACKFILL_CONFIRM=YES`.
- Runs on a bare Prisma client (no middleware); `col + INTERVAL 330 MINUTE` shifts
  DATETIME wall-clock and TIMESTAMP instant identically (both +5.5h).

**Production sizing:** on a large DB (e.g. 600k-row subscription tables) run during low
traffic. Batching keeps binlog on; if binlog capacity is a concern, run in a window with
`sql_log_bin=0` **and rebuild replicas afterward** (binlog-off changes don't replicate).

---

## Rollback

- **Code:** revert the two `src/` changes (middleware + dashboard). Storage reverts to UTC-write.
- **Data:** if already backfilled, run the same shift with **`-330`** minutes to return to UTC
  (mirror the script). Must be paired with the code revert.

---

## Verification (run after cutover)

- A record created "now" → API `createdAt` shows correct current IST (`+05:30`); raw DB
  value equals that IST wall-clock.
- An old record → API IST matches its known real local time; raw DB value = IST wall-clock;
  Prisma read (internal) = the original UTC instant.
- Dashboard hourly/daily buckets align to IST.
- Date-range filters return the expected set.

_Verified on local (staging copy) 2026-07-16: legacy inquiry id=1 stored `09:36` UTC →
backfilled to `15:06` IST → Prisma reads `09:36Z` → API `15:06+05:30`. All 261 `ws_*`
datetime/timestamp columns shifted; marker recorded._
