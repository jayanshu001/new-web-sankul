# Backend Audit — Batch 1a: Foundation (Modules 1–5, Admin Surface)

**Scope:** Admin surface only (`src/admin/**`). Modules covered: API & Routing, Controllers, Services, Database, Redis Caching.

**Deliverable shape:** This batch lands the **foundation** — new middlewares, cache lib, helpers, and the master-router auth hoist. Controller refactors that consume these primitives are deferred to **Batch 1b** to keep this diff reviewable.

---

## What landed in this batch

| File | Purpose |
|---|---|
| [src/middlewares/asyncHandler.ts](../../src/middlewares/asyncHandler.ts) | Wraps async handlers so rejections forward to the global error middleware. Eliminates per-handler try/catch. |
| [src/middlewares/validate.ts](../../src/middlewares/validate.ts) | Zod-based request validator middleware. Centralizes the body/query/params parse + 422 error response. Reject unknown fields via `.strict()` schemas. |
| [src/middlewares/idempotency.ts](../../src/middlewares/idempotency.ts) | Redis-backed `Idempotency-Key` middleware for mutating endpoints (payments, referral credits). Replays cached response on retry; 409 on key reuse with different payload. |
| [src/config/rateLimiter.ts](../../src/config/rateLimiter.ts) | Added `adminLimiter` (240/min keyed per-admin) and `adminMutationLimiter` (30/min). |
| [src/libs/cache.ts](../../src/libs/cache.ts) | Cache-aside helper. Key convention `{env}:{domain}:{entity}:{id}:{version}`, jittered TTL, `SET NX PX` singleflight, fail-open on Redis errors. |
| [src/utils/planDuration.ts](../../src/utils/planDuration.ts) | `computeEndAt({startAt, durationMonths})` (preserves `setMonth` semantics) and `composeDownloadsCount({savedMaterials, savedVideos, activeEbookDownloads})`. |
| [src/admin/admin.routes.ts](../../src/admin/admin.routes.ts) | Hoisted `authenticate` + `adminLimiter` at master router; `/auth` (login/refresh) stays mounted before the gate. |

---

## Module 1 — API & Routing

### Issues found
- **No master-level `authenticate` on `/api/v1/admin`** — relied on every domain router to call it. — severity: **P0**
- Per-router request validation duplicates Zod parse + error response (~170 handlers). — severity: **P1**
- Global limiter (60/min per IP) shared with client traffic; no admin-tier limiter. — severity: **P1**
- No `Idempotency-Key` enforcement on mutating payment/referral endpoints. — severity: **P1**
- Response envelope mostly consistent via `success()`/`failure()` but some handlers return ad-hoc `{ success, message }`. — severity: **P2**

### Refactor (landed)
```diff
+ router.use("/auth", adminAuthRoutes);              // public login/refresh stays first
+ router.use(authenticate, adminLimiter);            // master-level gate + admin-tier limiter
  router.use("/administrators", adminAdministratorRoutes);
  // ...remaining domain routers unchanged
```

### Impact
- **Security:** Forgetting `authenticate` on a new admin router no longer creates a public subtree.
- **Reliability:** Admin sessions get their own rate-limit bucket; a chatty admin can't crowd the global IP bucket and DoS clients sharing the same egress IP.
- **Latency:** Negligible — `authenticate` already ran inside each router; running it once at master and again per-router is double-decoding the JWT. **Follow-up in Batch 1b:** drop the per-router `authenticate` call from each domain `*.routes.ts` (keep `requireRole`).

### Verification
- `curl -i /api/v1/admin/courses` without `Authorization` → 401.
- `curl -i /api/v1/admin/auth/login -d '{...}'` → still public (200/401 from credential check, not auth middleware).
- Spam 300 req/min as same admin → 429 with `Retry-After`.

---

## Module 2 — Controllers

### Issues found
- All ~170 admin handlers use inline `try/catch` and return ad-hoc 500s. — severity: **P1**
- Business logic embedded in 95% of controllers; only `auth`, `goal`, `streamos` have service files. — severity: **P1**
- Direct Mongoose calls (`.find()`, `.populate()`, `.findByIdAndUpdate()`) inline in controllers — no data access layer. — severity: **P2**

### Refactor (landed)
- `asyncHandler` published; **consumption deferred to Batch 1b**.

### Refactor (planned for Batch 1b)
```ts
// before
export const getCourses = async (req, res) => {
  try { /* ... */ } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

// after
export const getCourses = asyncHandler(async (req, res) => {
  const { items, total } = await courseService.list(req.query);
  return success(res, { items, total });
});
```

