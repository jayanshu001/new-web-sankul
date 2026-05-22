# Backend Audit — Batch 2: Security + Queues + Performance + Observability

Covers the highest-value P0/P1 items from Modules 6 (Queues), 7 (Auth & Security), 9 (Observability), and 10 (Performance). Module 8 (Video Delivery) survey returned clean — no contract drift; admin HLS URLs are intentionally unencrypted. Heavier items (JWT `kid` rotation, full structured-logger augmentation, OpenTelemetry) are deferred to a follow-up batch.

---

## Files

### Created
| File | Purpose |
|---|---|
| [src/utils/scrub.ts](../../src/utils/scrub.ts) | Deep-clone deny-list PII scrubber. Replaces values, preserves shape. |
| [src/utils/metrics.ts](../../src/utils/metrics.ts) | Minimal Prometheus exposition: Counter, Gauge, Histogram. RED metrics + queue depth + cache hits/misses + DLQ counter. |
| [src/middlewares/metricsMiddleware.ts](../../src/middlewares/metricsMiddleware.ts) | Records HTTP RED metrics on `res.on('finish')`. Skips `/metrics` itself. |
| [src/config/env.ts](../../src/config/env.ts) | Fail-fast boot env validation. Required, required-in-prod, secret length sanity check. |

### Modified
| File | Change |
|---|---|
| [src/utils/requestLogger.ts](../../src/utils/requestLogger.ts) | `req.body` scrubbed before logging (Module 9 P0). |
| [src/middlewares/errorHandler.ts](../../src/middlewares/errorHandler.ts) | `req.body`, `req.query`, `req.params` scrubbed before error log + email. |
| [src/utils/crashReporter.ts](../../src/utils/crashReporter.ts) | Query string stripped from URL snapshot before emailing crash digest. |
| [src/client/auth/auth.service.ts](../../src/client/auth/auth.service.ts) | OTP comparison switched from `!==` to `crypto.timingSafeEqual`-backed `constantTimeEqual` helper. |
| [src/index.ts](../../src/index.ts) | `validateEnvOrExit()` runs before any module imports. `keepAliveTimeout=65s` + `headersTimeout=70s` on httpServer. |
| [src/app.ts](../../src/app.ts) | CORS fails fast if `ALLOWED_ORIGINS` missing in prod. `/metrics` endpoint added (token-gated). `metricsMiddleware` mounted. |
| [src/config/db.ts](../../src/config/db.ts) | `maxPoolSize=20`, `minPoolSize=2`, `serverSelectionTimeoutMS=5s`, `socketTimeoutMS=45s`. All env-overridable. |
| [src/admin/notification/scheduler.ts](../../src/admin/notification/scheduler.ts) | DLQ queue (`notification-scheduler-dlq`) on retry exhaustion + queue-depth sampler every 15s. |
| [src/libs/cache.ts](../../src/libs/cache.ts) | `cacheHitsTotal` / `cacheMissesTotal` counters incremented in `aside()`. |

---

## Module 9 — Observability (P0: PII in logs)

### Issue
[src/utils/requestLogger.ts:45](../../src/utils/requestLogger.ts) logged the full `req.body` for every non-GET request at INFO level. Auth (`POST /auth/login` body has `password`), OTP verify (`otp`), payment endpoints (card fields, `razorpay_signature`), referral payouts (`bankAccount.accountNumber`, `ifscCode`) — all of these were written to `logs/app-*.log` in plaintext. Same for [errorHandler.ts:54-56](../../src/middlewares/errorHandler.ts) (logged on every 5xx, also sent in the crash email).

### Fix
Deep-clone deny-list scrubber in [utils/scrub.ts](../../src/utils/scrub.ts). Case-insensitive substring match on keys: `password`, `otp`, `token`, `accesstoken`, `refreshtoken`, `secret`, `authorization`, `cookie`, `razorpay_signature`, `apikey`, `bankaccount`, `accountnumber`, `ifsccode`, `cardnumber`, `cvv`, `cvc`, `pan`, `upi`. Matched values → `[REDACTED]`. Shape preserved for debugging context.

Crash reporter's URL snapshot also strips the query string — `?token=...` and `?otp=...` in legacy GET requests no longer leak via the crash email.

### Impact
- **Security:** plaintext passwords / OTPs / bank account numbers / Razorpay signatures no longer reach disk or the 5xx alert mailbox. Lower blast radius if log volumes ever leak.
- **Reliability:** zero functional change; logged shape is preserved so debugging still works.

### Verification
```bash
# POST a login and confirm the password is redacted in the log file.
curl -X POST http://localhost:5000/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.com","password":"super-secret"}'

tail -n 1 logs/app-$(date +%Y-%m-%d).log | jq '.body'
# Expect: { "email":"a@b.com", "password":"[REDACTED]" }
```

---

## Module 7 — Auth & Security

