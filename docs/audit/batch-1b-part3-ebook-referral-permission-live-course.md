# Backend Audit — Batch 1b (Part 3): Ebook + Referral + Permission + Live-course + setMonth migration

Closes out the canonical refactor template across the remaining 4 admin domains and migrates every `setMonth` callsite in the codebase to the shared `computeEndAt` helper.

With this part, **all 6 audit-prioritized admin domains** from Modules 1–5 have been refactored.

---

## Files

### Created
| File | Purpose |
|---|---|
| [src/admin/ebook/ebook.service.ts](../../src/admin/ebook/ebook.service.ts) | Ebook CRUD + plans, `.lean()`, cache list/detail (300s), transactional delete. |
| [src/admin/referral/referral.service.ts](../../src/admin/referral/referral.service.ts) | Programs, transactions, withdrawal report + CSV, manual reward adjust, referrers aggregation. |
| [src/admin/permission/permission.service.ts](../../src/admin/permission/permission.service.ts) | Catalog list/detail/tree. **Cache TTL 30min** — hottest read in admin API. |
| [src/admin/live-course/live-course.service.ts](../../src/admin/live-course/live-course.service.ts) | Live-course CRUD + sessions + timetable. Transactional create/delete (folder fanout). |

### Rewritten
| File | Before | After |
|---|---|---|
| [src/admin/ebook/ebook.controller.ts](../../src/admin/ebook/ebook.controller.ts) | 270 lines, inline try/catch | 102 lines, all asyncHandler |
| [src/admin/referral/referral.controller.ts](../../src/admin/referral/referral.controller.ts) | 675 lines (aggregations embedded) | 115 lines |
| [src/admin/permission/permission.controller.ts](../../src/admin/permission/permission.controller.ts) | 359 lines, repeated zod-error formatting | 122 lines |
| [src/admin/live-course/live-course.controller.ts](../../src/admin/live-course/live-course.controller.ts) | 408 lines, inline try/catch + business logic | 134 lines |

### Modified (setMonth migration)
| File | Callsites migrated |
|---|---|
| [src/admin/subscription/subscription.controller.ts](../../src/admin/subscription/subscription.controller.ts) | Both day and month branches now via `computeEndAt({ asDays })` |
| [src/admin/live-course/live-course.subscription.controller.ts](../../src/admin/live-course/live-course.subscription.controller.ts) | endAt computation |
| [src/client/webhook/webhook.controller.ts](../../src/client/webhook/webhook.controller.ts) | Ebook + live-course activation paths |
| [src/client/payment/verify.controller.ts](../../src/client/payment/verify.controller.ts) | Course + live-course + ebook activation paths (3 callsites) |

---

## Module 2 — Controllers (across 4 domains)

### Issues addressed
- Every domain's handlers were each `try { ... } catch { 500 }`. Status codes corrected to 400/404/409 where appropriate.
- Business logic embedded in controllers (especially the `getReferrers` aggregation at ~225 lines, `getPermissionsTree` builder, live-course transactional delete fanout) — all extracted to services.

### Impact
- Total controller LOC across these 4 domains: **1,712 → 473** (−72%).
- All four now follow identical shape: parse → validate → service → respond.
- Permission + referral keep their legacy validation response shape (`{ errors: {...} }` or `{ errors: [...] }`) because the admin React dashboard already binds to those keys; the shape isn't part of the canonical envelope but is intentionally preserved to avoid breaking clients.

---

## Module 5 — Cache wiring summary (all domains)

| Domain | List TTL | Detail TTL | Tree/Catalog TTL | Invalidates on |
|---|---|---|---|---|
| course | 300s | 300s | — | create/update/delete/popular/plan write |
| package | 300s | 300s | — | create/update/delete/status/reorder/plan attach/video relations/embedded reorder |
| ebook | 300s | 300s | — | create/update/delete/trending/plan write/reorder |
| referral | — | — | — | (high-write, low-read — caching deferred) |
| **permission** | **1800s** | n/a | **1800s** | create/update/delete |
| live-course | 300s | 300s | — | create/update/delete/popular/timetable update |

Permission catalog (`{env}:permission:catalog:tree:v1` + `list:{hash}:v1`) is the highest-leverage cache in this batch. Admin React polls the tree on every role-edit screen open; 30-minute TTL with explicit bust on writes is correct for "rarely-changing master data."

---

## Cross-cutting: `setMonth` → `computeEndAt` migration

### Why this matters

