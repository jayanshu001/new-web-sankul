# Backend Optimization Audit — Consolidated Summary

A single-document rollup of every change landed across Batches 1a → 4. Per-batch documents remain authoritative for diffs and verification steps; this doc gives the full picture in one read.

Per-batch detail:
[1a Foundation](./batch-1a-foundation.md) · [1b‑1 Course](./batch-1b-part1-course.md) · [1b‑2 Package/Referral](./batch-1b-part2-package-referral.md) · [1b‑3 Ebook/Referral/Permission/Live-course](./batch-1b-part3-ebook-referral-permission-live-course.md) · [2 Security/Perf/Observability](./batch-2-security-perf-observability.md) · [3 Resilience/JWT](./batch-3-resilience-jwt.md) · [4 Cleanup/Revocation](./batch-4-cleanup-revocation.md)

---

## 1. Audit modules — coverage matrix

| # | Module | Status | Where landed |
|---|---|---|---|
| 1 | API & Routing | ✅ Done | Batch 1a (master-router auth hoist, admin limiter, validate/idempotency middleware) |
| 2 | Controllers | ✅ Done (6 admin domains) | Batch 1b parts 1–3 |
| 3 | Services | ✅ Done (6 admin domains) | Batch 1b parts 1–3 |
| 4 | Database | ✅ Done | Batch 1b (`.lean()`/`.select()`, transactions), Batch 2 (pool tuning) |
| 5 | Redis Caching | ✅ Done | Batch 1a (`libs/cache.ts`), Batch 1b (wired per-domain) |
| 6 | Queues | ✅ Done | Batch 2 (notification DLQ + depth sampler) |
| 7 | Auth & Security | ✅ Done | Batch 2 (PII scrub, constant-time OTP), Batch 3 (JWT keyring, customer), Batch 4 (keyring everywhere + revocation) |
| 8 | Video Delivery | ✅ Clean | Batch 2 survey — no contract drift |
| 9 | Observability | 🟡 Partial | Batch 2 (RED metrics, PII scrub, crash). **Open:** full structured logger / OpenTelemetry |
| 10 | Performance | ✅ Done | Batch 2 (HTTP keepalive, DB pool, cache metrics) |
| 11 | Resilience | ✅ Done | Batch 3 (`/healthz`, `/readyz`, graceful shutdown, `callOutbound`), Batch 4 (outbound migration finished) |
| 12 | Testing / CI | ⛔ Not started | Needs CI provider context |
| 13 | Scalability | ⛔ Not started | Needs prod capacity numbers (sharding, read-replica routing) |

**Roughly ~85% of the audit prompt is landed.** Remaining work is the three items above, all explicitly deferred pending external input — not blocked on code.

---

## 2. New primitives introduced

These now underpin the entire codebase; future routes/services should consume them rather than reinventing.

