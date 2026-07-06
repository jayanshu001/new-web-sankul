# Notification Scheduler — BullMQ

The scheduled-notification pipeline was migrated from a `node-cron` every-minute
poll to a **BullMQ delayed-job queue** backed by Redis. Notifications now fire
at their exact `scheduledAt` instant (within a few ms), with retries and
multi-instance safety built in.

---

## 1. Architecture

```
┌────────────────────────────┐
│  POST /admin/notifications │
│       /broadcast           │
│  (scheduledAt in future)   │
└─────────────┬──────────────┘
              │
              ▼
   Notification.create({status: "scheduled", scheduledAt})
              │
              ▼
   scheduleNotificationJob(id, scheduledAt)
              │
              ▼
        ┌──────────┐
        │  BullMQ  │  (Redis-backed delayed queue)
        │  queue   │
        └─────┬────┘
              │ wakes at scheduledAt
              ▼
        ┌──────────┐
        │  Worker  │  ← concurrency: 5
        └─────┬────┘
              ▼
   dispatchScheduledById(id)
   ├─ atomic claim: status "scheduled" → "sent"
   ├─ resolve audience → FCM sendPush()
   └─ update row with recipient counts
```

- **Queue name**: `notification-scheduler`
- **Job id**: notification `_id` (deterministic — enables cancel + idempotent rehydrate)
- **Retries**: 3 attempts, exponential backoff starting at 5 s
- **Concurrency**: 5 concurrent dispatches per worker
- **Retention**: completed jobs kept 1000 / 24h; failed kept 5000 / 7d

---

## 2. Files

| File | Role |
|---|---|
| [src/admin/notification/scheduler.ts](../src/admin/notification/scheduler.ts) | BullMQ queue, worker, init/shutdown, rehydrate |
| [src/admin/notification/dispatcher.ts](../src/admin/notification/dispatcher.ts) | `dispatchScheduledById(id)` — per-job dispatch with atomic claim + rollback-on-fail |
| [src/admin/notification/notification.controller.ts](../src/admin/notification/notification.controller.ts) | Hooks into queue: create / cancel / delete |
| [src/index.ts](../src/index.ts) | Boot-time `initNotificationScheduler()` + SIGTERM shutdown |
| ~~src/admin/notification/notification.worker.ts~~ | **Removed** (was the every-minute cron) |

---

## 3. End-to-end flow

### Creating a scheduled notification

`POST /api/v1/admin/notifications/broadcast` with `scheduledAt` (ISO timestamp, must be future):

