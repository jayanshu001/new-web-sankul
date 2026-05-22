# Backend Production-Grade Optimization & Scalability Audit Prompt

A comprehensive prompt to guide an end-to-end optimization, production-readiness, and scalability audit of the backend.

---

## Prompt

> You are a senior backend engineer performing a **production-readiness audit and optimization pass** on a Node.js/TypeScript backend (Express-style, MongoDB/Mongoose, Redis, BullMQ-style queues, structured logging, crash analytics). The codebase exposes admin + client APIs across domains such as auth, courses, live-courses, lectures, packages, ebooks, exams, test-series, referrals, permissions, and video delivery.
>
> Your job is to review the entire backend module-by-module and produce **concrete, file-level refactors** (not generic advice) that bring it to production-grade quality. For every change you propose, include: the file path, the problem, the fix (with code), and the measurable impact (latency / memory / cost / security / reliability).

---

## Scope — audit every layer

### 1. API & Routing Layer
- Enforce a single `authenticate` middleware on every route (admin + client). Flag any public-by-default route.
- Standardize request validation (Zod/Joi) at the controller boundary; reject unknown fields.
- Normalize response envelope `{ success, data, error, meta }` and HTTP status codes.
- Add per-route rate limiting (Redis-backed, sliding window) with tighter limits on auth, OTP, video URL, and payment endpoints.
- Add idempotency keys on all mutating payment/referral/order endpoints.

### 2. Controllers
- Keep controllers thin: parse → validate → delegate to service → format response. Move business logic out.
- Wrap every async handler in a central `asyncHandler` so no unhandled rejection leaks.
- Remove `try/catch` boilerplate where the global error middleware suffices.

### 3. Services / Domain Logic
- Identify N+1 Mongo queries; replace with `$lookup` aggregations or `populate` with `lean()` + field projection.
- Add `.lean()` and explicit `.select()` to every read path that doesn't need hydrated docs.
- Batch independent awaits with `Promise.all`; serialize only true dependencies.
- Extract pure helpers (price calc, plan duration → `endAt` using `setMonth`, downloads composition: `savedMaterials + savedVideos + activeEbookDownloads`) into testable units.

### 4. Database (MongoDB/Mongoose)
- Audit indexes against actual query shapes (`explain("executionStats")`); add compound indexes for hot queries, drop unused ones.
- Enforce schema-level validation, `strict: "throw"`, `timestamps: true`, and TTL indexes for ephemeral data (OTP, sessions, signed URLs).
- Use transactions for multi-document writes (orders, referral credit, enrollments) with retry-on-`TransientTransactionError`.
- Paginate every list endpoint (cursor-based preferred over skip/limit for large collections).

### 5. Redis Caching
- Define a cache key convention: `{env}:{domain}:{entity}:{id}:{version}`.
- Apply cache-aside on hot reads (catalog, course detail, permissions, categories) with per-key TTL + jitter to prevent stampede.
- Add a `singleflight`/lock pattern (`SET NX PX`) around cache misses on hot keys.
- Implement explicit invalidation on writes; never rely on TTL alone for correctness-sensitive data.
- Cache permission catalogs and JWT introspection results with short TTL.

### 6. Queues (BullMQ-style)
- Separate queues by SLA: `realtime`, `default`, `bulk`, `low-priority`. Distinct concurrency per worker.
- Configure `attempts`, exponential `backoff`, `removeOnComplete`, `removeOnFail` (bounded), and dead-letter queue.
- Ensure all jobs are **idempotent** (jobId derived from business key).
- Add graceful shutdown: drain workers on SIGTERM before exit.

### 7. Auth & Security
- Verify `authenticate` middleware short-circuits with constant-time comparisons; never log tokens.
- Rotate JWT signing keys via kid; support refresh + revocation list in Redis.
- Strict CORS allowlist, Helmet, HPP, body size limits, MongoSanitize, XSS sanitization on free-text fields.
- Secrets via env/secret-manager only; fail fast on missing required envs at boot.
- Per-role permission checks resolved from cached catalog, not hardcoded strings.

### 8. Video Delivery
- Every endpoint returning a video URL must match `/v1/lecture`'s **encrypted URL shape and contract** — flag any drift.
- Signed URL TTL ≤ 5 min, bound to user + IP/UA hash where feasible.
- Centralize encryption in `videoEncryption`/`videoResolver`; no inline crypto in controllers.

### 9. Observability
- Structured JSON logs (pino) with `requestId`, `userId`, `route`, `latencyMs`, `dbMs`, `cacheHit`.
- Distinguish `trace` / `debug` / `info` / `warn` / `error`; never log PII or tokens at info+.
- OpenTelemetry traces across HTTP → service → Mongo → Redis → queue producer/consumer.
- Metrics: RED (rate/errors/duration) per route, cache hit ratio, queue depth, job latency, Mongo slow-query count.
- Crash analytics (Sentry) with release + user scrubbing; source maps uploaded in CI.

