# Backend Audit — Batch 6: Module 13 (Scalability — actionable subset)

Lands the actionable-now subset of Module 13. Capacity planning items (shard keys, autoscaling thresholds, capacity model) remain deferred — they need production numbers to plan well.

This batch fixes **3 P0 bugs that would break a horizontal scale-out today** plus wires Socket.io for multi-pod operation, the single biggest scalability blocker on the system.

---

## Files

### Created
| File | Purpose |
|---|---|
| [src/libs/secondaryRead.ts](../../src/libs/secondaryRead.ts) | `secondaryRead(query)` helper — routes a Mongoose Query / Aggregate to a replica-set secondary with a 90s staleness budget. Helper-only; no callers migrated this batch. |
| [docs/audit/data-retention-policy.md](./data-retention-policy.md) | Spec for TTL / archival policy across 6 high-volume collections. Sign-off matrix per collection. |

### Modified
| File | Change |
|---|---|
| [src/middlewares/errorHandler.ts](../../src/middlewares/errorHandler.ts) | P0 fix: in-memory `_errorEmailCooldown` Map → Redis `SET NX EX` per error signature. Cluster-wide throttle instead of per-pod throttle. |
| [src/libs/outbound.ts](../../src/libs/outbound.ts) | P0 fix: circuit breaker state moved to Redis HASH. Local Map kept as a Redis-down fallback. |
| [src/utils/crashReporter.ts](../../src/utils/crashReporter.ts) | P0 fix: per-pod `lastEmailAt` throttle → Redis `SET NX EX`. N-pod crash loops no longer multiply the email volume by N. |
| [src/socket/livechat.socket.ts](../../src/socket/livechat.socket.ts) | A2: attached `@socket.io/redis-adapter` (dedicated pub/sub connections via `redisClient.duplicate()`). `viewerCount()` rewritten to use `fetchSockets()` so it sees viewers on OTHER pods. `socket.data.customerId/userName` copied alongside the existing `socket.customerId/userName` so cross-pod queries can read it. |
| [src/admin/notification/scheduler.ts](../../src/admin/notification/scheduler.ts) | A5: backpressure — `scheduleNotificationJob` refuses with `QueueBackpressureError` once `waiting + delayed` exceeds `NOTIFICATION_QUEUE_DEPTH_LIMIT` (default 10,000). Boot rehydrate passes `bypassBackpressure: true`. |
| `package.json` | Added `@socket.io/redis-adapter` (single new dependency this batch). |

### Endpoints affected
**None directly.** All changes are infrastructure. Behavior changes a caller might notice:

