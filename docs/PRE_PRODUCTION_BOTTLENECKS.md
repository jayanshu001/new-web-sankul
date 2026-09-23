# Pre-Production Bottleneck Audit — WebSankul Backend

**Date:** 2026-07-23 · **Branch:** `migration` · **Method:** static read of hot paths,
config, and schema, then targeted runtime verification of each fix.

**Status: 7 of 12 resolved, 1 partially, 4 open.** See the Status column below.
Every ✅ was verified by running it (differential parity tests, EXPLAIN plans,
concurrency tests) — not by inspection. DB-affecting changes are logged in
`docs/MIGRATION_QUERY_CHANGES.md`; one DDL is pending deploy
(`docs/migration/schema-changes/2026-07-23_video_category_relation_indexes.sql`).

**Two findings were wrong and are corrected in place** (#6, #8) — the audit was static,
the DB disagreed. Kept visible rather than deleted, so the reasoning is auditable.

**Read this first:** a prior audit (`docs/SCALABILITY_OPTIMIZATION_AUDIT.md`, 2026-07-01)
listed several P0s that are **now fixed** — `/readyz` probes MySQL via
`prisma.$queryRaw` (`src/middlewares/health.ts:82`), workers no longer run in API
replicas (`ecosystem.config.cjs` splits `websankul-api` / `websankul-worker`), the rate
limiter is Redis-backed and cluster-wide, and `cacheRoute` now has real stampede control.
The findings below are the ones that **survive in current code**, plus new ones.

Severity: **P0** = will hurt in production, fix before launch · **P1** = will hurt at
scale, fix before the traffic that triggers it · **P2** = tune once measured.

---

## Summary table

| # | Sev | Issue | Status |
| --- | --- | --- | --- |
| 1 | **P0** | 500 MB JSON/urlencoded body limit + `rawBody` copy on every request | ✅ **Fixed** — 1mb (`BODY_LIMIT`), rawBody scoped to webhooks, 25mb carve-out for bulk import |
| 2 | **P0** | Catalog: per-category N+1 fan-out | ⚠️ **Partial** — videos path fixed (60→5 queries, verified). **Materials (`:381`) and exams (`:427`) still fan out** |
| 3 | **P0** | Lecture heartbeat read-modify-write → races | ✅ **Fixed** — race-safe upsert; 12 concurrent heartbeats: 11 failures → 0 |
| 4 | **P0** | Broadcast loads every device token + giant `IN()` | ✅ **Fixed** — PK-paged 5k/page, ids chunked 1k, dedup preserved |
| 5 | **P1** | Chromium renders inside API processes capped at 512 MB | ❌ **Open — needs your decision** (worker vs raise cap) |
| 6 | **P1** | Index coverage | ✅ **Fixed + partly WRONG** — `ws_video`/`ws_customer` were already indexed; the real gap was `ws_video_category_relation` (DDL added) |
| 7 | **P1** | Connection pool unset vs `max_connections` | ✅ **Documented** — formula + commands in `.env.example`; **you must set the value** |
| 8 | **P1** | Unbounded `findMany` on dashboard sections | ✅ **Fixed + partly WRONG** — no `status` column exists; added bounding `take` only |
| 9 | **P2** | ~4 Redis round-trips/request; JWT verified twice | ⏸ Deferred — measure in Phase 2 first |
| 10 | **P2** | `compression()` on every response | ⏸ Deferred — measure in Phase 3 first |
| 11 | **P2** | `skip`/`take` deep pagination | ⏸ Deferred — Phase 2 J3 probes it |
| 12 | **P2** | `scope: "user"` cache on shared catalog data | ⏸ Deferred — Phase 4 measures hit ratio |

### Remaining work

1. **#2 tail** — materials + exams fan-out (same fix as videos; `descendantIds` per
   category + 2–3 counts per category). Mechanical now that the pattern is proven.
2. **#5** — puppeteer, blocked on your call.
3. **#7** — set the real `connection_limit` for your box.
4. **#9–12** — after the first k6 run, not before. They are tuning, not bugs.

---

## P0 findings

### 1. Body-size limit is 500 MB, and every JSON body is buffered twice

```ts
// src/app.ts:210
express.json({ limit: "500mb", ... verify: (req, _res, buf) => { (req as any).rawBody = buf; } })
// src/app.ts:238
express.urlencoded({ extended: true, limit: "500mb" })
```