### 10. Performance
- Enable HTTP keep-alive + gzip/br; tune `server.keepAliveTimeout` > LB idle timeout.
- Stream large responses; never buffer full file uploads in memory — use multipart streaming to S3.
- Profile event loop (`clinic.js`/`0x`); flag sync crypto, JSON.parse on hot paths, blocking regex.
- Connection pooling for Mongo/Redis tuned to worker count.

### 11. Resilience
- Timeouts + retries with jitter on every outbound call (payment gateway, SMS, email, S3).
- Circuit breakers around third-party providers.
- Health endpoints: `/healthz` (liveness) and `/readyz` (Mongo + Redis + queue ping).
- Graceful shutdown: stop accepting → drain in-flight → close DB/Redis/queues → exit.

### 12. Testing & CI
- Unit tests for pure helpers; integration tests with real Mongo + Redis (Testcontainers).
- Contract tests for response shapes (especially video URL contract).
- Load test hot endpoints (k6) and record baseline p50/p95/p99.
- Lint, typecheck, test, audit, and SBOM generation in CI; block merge on regressions.

### 13. Scalability & Horizontal Scaling
- **Statelessness**: ensure every API process is stateless — no in-memory sessions, rate-limit counters, locks, or caches that don't survive a pod restart. Move all shared state to Redis/Mongo.
- **Sticky-session audit**: flag any code path that assumes the same user hits the same instance (in-memory socket maps, local job state, in-process pub/sub).
- **WebSocket / live-session scaling**: use Redis adapter (or NATS) for Socket.IO pub/sub across nodes; never broadcast from a single instance's memory.
- **Sharding strategy**: identify collections that will outgrow a single replica set (lectures, video-watch events, notifications, audit logs) and plan shard keys *now* — retrofitting is painful.
- **Read scaling**: route heavy read endpoints (catalog, course detail, analytics) to Mongo secondaries with `readPreference: secondaryPreferred` + staleness budget; keep writes on primary.
- **Connection pool math**: `poolSize × replicas ≤ Mongo maxConnections`. Document the formula and enforce via env-driven config.
- **Queue horizontal scaling**: workers must be safely runnable as N replicas — verify job locking, no "singleton" workers unless explicitly marked and deployed as a StatefulSet of 1.
- **Hot-key mitigation in Redis**: detect hot keys (e.g. global catalog, popular live session); shard via key suffix or use local in-process LRU with short TTL in front of Redis.
- **Multi-tenancy / noisy neighbor**: per-tenant rate limits and queue quotas so one institution can't starve others.
- **Backpressure**: every ingress (HTTP, queue consumer, websocket) must shed load gracefully (429/503 with `Retry-After`) rather than queueing unbounded work in memory.
- **CDN & edge**: static assets, signed-but-cacheable thumbnails, and public catalog responses behind CDN with proper `Cache-Control` + `Vary`. Video manifests at edge; segments via signed URLs.
- **Cold-start budget**: container boot → `/readyz` green in < 5s. Lazy-load heavy modules; precompile regex/JIT-hot paths at boot.
- **Autoscaling signals**: expose Prometheus metrics that HPA can scale on — RPS, p95 latency, queue depth, event-loop lag — not just CPU.
- **Data growth plan**: TTL/archival policy for high-volume collections (watch events, OTP, signed URLs, audit logs) → cold storage (S3/Glacier) with a documented retention SLA.
- **Capacity model**: document target RPS, concurrent live sessions, and storage growth per month; map to instance counts so scaling decisions aren't reactive.

**Verification additions**:
- Load test at **2×, 5×, 10×** current peak; record where the system breaks (CPU, Mongo connections, Redis ops/sec, event loop lag).
- Chaos test: kill one app pod, one worker, one Redis replica mid-traffic — confirm zero data loss and < 1% error spike.

---

## Output format

For each module, produce:

```
## <module path>
### Issues found
- <issue> — severity: [P0|P1|P2]
### Refactor
<diff or full snippet>
### Impact
- Latency: ...
- Reliability: ...
- Security: ...
### Verification
- <test/command to confirm>
```

End with a **prioritized rollout plan** (P0 → P2), an **index hit-list** with `createIndex` commands, and a **cache key registry** table.

---

## Constraints

- Do not break existing public API response shapes without a version bump.
- Every route stays authenticated (Bearer token required) — no public defaults.
- Video URL responses must remain byte-compatible with `/v1/lecture`.
- Plan `duration` is in **months** — preserve `setMonth` semantics for `endAt`.
- Profile `downloads` count must remain `savedMaterials + savedVideos + activeEbookDownloads`.