The audit pinned `setMonth` semantics as a hard constraint:
> Plan `duration` is in **months** — preserve `setMonth` semantics for `endAt`.

Before this batch, 7 callsites across 4 controllers each computed `endAt` with hand-rolled `new Date(...); setMonth(...)`. Any divergence — say, someone using `setDate(getDate() + months * 30)` for a perf "optimization" — would silently produce wrong expiry dates on 6/12-month plans bought on Jan 31, Feb 28, etc.

### Refactor

Every callsite now imports and uses `computeEndAt({ startAt, durationMonths })` from [`utils/planDuration.ts`](../../src/utils/planDuration.ts). The helper itself uses `setMonth` internally; this batch is the single source of truth. Day-based grants (TestSeries `durationDays`) still use `setDate` either directly (unchanged for now) or via `computeEndAt({ ..., asDays: true })`.

### Verification

```bash
# A 6-month plan bought on Jan 31 must expire on Jul 31 (not Jul 30 / Aug 1).
node -e "
const { computeEndAt } = require('./dist/utils/planDuration');
const startAt = new Date('2026-01-31T10:00:00Z');
const endAt = computeEndAt({ startAt, durationMonths: 6 });
console.log(endAt.toISOString());
// 2026-07-31T10:00:00.000Z
"

# Grep to confirm no raw setMonth calls remain on plan-duration paths
grep -rn 'setMonth' src/ --include='*.ts' | grep -v planDuration | grep -v dashboard
# Expect: empty (dashboard.controller's setMonth is unrelated — it's for time-window queries)
```

---

## Module 1 — referral idempotency (recap from Part 2)

Part 2 mounted `idempotency` + `adminMutationLimiter` on the three financial routes. Part 3's referral controller refactor preserves that contract — the `Idempotency-Key` header is still required for those routes; the middleware mounts on the route layer, not the controller, so refactoring the handler bodies didn't affect it.

---

## Constraint compliance (all of Batch 1b)

- ✅ No public API response shape changes on happy paths.
- ✅ Every admin route still requires Bearer token.
- ✅ Video URL contract untouched.
- ✅ Plan `duration` semantics preserved — `setMonth` math is now centralized but identical.
- ✅ Downloads count composition not touched in this batch (helper available, migration deferred — no callsite required it this batch).
- ⚠️ Referral mutation routes still require `Idempotency-Key` header (carried from Part 2).

---

## Modules 1–5 — Final status

| Module | Status | Notes |
|---|---|---|
| 1. API & Routing | ✅ | authenticate hoisted to master, admin-tier rate limiter, idempotency on referral mutations |
| 2. Controllers | ✅ for 6 priority domains | asyncHandler + validate ready for remaining ~30 controllers |
| 3. Services/Domain | ✅ for 6 priority domains | `.lean()`, `.select()`, Promise.all batching, planDuration helper extracted |
| 4. Database | ✅ P0 fixed (plan transaction); pagination on previously-unbounded endpoints | Index hit-list shipped in Part 1 audit |
| 5. Redis Caching | ✅ | Cache key convention, jitter, singleflight, fail-open, explicit invalidation on every write |

---

## What's next — Batch 2 (Modules 6–10, await approval)

The audit defines 13 modules; the next user-approved batch should land Modules 6–10:

- **Module 6 — Queues (BullMQ)**: separate by SLA, exponential backoff, DLQ, idempotent jobIds, graceful shutdown.
- **Module 7 — Auth & Security**: JWT `kid` rotation + refresh + revocation list, strict CORS allowlist enforcement, secret-manager preflight at boot, per-role cached permission checks.
- **Module 8 — Video Delivery**: audit URL contract drift vs `/v1/lecture`, signed URL TTL ≤ 5min, IP/UA-bound signatures, centralize encryption in `videoResolver`.
- **Module 9 — Observability**: pino structured logs with requestId/userId/route/latency/dbMs/cacheHit, OpenTelemetry traces, RED metrics, Sentry releases.
- **Module 10 — Performance**: keep-alive tuning > LB idle timeout, multipart streaming to S3, event-loop profile (clinic.js), connection pool tuning.

Plus the open follow-ups from Batch 1:
- Remove duplicated per-router `authenticate` calls (master now handles it).
- Apply the canonical template to the remaining ~30 admin controllers (notification, customer, exam, cms, dashboard, etc.). They weren't on the audit P0/P1 list but should match the same shape eventually.
- Migrate the profile dashboard's `downloads` count to `composeDownloadsCount` once that endpoint enters scope.