**Why it breaks:** a single request can allocate 500 MB. Ten concurrent ones OOM a
512 MB PM2 worker instantly, and `JSON.parse` on a body that large blocks the event loop
for *seconds* — every other request on that worker stalls behind it. The `verify` hook
compounds it: `rawBody` retains a **second full copy** of every JSON body, on every
route, when only the Razorpay webhook needs it.

This limit also contradicts the project's own design — large files (ebook PDFs ≤500 MB)
go **direct-to-Spaces via `/admin/uploads/presign`**, never through this parser. Nothing
legitimately posts a 500 MB JSON body.

**Fix:**
- `express.json({ limit: "1mb" })`, `urlencoded({ limit: "1mb" })`. Raise per-route only
  where a real payload needs it (bulk admin imports).
- Move the `verify`/`rawBody` capture onto the webhook router only, not the global parser.

**Verify:** post a 50 MB JSON body and watch RSS; then re-run Phase 2 and confirm p95 on
other routes is unaffected.

---

### 2. Catalog videos — N+1 fan-out per category on an uncached route

```ts
// client-catalog.service.ts:158
const list = await Promise.all(selected.map(async (cat) => {
  ...
  const videos = await prisma.video.findMany({ where: videoWhere, orderBy: { order: "asc" } });   // :178
  const rows   = await prisma.lectureProgress.findMany({ where: { customerId, videoId: { in: ... } } }); // :181
}));
```

Three compounding problems:
1. **Two queries per category**, fanned out with `Promise.all` — a package with 30
   subject categories issues 60 concurrent queries **for one request**.
2. **No `take`, no `select`** on `video.findMany` — every column of every video in the
   category, however many that is.
3. `GET /client/catalog/:type/:id/videos` is **not** wrapped in `cacheRoute`, while its
   siblings (`/materials`, `/tests`) are (`src/client/catalog/catalog.routes.ts:18-21`).

The same shape repeats for materials and exams.

**Status 2026-07-23 — videos path FIXED, materials + exams STILL OPEN.**
The grouped video path is now 3 batched queries regardless of category count
(`descendantsByRoot` + two `groupBy`s), and the flat `course` path gained an explicit
`select`. Measured on staging: a 20-category package went from **60 queries for the counts
alone to 5 for the whole request.** Parity verified across 20 responses, 0 mismatches.

Still fanning out, same fix applies:
- **Materials** — `client-catalog.service.ts:381`: per category, `descendantIds()` +
  `material.count` + `materialCategory.findMany` + `materialCategoryAncestors` (**4 queries
  per category**).
- **Exams** — `client-catalog.service.ts:427`: per category, `descendantIds()` +
  `exam.count` + `examCategory.count` (**3 per category**).

Note these walk `ws_material_category.parent` / `ws_exam_category.parent_id` (self-FK
columns) via a different helper, `descendantIds()` — not the relation-table CTE the video
path uses — so they need their own batched equivalent rather than `descendantsByRoot`.

**Why it breaks:** at 200 concurrent users this route alone can demand thousands of
simultaneous connections against a pool of ~10. Requests queue on the pool, p99 explodes,
then pool timeouts surface as 500s. **This is my prediction for the first thing Phase 2
breaks.**

**Fix:**
- Collapse to **two queries total**: one `video.findMany({ where: { videoCategoryId: { in: allCatIds } } })`
  and one `lectureProgress.findMany` for all video ids, then group in JS. The batched-`IN`
  pattern is already used well elsewhere in this codebase (`client-dashboard.service.ts:155-160`) — follow it.
- Add `select` (only the fields the transformer emits) and a `take` bound.
- Consider `cacheRoute` for the anonymous/shared portion.

---

### 3. Lecture heartbeat: read-modify-write instead of `upsert`

```ts
// client-lecture-progress.service.ts:80-87
const existing = await prisma.lectureProgress.findFirst({ where: { customerId, videoId } });
...
if (existing) return prisma.lectureProgress.update({ where: { id: existing.id }, data: set });
return prisma.lectureProgress.create({ data: { customerId, videoId, ...set } });
```

The table **already has** the right constraint —
`@@unique([customerId, videoId], name: "uniq_customer_video")` (`prisma/schema.prisma:2000`)
— so this hand-rolled path is both slower and unsafe.

