# Scheduled Notifications: Retries and the Dead Letter Queue

How a scheduled push notification is queued, sent, retried, and parked in a dead letter
queue (DLQ) when it keeps failing. Written 2026-10-09 against the code on the
`migration` branch. Section 7 records the retry gap that was fixed the same day.

---

## 1. Components

| Piece | Where | Purpose |
|---|---|---|
| `ws_notification` row | MySQL | Source of truth: `status` is `scheduled` → `sent` / `failed` / `cancelled` |
| `notification-scheduler` queue | Redis (BullMQ) | One delayed job per scheduled notification |
| Worker (concurrency 5) | `websankul-worker` PM2 process | Runs the job when its delay expires |
| `notification-scheduler-dlq` queue | Redis (BullMQ) | Copy of every job that exhausted its retries. **No worker reads it**; it is an inbox for people |
| Boot rehydrate | worker start-up | Re-queues every row still `scheduled`, so a Redis flush or restart loses nothing |
| `/metrics` | API | `queue_depth{queue,state}` and `queue_jobs_dlq_total{queue}` |

Code:

- `src/admin/notification/scheduler.ts`: queue, worker, retry policy, DLQ, rehydrate, backpressure
- `src/modules/admin-notification/admin-notification.service.ts`: `dispatchScheduledById`
  (claim + send), `dispatchAudience`, `markFailed`, `listScheduledForRehydrate`
- `src/utils/fcm.ts`: `sendPush` (FCM batches, transport retry, invalid-token pruning)
- `src/admin/notification/notification.controller.ts`: schedule / cancel / delete endpoints

---

## 2. Lifecycle

```
Admin schedules ──► ws_notification (status=scheduled)
                └─► BullMQ job "notif-<id>" (delay = scheduledAt - now)
                                   │ delay expires
                                   ▼
                    worker: dispatchScheduledById(id)
                    1. claim: UPDATE ... SET status='sent' WHERE id=? AND status='scheduled'
                       0 rows → already sent/cancelled → job completes as "skipped"
                    2. resolve audience → collect FCM tokens (paged)
                    3. sendPush: batches of 500, each batch retried 3x on network/5xx
                    4. write result to the row
                                   │
            ┌──────────────────────┼─────────────────────────────┐
     ≥1 device got it        dispatch threw, or          no registered devices
     row = sent, done        FCM rejected every device   row = failed, job ends
                             row rolled back to          (permanent, no retry)
                             scheduled, job throws
                                   │
                    BullMQ retry: 3 attempts total, backoff 5s → 10s → 20s
                                   │ still failing after attempt 3
                                   ▼
                    worker "failed" listener:
                    - markFailed(id, lastError)  → row status=failed, failureReason
                    - copy job to notification-scheduler-dlq as "dlq-notif-<id>"
                      { notificationId, lastError }, kept 30 days
                    - queue_jobs_dlq_total += 1
```

---

## 3. Endpoints that feed the queue

All under `/api/v1/admin/notifications` (admin Bearer token):

| Endpoint | Effect on the queue |
|---|---|
| `POST /broadcast` with a future `scheduledAt` | Creates the `scheduled` row, then `scheduleNotificationJob` |
| `POST /:id/cancel` | Removes the job (`cancelNotificationJob`); row → `cancelled` |
| `DELETE /:id`, `POST /bulk-delete` | Deletes rows; removes the jobs of any that were `scheduled` |

There is no resend or retry endpoint today (see §8).

---

## 4. Retry policy

There are two layers.

1. **Transport retry, per FCM batch** (`fcm.ts` → `callOutbound`): 3 attempts, 10 s
   timeout each, only for network errors and 5xx. Per-device errors arrive inside a
   successful FCM response and are not retried. Tokens FCM reports as invalid are
   pruned from `ws_customer`.
2. **Job retry** (`scheduleNotificationJob`): `attempts: 3`,
   `backoff: { type: "exponential", delay: 5000 }`. The job retries only when the worker
   throws.

### When the job is considered failed

| Outcome of a send | Row | Job |
|---|---|---|
| At least one device succeeded | `sent` (`recipientCount` = successes) | completed. Failed devices are not retried |
| `dispatchAudience` threw (DB error, crash, timeout) | rolled back to `scheduled` | throws → retried |
| FCM reached but every device failed (`All sends failed.`, usually an FCM outage) | rolled back to `scheduled` | throws → retried; after attempt 3 the row → `failed` and the job → DLQ |
| No registered devices for the audience | `failed` at once | completed. Permanent, so no retry |
| Firebase not configured (`FIREBASE_SERVICE_ACCOUNT` missing) | `sent` | completed. `sendPush` skips sending and the result counts as sent; this predates the fix and is unchanged |

The retry decision is `isRetryableDispatchFailure(result)` in
`admin-notification.service.ts`: true only for `All sends failed.`.

---

## 5. Safety properties

- **No double send.** The claim is a conditional `updateMany` from `scheduled` to `sent`.
  A retry, a second worker, or a duplicate job finds 0 rows and skips.