### 7a. P1 — OTP timing attack

[auth.service.ts:283](../../src/client/auth/auth.service.ts) used `customer.otp !== otp`. V8 short-circuits string comparison on the first mismatched byte, leaking ~10ns of timing per matched prefix byte. Over a wire with reliable RTT measurement, a remote attacker can recover a 4-digit OTP digit-by-digit in O(N) trials instead of O(10^N). Same code path is hit before the rate-limit exhausts, so the rate limiter alone is not sufficient mitigation.

**Fix:** `constantTimeEqual(a, b)` wrapping `crypto.timingSafeEqual` on equal-length buffers. OTPs are fixed-length (4 digits or static `5786`), so length check is not a secret-bearing branch.

### 7b. P1 — Boot env validation

Previously, missing `JWT_ACCESS_SECRET` resulted in `jwt.sign` being called with `undefined` cast as string — tokens signed with the literal string `"undefined"`, accepted by every other instance with the same misconfiguration. `MONGODB_URI` defaulted to empty string and threw on connect with no actionable error.

**Fix:** [config/env.ts](../../src/config/env.ts) `validateEnvOrExit()` invoked at the top of [index.ts](../../src/index.ts) BEFORE any other module imports. Three tiers:

- **Required everywhere:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MONGODB_URI`. Missing → process exits 1 with explicit message.
- **Required in production:** `ALLOWED_ORIGINS`, `RAZORPAY_WEBHOOK_SECRET`, `REDIS_HOST`, `REDIS_PORT`. Missing in prod → exit 1. Missing in dev → warn only.
- **Sanity check:** JWT secrets < 32 chars or matching `^(secret|changeme|test|password)` → warn (does not fail boot).

CORS allowlist gets defense-in-depth in [app.ts](../../src/app.ts) too: process exits if `ALLOWED_ORIGINS` is missing in prod, even if env validation was skipped somehow.

### Verification
```bash
JWT_ACCESS_SECRET= MONGODB_URI= node dist/index.js
# Expect: [env] FATAL: missing required environment variables: JWT_ACCESS_SECRET, MONGODB_URI
# Exit code 1.

# Constant-time OTP verify — wrong OTP path must not branch early.
node -e "
const c = require('./dist/client/auth/auth.service');
// (helper is internal; verify by inspecting source for crypto.timingSafeEqual call)
"
```

---

## Module 6 — Queues

### Issue
[notification scheduler](../../src/admin/notification/scheduler.ts) had no dead-letter queue: a job that exhausted all 3 retries marked the Notification row `status: "failed"` and was then forgotten by BullMQ (just retained in the `failed` index for 7 days). No visibility into why, and no replay path. No queue-depth visibility either.

### Fix
- **DLQ:** new `notification-scheduler-dlq` queue. On retry exhaustion, push `{ notificationId, lastError }` onto the DLQ with a stable `jobId` (`dlq:${originalJobId}`) and 30-day retention. No worker consumes the DLQ — it's a forensics inbox.
- **Queue-depth metric:** a 15s `setInterval` (with `unref()` so it doesn't block exit) calls `queue.getJobCounts("waiting","active","delayed","failed")` and publishes via `queueDepth.set(...)`. DLQ depth surfaces under `{queue=notification-scheduler-dlq, state=waiting}`.
- **DLQ counter:** `queue_jobs_dlq_total{queue=notification-scheduler}` increments on every exhausted job (separate from the gauge so alert rules can fire on "rate of new DLQ entries").

### Impact
- **Reliability:** failed notifications no longer disappear into log noise. Operators can list DLQ entries, fix root cause, and replay.
- **Observability:** alert thresholds on `queue_depth{state="waiting"}` (backlog growing) and `rate(queue_jobs_dlq_total[5m])` (sudden failure spike) are now possible.

### Verification
```bash
# Force a failure path (e.g. point dispatcher at unreachable FCM endpoint),
# then check the DLQ has a fresh entry after retries exhaust.
redis-cli LLEN bull:notification-scheduler-dlq:waiting

# Prometheus scrape:
curl -s http://localhost:5000/metrics \
  -H "Authorization: Bearer $METRICS_TOKEN" | grep -E 'queue_depth|queue_jobs_dlq_total'
```

---

## Module 9 — RED metrics + cache hit ratio

### Fix
- `httpRequestsTotal{method,route,status}` — counter
- `httpRequestDurationMs{method,route,status}` — histogram (buckets 5ms → 10s)
- `cache_hits_total{domain}` / `cache_misses_total{domain}` — counters (incremented in [libs/cache.ts](../../src/libs/cache.ts))
- `queue_depth{queue,state}` — gauge
- `queue_jobs_dlq_total{queue}` — counter

Route labels normalized via `normalizeRoute(req)` — uses `req.route.path` when Express matched a route, falls back to coalescing ObjectIds / UUIDs / numeric segments to `:id` / `:uuid` / `:n`. Cardinality bounded.

### `/metrics` endpoint protection
Token-gated via `METRICS_TOKEN` env var. If unset, returns 503 (refuses to expose internal data publicly). If wrong token, 401. Mounted BEFORE the global rate limiter so scrapes don't get 429d.

```yaml
# Prometheus scrape config example
scrape_configs:
  - job_name: web-sankul
    bearer_token: <METRICS_TOKEN value>
    static_configs:
      - targets: ['api.example.com:5000']
