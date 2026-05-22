# Backend Audit — Batch 3: Resilience + JWT kid rotation

Closes out **Module 11 (Resilience)** at high coverage and lands the **JWT kid rotation infrastructure** flagged from Module 7. Module 12 (Testing/CI) and Module 13 (Scalability/sharding/read-replica routing) are deliberately not in this batch — they need concrete CI provider context and production capacity numbers to plan well.

---

## Files

### Created
| File | Purpose |
|---|---|
| [src/middlewares/health.ts](../../src/middlewares/health.ts) | `/healthz` (liveness) + `/readyz` (Mongo + Redis ping). |
| [src/utils/gracefulShutdown.ts](../../src/utils/gracefulShutdown.ts) | Orchestrated SIGTERM/SIGINT handler: flip readyz → close HTTP → drain queues → close Mongo/Redis → exit. |
| [src/libs/outbound.ts](../../src/libs/outbound.ts) | `callOutbound()` — timeout + retry-with-jitter + circuit breaker for third-party calls. Zero new deps. |
| [src/config/jwtKeys.ts](../../src/config/jwtKeys.ts) | JWT keyring (kid → secret) with legacy-secret fallback. |
| [src/utils/jwtSigner.ts](../../src/utils/jwtSigner.ts) | `signAccessToken` / `verifyAccessToken` (+ refresh equivalents) that embed/read the `kid` header. |

### Modified
| File | Change |
|---|---|
| [src/app.ts](../../src/app.ts) | Mounts `/healthz` + `/readyz` before global rate limiter. |
| [src/index.ts](../../src/index.ts) | Replaces ad-hoc SIGTERM handler with `installGracefulShutdown({ httpServer })`. |
| [src/middlewares/authenticate.ts](../../src/middlewares/authenticate.ts) | `verifyAccessToken` (keyring-aware) replaces direct `jwt.verify(token, JWT_SECRET)`. |
| [src/client/auth/auth.service.ts](../../src/client/auth/auth.service.ts) | Sign/verify routed through keyring. OTP SMS wrapped in `callOutbound`. JWT_SECRET / JWT_REFRESH_SECRET constants removed (now consumed via keyring). |
| [src/utils/emailService.ts](../../src/utils/emailService.ts) | `sendEmail` wrapped in `callOutbound` (8s timeout, 2 attempts). |
| [src/client/payment/razorpay.ts](../../src/client/payment/razorpay.ts) | New `createRazorpayOrder()` helper wraps `rp.orders.create` in `callOutbound`. |
| 6× payment controllers ([course](../../src/client/payment/course-payment.controller.ts), [live-course](../../src/client/payment/live-course-payment.controller.ts), [ebook](../../src/client/payment/ebook-payment.controller.ts), [package](../../src/client/payment/package-payment.controller.ts), [test-series](../../src/client/payment/test-series-payment.controller.ts), [book](../../src/client/payment/payment.controller.ts)) | `rp.orders.create(...)` → `createRazorpayOrder(rp, ...)`. |

---

## Module 11 — Resilience

### 11a. Health probes

#### `/healthz` (liveness)
Returns 200 + `{ status, uptimeSec, pid, timestamp }` as long as the event loop can serve the request. No I/O. K8s uses this to decide whether to RESTART.

#### `/readyz` (readiness)
- Pings Mongo (`db.admin().ping()` with a 1.5s timeout) — catches the case where `mongoose.readyState === 1` but a failover is silently buffering writes.
- Pings Redis (`PING` with 1.5s timeout).
- Returns 200 + per-check status + latencyMs when all green.
- Returns **503 + `status: "shutting_down"`** the moment SIGTERM is received (via `isShuttingDown()` flag from `gracefulShutdown.ts`). LB drains within one health-check interval.
- Returns 503 + per-check status when any dependency is unhealthy.

K8s uses this to decide whether to **keep traffic flowing**. Briefly failing /readyz during a Mongo blip is preferable to spraying 5xx at users.

Both endpoints mounted **before** the global rate limiter so a 1Hz scrape per pod doesn't get 429d.

#### Verification
```bash
# Liveness
curl -s localhost:5000/healthz | jq
# { "status": "ok", "uptimeSec": 42, "pid": 12345, "timestamp": "..." }

# Readiness — happy
curl -s localhost:5000/readyz | jq
# { "status": "ready", "checks": { "mongo": { "ok": true, "latencyMs": 3 }, "redis": { "ok": true, "latencyMs": 1 } }, "timestamp": "..." }

# Readiness — Mongo down
# kill -STOP $(pgrep mongod); curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/readyz
# Expect: 503
```

---

### 11b. Graceful shutdown

Replaces the ad-hoc `process.on("SIGTERM", () => { shutdownNotificationScheduler(); process.exit(0); })` with an orchestrated sequence:

1. **Set `shuttingDown=true`** — `/readyz` starts returning 503 immediately. The LB stops sending new traffic within ~5s.
2. **`server.close()`** — stop accepting new connections. Existing keep-alive sockets close after their next request finishes (Node 18.2+ behavior). Race with `SHUTDOWN_DRAIN_MS` (default 25s) so a stuck handler can't pin us forever.
3. **`preClose` hook** — for websocket close, third-party SDK teardown (extension point; unused right now).
4. **`shutdownNotificationScheduler()`** — BullMQ `worker.close()` waits for the active job to finish before returning.
5. **`mongoose.connection.close()` + `redisClient.quit()`** in parallel — flush buffered writes, drain in-flight Redis commands.
6. **`process.exit(0)`** — clean exit.

If anything hangs past `SHUTDOWN_HARD_TIMEOUT_MS` (default 30s), a watchdog `process.exit(1)` lets PM2/K8s restart the pod.

#### Impact
- **Reliability:** rolling deploys no longer drop in-flight requests. Notification jobs that were mid-dispatch don't get stranded as "scheduled" forever.
- **Operations:** SIGTERM → exit-0 path is observable via logs (`Received SIGTERM, beginning graceful shutdown` → `Graceful shutdown complete`).

#### Verification
```bash
# Send SIGTERM and watch the log.
kill -TERM $(pgrep -f "node dist/index")
tail -f logs/app-$(date +%Y-%m-%d).log
# Expect (in order):
#   Received SIGTERM, beginning graceful shutdown.
#   Closing HTTP server (no new connections).
#   Draining notification scheduler.
#   Closing Mongo + Redis connections.
#   Graceful shutdown complete.
```

---

### 11c. Outbound timeout + retry + circuit breaker

Centralized wrapper in [libs/outbound.ts](../../src/libs/outbound.ts). Three orthogonal protections:

1. **Timeout** — every attempt is `Promise.race`d against a per-call deadline. Default 5s.
2. **Retry with full jitter** — exponential backoff (`baseDelayMs * 2^(attempt-1)`, capped at `maxDelayMs`, then `Math.random()` of that). Only retries on retryable errors (network codes, 5xx, 429). 4xx other than 429 fails immediately — that's a bug, not a transient failure.
3. **Circuit breaker** — after `failureThreshold` consecutive failures (default 5), the breaker opens for `cooldownMs` (default 30s) and all subsequent calls short-circuit with `CircuitOpenError`. After cooldown one probe call is allowed; success → closed, failure → opens again. Stops cascading hammering of a downed dependency.

Breaker state is keyed by `label`, so independent dependencies (SMS, email, Razorpay) have independent breakers.

#### Migrated callsites (this batch)

| Callsite | Label | Timeout | Attempts | Notes |
|---|---|---|---|---|
| 2Factor SMS OTP (auth.service.ts) | `sms.2factor` | 4s | 3 | Previously had no breaker; a 2Factor outage would queue OTPs at the 10s default until upstream gave up. |
| Email (utils/emailService.ts) | `email.smtp` | 8s | 2 | SMTP `verify()` is the slow step (TLS handshake); single retry covers a flapping NIC without doubling the email-to-user latency. |
| Razorpay create-order (6 controllers via `createRazorpayOrder`) | `razorpay.orders.create` | 6s | 3 | Razorpay's `receipt` field is their idempotency key, so retries with the same receipt are safe — either return the existing order or create one. |

#### Verification
```bash
# Force a circuit open by pointing SMS_BASE_URL to a black-hole, then send 6 OTPs.
TWO_FACTOR_BASE_URL=https://10.255.255.1/ \
  curl -X POST localhost:5000/api/v1/client/auth/send-otp -d '{"phone":"9999999999"}'
# ... repeat 5x. The 6th should fail INSTANTLY with "Circuit open for sms.2factor".

# Confirm breaker state via /metrics? — breaker state is internal; expose via
# /healthz "extra" or add a metric in a follow-up batch.
```

---

## Module 7 — JWT `kid` rotation

### Why this matters
The legacy code signed and verified every JWT with a single `process.env.JWT_ACCESS_SECRET`. There was no mechanism to rotate the secret without invalidating every active session, so the secret could never realistically be changed — which is its own security weakness (long-lived shared secret).

### Design
Two-layer split:
- [config/jwtKeys.ts](../../src/config/jwtKeys.ts) — pure env parsing → `KeyRing { byKid, currentKid, legacySecret }`. No dependency on `jsonwebtoken`.
- [utils/jwtSigner.ts](../../src/utils/jwtSigner.ts) — `signAccessToken` / `verifyAccessToken` (+ refresh) using the ring. Sign embeds `kid` header; verify reads `kid` from header and looks up the matching secret.