**Why it breaks:** this is the platform's **highest-frequency write** (every playing
student, on an interval — and per the per-container progress model, the same student can
have two players open). Two concurrent heartbeats for one `(customer, video)` both see
`existing === null` and both `create` → the unique constraint fires **P2002 → 500** to a
student mid-video. It also costs **two round trips** where one suffices, and `findFirst`
selects every column when only `id` is used.

**Fix:** use the native atomic upsert (identical for `upsertLiveSessionProgress`):
```ts
return prisma.lectureProgress.upsert({
  where:  { uniq_customer_video: { customerId, videoId } },
  update: set,
  create: { customerId, videoId, ...set, createdAt: now, completed: !!completedNow },
});
```

**Verify:** Phase 3 with J4 as a `constant-arrival-rate` scenario, two VUs sharing one
`(customer, video)` pair. Current code should produce P2002s; fixed code shouldn't.

---

### 4. Notification broadcast materializes every device token in memory

```ts
// admin-notification.service.ts:131-138  (collectTokens, audience.isAll)
const rows = await prisma.customer.findMany({
  where: { isAccountDeleted: false, status: true, firebaseToken: { not: null } },
  select: { firebaseToken: true },
});
return rows.map((r) => r.firebaseToken!).filter(Boolean);
```

And at `:113`, `customer.findMany({ where: { id: { in: idIn } } })` where `idIn` can be
every subscriber of a course.

**Why it breaks:** on a ~600k-customer base (the size the IST backfill had to
PK-batch around) a broadcast allocates a single array of hundreds of thousands of token
strings — tens of MB in one go — and the `IN (...)` variant can generate a query packet
large enough to hit `max_allowed_packet`. It runs in the worker, not the API, so it won't
show in k6 — but it will show at 9pm when marketing sends an announcement.

**Fix:** cursor-paginate (`take` + `cursor` on PK, the pattern
`scripts/backfill-ist-timestamps.ts` already uses), dispatching in FCM-sized chunks (500)
per page. Never build the full list.

---

## P1 findings

### 5. Chromium runs inside the API process, under a 512 MB cap
`src/libs/core/generate.ts` launches puppeteer (lazily cached, which is good), and the
callers are **client request handlers** — `src/client/{ebook,course,book,exam}/*.controller.ts`
(receipts/invoices). Meanwhile `ecosystem.config.cjs` sets
`max_memory_restart: "512M"` on `websankul-api`.

A cached Chromium plus page renders will sit well above that. PM2 will restart the
worker — **killing every in-flight request on it**, including unrelated ones. And each
render burns CPU that the event loop needs.

**Fix:** route PDF generation to the `websankul-worker` app (BullMQ job + poll/signed URL,
exactly like the existing async-export design), or at minimum raise the API memory cap and
cap concurrent renders. Phase 5 (soak) with a trickle of invoice requests will expose the
restart loop.

### 6. Index coverage — TWO THIRDS OF THIS FINDING WAS WRONG

**Corrected 2026-07-23 against the live DB.** The caveat below was the right instinct:
`schema.prisma` is hand-curated, and the DB *does* carry indexes it doesn't declare.

- `ws_video` — **already indexed** on `vcategory_id` (`statusSubject`,
  `idx_vcategory_platform`, `status_id_3`). No action.
- `ws_customer` — **already indexed** on `phone` (`idx_get_user_by_phoneNumber`),
  `referral_code`, plus a unique `phone_active`. No action.
- `ws_video_category_relation` — **had ONLY a PRIMARY KEY.** This is the real gap, and a
  worse one than either claim above: the table backs the recursive CTE that walks the
  category DAG on every catalog request. Verified before:
  `type: ALL, key: NULL, rows: 2456`. After adding `idx_vcr_parent` / `idx_vcr_child`:
  `type: range, key: idx_vcr_parent, rows: 5, Using index`.
  DDL: `docs/migration/schema-changes/2026-07-23_video_category_relation_indexes.sql`.

**Lesson worth keeping:** never infer index coverage from `schema.prisma` in this repo.
Always `SHOW INDEX` / `information_schema.STATISTICS` against the live DB.

<details><summary>Original (incorrect) finding, kept for auditability</summary>

#### Index coverage looks thin
`prisma/schema.prisma` declares **36 `@@index` across ~121 models**. Specifically:
- `Video` declares only `@@index([liveSessionId])` — **nothing on `videoCategoryId`**,
  which is the filter for the fan-out in finding #2.