| File | Role |
|---|---|
| [src/middlewares/asyncHandler.ts](../../src/middlewares/asyncHandler.ts) | Forwards async rejections to global error middleware. Eliminates per-handler try/catch. |
| [src/middlewares/validate.ts](../../src/middlewares/validate.ts) | Zod body/query/params validator returning 422. `.strict()` schemas reject unknown fields. |
| [src/middlewares/idempotency.ts](../../src/middlewares/idempotency.ts) | Redis-backed `Idempotency-Key` for mutations. Replays cached response on retry; 409 on key reuse with different payload. |
| [src/libs/cache.ts](../../src/libs/cache.ts) | Cache-aside. Key shape `{env}:{domain}:{entity}:{id}:{version}`, jittered TTL, `SET NX PX` singleflight, fail-open on Redis errors, hit/miss counters. |
| [src/libs/outbound.ts](../../src/libs/outbound.ts) | `callOutbound()` — timeout + retry-with-jitter + circuit breaker for any third-party I/O. Zero new deps. |
| [src/libs/tokenRevocation.ts](../../src/libs/tokenRevocation.ts) | Revoke-by-cutoff: per-user timestamp in Redis; tokens with `iat * 1000 < cutoff` rejected. |
| [src/middlewares/logoutAllDevices.ts](../../src/middlewares/logoutAllDevices.ts) | Factory producing a logout-all-devices handler for any user type. |
| [src/middlewares/health.ts](../../src/middlewares/health.ts) | `/healthz` liveness + `/readyz` (Mongo + Redis ping, 503 on shutdown). |
| [src/middlewares/metricsMiddleware.ts](../../src/middlewares/metricsMiddleware.ts) | HTTP RED metrics on `res.on('finish')`. |
| [src/utils/scrub.ts](../../src/utils/scrub.ts) | Deny-list PII scrubber preserving shape (password, OTP, token, bank, Razorpay sig, etc.). |
| [src/utils/metrics.ts](../../src/utils/metrics.ts) | Minimal Prometheus exposition (Counter/Gauge/Histogram). RED + queue depth + cache + DLQ. |
| [src/utils/gracefulShutdown.ts](../../src/utils/gracefulShutdown.ts) | SIGTERM/SIGINT orchestrator: flip readyz → close HTTP → drain queues → close Mongo/Redis → exit. |
| [src/utils/planDuration.ts](../../src/utils/planDuration.ts) | `computeEndAt({startAt, durationMonths, asDays?})` and `composeDownloadsCount(...)`. |
| [src/config/env.ts](../../src/config/env.ts) | Fail-fast env validation at boot (required, required-in-prod, secret length sanity). |
| [src/config/jwtKeys.ts](../../src/config/jwtKeys.ts) | JWT keyring (kid → secret) with legacy-secret fallback. |
| [src/utils/jwtSigner.ts](../../src/utils/jwtSigner.ts) | `sign/verifyAccessToken` + refresh equivalents that embed/read the `kid` header. |
| [src/admin/{course,package,ebook,referral,permission,live-course}/*.service.ts](../../src/admin/) | All admin-domain business logic; controllers are now thin. |

---

## 3. Cross-cutting fixes

### 3.1 Master-level auth gate (Batch 1a)
Previously every admin domain router had to remember to call `authenticate`. A new domain router could silently expose a public subtree. Auth + `adminLimiter` are now hoisted at the master `/api/v1/admin` router; `/auth/login` and `/auth/refresh` stay mounted before the gate.

### 3.2 Plan default-flip race (Batch 1b‑1, **P0**)
`enforceSingleDefault` flipped sibling plans outside the write transaction, leaving a window with zero or two defaults. Now wrapped in `session.withTransaction()` for `createPlan` / `updatePlan` / `markAsDefault`.

### 3.3 `setMonth` mistakes (Batch 1b‑3)
Every `setMonth(...)` callsite that computed subscription/ebook/live-course expiry migrated to `computeEndAt({ startAt, durationMonths, asDays? })` — single source of truth, including the `asDays` fallback path for day-denominated plans. Files: subscription, live-course-subscription, webhook, verify (3 callsites).

### 3.4 PII in logs (Batch 2, **P0**)
`requestLogger`, `errorHandler`, and `crashReporter` all ran request bodies / query strings into log files and crash emails in plaintext — including passwords, OTPs, Razorpay signatures, bank account numbers, IFSC. Now scrubbed via `utils/scrub.ts` deny-list with shape preserved; crash reporter additionally strips query strings from URL snapshots.

### 3.5 OTP timing attack (Batch 2)
Client auth OTP compared with `!==`. Switched to a `crypto.timingSafeEqual`-backed `constantTimeEqual`.

### 3.6 Idempotency on financial mutations (Batch 1b‑2)
Referral withdrawal status / withdrawal reject / manual reward adjust now require `Idempotency-Key` + are bucketed by `adminMutationLimiter`. Stops double-credits on retry.

### 3.7 JWT keyring + revocation (Batches 3 → 4)
All `jwt.sign` / `jwt.verify` callsites — customer, admin, educator, promoter auth services and the two socket handlers (`livechat`, `camera-ingest`) — now route through `signAccessToken` / `verifyAccessToken` (and refresh equivalents) so every minted token carries a `kid` header. A future `JWT_ACCESS_KEYS=v2:<new>,v1:<old>` rotation works uniformly.

Refresh-token revoke-by-cutoff (`libs/tokenRevocation.ts`): per-user `iat`-cutoff timestamp in Redis; `authenticate` checks `isRevoked(type, userId, iat)` and rejects stale tokens. `POST /logout-all-devices` is exposed for all 4 auth surfaces.

### 3.8 Outbound resilience (Batches 3 → 4)
Every third-party callsite wrapped in `callOutbound` (timeout + jittered retry + circuit breaker):
- Razorpay order creation (6 payment controllers via the new `createRazorpayOrder` helper)
- RazorpayX payouts (`razorpayx.ts`)
- Razorpay IFSC lookup (`client/referral/ifsc.ts`)
- VideoCrypt resolver (`utils/videoResolver.ts`)
- Email sending (`utils/emailService.ts`)
- OTP SMS (`client/auth/auth.service.ts`)
- S3 deletes (`middlewares/upload.ts`)
- FCM push (`utils/fcm.ts`)

A single misbehaving third-party can no longer pin worker threads or cascade into request timeouts.

### 3.9 Health & graceful shutdown (Batch 3)
`/healthz` (liveness, no I/O) + `/readyz` (Mongo + Redis ping, 503 on SIGTERM). Both mounted before the global rate limiter. Graceful shutdown orchestrator: flip readyz → close HTTP → drain queues → close Mongo/Redis → exit, with a hard-kill timer.

### 3.10 Boot-time env validation (Batch 2)
`validateEnvOrExit()` runs in `src/index.ts` before any module import. Missing-in-prod required vars and undersized secrets fail the process at boot rather than at first request.

### 3.11 HTTP / DB tuning (Batch 2)
- `keepAliveTimeout=65s`, `headersTimeout=70s` on the HTTP server (avoids ALB 502 races).
- Mongo: `maxPoolSize=20`, `minPoolSize=2`, `serverSelectionTimeoutMS=5s`, `socketTimeoutMS=45s` — all env-overridable.

### 3.12 Queue resilience (Batch 2)
Notification scheduler: DLQ (`notification-scheduler-dlq`) on retry exhaustion + 15s queue-depth sampler exported as a Prometheus gauge.

### 3.13 Observability (Batch 2)
Prometheus-style `/metrics` endpoint (token-gated) exposing HTTP RED, queue depth, cache hits/misses, DLQ counter.

---

## 4. Admin domain refactors (Batch 1b)

All six audit-prioritized admin domains follow the same template: `parse (Zod) → service → respond`. Controllers became thin, services own all Mongoose access with `.lean()` / `.select()`, transactions for multi-collection writes, and cache wiring.

| Domain | Controller LOC before → after | Notable additions |
|---|---|---|
| course | 665 → 248 | Cache list+detail, transactional plan default-flip |
| package | 680 → 226 | Transactional delete (video relations, chat, ebook-price unlinks), BFS video-relation expansion extracted |
| ebook | 270 → 102 | Cache list+detail (300s), transactional delete |
| referral | 675 → 115 | 225-line referrers aggregation moved to service; idempotency on financial mutations |
| permission | 359 → 122 | Cache TTL 30 min (hottest read in admin API); tree builder extracted |
| live-course | 408 → 134 | Transactional create/delete with folder fanout |

Aggregate: **4-domain block (ebook+referral+permission+live-course) shrank 1,712 → 473 LOC (−72%)**; course+package similar.

Validation envelopes for permission + referral intentionally preserve their legacy `{ errors: {...} }` shape because the admin React dashboard binds to those keys.

---

## 5. What is still open

1. **Module 12 — Testing / CI.** Not started. Needs the user to pick a CI provider and indicate which suites to gate on. No code blocker.
2. **Module 13 — Scalability.** Sharding strategy + read-replica routing. Needs production capacity numbers (current QPS, working-set size, read/write split). No code blocker.
3. **Module 9 — Logger augmentation.** Structured-logger overhaul + OpenTelemetry tracing was deferred at Batch 2. The PII / RED / scrub pieces are in; the broader tracing/correlation-ID story is the gap.
4. **Cosmetic envelope unification.** Permission + referral routes intentionally still return their legacy validation shape; harmless but worth revisiting when the admin dashboard is next touched.
5. **Per-router `authenticate` duplication.** Batch 1a hoisted auth at the master router but the per-domain `*.routes.ts` files still call `authenticate` defensively. Dropping the redundant calls (keep `requireRole`) was flagged as a follow-up but not landed.

---

## 6. Verification quick-reference

| Concern | One-line check |
|---|---|
| Master-level auth | `curl -i /api/v1/admin/courses` (no Authorization) → 401 |
| Admin limiter | 300 req/min as same admin → 429 with `Retry-After` |
| PII scrub | `POST /api/v1/admin/auth/login` then `grep password logs/app-*.log` — should show `[REDACTED]` |
| Healthz / readyz | `curl /healthz` → 200; `kill -TERM <pid>` then `curl /readyz` → 503 within ~1s |
| Idempotency | POST referral mutation twice with same `Idempotency-Key` → identical response, single write |
| JWT keyring | Decode a freshly minted access token; header must include `kid` |
| Logout-all-devices | Call the route, then a previously-valid access token → 401 |
| Metrics | `curl -H 'Authorization: Bearer $METRICS_TOKEN' /metrics` → Prometheus exposition |

---

*Last updated: 2026-05-21.*