### Env contract
```
# Legacy (still works):
JWT_ACCESS_SECRET=<32+ char secret>
JWT_REFRESH_SECRET=<32+ char secret>
# → synthesized as ring { v1: <legacy secret> } at boot.

# Explicit rotation:
JWT_ACCESS_KEYS=v2:<new-secret>,v1:<old-secret>
JWT_ACCESS_CURRENT_KID=v2
# → new tokens sign with v2; old v1 tokens still verify.
```

### Rotation playbook (no downtime)

1. **Day 0**: `JWT_ACCESS_SECRET=<existing>` only. Tokens have no `kid` (legacy path).
2. **Day 1** (rollout): deploy this code. Existing tokens still verify (legacy secret = ring's legacySecret). New tokens get `kid=v1`.
3. **Day N** (rotation): set:
   ```
   JWT_ACCESS_KEYS=v2:<new-32-char-secret>,v1:<old-secret>
   JWT_ACCESS_CURRENT_KID=v2
   ```
   Rolling restart. New logins issue v2 tokens; v1 tokens keep working until their natural expiry (7 days for access, 60 for refresh).
4. **Day N + 60** (cleanup): drop v1:
   ```
   JWT_ACCESS_KEYS=v2:<new-secret>
   ```
   Any token still signed with v1 fails verification with `Token kid "v1" is not in the active keyring.` — expected, since all active sessions have rotated through the refresh path by now.

### Migrated callsites this batch

Customer auth (the highest-traffic path) is fully migrated:
- [src/middlewares/authenticate.ts](../../src/middlewares/authenticate.ts) — verify
- [src/client/auth/auth.service.ts](../../src/client/auth/auth.service.ts) — login sign + refresh sign + refresh verify

### Deferred callsites (next batch)
Same pattern applies to:
- [src/admin/auth/admin.auth.service.ts](../../src/admin/auth/admin.auth.service.ts) — 5 callsites
- [src/educator/auth/educator.auth.service.ts](../../src/educator/auth/educator.auth.service.ts) — 5 callsites
- [src/promoter/auth/promoter.auth.service.ts](../../src/promoter/auth/promoter.auth.service.ts) — 5 callsites
- [src/socket/livechat.socket.ts](../../src/socket/livechat.socket.ts) — websocket auth verify
- [src/socket/camera-ingest.ts](../../src/socket/camera-ingest.ts) — websocket auth verify

These keep using the raw `jwt.sign(payload, JWT_SECRET)` — they remain functionally correct (because `JWT_ACCESS_SECRET` is still the ring's legacy secret) but will silently miss out on the kid header. **Tokens minted by these paths won't survive a rotation step.** Migration in the next batch is a mechanical refactor identical to what was done for customer auth.

---

## Constraint compliance

- ✅ No public API response shape changes.
- ✅ Every admin route still requires Bearer token.
- ✅ Video URL contract untouched.
- ✅ Plan duration / `setMonth` semantics untouched.
- ✅ Downloads composition untouched.
- ⚠️ **New required behavior:** SIGTERM now triggers a 25-30s graceful shutdown. PM2/K8s `stop_timeout` should be ≥ 35s to avoid SIGKILL during the drain phase.
- ⚠️ **New optional env vars:** `JWT_ACCESS_KEYS`, `JWT_ACCESS_CURRENT_KID`, `JWT_REFRESH_KEYS`, `JWT_REFRESH_CURRENT_KID`, `SHUTDOWN_DRAIN_MS`, `SHUTDOWN_HARD_TIMEOUT_MS`. All have safe defaults derived from existing env.

---

## Open follow-ups

**Module 7 (auth — finish kid migration):**
- Migrate admin/educator/promoter auth services + the 2 socket handlers to `signAccessToken` / `verifyAccessToken`.
- Refresh-token revocation list in Redis (logout-all-devices endpoint).

**Module 9 (observability — deferred):**
- AsyncLocalStorage-backed request context so every log line carries `requestId`, `userId`, `route`, `latencyMs`, `dbMs`, `cacheHit` without manual threading.
- Mongoose middleware to capture `dbMs` per request.
- Winston → pino migration (~5x faster, structured by default).

**Module 11 (resilience — remaining):**
- Expose breaker state via `/healthz` or a `circuit_breaker_state{label}` gauge metric.
- Migrate the remaining outbound callsites: S3 ops (multer-s3 streaming uploads), YouTube ytdl-core resolves, VideoCrypt token unwrap, FCM push.

**Module 12 (testing/CI):** Needs a focused turn — depends on your CI provider, test framework choice, and Testcontainers setup. Not landed here.

**Module 13 (scalability):** Sharding strategy, secondary-routing for catalog reads, multi-tenant rate limits — all need real capacity numbers to plan. Not landed here.