- `Customer` declares **no `@@index` and no `@unique`** at all — including on the mobile
  number used for login lookups.

**Caveat, stated plainly:** `schema.prisma` here is hand-curated (`yarn db:pull` is
avoided because it reverts the file), so the DB may carry indexes the schema doesn't
declare. **Verify against the live DB before acting** — `SHOW INDEX FROM ws_video;`,
`SHOW INDEX FROM ws_customer;` — then add any missing ones as DDL under
`docs/migration/schema-changes/`.

</details>

### 7. Connection pool is unset by default
`.env.example:18-20` documents `connection_limit` but the shipped `DATABASE_URL` omits it.
Prisma's default is `num_cpus * 2 + 1` **per process**. With `API_INSTANCES=2` (default)
on an 8-core box that's ~34 connections; raise instances to 8 and it's ~136 — against a
MySQL `max_connections` that is often 151. One admin report run then fails with
`too many connections`.

**Fix:** set an explicit `connection_limit` sized as
`max_connections × 0.8 ÷ (API_INSTANCES + worker)`, and document the arithmetic next to it.
Phase 3 + `SHOW STATUS LIKE 'Threads_connected'` measures the real ceiling.

### 8. Unbounded dashboard section query
`client-dashboard.service.ts:102`:
```ts
prisma.bannerSlider.findMany({ orderBy: { orderBy: "asc" } })   // no take, no status filter
```
Every other section in that `Promise.all` is capped by `DASHBOARD_SECTION_LIMIT`. This one
returns every banner row ever created, including inactive ones, on the most-hit
authenticated route. Add `where: { status: true }` and a `take`.

**Corrected 2026-07-23:** the "including inactive ones" half was wrong — `ws_banner_slider`
has **no `status` column** to filter on, and holds 2 rows. Adding a `where` would have been
a behaviour change based on a column that doesn't exist. Only the bounding `take`
(`BANNER_LIMIT = 50`, far above any realistic banner count) was applied, so today's
response is unchanged. Real severity: **P2, not P1.**

---

## P2 — tune after measuring

9. **Per-request Redis chattiness.** `authenticate` does a revocation check plus a cached
   customer-gate lookup, and `rateLimiter.ts:50` (`bearerUserId`) **verifies the JWT a
   second time** just to build the limit key, on top of the limiter's own INCR. That's
   ~3–4 Redis round-trips and 2 JWT verifies per request. Individually cheap, but it puts
   Redis on the critical path of *every* call — measure its contribution to
   `http_req_waiting`, and consider stashing the decoded token on `req` for reuse.
10. **`compression()` runs on every response** with default settings — gzip CPU on
    hot cached JSON. Consider a `threshold` and skipping already-small payloads.
11. **`skip`/`take` deep pagination.** MySQL `LIMIT n OFFSET 100000` scans and discards.
    Phase 2 J3 explicitly probes `page=50`; if it's slow, move to keyset pagination on
    hot lists.
12. **`scope: "user"` on shared catalog data.** `/client/course` and
    `/client/course/categories/:id/courses` cache per user (`catalog-course`, 86400s) but
    the payload is largely identical across users — one entry per user is a Redis-memory
    multiplier and a much lower hit ratio than `scope: "shared"` would give. Where a
    payload has only a small user-specific slice (owned/not-owned), consider caching the
    shared body and decorating per user.

---

## Fix order — where we are

1. ~~**#1 body limit**~~ ✅
2. ~~**#3 heartbeat upsert**~~ ✅
3. **#2 catalog fan-out** — ⚠️ videos ✅, **materials + exams still open**
4. ~~**#6 index verification**~~ ✅ (DDL pending deploy) · **#7 pool** — documented, value not set
5. ~~**#8 banner cap**~~ ✅ · ~~**#4 broadcast**~~ ✅ · **#5 puppeteer** — needs a decision
6. Re-run the identical k6 phase after each fix and record the delta (§11 of the k6 plan).

**Deploy checklist for what's already done:**
- Apply `docs/migration/schema-changes/2026-07-23_video_category_relation_indexes.sql`
- Set a real `connection_limit` on `DATABASE_URL` (formula in `.env.example`)
- Regression-test the two payment webhooks (rawBody scoping touched that path)

Log any query/index/schema change from this list in `docs/MIGRATION_QUERY_CHANGES.md`
(newest first), per the project rule.
