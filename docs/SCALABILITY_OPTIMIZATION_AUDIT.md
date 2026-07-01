# New Web Sankul Scalability and API Optimization Audit (Post-MySQL Migration)

Audit date: 2026-07-01

Scope: `new-web-sankul` backend APIs, MySQL/Prisma data layer, Redis, queues, sockets, workers, caching, and hot-path query patterns. Comparison against the prior MongoDB-era audit (2026-05-26).

Related documents (split for clarity):

- [Implementation and Logic Issues Audit](./IMPLEMENTATION_ISSUES_AUDIT.md) — webhooks, auth, error handling, logging correctness, Mongo artifacts
- [Deployment and Operations Audit](./DEPLOYMENT_OPERATIONS_AUDIT.md) — PM2 topology, Docker, build pipeline, env, infrastructure, load tests

Migration context: The project has completed module-by-module migration from MongoDB/Mongoose to MySQL/Prisma. `src/config/migration.ts` hard-codes `isMysqlModule() === true` and `isMongoFallbackEnabled() === false`. All production traffic is served from MySQL. See `docs/migration/legacy_system_migration_strategy.md` and `docs/migration/DEPLOY_RUNBOOK.md`.

---

## Executive Summary

`new-web-sankul` retains a strong production foundation from the prior optimization pass:

- Express security/performance middleware: `helmet`, `compression`, CORS allowlist, body-size limits.
- Redis-backed sessions, cache helper, rate-limit support, crash/email throttling, and Socket.IO adapter.
- PM2 cluster deployment config with `wait_ready`.
- `/healthz`, `/readyz`, token-gated `/metrics`, request tracing, structured logs, crash reporting, and graceful shutdown.
- BullMQ notification scheduler with retries, DLQ, queue-depth metrics, and backpressure.
- MySQL/Prisma migration complete with SQL modules for catalog, commerce, notifications, dashboard, and search.
- `parseListQuery` centralizes pagination for migrated list endpoints (default 20, max 100).
- `docs/migration/DEPLOY_RUNBOOK.md` documents MySQL-only deployment.

The biggest scalability risks after the MySQL migration are:

- **Critical regression:** `/readyz` and `/health` still probe MongoDB, not MySQL — readiness will always fail in MySQL-only mode.
- **Rate limiting is effectively off** for public APIs: global limiter is commented out; OTP limiter is disabled; Redis store init race remains latent.
- Queue workers (notification, PDF upload, plan popularity) still start inside every API process — see [Deployment Audit § D0.3](./DEPLOYMENT_OPERATIONS_AUDIT.md#d03-pm2-worker-topology--workers-run-in-every-api-instance).
- Large notification broadcasts load all device tokens into memory.
- Home dashboard loads unbounded `courses`, `testimonials`, and `banners`.
- Package detail pages run N+1 SQL (recursive CTE + count queries per category).
- Search uses `LIKE '%term%'` across five entity types with no FULLTEXT indexes.
- CPU-heavy work (`ffmpeg`, `puppeteer`) still runs inside API processes.
- Cache infrastructure exists but `cache.aside()` is never wired on read paths.
- MongoDB-era artifacts remain — see [Implementation Audit § I1.7](./IMPLEMENTATION_ISSUES_AUDIT.md#i17-mongodb-era-artifacts-cause-observability-drift).

---

## Priority 0 — Must Fix Before Production Traffic

### P0.1 `/readyz` Still Probes MongoDB Instead of MySQL

Evidence:

- `src/middlewares/health.ts:78–99` — readiness checks `mongoose.connection.readyState` and pings Mongo admin.
- `src/index.ts:58` — boot calls `connectPrisma()` only; `connectDB()` from `src/config/db.ts` is never invoked.
- `src/config/migration.ts:39` — `isMongoFallbackEnabled()` returns `false`; Mongo is never connected at runtime.

Impact:

- **`/readyz` returns 503 permanently** in MySQL-only production — load balancers will drain all instances or operators will ignore the probe.
- Rolling deploys cannot use readiness-based traffic drain correctly.
- `/health` dashboard (`health.ts:136–150`) always reports `mongoDB: "disconnected"` even when the app is healthy.

Recommendations:

**Step 1 — Replace Mongo probe with Prisma/MySQL ping in `readinessHandler`:**

```typescript
// src/middlewares/health.ts — replace the mongo block
const mysqlStart = Date.now();
try {
  await withTimeout(prisma.$queryRaw`SELECT 1`, PING_TIMEOUT_MS, "mysql");
  checks.mysql = { ok: true, latencyMs: Date.now() - mysqlStart };
} catch (err) {
  checks.mysql = { ok: false, latencyMs: Date.now() - mysqlStart, error: (err as Error).message };
}
```

**Step 2 — Update `healthReportHandler` to report `database: { mysql, redis }` instead of `mongoDB`.**

**Step 3 — Remove `mongoose` import from `health.ts` once probes are migrated.**

**Step 4 — Add a staging smoke test:** `curl /readyz` must return 200 after `yarn build && yarn start`.

---

### P0.2 Global Rate Limiter Is Commented Out

Evidence:

- `src/app.ts:281–282` — `// app.use(globalLimiter);` is disabled.
- `src/config/rateLimiter.ts:6–21` — `globalLimiter` is defined (60 req/min per IP) but not mounted.

Impact:

- Client, educator, promoter, and webhook surfaces have **no global IP rate protection**.
- Only admin routes are protected (`adminLimiter` at 240/min per admin in `admin.routes.ts`).
- DDoS and abuse traffic can hit MySQL, Redis, and external providers (SMS, Razorpay) without throttling.

Recommendations:

**Step 1 — Re-enable global limiter in `app.ts`**, mounted after health/metrics but before route handlers:

```typescript
app.use(globalLimiter);
```

**Step 2 — Fix Redis store initialization (see P0.3) before re-enabling.**

**Step 3 — Add `app.set("trust proxy", 1)`** (or correct hop count for your LB) in `app.ts` so `req.ip` reflects the client IP, not the load balancer.

**Step 4 — Review limiter ordering:** global 60/min runs before admin routes; ensure admin traffic is not throttled by shared egress IP before `adminLimiter` applies.

---

### P0.3 Redis Rate Limiting Can Fall Back to Per-Process Memory

Evidence:

- `src/config/rateLimiter.ts:15–20` — store is chosen with `isRedisReady()` at **module import time**.
- `isRedisReady()` checks `redisClient.status === "ready"` (`src/config/redis.ts`); at import time Redis is typically still `connecting`.
- If Redis is not ready during import, `store` is `undefined` and the limiter remains in-memory for that process lifetime.

Impact:

- In PM2 cluster mode, every process gets its own counter.
- Across multiple servers, each server gets its own counter.
- Effective limit becomes `limit × process count × server count`, weakening DDoS/abuse protection.

Recommendations:

**Step 1 — Always construct limiters with `RedisStore`**, never gate on `isRedisReady()` at module load:

```typescript
const redisStore = (prefix?: string) =>
  new RedisStore({
    sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any,
    ...(prefix ? { prefix } : {}),
  });

export const globalLimiter = rateLimit({
  // ...
  store: redisStore(),
});
```

**Step 2 — Fail closed in production** if Redis is unavailable for critical limiters (log + reject or use a startup gate).

**Step 3 — Lazy-init alternative:** defer limiter creation until after Redis `ready` event in `index.ts`, then mount dynamically.

---

### P0.4 OTP Rate Limiting Is Disabled

Evidence:

- `src/client/auth/auth.routes.ts:6–9, 18, 25` — `otpLimiter` import and middleware are commented out with a `TEMP (testing)` note.
- Application-level `OTP_MAX_ATTEMPTS` exists in `auth.service.ts` but no IP-level throttle.

Impact:

- Public OTP endpoints are exposed to SMS/email cost abuse.
- Attackers can spam a phone number or drain provider quotas.
- Heavy OTP traffic creates unnecessary MySQL/Redis/provider pressure.

Recommendations:

**Step 1 — Re-enable `otpLimiter` immediately:**

```typescript
import { otpLimiter } from "../../config/rateLimiter";
router.post("/otp/generate", otpLimiter, generateOtpHandler);
router.post("/otp/resend", otpLimiter, resendOtpHandler);
```

**Step 2 — Add phone-number based throttling** in `auth.service.ts` (Redis key `otp:phone:{normalizedPhone}`, cooldown 60s, daily cap).

**Step 3 — Use `crypto.timingSafeEqual`** for OTP comparison instead of plain `!==` (`auth.service.ts`).

**Step 4 — Log and alert** on OTP throttle hits and provider errors.

---

## Priority 1 — High Impact Scalability Issues

### P1.1 Queue Workers Start Unconditionally in Every Process

Evidence:

- `src/index.ts:65–70` — `initNotificationScheduler()`, `initPdfUploadScheduler()`, and `initPlanPopularityScheduler()` run on every boot with no env gate.
- `src/admin/pdfUpload/pdfUpload.scheduler.ts` — worker `concurrency: 1` (intended single-PDF FIFO).
- `src/admin/notification/scheduler.ts` — worker `concurrency: 5`.

Impact:

- With PM2 cluster (2+ instances), PDF and notification workers multiply — defeating single-flight PDF design and causing duplicate FCM dispatches.
- Plan popularity cron runs N identical sweeps per pod every 24h.
- API scaling also scales background workers even when queue depth does not require it.

Recommendations:

**Step 1 — Gate worker startup in `index.ts`:**

```typescript
if (process.env.WORKER_ENABLED === "true") {
  await initNotificationScheduler();
  await initPdfUploadScheduler();
  initPlanPopularityScheduler();
}
```

**Step 2 — Use a Redis leader lock** for notification rehydration so only one worker scans scheduled rows on boot.

**Step 3 — Rehydrate with batched SQL queries** (`findMany` with `take` + cursor) instead of loading all scheduled notifications at once.

**Step 4 — Call `stopPlanPopularityScheduler()`** in `gracefulShutdown.ts`.

> PM2 ecosystem split (separate `websankul-api` and `websankul-worker` apps), memory limits, and `listen_timeout` tuning: [Deployment Audit § D0.3](./DEPLOYMENT_OPERATIONS_AUDIT.md#d03-pm2-worker-topology--workers-run-in-every-api-instance).

---

### P1.2 Notification Fanout Loads Large Audiences Into Memory

Evidence:

- `src/modules/admin-notification/admin-notification.service.ts:131–149` — `collectTokens()` for broadcast loads all live customer IDs, then all device tokens:

```typescript
const liveIds = await prisma.customer.findMany({ where: { isAccountDeleted: false, status: true }, select: { id: true } });
const rows = await prisma.customerDeviceToken.findMany({
  where: { customerId: { in: liveIds.map((c) => c.id) } },
  select: { token: true },
});
return rows.map((r) => r.token).filter(Boolean);
```

- Targeted sends use `createMany` with one row per recipient (`admin-notification.service.ts:193–210`).

Impact:

- Large broadcasts create high memory usage in one worker.
- FCM sends and feed fanout can become long-running jobs.
- A single large notification can block queue concurrency and increase retry blast radius.

Recommendations:

**Step 1 — Paginate token collection** with cursor-based batches (e.g. 500 customers per batch):

```typescript
async function* tokenBatches(audience: ResolvedAudience, batchSize = 500) {
  let cursor: number | undefined;
  for (;;) {
    const rows = await prisma.customerDeviceToken.findMany({
      where: { /* audience filter */ },
      take: batchSize,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: "asc" },
      select: { id: true, token: true },
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    yield rows.map((r) => r.token).filter(Boolean);
  }
}
```

**Step 2 — Chunk FCM sends** (Firebase recommends ≤500 tokens per multicast).

**Step 3 — Chunk `createMany`** for per-recipient feed rows (batch size 200–500).

**Step 4 — Split large campaigns** into child BullMQ jobs by audience segment.

**Step 5 — Add max-recipient guardrails** and require explicit admin override for sends above a threshold (e.g. 50k).

---

### P1.3 Socket Presence Uses Cluster-Wide Scans on Hot Paths

Evidence:

- `src/socket/livechat.socket.ts` — `viewerCount()` uses `io.in(room).fetchSockets()`; called on join, leave, and disconnect.
- Ban/unban flows call `io.fetchSockets()` across all sockets.

Impact:

- `fetchSockets()` asks every Socket.IO node for socket metadata via Redis adapter.
- Large live classes increase Redis adapter chatter and cross-process work.
- Join/leave storms amplify presence updates.

Recommendations:

**Step 1 — Maintain room-level viewer counters in Redis:**

```typescript
// On join:  await redisClient.hincrby(`room:${roomId}:viewers`, customerId, 1)
// On leave:  await redisClient.hincrby(`room:${roomId}:viewers`, customerId, -1)
// Count:     await redisClient.hlen(`room:${roomId}:viewers`)
```

**Step 2 — Track each customer in a per-customer socket room** (`customer:{id}`) so ban/unban targets that room instead of scanning all sockets.

**Step 3 — Debounce viewer-count broadcasts** (e.g. 500ms coalesce per room).

**Step 4 — Add per-socket event rate limits** for `send_message`, `submit_vote`, and room join/leave.

**Step 5 — Re-enable single-device session enforcement** (currently commented out in `livechat.socket.ts` and `authenticate.ts`).

---

### P1.4 Camera Ingest Runs `ffmpeg` Inside API Workers

Evidence:

- `src/socket/camera-ingest.ts` spawns `ffmpeg` per ingest WebSocket.
- Binary media chunks are written directly to `ffmpeg.stdin`.
- No per-stream concurrency lock, payload cap, or backpressure handling around `stdin.write()`.

Impact:

- CPU-heavy transcoding can starve API request handling.
- Multiple streams can exhaust CPU/memory and trigger PM2 restarts.
- A single slow `ffmpeg` pipe can accumulate pressure inside the API process.

Recommendations:

**Step 1 — Move camera ingest/transcoding** to a separate worker service or dedicated media node.

**Step 2 — Add a Redis lock** so only one active ingest exists per stream.

**Step 3 — Configure WebSocket `maxPayload`**, pre-auth buffer limits, and idle timeouts.

**Step 4 — Handle `stdin.write()` backpressure** by pausing/resuming socket reads or closing overloaded streams.

**Step 5 — Run capacity tests** for concurrent live classes before enabling ingest on the same nodes as APIs.

---

### P1.5 Graceful Shutdown Does Not Close Socket Servers Explicitly

Evidence:

- `src/utils/gracefulShutdown.ts` supports a `preClose` hook for websockets.
- `src/index.ts:89` — `installGracefulShutdown({ httpServer })` without socket teardown.
- `initLiveChatSocket()` and `initCameraIngest()` return server handles that are not retained for shutdown.

Impact:

- Existing upgraded WebSocket connections may keep running during deploy drain.
- Socket.IO Redis pub/sub duplicate clients may remain open until process exit.
- Draining behavior can be inconsistent during rolling restarts.

Recommendations:

**Step 1 — Store Socket.IO and `ws` server handles in `index.ts`:**

```typescript
const io = initLiveChatSocket(httpServer, allowedOrigins);
const wss = initCameraIngest(httpServer);
installGracefulShutdown({
  httpServer,
  preClose: async () => {
    await io.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  },
});
```

**Step 2 — During shutdown, emit a reconnect/draining signal** to connected clients.

---

### P1.6 Several Public APIs Still Allow Unbounded Pagination

Evidence:

- `parseListQuery` (`src/utils/listQuery.ts`) caps at 100, but many controllers use ad-hoc parsing without caps:
  - `src/client/package/package.controller.ts:67` — `Math.max(..., 1)` only, no upper bound.
  - `src/client/categories/categories.controller.ts:98` — same pattern.
  - `src/promoter/customer/customer.controller.ts:21` — same pattern.
  - `src/client/notification/notification.controller.ts:18` — same pattern.
  - `src/admin/customer/customer.controller.ts:31` — same pattern.
- Deep offset pagination with `.skip(skip)` and `count()` doubles query work on large tables.

Impact:

- A request with `limit=100000` can allocate large MySQL result sets and JSON responses.
- Deep pages with `skip` become progressively slower as tables grow (MySQL must scan skipped rows).
- `count()` on hot filtered tables doubles query work per list request.

Recommendations:

**Step 1 — Migrate all list endpoints to `parseListQuery`:**

```typescript
import { parseListQuery, buildPagination } from "../../utils/listQuery";
const { search, page, limit, skip } = parseListQuery(req.query, { maxLimit: 50 }); // public
```

**Step 2 — Enforce caps:** public API max 50, internal/admin max 100–200 unless export job.

**Step 3 — Reject extreme `page × limit` values** (e.g. `skip > 10_000` → 400).

**Step 4 — Use cursor pagination** for high-volume feeds (notifications, purchase history, chat).

**Step 5 — Avoid returning `total`** on high-traffic endpoints unless the UI truly needs it; use `hasMore` instead.

**Step 6 — Add MySQL indexes** for common `WHERE + ORDER BY` pairs used in list queries.

---

### P1.7 Hot Dashboard and Catalog APIs Perform Large or Unbounded Reads

Evidence:

- `src/modules/client-dashboard/client-dashboard.service.ts:95–101` — home dashboard:

```typescript
prisma.bannerSlider.findMany({ orderBy: { orderBy: "asc" } }),           // no take
prisma.course.findMany({ where: { status: true }, orderBy: { createdAt: "desc" } }), // no take
prisma.testimonial.findMany({ orderBy: { rating: "desc" } }),            // no take
```

- `RECENTLY_ADDED_LIMIT = 10` applies to packages only; `COURSE_CATEGORY_LIMIT = 20` applies to categories.
- `src/libs/cache.ts` exists with TTL jitter, singleflight, and fail-open semantics, but **`cache.aside()` is never called** on read paths (only invalidation on writes).
- `src/libs/secondaryRead.ts` is a Mongoose replica helper with zero call sites.

Impact:

- Home/dashboard traffic is usually the highest read traffic in an education app.
- Payload size and query time grow linearly with catalog size.
- Redis cache infrastructure delivers zero read-path benefit despite write-side invalidation.

Recommendations:

**Step 1 — Add explicit `take` limits** to dashboard queries:

```typescript
const DASHBOARD_COURSE_LIMIT = 20;
const DASHBOARD_TESTIMONIAL_LIMIT = 10;
const DASHBOARD_BANNER_LIMIT = 10;

prisma.course.findMany({ where: { status: true }, orderBy: { createdAt: "desc" }, take: DASHBOARD_COURSE_LIMIT }),
prisma.testimonial.findMany({ orderBy: { rating: "desc" }, take: DASHBOARD_TESTIMONIAL_LIMIT }),
prisma.bannerSlider.findMany({ orderBy: { orderBy: "asc" }, take: DASHBOARD_BANNER_LIMIT }),
```

**Step 2 — Wire `cache.aside()` on hot reads** (dashboard sections, category trees, package/course lists):

```typescript
const dashboard = await cache.aside({
  key: cache.keys.dashboardHome(customerId ?? "anon"),
  ttlSec: 60,
  jitterSec: 15,
  domain: "dashboard",
  loader: () => buildHomeDashboardUncached(customerId),
});
```

**Step 3 — Invalidate dashboard cache keys** on admin writes to courses, packages, banners, testimonials.

**Step 4 — Precompute frequently displayed counters** (course counts per category, package purchase counts) in materialized columns or a `ws_catalog_stats` summary table updated on writes.

**Step 5 — Remove or replace `secondaryRead.ts`** with Prisma read-replica URL support when a replica is provisioned (`DATABASE_READ_URL`).

---

### P1.8 Package Detail Performs N+1 SQL Queries Per Category

Evidence:

- `src/modules/catalog-package/catalog-package.detail.sql.ts:46–55, 65–73, 84–92` — for each attached category in video/material/exam groups:
  - One recursive CTE (`descendantIds` / `descendantsOf`)
  - Two count queries (content count + child count)
- A package with 20 video categories ≈ **60+ SQL round trips** per detail view.

Impact:

- Query count grows with package complexity.
- A single detail page under concurrent app traffic can saturate the MySQL connection pool.
- This replaces the prior Mongo N+1 pattern but with equivalent SQL cost.

Recommendations:

**Step 1 — Batch category counts in a single query per group type:**

```sql
-- Example: count videos per root category in one pass
WITH RECURSIVE tree AS ( ... ),
grouped AS (
  SELECT root_id, COUNT(v.id) AS video_count
  FROM tree t
  JOIN ws_video v ON v.video_category_id = t.id AND v.status = 1
  GROUP BY root_id
)
SELECT * FROM grouped WHERE root_id IN (...);
```

**Step 2 — Store denormalized counts** on category rows (`video_count`, `material_count`, `exam_count`) updated on content writes.

**Step 3 — Cache package detail responses** with short TTL (60–120s) and invalidate on admin package/content writes.

**Step 4 — Use `cache.aside()`** with key `cache.keys.packageDetail(packageId)`.

---

### P1.9 Search Uses `LIKE '%term%'` Patterns That Do Not Scale

Evidence:

- `src/modules/client-search/client-search.service.ts:29–36` — Prisma `{ contains: name }` → MySQL `LIKE '%term%'`.
- `src/client/search/search.controller.ts:34–40` — when `type` is omitted, runs all 5 entity types in parallel; each does `findMany` + `count` + enrichment.
- Empty `q` returns all active entities per type (no minimum query length).
- No FULLTEXT indexes defined in `prisma/schema.prisma` for search columns.

Impact:

- Leading-wildcard `LIKE` cannot use B-tree indexes efficiently.
- Empty or short queries match very large portions of tables.
- "Search all" multiplies cost across courses, packages, live courses, books, and ebooks (30+ SQL queries per request).

Recommendations:

**Step 1 — Enforce minimum query length** (e.g. 2 characters) for global search; return 400 or empty results for shorter input.

**Step 2 — Add MySQL FULLTEXT indexes** on `name` columns for searchable tables:

```sql
ALTER TABLE ws_course ADD FULLTEXT INDEX ft_course_name (name);
ALTER TABLE ws_package ADD FULLTEXT INDEX ft_package_name (name);
-- repeat for book, ebook, live_course
```

**Step 3 — Use `MATCH ... AGAINST` via `$queryRaw`** or Prisma raw queries for search, with `contains` as fallback for short terms.

**Step 4 — Cache popular search results** with short TTL (30–60s).

**Step 5 — For autocomplete,** use normalized prefix fields and anchored `LIKE 'term%'` queries.

**Step 6 — Long term:** evaluate Meilisearch, Elasticsearch, or MySQL 8+ inverted index search for cross-entity search.

---

### P1.10 Prisma Has No Query Timing Instrumentation

Evidence:

- `src/config/prisma.ts:6–13` — default `PrismaClient` with no middleware.
- `src/config/db.ts` — Mongoose timing plugin exists but is never imported; `dbMs` in request context stays 0 for all MySQL queries.

Impact:

- Per-request DB timing in logs and metrics is incomplete.
- Harder to identify slow SQL during incidents.

Recommendations:

**Step 1 — Add Prisma `$use` middleware** to populate `dbMs` in request context:

```typescript
prisma.$use(async (params, next) => {
  const start = process.hrtime.bigint();
  const result = await next(params);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  incrementContext("dbMs", elapsedMs);
  return result;
});
```

**Step 2 — Wire `dbQueryDuration` histogram** in `src/utils/metrics.ts`.

> MySQL `connection_limit` sizing for PM2 cluster: [Deployment Audit § D1.2](./DEPLOYMENT_OPERATIONS_AUDIT.md#d12-mysql-connection-pool-not-sized-for-pm2-cluster).

---

## Priority 2 — Operational and Efficiency Improvements

### P2.1 Heavy PDF Generation Runs Synchronously in Requests

Evidence:

- `src/libs/core/generate.ts:74–101` — **new Puppeteer browser per request** via `puppeteer.launch()`, then `browser.close()`.
- Used by exam solution PDF (`exam.controller.ts`) and ebook receipt (`ebook.controller.ts`).

Impact:

- Browser startup is CPU and memory expensive (2–10+ seconds per request).
- Concurrent PDF requests can increase latency for unrelated APIs.
- Concurrent PDF requests starve the event loop for other API handlers.

Recommendations:

**Step 1 — Use a browser pool** (singleton Chromium with page pool, max 2–3 concurrent pages).

**Step 2 — Queue large solution/report generation** via BullMQ (reuse PDF upload worker pattern).

**Step 3 — Cache generated receipts/solutions** where output is immutable (key by order/result ID).

**Step 4 — Add endpoint-specific rate limits** for PDF downloads.

---

### P2.2 Logging Volume Is High for Production Traffic

Evidence:

- `src/app.ts:156` — always enables `morgan("dev")`.
- `src/utils/requestLogger.ts` logs both "API Request Start" and "API Request Completed" with scrubbed non-GET bodies.
- `src/utils/logger.ts:67` — level set to `debug`; writes rotating local files plus console.

Impact:

- High RPS produces large log volume and disk I/O.
- Logging request bodies increases CPU and storage usage.
- Local file logs are harder to aggregate in containerized environments.

Recommendations:

**Step 1 — Disable `morgan` in production:**

```typescript
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}
```

**Step 2 — Default production log level to `info`:**

```typescript
level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
```

**Step 3 — Log bodies only for failed requests** or selected debug windows.

**Step 4 — Sample successful request logs** at high traffic (e.g. 1 in 10).

**Step 5 — Prefer stdout plus a log collector** for production deployments.

---

### P2.3 Metrics Are In-Process and Not Cluster-Aware

Evidence:

- `src/utils/metrics.ts` keeps counters/histograms in memory.
- `/metrics` exposes only the process that handles the scrape request.

Impact:

- Per-process counters reset on restart; cluster-wide views are incomplete without per-instance scraping.

Recommendations:

**Step 1 — Add process labels** (`pid`, `instance_id`) on all metrics.

**Step 2 — Add process metrics:** event loop lag, heap/RSS, Redis status, queue depth.

**Step 3 — Wire Prisma middleware** to increment `dbQueryDuration` histogram (see P1.10).

> PM2 per-instance scraping and production metrics topology: [Deployment Audit § D2.2](./DEPLOYMENT_OPERATIONS_AUDIT.md#d22-metrics-are-not-cluster-aware-in-pm2).

> Redis hardening, memory policy, RabbitMQ removal: [Deployment Audit § D1.5–D1.6](./DEPLOYMENT_OPERATIONS_AUDIT.md#d15-redis-compose-config-is-dev-friendly-not-production-hardened).

> Do not run `cpuMonitor.ts` / `autoScale.ts` in production: [Deployment Audit § D2.1](./DEPLOYMENT_OPERATIONS_AUDIT.md#d21-pm2-auto-restartautoscale-scripts-are-risky-under-load).

---

### P2.4 JSON Body Parser Allows 500MB Payloads

Evidence:

- `src/app.ts:172, 200` — `express.json({ limit: "500mb" })`.

Impact:

- Memory exhaustion vector on JSON endpoints (not just file uploads).
- A malicious or buggy client can OOM the process.

Recommendations:

**Step 1 — Reduce default JSON limit** to `1mb` or `5mb` for most routes.

**Step 2 — Apply `500mb` only on specific upload routes** via route-level middleware or `multer` limits.

---

## Suggested Implementation Plan (Application Code)

### Phase 0 — Application Blockers (Before Any Traffic)

| Step | Action | Files |
|------|--------|-------|
| 0.1 | Fix `/readyz` to ping Prisma/MySQL | `src/middlewares/health.ts` |
| 0.2 | Fix Redis rate limiter store init | `src/config/rateLimiter.ts` |
| 0.3 | Re-enable `globalLimiter` + `otpLimiter` | `src/app.ts`, `auth.routes.ts` |
| 0.4 | Add `trust proxy` | `src/app.ts` |
| 0.5 | Gate BullMQ workers behind `WORKER_ENABLED` | `src/index.ts` |
| 0.6 | Fix payment webhook raw body verification | `webhook.controller.ts` — see [Implementation Audit](./IMPLEMENTATION_ISSUES_AUDIT.md) |

> Deployment blockers (build, PM2 topology, module format, pool sizing): [Deployment Audit § Phase 0](./DEPLOYMENT_OPERATIONS_AUDIT.md#phase-0--before-first-production-deploy).

### Phase 1 — Immediate Hardening

| Step | Action |
|------|--------|
| 1.1 | Cap dashboard `courses`, `testimonials`, `banners` with `take` |
| 1.2 | Migrate unbounded pagination controllers to `parseListQuery` |
| 1.3 | Reduce JSON body limit; route-level limits for uploads |
| 1.4 | Disable `morgan("dev")` and set production log level `info` |
| 1.5 | Add socket event rate limits for chat/vote/join |
| 1.6 | Wire socket `preClose` on graceful shutdown |

> Error handling, auth, logging fixes: [Implementation Audit § Phase 2](./IMPLEMENTATION_ISSUES_AUDIT.md#phase-2--hardening).

### Phase 2 — Worker and Queue Optimization

| Step | Action |
|------|--------|
| 2.1 | Redis leader lock + batched rehydration for notifications |
| 2.2 | Chunk notification token collection + FCM sends |
| 2.3 | Puppeteer browser pool or queue PDF generation |
| 2.4 | Worker health + DLQ/depth alerts |

> PM2 API/worker split: [Deployment Audit § D0.3](./DEPLOYMENT_OPERATIONS_AUDIT.md#d03-pm2-worker-topology--workers-run-in-every-api-instance).

### Phase 3 — Hot API Optimization (MySQL-Specific)

| Step | Action |
|------|--------|
| 3.1 | Wire `cache.aside()` on dashboard, catalog, package detail |
| 3.2 | Batch package detail category counts (single SQL per group type) |
| 3.3 | Add FULLTEXT indexes + `MATCH AGAINST` for search |
| 3.4 | Precompute category content counts on writes |
| 3.5 | Cursor pagination for notifications, purchase history |
| 3.6 | Add Prisma query timing middleware for `dbMs` metrics |
| 3.7 | Redis room counters for socket presence |

---

## Reference: Strong Patterns Already Present

Keep and extend these patterns:

- `src/middlewares/health.ts`: liveness/readiness separation (fix MySQL probe).
- `src/utils/gracefulShutdown.ts`: orchestrated SIGTERM/SIGINT with BullMQ + Prisma drain.
- `src/admin/notification/scheduler.ts`: BullMQ retries, DLQ, queue-depth metrics, backpressure.
- `src/admin/pdfUpload/pdfUpload.scheduler.ts`: streaming S3 upload, concurrency=1 design.
- `src/libs/cache.ts`: TTL jitter, singleflight, fail-open cache-aside (wire on reads).
- `src/utils/listQuery.ts`: centralized pagination for migrated endpoints.
- `src/utils/requestLogger.ts` and `src/utils/requestContext.ts`: request IDs and trace context.
- `src/utils/crashReporter.ts` and `src/middlewares/errorHandler.ts`: Redis-throttled crash/error emails.
- `src/socket/livechat.socket.ts`: Redis adapter for multi-node Socket.IO broadcasting.
- `src/config/migration.ts`: clean MySQL-only cutover flag.
- `src/modules/admin-notification/admin-notification.service.ts`: SQL notification dispatch with atomic claim-lock.
- `docs/migration/DEPLOY_RUNBOOK.md`: MySQL-only deploy runbook with DDL workflow.

---

## Changes Since Prior Audit (2026-05-26)

| Area | Prior State (Mongo) | Current State (MySQL) |
|------|---------------------|----------------------|
| Database | Mongoose pool tuning, `dbMs` plugin | Prisma singleton; **no query timing**; pool via URL only |
| Readiness | Mongo ping (worked) | **Mongo ping (broken)** — must switch to Prisma |
| Notifications | Mongo `Customer.find` tokens | SQL `customerDeviceToken` table — better model, same memory risk on broadcast |
| Pagination | Many unbounded controllers | `parseListQuery` adopted in ~10 endpoints; many still ad-hoc |
| Search | Mongo `$regex` | Prisma `contains` → `LIKE '%term%'` — same scale concern |
| Package detail | Mongo N+1 `countDocuments` | SQL recursive CTE N+1 — equivalent cost |
| Deployment | No deploy guide | `DEPLOY_RUNBOOK.md` exists |
| Lockfile | Ignored | `yarn.lock` committed |
| Redis eviction | `noeviction` | `allkeys-lru` (better for cache, risky for sessions) |
| Global limiter | Enabled but Redis race | **Commented out entirely** |
| Secondary reads | `secondaryRead.ts` unused | Still unused (Mongo-specific) |

---

## Load Test Checklist

Pre-go-live load tests (including PM2 topology, deploy smoke, and infrastructure checks) are in the [Deployment and Operations Audit — Load Test Checklist](./DEPLOYMENT_OPERATIONS_AUDIT.md#load-test-checklist-pre-go-live).

Application-focused scenarios to validate after code fixes:

- Dashboard/home API at expected peak RPS.
- Global search with short, common, and empty queries.
- Course/package detail with large category trees (query count per request).
- Live chat join/leave storms and message bursts.
- Notification campaign fanout (10k+ recipients).
- OTP endpoints under abuse-like traffic.
- PDF downloads under concurrent access.

---

## Document History

| Date | Version | Notes |
|------|---------|-------|
| 2026-05-26 | 1.0 | Initial audit (MongoDB era) |
| 2026-07-01 | 2.0 | Post-MySQL migration re-audit |
| 2026-07-01 | 2.1 | Split into scalability + implementation + deployment docs |