1. Validate `scheduledAt > now` (controller, [notification.controller.ts:61](../src/admin/notification/notification.controller.ts#L61)).
2. Insert row with `status: "scheduled"`.
3. Call `scheduleNotificationJob(doc._id, scheduledAt)` — adds a delayed BullMQ job with `delay = scheduledAt - now`.
4. Respond 200 with the persisted doc.

### Firing

1. Redis triggers the delayed job at the exact instant.
2. Worker pulls the job and calls `dispatchScheduledById(id)`.
3. Atomic Mongo `findOneAndUpdate({status:"scheduled"} → {status:"sent"})` claims the row. If already claimed (another instance or a manual cancel beat us), the worker returns `{skipped:true}`.
4. Audience is resolved → FCM `sendPush()`.
5. Row is finalised with `status: "sent" | "failed"`, `recipientCount`, `failureReason`.

### Retry semantics

- If FCM throws or `dispatchAudience` returns `status: "failed"`, the dispatcher **rolls the row back** to `status: "scheduled"` and throws.
- BullMQ retries with exponential backoff (5 s → 25 s → 125 s).
- After the final attempt fails, the worker's `failed` listener marks the row `status: "failed"` permanently with the last error message.

### Cancellation

`POST /api/v1/admin/notifications/:id/cancel`:

1. Mongo `findOneAndUpdate({status: "scheduled"} → {status: "cancelled"})`.
2. `cancelNotificationJob(id)` — `queue.getJob(id).remove()`. If the job already fired or doesn't exist, this is a safe no-op.

### Deletion

Both `DELETE /:id` and `POST /bulk-delete` now also remove any BullMQ job that backed a still-scheduled row, preventing orphan jobs from firing against a deleted Mongo doc.

### Boot-time rehydrate

On every server start, `initNotificationScheduler()` queries `{status: "scheduled"}` and enqueues each row. Because the BullMQ jobId is the notification `_id`, re-enqueueing an already-queued job is a no-op — so this is safe to run on every start even mid-flight in PM2 cluster mode.

Past-due rows (server was down at `scheduledAt`) get `delay = 0` and fire immediately on the next worker tick.

---

## 4. Multi-instance / PM2 cluster behaviour

Safe out of the box:

- All instances share the same Redis queue. BullMQ guarantees a delayed job is delivered to **one** worker.
- All instances also share the same Mongo `Notification` collection. The atomic claim in `dispatchScheduledById` is the second line of defence — even if two workers somehow processed the same job (e.g. stalled-job recovery), only the first would flip status from `scheduled` to `sent`; the second sees the row already claimed and skips.
- Rehydrate-on-boot uses the deterministic `jobId`, so 4 instances starting simultaneously will not produce 4 duplicate jobs.

---

## 5. Configuration

Environment variables (all optional, defaults shown):

```
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASSWORD=
```

The scheduler creates **separate** Redis connections (queue / worker / events) with `maxRetriesPerRequest: null` and `enableReadyCheck: false`, as BullMQ requires. It does **not** share the global `redisClient` used for sessions/rate-limit.

---

## 6. Tuning knobs ([scheduler.ts](../src/admin/notification/scheduler.ts))

| Knob | Default | When to change |
|---|---|---|
| `concurrency` | 5 | Increase if FCM throughput is the bottleneck and your audience resolution can handle parallelism |
| `attempts` | 3 | Raise for flakier downstream (e.g. an HTTP webhook) |
| `backoff.delay` | 5 s | Lower for tighter SLAs; raise to be gentler on FCM during outages |
| `removeOnComplete` / `removeOnFail` | 24h / 7d | Control Redis memory growth |

---

## 7. Observability

Logged events (via `logger`):

- `BullMQ notification scheduler started.` (with rehydrated count)
- `Notification job completed` (with jobId)
- `Notification job failed` (with jobId, attemptsMade, error)
- `Notification worker error` (queue-level)

To add a UI later, drop in **Bull Board** (`@bull-board/express`) pointing at the same queue — zero code changes elsewhere.

---

## 8. Failure modes & mitigations

| Failure | Behaviour |
|---|---|
| Redis down at boot | `initNotificationScheduler()` keeps retrying; once Redis is back, rehydrate runs. The cron sweep is gone, so scheduled notifications **will not fire until Redis is restored**. |
| Redis dies mid-flight | BullMQ pauses; jobs resume on reconnect. No data loss — the source of truth is Mongo, queue state is reconstructable via rehydrate (restart the process). |
| FCM transient error | Retried 3× with backoff. |
| FCM permanent error / all-tokens-invalid | Row marked `failed` with reason after attempts exhausted. |
| Process killed between claim and dispatch | Row is `sent` in Mongo but no push was delivered. BullMQ's stalled-job recovery picks up the job and retries; dispatcher sees `status: "sent"` (not `"scheduled"`) and skips — **gap to be aware of**. Mitigation: would need a two-phase status (e.g. `"dispatching"`) to make this fully crash-safe. Acceptable for current scale. |

---

## 9. Migration notes

- `node-cron` is no longer used by notifications. Other cron jobs (if any) are unaffected.
- The dependency stays in `package.json` until other consumers are gone.
- Existing rows already in `status: "scheduled"` from before this change will be picked up by the rehydrate sweep on the next deploy — no manual migration required.
- The `processDueNotifications()` function is retained in [dispatcher.ts](../src/admin/notification/dispatcher.ts) for emergency manual sweeps (e.g. a `POST /admin/notifications/sweep` endpoint if needed), but it is not called automatically anywhere.