### Impact (when Batch 1b lands)
- Removes ~170 try/catch blocks (~1,500 lines).
- Unifies 5xx error reporting via the existing `errorHandler` (which already wires logging + email).
- Restores stack-trace fidelity (current pattern loses non-`error.message` context).

---

## Module 3 — Services / Domain Logic

### Issues found
- N+1 patterns: not observed on hot paths — most controllers correctly use `Promise.all`. — severity: clean
- `.lean()` missing on many read-only list endpoints. — severity: **P1**
- `.select()` missing on populate chains (returns full referenced docs). — severity: **P1**
- `setMonth`-based `endAt` computation duplicated across 4+ files (subscription, live-course subscription, webhook, payment verify). — severity: **P2**
- Downloads count composition (`savedMaterials + savedVideos + activeEbookDownloads`) not extracted. — severity: **P2**

### Refactor (landed)
- [src/utils/planDuration.ts](../../src/utils/planDuration.ts) exposes `computeEndAt` and `composeDownloadsCount`. Existing callsites continue to work; Batch 1b will swap them in (no behavior change — same `setMonth` math).

### Refactor (planned for Batch 1b)
- New `course.service.ts`, `package.service.ts`, `ebook.service.ts`, `referral.service.ts`, `permission.service.ts`, `live-course.service.ts`. Each owns: list / detail / create / update / delete + cache invalidation hooks.
- Every read path: `.lean()` + `.select()` against the actual response shape.

---

## Module 4 — Database (MongoDB / Mongoose)

### Issues found
- **No `strict: "throw"`** on schemas — silent drops on unknown fields. — severity: **P1**
- TTL indexes only on token models — missing on OTP, signed-URL, ephemeral session collections. — severity: **P1**
- `plan.controller.ts:26–35` `enforceSingleDefault()` runs `updateMany` **outside** the surrounding transaction. — severity: **P0**
- ~5–10 list endpoints have **no pagination** (`getCourseVideoCategories`, `getCourseMaterials`, `getPrograms`, etc.). — severity: **P1**
- Skip/limit pagination universal; will hurt at high page numbers on large collections (test-series, video-watch events). — severity: **P2**
- Indexes generally well-covered (Package has 10 indexes), but no `explain("executionStats")` audit performed yet. — severity: **P2**

### Refactor (planned for Batch 1b)
- Wrap `plan.controller.ts` `enforceSingleDefault()` inside the `session.withTransaction()` block.
- Add `limit=Math.min(100, parseInt(...))` + pagination envelope to unbounded list endpoints.
- Schema-level `strict: "throw"` on new models; existing models flagged for follow-up batch.

### Index hit-list (proposed `createIndex` commands)

Run in a `mongosh` shell against the target DB. Each is idempotent (Mongo no-ops on identical existing index).

```js
// Course list filters (status + popularity sort)
db.ws_courses.createIndex({ status: 1, isPopular: -1, createdAt: -1 });
db.ws_courses.createIndex({ courseEducatorId: 1, status: 1 });

// Package list filters (active + goal + type)
db.ws_packages.createIndex({ isActive: 1, goalId: 1, createdAt: -1 });

// Plan rows resolve by entity + isDefault flip (`enforceSingleDefault`)
db.ws_package_course_ebook_prices.createIndex({ courseId: 1, isDefault: -1 });
db.ws_package_course_ebook_prices.createIndex({ ebookId: 1, isDefault: -1 });
db.ws_package_course_ebook_prices.createIndex({ packageId: 1, isDefault: -1 });

// Referral reporting (range scans by customer + time)
db.ws_referral_transactions.createIndex({ customerId: 1, createdAt: -1 });
db.ws_referral_transactions.createIndex({ type: 1, status: 1, createdAt: -1 });

// Permission catalog hot reads (name+guard already unique; add guard-only for list)
db.ws_permissions.createIndex({ guardName: 1, name: 1 });

// Live-course list (status + startAt)
db.ws_live_courses.createIndex({ status: 1, startAt: -1 });

// Customer access tokens: TTL already present; verify with:
db.ws_customer_access_tokens.getIndexes();
// expect: { v: 2, key: { expiresAt: 1 }, expireAfterSeconds: 0 }
```

**Verification command:**
```bash
mongosh "$MONGO_URI" --eval 'db.ws_courses.find({status:"active"}).sort({isPopular:-1,createdAt:-1}).limit(20).explain("executionStats").executionStats.totalDocsExamined'
# Want: ≈ limit value, not full collection scan.
```