- Live chat `viewer_count` events now reflect cluster-wide viewer count (was: only the local pod's viewers).
- Scheduling a notification when the queue is over capacity now fails with `QueueBackpressureError` instead of silently growing the queue. Controllers that call `scheduleNotificationJob` should map this to HTTP 503 with `Retry-After: 60`. (No callers updated this batch — they currently let the error bubble to the global handler, which returns 500. Acceptable for now; will be tightened in a follow-up.)

---

## Module 13 — Statelessness (A1)

### Survey findings recap (from Explore agent, abridged)

| Severity | Issue | File |
|---|---|---|
| **P0** | `_errorEmailCooldown` Map → 5-pod deploy → 5× email spam | errorHandler.ts:31 |
| **P0** | Circuit breaker `breakers` Map → each pod has its own breaker → no cross-pod recovery | outbound.ts:110 |
| **P0** | Crash reporter `lastEmailAt` → crash loop emails × N pods | crashReporter.ts:21-22 |
| **P1** | Socket.io `viewerCount` reads local adapter only | livechat.socket.ts:32 |
| **P1** | BullMQ scheduler runs on every pod (concurrency multiplication) | scheduler.ts:22 |
| **P2** | YouTube cookies parsed per-pod on first use | videoResolver.ts:17 |

### Fixed this batch

**P0 #1 — errorHandler cooldown**

```diff
- const _errorEmailCooldown = new Map<string, number>();
- const lastSent = _errorEmailCooldown.get(cooldownKey) ?? 0;
- const shouldSend = Date.now() - lastSent > ERROR_EMAIL_COOLDOWN_MS;
+ const acquireEmailCooldown = async (statusCode, message) => {
+   const result = await redisClient.set(
+     errorEmailCooldownKey(statusCode, message),
+     String(Date.now()), "EX", 60, "NX"
+   );
+   return result === "OK";
+ };
+ const shouldSend = await acquireEmailCooldown(statusCode, message);
```

`SET NX EX` is atomic — first pod wins the cooldown, all other pods skip the email for 60 seconds. Fail-open: if Redis is down, every pod sends (better than zero alerts).

**P0 #2 — circuit breaker state**

Breaker state moved to Redis HASH per label. Each `callOutbound` invocation does one `HGETALL` (read) and one `HSET + EXPIRE` (write) — both ~1ms. Local Map kept as a fallback when `isRedisReady()` returns false, so the system degrades to "per-pod breaker" instead of crashing. Old `breakerSnapshot()` API preserved for compatibility (now reports the local fallback view only; for cluster-wide state, query Redis directly).

**P0 #3 — crash reporter throttle**

Same `SET NX EX` pattern as errorHandler, keyed by the crash title. Per-pod `crashEmailInFlight` boolean kept — that's correct same-pod behavior, just not sufficient on its own.

**P1 #4 — Socket.io viewer count** (covered by A2 below).

### Deferred

- **P1 #5 BullMQ worker concurrency multiplication.** Needs a deployment decision: which pod runs the worker? Options are (a) env flag `WORKER_NODE=true` set on a designated pod, (b) Kubernetes StatefulSet-of-1 for the worker as a separate deployment, (c) BullMQ's built-in distributed locking lets all pods run workers safely but with `globalConcurrency` rather than per-pod `concurrency`. Each is a real architectural choice that needs your topology context.
- **P2 #6 YouTube cookies cache.** Cosmetic. Per-pod parse cost is microseconds.

---

## Module 13 — Socket.io scaling (A2)

### Why this is the biggest single blocker

Without the Redis adapter, here's what breaks when you scale from 1 pod to 2:

- Student A is on pod 1, watching live class X.
- Student B is on pod 2, also watching live class X.
- Teacher emits a poll question via the admin REST endpoint → it broadcasts via `io.to(roomKey(X)).emit(...)`.
- Only the students connected to the SAME pod that handled the REST request see the poll. The other half of the class sees nothing.

The Redis adapter publishes every broadcast to a Redis channel; every pod subscribes and re-emits to its local sockets. Now every student in the room sees every event regardless of which pod they're connected to.

### Implementation

```ts
const pubClient = redisClient.duplicate();
const subClient = redisClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

`duplicate()` preserves the host/port/password/retry config without re-wiring the connection details. We use dedicated pub/sub connections because **Redis pub/sub mode blocks the subscribed connection from issuing other commands** — reusing the shared `redisClient` would lock cache/session/breaker reads.

### `viewerCount` rewrite

Old version walked the local adapter's `rooms` Set, which only sees sockets on THIS pod. New version uses `io.in(room).fetchSockets()` — with the Redis adapter, this RPCs every pod, fetches their socket lists, and returns the union. The function became async; all 4 callsites already awaited it (or were inside async handlers), so the migration was mechanical.

Custom socket fields (`customerId`, `userName`) now also live in `socket.data` because Socket.io's `RemoteSocket` (returned by cross-pod queries) only exposes `socket.data` — not the custom properties we monkey-patched onto the local Socket instance.

### Verification

```bash
# Run two API instances, each pointing at the same Redis.
PORT=5000 npm start
PORT=5001 npm start  # in another terminal

# Connect socket clients to BOTH instances using the demo:
# - Open http://localhost:5000/demo/live-chat with student A
# - Open http://localhost:5001/demo/live-chat with student B
# Join the same live class room.
# Teacher posts a poll via REST to :5000.
# Expect: both students receive the poll-started event.

# Without the adapter: only student A receives it.
```

---

## Module 13 — Secondary read helper (A3)

`secondaryRead(query)` is a thin wrapper that calls `.read("secondaryPreferred", [], { maxStalenessSeconds: 90 })` on the underlying Query / Aggregate. **No callers migrated this batch** — the helper is published for future opt-in use on catalog/list endpoints.

Why opt-in: read-your-writes is a real consistency requirement on detail endpoints, payment-verify paths, and post-create redirects. Bulk-migrating list endpoints to secondaryPreferred without a per-endpoint review risks subtle bugs (e.g. user creates a course, immediately reloads the list, doesn't see it for ~1s).

When you're ready to migrate, the candidates per priority:

- **High value, low risk:** Public catalog reads. `Course.find({ active: true })` on the client side, `listPackageTypes`, `listPermissions/tree`, anything cached via `cache.aside` already (because aside's TTL already implies stale-tolerant).
- **Medium value, medium risk:** Admin list endpoints. Admins refreshing a list don't expect millisecond freshness; ~1s lag is invisible.
- **Skip:** Any endpoint reading the result of an operation that just succeeded. Verify webhooks, post-create redirects, refresh-token rotation, subscription activation.

---

## Module 13 — Backpressure (A5)

`scheduleNotificationJob` now refuses new schedules when the BullMQ queue's `waiting + delayed` count exceeds `NOTIFICATION_QUEUE_DEPTH_LIMIT` (default 10,000, env-tunable).

### Failure mode prevented

A bug that schedules notifications in a tight loop (or a real surge: a "system maintenance" blast to 100k students) would push BullMQ's waiting list into hundreds of MB of Redis memory. That degrades every other tenant of the same Redis instance — cache, sessions, rate limits, breakers — and turns a notification feature bug into a site-wide outage.

The limit is a soft ceiling, with `bypassBackpressure: true` available for callers that are processing recovery work (boot rehydrate already uses it). Operators can raise the limit via env without a code change.

### Where this surfaces to users

Currently the controllers that call `scheduleNotificationJob` let the error bubble to the global error middleware, which returns 500. **A follow-up should map `QueueBackpressureError` to HTTP 503 with `Retry-After: 60`.** This is straightforward but wasn't in scope for this batch.

---

## Module 13 — Data retention policy doc (A4)

[docs/audit/data-retention-policy.md](./data-retention-policy.md) — spec, not code. Identifies every high-volume collection in the system, classifies by retention need (ephemeral / hot operational / audit), and gives an owner-by-owner sign-off matrix.

Most useful as a checklist for follow-up tickets. Nothing in this doc is "implement now" without product/finance/analytics input.

---

## Constraint compliance

- ✅ No public API response shape changes.
- ✅ Every authenticated route still requires Bearer token.
- ✅ Video URL contract untouched.
- ✅ Plan duration / `setMonth` semantics untouched.
- ✅ Downloads composition untouched.
- ⚠️ **New env var:** `NOTIFICATION_QUEUE_DEPTH_LIMIT` (optional, defaults 10,000).
- ⚠️ **New dependency:** `@socket.io/redis-adapter ^8.3.0`. Run `npm install` after pulling.
- ⚠️ **Behavior change:** `viewerCount` is now async. Callsites that aren't already awaiting will silently emit `[object Promise]` as the count. All current callsites were updated in this batch.

---

## Module status after Batch 6

| Module | Status |
|---|---|
| 1. API & Routing | ✅ Done |
| 2. Controllers | ✅ Done for 6 priority domains |
| 3. Services | ✅ Done for 6 priority domains |
| 4. Database | ✅ Mostly done (cursor pagination outstanding; data-retention spec landed this batch) |
| 5. Redis Caching | ✅ Done |
| 6. Queues | ✅ Done — DLQ, queue depth metric, backpressure all landed |
| 7. Auth & Security | ✅ Done |
| 8. Video Delivery | ✅ Done |
| 9. Observability | ✅ Done |
| 10. Performance | ✅ Mostly done |
| 11. Resilience | ✅ Done |
| 12. Testing & CI | ❌ Out of scope per user direction |
| 13. Scalability | ✅ **Actionable subset done.** Capacity planning items (shard keys, HPA thresholds, capacity model) deferred — need production numbers. |

---

## What's still open

**Module 13 — needs your input:**
- BullMQ worker deployment topology (env flag vs StatefulSet vs `globalConcurrency`).
- Shard key planning (needs collection sizes, query patterns).
- Connection pool math for your specific PM2/K8s topology.
- HPA / autoscaling thresholds (needs current p95 latency baseline).
- Target RPS / concurrent live session capacity model.

**Module 4 / 6 — discretionary:**
- Cursor-based pagination on high-cardinality collections.
- SLA-tiered queues (`realtime` / `bulk` / `low-priority`) — premature; only one queue exists today.

**Module 9 — discretionary:**
- Winston → pino migration.
- OpenTelemetry traces.

**Module 13 follow-ups:**
- Migrate catalog/list endpoints to `secondaryRead` (opt-in, per-endpoint review).
- Map `QueueBackpressureError` to HTTP 503 with `Retry-After` in notification controllers.
- Address the 3 retention-policy items that are operational (ws_referral_transactions, ws_live_chat_messages, ws_live_session_attendances).