- **Idempotent enqueue.** The job id is `notif-<id>`. BullMQ rejects purely numeric ids,
  hence the prefix. Rescheduling removes the old job first.
- **Restart safe.** On boot one worker (Redis lock `notif:rehydrate:boot-lock`, 120 s TTL)
  re-queues every `scheduled` row with its original `scheduledAt`. Overdue rows fire
  immediately. Rows are read in id pages of 1000 and never capped, so none are dropped.
- **Backpressure.** New schedules are refused once waiting + delayed jobs reach
  `NOTIFICATION_QUEUE_DEPTH_LIMIT` (default 10000) by throwing `QueueBackpressureError`.
  No controller maps it to 503 today, so the admin sees the broadcast handler's generic
  error. Note: the `scheduled` row is created before the enqueue, so a refused schedule
  leaves a `scheduled` row that the next worker restart re-queues. Rehydrate bypasses
  the limit because it recovers existing work.
- **DLQ retention.** DLQ jobs are never processed, never removed on completion, and
  expire after 30 days.

---

## 6. Operating the DLQ (manual)

### Watch it

- `/metrics`: `queue_jobs_dlq_total{queue="notification-scheduler"}` (counter) and
  `queue_depth{queue="notification-scheduler-dlq",state="waiting"}` (gauge). Alert when the
  counter increases.
- Logs: `Notification job failed` (every attempt) and
  `Failed to mark notification as failed after retries exhausted`.

### List what is in it

```bash
npx tsx -e '
import { Queue } from "bullmq"; import Redis from "ioredis";
const q = new Queue("notification-scheduler-dlq", { connection: new Redis({
  host: process.env.REDIS_HOST ?? "localhost", port: Number(process.env.REDIS_PORT ?? 6380),
  password: process.env.REDIS_PASSWORD, maxRetriesPerRequest: null }) });
q.getJobs(["waiting"], 0, 100).then((jobs) => {
  for (const j of jobs) console.log(j.id, j.data.notificationId, j.data.lastError, new Date(j.timestamp).toISOString());
  process.exit(0);
});'
```

Each DLQ job carries `{ notificationId, lastError }`. The matching `ws_notification` row
has `status = 'failed'` and `failure_reason`.

### Replay one notification

The row must go back to `scheduled` first; otherwise the claim step skips it.

1. Fix the cause (FCM credentials, Redis, DB).
2. In MySQL: `UPDATE ws_notification SET status='scheduled', sent_at=NULL WHERE id=<id> AND status='failed';`
3. Re-queue it to fire now, from a shell with the app's `.env`:
   ```bash
   npx tsx -e 'import { scheduleNotificationJob } from "./src/admin/notification/scheduler";
   scheduleNotificationJob("<id>", new Date(), { bypassBackpressure: true }).then(() => process.exit(0));'
   ```
   Restarting the worker does the same for every `scheduled` row (boot rehydrate).
4. Optionally remove the DLQ entry: `dlq-notif-<id>`.

Replaying re-sends to the **whole** audience. If the earlier attempt reached some devices,
those devices get it twice.

---

## 7. Retry gap fixed (2026-10-09)

**Before:** when FCM rejected every device, `dispatchScheduledById` wrote the row as
`failed`, then the worker threw. The BullMQ retry found the row no longer `scheduled`,
so its claim affected 0 rows and the job completed as "skipped". The notification was
never really retried and never reached the DLQ.

**Now:**

- `All sends failed.` rolls the row back to `scheduled` and the worker throws, so all 3
  attempts really run (5 s → 10 s → 20 s). If the last one fails too, the worker's
  "failed" listener marks the row `failed` and copies the job to the DLQ, as §2 describes.
- `No registered devices…` is marked `failed` and the job completes at once instead of
  burning two no-op retries.

Verified with `scripts/verify-notification-retry.ts`. FCM is stubbed and the DB is real;
the script creates and removes its own rows. 16/16 checks pass: outage on all 3 attempts
leads to `failed`; outage then recovery delivers; no devices fails at once; partial
delivery stays `sent`.

Note: while a notification is between retries its row reads `scheduled`, so an admin can
still cancel it in that window.

## 8. Not implemented

- No automatic DLQ consumer: replay is the manual procedure in §6.
- No admin resend or retry endpoint for a `failed` notification (re-queue by hand, §6).
- `QueueBackpressureError` is not mapped to 503 (see §5).
- Devices that failed inside a partly successful send are not retried individually.
- Immediate (not scheduled) broadcasts do not go through this queue; they are sent within
  the request, so a failure is reported to the admin at once.

---

## 9. Configuration

| Variable | Default | Used for |
|---|---|---|
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6380` / none | BullMQ connections (dedicated, never the cache client) |
| `NOTIFICATION_QUEUE_DEPTH_LIMIT` | `10000` | Backpressure ceiling for new schedules |
| `WORKER_ENABLED` | `true` (`false` on API replicas) | Only processes with workers run the worker and rehydrate. API replicas only enqueue |
| `FIREBASE_SERVICE_ACCOUNT` | none | FCM credentials. Missing → sends are skipped (`FCM not configured.`) |