---

## Module 5 — Redis Caching

### Issues found
- Only the goal service uses Redis caching. No course/package/ebook/permission caches. — severity: **P1**
- No key naming convention. Mix of `cache:admin:goals:list`, `admin_session:{id}`, `rl:otp:`. — severity: **P2**
- No cache invalidation on admin writes — even if client caches existed, admin updates wouldn't bust them. — severity: **P1**
- No stampede protection on cache misses. — severity: **P2**

### Refactor (landed)
- [src/libs/cache.ts](../../src/libs/cache.ts) publishes `key()`, `aside()`, `invalidate()`, `invalidateByPrefix()`. Singleflight via `SET NX PX`. TTL jitter ±10%. Fail-open.

### Cache key registry (v1)

| Key | TTL | Owner | Invalidation triggers |
|---|---|---|---|
| `{env}:admin:goal:list:v1` | 600s | goal.admin.service | goal create/update/delete |
| `{env}:client:goal:active:v1` | 600s | goal.admin.service | goal create/update/delete |
| `{env}:admin:course:list:{filterHash}:v1` | 300s | *Batch 1b* — course.service | course create/update/delete |
| `{env}:admin:course:detail:{id}:v1` | 300s | *Batch 1b* — course.service | course update/delete |
| `{env}:admin:package:list:{filterHash}:v1` | 300s | *Batch 1b* — package.service | package create/update/delete |
| `{env}:admin:package:detail:{id}:v1` | 300s | *Batch 1b* — package.service | package update/delete |
| `{env}:admin:ebook:list:{filterHash}:v1` | 300s | *Batch 1b* — ebook.service | ebook create/update/delete |
| `{env}:admin:ebook:detail:{id}:v1` | 300s | *Batch 1b* — ebook.service | ebook update/delete |
| `{env}:permission:catalog:list:v1` | 1800s | *Batch 1b* — permission.service | permission create/update/delete |
| `{env}:admin:plan:by-entity:{entityType}:{entityId}:v1` | 300s | *Batch 1b* — plan.service | plan create/update/delete + enforceSingleDefault |
| `admin_session:{adminId}` | 86400s | admin.auth.service | login, logout, force-revoke |
| `customer_session:{customerId}` | 86400s | client auth | login, logout |
| `idem:{scope}:{key}` | 86400s | idempotency middleware | TTL only |
| `rl:admin:admin:{adminId}` | 60s | adminLimiter | TTL only |
| `rl:adminmut:adminmut:{adminId}` | 60s | adminMutationLimiter | TTL only |
| `rl:otp:{ip}` | 900s | otpLimiter | TTL only |

---

## Prioritized rollout (Batch 1a → 1b)

### Batch 1a (this PR — landed)
- **P0:** Hoist `authenticate` at admin master router.
- **P0 (lib):** Publish `asyncHandler`, `validate`, `idempotency`, `cache`, `planDuration`, `adminLimiter`. These are no-op until consumed.

### Batch 1b (next, awaiting approval)
- **P0:** Fix `plan.controller.ts` `enforceSingleDefault()` transaction wrapping.
- **P1:** Refactor course, package, ebook, referral, permission, live-course controllers to use `asyncHandler`, `validate`, services, `.lean()`/`.select()`, and cache.aside.
- **P1:** Add pagination to unbounded list endpoints.
- **P1:** Switch `enforceSingleDefault` + subscription/webhook/verify callsites to `computeEndAt`.
- **P1:** Mount `adminMutationLimiter` + `idempotency({scope:"referral"})` on referral credit endpoints.

### Batch 2+ (later modules)
- Module 6: Queues (BullMQ) — separate by SLA, DLQ, idempotent jobIds.
- Module 7: Auth & Security — JWT kid rotation, refresh revocation list, secret manager.
- Module 8: Video Delivery — audit URL contract drift vs `/v1/lecture`.
- Module 9: Observability — pino structured logs, RED metrics.
- Module 10: Performance — keep-alive tuning, multipart streaming.
- Module 11: Resilience — circuit breakers, /healthz + /readyz.
- Module 12: Testing & CI.
- Module 13: Scalability & horizontal scaling.

---

## Constraint compliance (Batch 1a)

- ✅ No public API response shapes changed.
- ✅ Every admin route still requires Bearer token (now enforced at master + per-router).
- ✅ Video URL responses untouched.
- ✅ Plan `duration` semantics: `computeEndAt` uses `setMonth`. No callsite migrated yet.
- ✅ Downloads count composition preserved in `composeDownloadsCount` (3 named terms only).