```

### Verification
```bash
# Generate some traffic, then scrape.
curl -s http://localhost:5000/api/v1/admin/courses -H "Authorization: Bearer $T"
curl -s http://localhost:5000/api/v1/admin/courses -H "Authorization: Bearer $T"

curl -s http://localhost:5000/metrics -H "Authorization: Bearer $METRICS_TOKEN" \
  | grep -E '^http_requests_total|^cache_hits_total'
# Expect counters > 0 with labels.
```

---

## Module 10 — Performance

### 10a. HTTP keep-alive tuning

[index.ts](../../src/index.ts): `keepAliveTimeout = 65s`, `headersTimeout = 70s`. Default Node values are 5s / 60s.

**Why this matters:** AWS ELB and GCP HTTPS LBs idle out at 60s. If Node closes connections first (default 5s), the LB sees half-open TCP connections and surfaces them as ECONNRESET / 502 to clients — intermittent and hard to debug. Setting Node's keepAlive *just above* the LB idle prevents the race.

### 10b. Mongo pool sizing

[db.ts](../../src/config/db.ts): `maxPoolSize=20`, `minPoolSize=2`, `serverSelectionTimeoutMS=5s`, `socketTimeoutMS=45s`. All env-overridable.

**Connection pool math (documented per audit):** `maxPoolSize × app_instances ≤ Mongo max_connections`. For Atlas M10/M20 with `max_connections ≈ 500` and 10 PM2 procs × 2 nodes = 20 procs, `maxPoolSize=20` yields 400 concurrent connections — comfortable headroom. Adjust via env if your topology differs.

**`serverSelectionTimeoutMS=5s`:** the default 30s was deeply hostile — every request hung for 30s when Mongo was down, exhausting Node's event loop and stalling unrelated requests too. 5s fails fast.

### Verification
```bash
# Check keepAlive tuning in a running container
node -e "console.log(require('http').globalAgent.keepAliveTimeout)"

# Mongo pool sizing visible in connect log.
grep "MongoDB connected" logs/app-$(date +%Y-%m-%d).log
# Expect: { maxPoolSize: 20, minPoolSize: 2, serverSelectionTimeoutMS: 5000 }
```

---

## Module 8 — Video Delivery

The survey returned **clean** — see the survey report. The canonical `/v1/lecture` endpoint encrypts video URLs via AES-128-CBC; no other client-facing endpoint returns raw URLs. Admin/educator endpoints return `hlsUrl` directly, which is by design (admin-only, behind authenticate). No drift detected.

**Open follow-ups (not in this batch):**
- Bind signed URLs to user + IP/UA hash (audit spec). Currently signed by upstream (VideoCrypt / YouTube) with their own TTL.
- Reduce signed URL TTL from upstream-dependent ~6h-24h to ≤5min. Requires re-signing in our resolver.

---

## Constraint compliance (Batch 2)

- ✅ No public API response shapes changed.
- ✅ Every admin route still requires Bearer token.
- ✅ Video URL contract untouched (Module 8 deferred).
- ✅ Plan duration semantics untouched.
- ✅ Downloads composition untouched.
- ⚠️ **New env var requirement:** `METRICS_TOKEN` (optional — endpoint returns 503 if unset; safe default). `ALLOWED_ORIGINS` + `RAZORPAY_WEBHOOK_SECRET` now hard-required in production (will refuse to boot if missing).

---

## Open follow-ups (next batch)

**Module 7 — JWT `kid` rotation**
- Accept old `kid` for a grace period, sign new tokens with current.
- Refresh-token revocation list in Redis (logout-all-devices).
- Per-role cached permission checks resolved from the permission catalog cache (already in place via Batch 1b Part 3).

**Module 9 — Structured logger augmentation**
- Inject `requestId`, `userId`, `route`, `latencyMs`, `dbMs`, `cacheHit` into every log line via a request-scoped context (AsyncLocalStorage).
- Mongoose middleware to capture `dbMs` per request.
- Migrate from Winston → pino for structured JSON throughput (~5x faster).

**Module 11 — Resilience**
- Timeouts + retries with jitter on every outbound call (Razorpay, 2Factor SMS, S3).
- Circuit breakers around third-party providers (opossum).
- `/healthz` (liveness) + `/readyz` (Mongo + Redis + queue ping).

**Modules 12 + 13 — Testing/CI + Scalability**
