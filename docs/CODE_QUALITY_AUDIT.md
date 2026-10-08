# New Web Sankul — Code Quality & Maintainability Audit

Audit date: 2026-10-08

Scope: Readability, maintainability, comments, type safety, layering, dead code, and performance-related code smells in `new-web-sankul` after the MySQL migration and prior scalability / deployment hardening.

Related documents:

- [Scalability and API Optimization Audit](./SCALABILITY_OPTIMIZATION_AUDIT.md)
- [Implementation Issues Audit](./IMPLEMENTATION_ISSUES_AUDIT.md)
- [Deployment and Operations Audit](./DEPLOYMENT_OPERATIONS_AUDIT.md)

---

## Executive Summary

Overall code quality is **mixed-to-good**. The project has solid foundations after migration: module headers, shared list/search helpers, notification token paging, dashboard connection pooling, response sanitizer, and fail-fast env validation.

The remaining problems are not “missing infrastructure” — they are **code smells** that hurt readability, long-term maintenance, and hot-path performance:


| Severity | Count | Theme                                                        |
| -------- | ----- | ------------------------------------------------------------ |
| **P0**   | 3     | Security footgun + severe performance anti-patterns          |
| **P1**   | 8     | God files, N+1, dual response envelopes, layering inversions |
| **P2**   | 9     | Naming leftovers, duplication, type `any`, fat files         |
| **P3**   | 4     | Polish, comment cleanup, opportunistic cleanup               |


**Verdict:** Fixable without a rewrite. Prioritize P0 security/performance first, then split God modules and standardize envelopes/helpers.

---

## Priority Legend


| Priority | Meaning                                                                            |
| -------- | ---------------------------------------------------------------------------------- |
| **P0**   | Fix before / immediately after next production push — security or severe load risk |
| **P1**   | High impact on maintainability or scale — schedule in next sprint                  |
| **P2**   | Consistency / debt — fix opportunistically while touching related files            |
| **P3**   | Polish — do when capacity allows                                                   |


---

## Priority 0 — Must Fix

### CQ0.1 Plaintext OTP Logged to stdout

**Smell:** Sensitive data in logs.

**Evidence:**

- `src/client/auth/auth.service.ts:113` — `console.log` prints the generated OTP in colored terminal text on every generate.
- `src/client/auth/auth.service.ts:64` — when SMS is unconfigured, `console.warn` includes the OTP value.

**Why we need to fix it:**

- In PM2 / Docker / journald, stdout is shared ops logs.
- Anyone with log access can reuse a live OTP → account takeover.
- Bypasses structured `logger` scrubbing / levels.

**Step-by-step resolution:**

1. **Remove or gate the OTP `console.log`:**

```typescript
// auth.service.ts — replace line ~113
if (process.env.NODE_ENV !== "production" && process.env.LOG_OTP === "true") {
  logger.debug("OTP generated (dev only)", { phone }); // never log otp value
}
```

1. **Never put OTP in the SMS-skip warning:**

```typescript
if (!base || !apiKey) {
  logger.warn("[SMS] 2Factor not configured — OTP send skipped", { phone });
  return true; // only if DUMMY_OTP / testing path is intentional
}
```

1. **Route SMS failures through `logger.error`**, not `console.error`.
2. **Add a unit/smoke check:** grep CI for `console.log.*otp` / `OTP` string logs in `src/`.
3. **Rotate / invalidate** any OTPs that may have been logged in staging/prod already (short TTL already helps).

---

### CQ0.2 Promoter Customer Detail Loads Up to 100k Rows × 3

**Smell:** “Fetch everything, filter in memory” anti-pattern.

**Evidence:**

```52:61:src/promoter/customer/customer.controller.ts
const { items } = await listPromoterCustomers(pid, { page: 1, limit: 100000 });
const customer = items.find((c) => c._id === String(cid));
// ...
const [courseAll, ebookAll] = await Promise.all([
  listPromoterSubscriptions(pid, { type: "course", page: 1, limit: 100000 }),
  listPromoterSubscriptions(pid, { type: "ebook", page: 1, limit: 100000 }),
]);
const courseSubscriptions = courseAll.items.filter((s) => s.customerId?._id === String(cid));
```

**Why we need to fix it:**

- Latency and memory grow with promoter size.
- Can timeout / OOM under load.
- Unreadable intent: “get one customer detail” should be one targeted query.

**Step-by-step resolution:**

1. **Add repository/service methods** that filter in SQL:

```typescript
// modules/promoter-data (or existing promoter service)
export async function getAttributedCustomer(promoterId: number, customerId: number) { /* findFirst where attributed */ }
export async function listCustomerSubscriptionsForPromoter(
  promoterId: number,
  customerId: number,
  type: "course" | "ebook"
) { /* where customerId + promoter attribution */ }
```

1. **Rewrite the controller:**

```typescript
const customer = await getAttributedCustomer(pid, cid);
if (!customer) return failure(res, "Customer not found.", 404);

const [courseSubscriptions, ebookSubscriptions] = await Promise.all([
  listCustomerSubscriptionsForPromoter(pid, cid, "course"),
  listCustomerSubscriptionsForPromoter(pid, cid, "ebook"),
]);

return success(res, { customer, courseSubscriptions, ebookSubscriptions });
```

1. **Ban `limit: 100000`** — add a code comment / lint note; max list limit stays via `parseListQuery`.
2. **Load-test** promoter detail for a promoter with 10k+ attributed customers before/after.

---

### CQ0.3 Package List Ignores Existing Batch Subscription Helper (N+1)

**Smell:** Duplicate / unused efficient API while hot path stays N+1.

**Evidence:**

- `src/modules/catalog-package/catalog-package.detail.sql.ts:250–278` — per-row `getActivePackageSubscription`.
- `src/modules/commerce-subscription/commerce-subscription.service.ts:34+` — `getActivePackageSubMap` already exists.
- Used correctly in `package-category.service.ts` and `exam-countdown.client.ts`, **not** in package list enrichment.

**Why we need to fix it:**

- Page of N packages → N subscription queries after cache miss / on live merge.
- Batch helper already written — continuing N+1 is avoidable debt.

**Step-by-step resolution:**

1. **In `listPackagesCached` / `enrichPackagesSql`**, replace the per-row loop:

```typescript
const packageIds = rows.map((r) => r.id);
const subMap = customerId
  ? await getActivePackageSubMap(customerId, packageIds, now)
  : new Map();

const data = shared.map((item, i) => {
  const activeSub = subMap.get(rows[i].id) ?? null;
  const isPurchased = !!activeSub;
  return {
    ...item,
    isPurchased,
    daysLeft: isPurchased ? computeDaysLeft(activeSub?.endAt ?? null, now) : null,
    shareableLink: buildShareUrl("packages", item._id, baseUrl),
  };
});
```

1. **Grep** for other `getActivePackageSubscription` inside `Promise.all(...map` and convert the same way.
2. **Keep** single-id `getActivePackageSubscription` for package **detail** (one row is fine).

---

## Priority 1 — High Impact

### CQ1.1 Package Detail Category Groups Are N+1

**Smell:** Per-child recursive CTE + counts inside `Promise.all(map)`.

**Evidence:** `catalog-package.detail.sql.ts` — `videoGroups` / `materialGroups` / `examGroups` (~22–82): each category runs descendant + count queries.

**Why we need to fix it:**

- Package with many subjects → dozens of SQL round trips on cold cache.
- Detail is a high-traffic client path; cache (60s) only masks the loader cost.

**Step-by-step resolution:**

1. Collect all root category IDs for the package (already done via refs).
2. Run **one** recursive CTE (or reuse `descendantsOf` batched) for the whole set.
3. Aggregate counts with `groupBy` / single SQL `GROUP BY root_id`.
4. Map results in memory to DTO shape.
5. Keep `cache.aside` on the shared detail payload; invalidate on admin content writes.

---

### CQ1.2 God Module: `admin-live-course.service.ts` (~2944 lines)

**Smell:** God object / over-coupled module.

**Evidence:** `src/modules/admin-live-course/admin-live-course.service.ts` — ~2944 lines, CRUD + plans + subscriptions + schedule + chat-adjacent + recordings + exports + reminders; heavy `any` usage.

**Why we need to fix it:**

- Unreviewable PRs, merge conflicts, high regression risk.
- Unrelated domains share one file (billing vs chat vs VOD).
- New engineers cannot find the “right place” to change behavior.

**Step-by-step resolution:**

1. Inventory exports and group by concern:


| New file                              | Owns                                 |
| ------------------------------------- | ------------------------------------ |
| `live-course.crud.service.ts`         | create/update/list/get/delete course |
| `live-course.plan.service.ts`         | pricing plans                        |
| `live-course.subscription.service.ts` | grants / subs                        |
| `live-course.schedule.service.ts`     | folders / entries                    |
| `live-course.recording.service.ts`    | VOD / recordings                     |
| `live-course.export.service.ts`       | CSV / reports                        |
| `live-course.chat.service.ts`         | chat/ban helpers if still here       |


1. Move functions one group at a time; keep temporary re-exports from `admin-live-course.service.ts` so imports don’t break.
2. Replace `any` with Prisma types as each file is split.
3. Delete the facade once call sites import the new modules.
4. Add a short module README comment on each new file: “owns X / does not own Y”.

---

### CQ1.3 Fat Controller: `admin/live/live.controller.ts` (~1178 lines)

**Smell:** Fat controller mixing HTTP, webhooks, and orchestration.

**Evidence:** StreamOS webhooks + session CRUD + promote + attendance + per-session link fetches in list (~240+).

**Why we need to fix it:**

- Hard to test webhook vs admin HTTP separately.
- List endpoint can be O(sessions × 2) queries.
- Diffs mix unrelated features.

**Step-by-step resolution:**

1. Move StreamOS webhook handlers to `streamos.webhook.controller.ts` (or keep existing `streamos.v1.webhook.ts` as the only entry).
2. Move session orchestration into `admin-live.service` (batch-load linked courses/folders for a page of IDs).
3. Leave the controller as: validate → auth → call service → `success`/`failure`.
4. Cap list pagination with `parseListQuery`.

---

### CQ1.4 Dual HTTP Response Envelopes

**Smell:** Inconsistent API contract.

**Evidence:**

- Canonical: `utils/httpResponse.ts` → `{ success, code, data, message, messages }`.
- Bypass: many promoter / educator / search / wishlist handlers use `res.status(200).json({ success: true, data })` without `code` / `messages`.
- Example: `promoter/customer/customer.controller.ts:63`.

**Why we need to fix it:**

- Mobile/admin clients must handle two shapes.
- Metrics, sanitizer, and OpenAPI assume one envelope.
- Harder onboarding for frontend engineers.

**Step-by-step resolution:**

1. Adopt rule: **all JSON APIs use `success` / `failure` / `failureFrom`** except provider webhooks.
2. Migrate promoter + educator controllers first (small surface, currently worst offenders).
3. Migrate client search / wishlist next.
4. Optional ESLint restriction: disallow `res.json({ success:` outside `httpResponse.ts` and webhook folders.
5. Document the envelope in `docs/` or Postman collection notes.

---

### CQ1.5 Global Search “All Types” Multiplies Query Load

**Smell:** Unbounded fan-out on a public endpoint.

**Evidence:** `client/search/search.controller.ts` runs all entity types in parallel when `type` is omitted; each type does findMany + count + enrichment (`client-search.service.ts`).

**Why we need to fix it:**

- One request can trigger 30+ SQL queries.
- Empty / short queries amplify cost.
- Readability: controller hides the cost of “search everything”.

**Step-by-step resolution:**

1. Require `type` for production clients, **or** default to one type and document it.
2. Enforce minimum query length (e.g. 2 chars) before DB hit.
3. Cap parallel types if “all” must remain (e.g. max 2 types, or sequential with early abort).
4. For book purchase enrichment: filter by `bookId IN (...)` — do not load all verified book orders for the user.
5. Cache popular queries with short TTL (optional Phase 2).

---

### CQ1.6 Catch-and-Return `e.message` Across Many Controllers

**Smell:** Bypassing central error handling; leaking exception text (mitigated by sanitizer, not by design).

**Evidence:** Dozens of controllers (promoter, offline, CMS, notifications, etc.) use:

```typescript
return res.status(500).json({ success: false, message: e.message });
```

`responseSanitizer` strips many cases, but structured logging / email alerts via `errorHandler` are skipped.

**Why we need to fix it:**

- Incidents harder to triage (no consistent stack/context through central handler).
- Relies forever on a middleware backstop.
- Inconsistent with `HttpError` + `failureFrom` pattern.

**Step-by-step resolution:**

1. Prefer:

```typescript
import { asyncHandler } from "../../utils/asyncHandler"; // or throw into next
throw new HttpError(400, "Invalid id.");
// unexpected: throw err; // let errorHandler respond
```

1. For existing try/catch blocks during migration:

```typescript
} catch (err) {
  logger.error("handler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
  return failure(res, "Internal Server Error", 500);
}
```

1. Migrate hot paths first: auth, payment, promoter, CMS.
2. Keep `responseSanitizer` as a permanent safety net.

---

### CQ1.7 Inverted Layering: Modules Import HTTP Controllers

**Smell:** Dependency arrow points the wrong way.

**Evidence:** `src/modules/export-job/export-job.registry.ts` imports admin controllers for query parsers.

**Why we need to fix it:**

- Circular dependency risk.
- Workers/tests must load Express controllers to run exports.
- Encourages dumping shared helpers into controllers.

**Step-by-step resolution:**

1. Extract `reportQueryFrom` / `parse*ReportQuery` into `modules/.../*.query.ts` or `utils/reportQuery.ts`.
2. Controllers import parsers from that shared module.
3. `export-job.registry.ts` imports **only** the shared parsers + service runners.
4. Confirm no `modules/*` → `admin/*` or `client/*` imports remain (except temporary facades).

---

### CQ1.8 Controllers / Client Services Hitting Prisma Directly

**Smell:** Broken layering / anemic modules.

**Evidence:** Examples include payment controllers and some `client/*/service.ts` files importing `prisma` instead of going through `modules/`* repositories.

**Why we need to fix it:**

- Business rules leak into HTTP handlers.
- Caching / reuse becomes harder.
- Diverges from the mature CMS module pattern (repository → service → transformer).

**Step-by-step resolution:**

1. For each direct Prisma call in controllers: move into the matching `modules/<domain>` service.
2. Controller becomes: parse → auth → `service.method` → `success`/`failure`.
3. Prefer the CMS module layout as the gold standard for new work.
4. Document the convention in a short `docs/CODING_CONVENTIONS.md` (optional follow-up).

---

## Priority 2 — Consistency & Debt

### CQ2.1 Mongo-Era Naming: `*Sql` / `*Mysql` / `(sql)` Log Suffixes

**Smell:** Misleading names after MySQL-only cutover.

**Evidence:** `createOrderMysql`, `buildPackageDetailSql`, `existsSql`, logs like `"success (sql)"`, `"not attributed (sql)"`.

**Why we need to fix it:**

- Implies a dual store that no longer exists.
- Grep / onboarding noise; new code cargo-cults the suffix.

**Step-by-step resolution:**

1. Rename in a mechanical PR: `*Sql` → domain verb (`buildPackageDetail`).
2. Keep deprecated alias exports for one release if needed.
3. Clean log messages to drop `(sql)`.
4. Update Postman / docs references.

---

### CQ2.2 Legacy ObjectId Validation Still Accepted

**Smell:** Dead validation branch lying to callers.

**Evidence:** `isObjectId` / `objectIdSchema` / “Invalid ObjectId” messages across admin/client validation files (~15+ files).

**Why we need to fix it:**

- Runtime IDs are integers; 24-hex strings “validate” then fail later.
- Confusing API errors for clients.

**Step-by-step resolution:**

1. Add shared helpers in `utils/parseId.ts`:

```typescript
export const parsePositiveInt = (v: unknown): number | null => { /* ... */ };
export const zPositiveIntId = z.coerce.number().int().positive();
```

1. Replace ObjectId schemas module-by-module.
2. If mobile still sends hex during transition, keep **one** documented compatibility shim — not 30 copies.
3. Delete ObjectId helpers when clients are fully numeric.

---

### CQ2.3 Duplicate `parseId` / Pagination Helpers

**Smell:** Copy-paste utilities.

**Evidence:** Identical `Number.isInteger(n) && n > 0` in ~50 modules; many controllers still hand-roll `page`/`limit` despite `utils/listQuery.ts`.

**Why we need to fix it:**

- Caps drift (100 vs 500).
- Bugs fixed in one copy don’t propagate.

**Step-by-step resolution:**

1. Export `parsePositiveInt` from `utils/parseId.ts`.
2. Mandate `parseListQuery(req.query, { maxLimit })` for lists.
3. Delete local copies as files are touched.
4. Client max 50–100; admin max 100–200 (exports can be higher via dedicated endpoints).

---

### CQ2.4 Widespread `as any` / `: any`

**Smell:** Weak type safety where Prisma should help.

**Evidence:** Highest concentration in `admin-live-course.service.ts`, `admin-testseries`, `admin-live`, search `where: any`.

**Why we need to fix it:**

- Hides broken filters until runtime.
- Undermines the main benefit of Prisma.

**Step-by-step resolution:**

1. Prefer `Prisma.XWhereInput` / generated types at query sites.
2. Ban new `as any` via ESLint `@typescript-eslint/no-explicit-any` (warn first, then error) with a short allowlist for interop.
3. Clean types when splitting God files (CQ1.2).

---

### CQ2.5 Payment Create-Order Copy-Paste Across Controllers

**Smell:** Duplicated business flow.

**Evidence:** `client/payment/{package,course,ebook,live-course,test-series}-payment.controller.ts` share Razorpay / promo / wallet patterns.

**Why we need to fix it:**

- Bugfixes must be repeated; drift already visible (some paths do extra Prisma checks inline).

**Step-by-step resolution:**

1. Extract `createPaidOrder({ resolvePlan, createPendingRow, crmType, shipping? })`.
2. Each controller becomes a thin adapter supplying domain-specific callbacks.
3. Add one integration test covering wallet + promo for a single product type; others reuse the helper.

---

### CQ2.6 Cross-Layer Imports (modules → admin/client)

**Smell:** Shared domain living under HTTP trees.

**Evidence:** Order services → `client/referral/credit-referrer`; live modules → `admin/live/streamos.provider`.

**Why we need to fix it:**

- Circular risk; “shared” code is not discoverable as shared.

**Step-by-step resolution:**

1. Move StreamOS client to `libs/streamos` or `modules/streamos`.
2. Move referral wallet credit to `modules/referral`.
3. Update imports; forbid new `modules → admin|client` imports in review checklist.

---

### CQ2.7 Typo Model Names (`refferal*`)

**Smell:** Permanent misspelling tax.

**Evidence:** `prisma.refferalProgram`, `refferalTerm`, `refferalFaq`.

**Why we need to fix it:**

- Search for “referral” misses half the code.
- Confuses every new contributor.

**Step-by-step resolution:**

1. Add Prisma model aliases / `@@map` to keep DB column compatibility while fixing TS names **or** rename DB in a planned DDL window.
2. Wrap access in `referral.repository.ts` so call sites never see the typo.
3. Document the mapping in the repository header comment.

---

### CQ2.8 Unbounded `findMany` on Growing Tables

**Smell:** Silent scalability footgun.

**Evidence:** Examples include scheduled notification rehydrate (all rows), image notification lists, public promocode “load all then filter in JS”, some CMS list variants.

**Why we need to fix it:**

- Fine while tables are tiny; fails quietly as data grows.
- In-JS filtering misses indexes.

**Step-by-step resolution:**

1. Add default `take` / cursor pagination.
2. Push filters into `where` clauses.
3. For rehydrate: page with cursor + leader lock (leader lock may already exist — keep paging).

---

### CQ2.9 Orphan / Scratch Artifacts

**Smell:** Dead code in the repo.

**Evidence:** Scratch scripts (`_v4.ts`, `scripts/tmp-`*), unused imports, deprecated helpers with zero callers, large dumps under `old_db/` if still tracked.

**Why we need to fix it:**

- Clone/review noise; accidental execution risk.

**Step-by-step resolution:**

1. Delete confirmed unused scripts and dead exports.
2. Keep DB dumps out of the app repo or gitignore them.
3. Periodically run unused-export analysis (e.g. `knip` / ts-prune).

---

## Priority 3 — Polish

### CQ3.1 Outdated / Uneven Comments

**Smell:** Comments describing Mongo dual-path or missing “owns X” headers on complex SQL modules.

**Why fix:** Misleading comments are worse than none.

**Resolution:** Update headers when touching a file; use the style already present in `course-detail.sql.ts` / notification modules.

### CQ3.2 Two Zod Error Formatters

**Smell:** `formatZodError` vs `formatZodIssues` with different field-key semantics.

**Resolution:** Keep one helper; migrate callers; never return raw `e.issues` to clients.

### CQ3.3 Mixed snake_case Prisma Fields in App Code

**Smell:** `created_at` vs `createdAt` in the same service.

**Resolution:** Prefer Prisma client field names in TS; snake_case only inside raw SQL.

### CQ3.4 Magic Status Strings Duplicated

**Smell:** Hard-coded `["verified","shipped","delivered"]` / `"complete"` in multiple places.

**Resolution:** Shared constants / enums in `models/enums` or `shared/orderStatus.ts`.

---

## Strong Patterns to Keep

Do **not** regress these:

1. **Notification token paging** — cursor batches + FCM chunks of 500 (`admin-notification.service.ts`).
2. `**getActivePackageSubMap**` — correct batch pattern; extend its use (CQ0.3).
3. `**parseListQuery` / `searchFilter**` — shared list + search helpers.
4. `**responseSanitizer` + `HttpError` + `errorHandler**` — defense in depth.
5. **Fail-fast `env.ts`** — production feature warnings.
6. **CMS module layout** — repository / service / transformer / types / validation.
7. **Package / catalog cache-aside** — shared TTL payload + live purchase merge.
8. **Graceful shutdown + worker gating** — API vs worker PM2 split.
9. **Module-top domain comments** — explain schema quirks (e.g. no `payment_status` on some tables).

---

## Suggested Remediation Plan

### Phase A — This week (P0)


| Step | Issue                                                   | Owner hint |
| ---- | ------------------------------------------------------- | ---------- |
| A1   | Stop logging OTP values (CQ0.1)                         | Auth       |
| A2   | Rewrite promoter customer detail queries (CQ0.2)        | Promoter   |
| A3   | Wire `getActivePackageSubMap` into package list (CQ0.3) | Catalog    |


### Phase B — Next sprint (P1)


| Step | Issue                                                        |
| ---- | ------------------------------------------------------------ |
| B1   | Batch package-detail category counts (CQ1.1)                 |
| B2   | Split `admin-live-course.service.ts` (CQ1.2)                 |
| B3   | Thin `live.controller.ts` + batch list links (CQ1.3)         |
| B4   | Standardize `success`/`failure` on promoter/educator (CQ1.4) |
| B5   | Cap / require search `type` (CQ1.5)                          |
| B6   | Migrate catch-and-leak controllers on hot paths (CQ1.6)      |
| B7   | Uninvert export-job layering (CQ1.7)                         |


### Phase C — Ongoing debt (P2–P3)


| Step | Issue                                                             |
| ---- | ----------------------------------------------------------------- |
| C1   | Rename `*Sql` / drop ObjectId validators                          |
| C2   | Shared `parsePositiveInt` + listQuery migration                   |
| C3   | Deduplicate payment create-order                                  |
| C4   | Move StreamOS / referral helpers under `modules`/`libs`           |
| C5   | Delete scratch scripts / drain dead RazorpayX if confirmed unused |
| C6   | Reduce `any`; unify Zod error formatting                          |


---

## How to Use This Document

1. Treat **P0** as merge blockers for the next production deploy.
2. File tickets from Phase B with the issue IDs (`CQ1.2`, etc.).
3. When fixing, prefer **small PRs** (one smell family per PR).
4. After each Phase A/B item lands, mark it **Fixed** in a short changelog section below.

---

## Re-verification (2026-10-08) — Simplify · Comments · Performance

Second pass focused on: (1) complex code we can simplify **without changing API response shapes**, (2) comment quality, (3) live performance status vs earlier audits.

### Snapshot


| Area                                        | Status                                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| Dashboard banners/courses/testimonials caps | **Improved** — `BANNER_LIMIT` / `DASHBOARD_SECTION_LIMIT` |
| Catalog **videos** N+1                      | **Fixed** — batched CTE + `groupBy` with good why-comment |
| Catalog **materials / exams** N+1           | **Still open** — copy videos batch pattern                |
| Package list subscription N+1               | **Still open** — `getActivePackageSubMap` unused here     |
| Promoter detail `limit: 100000`             | **Still open**                                            |
| OTP `console.log`                           | **Still open**                                            |
| Comments on hot SQL/cache modules           | **Generally good**                                        |
| God files / payment copy-paste              | **Still complex** — safe to simplify                      |


---

### Part 1 — Complex code we can simplify (same responses)

These refactors change **structure only**. Response JSON field names and semantics stay the same unless noted.

#### S1. Deduplicate payment create-order pipelines — **P1**

**Evidence:** `course|package|ebook|live-course-payment.controller.ts` — same auth → plan → promo → wallet → Razorpay → persist → CRM sequence.

**Why complex:** Bugfixes must be repeated in 4–5 files; hard to read the real differences (shipping, plan kind).

**Step-by-step (no response change):**

1. Extract `requirePaymentCustomer(req)`, `applyPromoAndWallet(...)`, `finalizeRazorpayOrder(...)`.
2. Keep thin adapters per product type that only supply plan lookup + response entity key (`course` vs `package` vs …).
3. Share Zod for `promocode` / `coin`.
4. Snapshot one Postman response per type before/after.

**Risk:** Wallet/promo edge cases differ by kind — keep those branches explicit in adapters.

---

#### S2. Table-driven `verifyPayment` — **P1**

**Evidence:** `verify.controller.ts` — six nearly identical claim blocks.

**Step-by-step:**

1. Define handlers array: `{ find, verify, crm?, cacheFlush? }`.
2. Loop sequentially (do **not** parallelize finds — order is part of ownership semantics).
3. Keep returning `{ success: true }` as today.
4. Rename `[mysql]` log tags away while touching the file.

**Risk:** Wrong handler order if ids ever collided across tables (unlikely; keep current order).

---

#### S3. Split purchase-history list function — **P1**

**Evidence:** `client-purchase-history.service.ts` ~57–312 — over-fetch, enrich, five mappers, sort+slice in one function.

**Step-by-step:**

1. Split into `fetchSources` → `enrich` → `mapRowByKind` → `sortAndPage`.
2. Keep over-fetch `0..skip+take` from all sources (required for correct cross-table pagination).
3. Do **not** page each source independently (would change which rows appear on a page).

**Risk:** `purchasedAt` nulls / id prefixes (`lc_`, `pcs_`, …) must stay identical.

---

#### S4. Remove dead live branches in `listMyLearningProgress` — **P1**

**Evidence:** `client-lecture-progress.service.ts` — live path intentionally empty but still wired through maps/`Promise.all`.

**Step-by-step:**

1. Delete or hard-guard live queries until product re-enables them.
2. Extract shared `cardFromPtr(kind, ...)`.
3. Keep `resumeNext` as **global** (not page-local) — same response field.

---

#### S5. Admin test-series: filter after SQL pagination — **P0** (correctness)

**Evidence:**

```208:237:src/modules/admin-testseries/admin-testseries.service.ts
// skip/take in SQL, then examCategory filter in memory
```

**Why:** Page size and `total` disagree with filtered rows when `catIds` is set. Same field names, **wrong counts**.

**Step-by-step:**

1. Prefer: resolve matching series ids (JSON/`examCategoryId`) then `findMany` with `id: { in }` + skip/take + matching `count`.
2. Or: filter full candidate set then slice (OK only if table stays small).
3. Confirm with admin UI that empty pages under category filter go away.

**Note:** Pagination totals **will** change for filtered lists — that is the bugfix. Field shapes stay the same.

---

#### S6. Drop Mongo / `*Mysql` naming noise — **P2**

**Evidence:** `FaqCreateMongoInput`, `*MysqlPath`, log suffixes `(sql)` / `[mysql]`, empty `{ }` blocks in payment controllers.

**Step-by-step:** Rename types/functions to domain verbs; flatten useless blocks; no behavior change.

---

#### S7. Shared `parsePositiveInt` + receipt shell helper — **P2/P3**

**Evidence:** 50+ local `parse*Id` copies; receipt DTOs rebuilt 5× in purchase-history.

**Step-by-step:** One util + `buildReceiptShell(...)`; thin per-kind fetchers.

---

#### Already appropriately simple (keep)

- `utils/listQuery.ts`, `searchFilter.ts` (documents prefix vs contains trade-off)
- Catalog **videos** batched loader + why-comment (`client-catalog.service.ts:146-171`)
- `getActivePackageSubMap` contract comment
- Dashboard named limits (`BANNER_LIMIT`, `DASHBOARD_SECTION_LIMIT`)
- FAQ `resolveFaqTypeFilter` early returns
- `pick` / `omit` at response edge

---

### Part 2 — Comment quality

Use the blocks below as the **house style**. When editing a file, match this level of “why” — not “what the next line does”.

#### Good comment references (copy this style)

##### G1. Search filter — collation + prefix trade-off

```1:6:src/utils/searchFilter.ts
// Search filter: uniform free-text search for every module. The term is trimmed and split on
// whitespace; every token must match (AND), each token ORs across the fields.
// Case/accent-insensitivity comes from the utf8mb4_0900_ai_ci column collation:
// Prisma MySQL has no `mode: "insensitive"`, and wrapping columns in LOWER()/BINARY
// would defeat indexes. Searched columns must be utf8mb4 for non-Latin/emoji terms
// (docs/migration/schema-changes/2026-07-16_search_columns_utf8mb4.sql).
```

```29:35:src/utils/searchFilter.ts
// Prefix-anchored variant for large tables (e.g. ws_customer): the first token is
// `LIKE 'token%'`, which can use a B-tree range scan where a leading wildcard cannot.
// Only the first token is anchored; the rest use `contains`. Anchoring every token
// makes multi-word search on one field unsatisfiable ("Week 01" would need a value
// starting with both "Week" and "01"). Trade-off: "Week 01" finds "Week 01 (PSI)" but
// not "Physics Week 01"; use `buildPrismaSearch` when that matters more than speed.
// Same shape as `buildPrismaSearch`, so the two are interchangeable.
```

**Why this is good:** Explains *why* MySQL collation matters, *when* to use prefix vs contains, and points at the DDL doc.

---

##### G2. Admin notifications — schema quirks + queue ids

```1:11:src/modules/admin-notification/admin-notification.service.ts
/**
 * Admin notifications: audience, FCM dispatch, scheduling, admin log and image banners.
 *
 *  - tokens: the single ws_customer.device (firebaseToken) column — one token per
 *    customer (last device wins).
 *  - audience: customer ids (int). Course-targeting uses ws_package_course_subscription,
 *    which has no payment_status column, so the entitlement signal is status=true
 *    (+ endAt null/future).
 *  - BullMQ jobId is `notif-${id}` (numeric-only ids are rejected by BullMQ),
 *    namespaced in the scheduler — see jobIdFor().
 */
```

**Why this is good:** Owns-list + schema trap (`no payment_status`) + BullMQ constraint in one place.

---

##### G3. Package detail — cache vs live purchase split

```116:121:src/modules/catalog-package/catalog-package.detail.sql.ts
// Everything here is customer-independent and cached. isPurchased/daysLeft is the
// only per-customer field and is always computed live in buildPackageDetailSql;
// package.routes.ts must not wrap this in a user-scoped cacheRoute either.
const buildPackageDetailShared = async (packageId: number) => {
  // No `active` filter: the entry is shared and an inactive package must stay
  // reachable for its subscribers. The per-caller gate is in buildPackageDetailSql.
```

**Why this is good:** Cache contract + warning against a footgun (`cacheRoute` with user scope).

---

##### G4. Course detail — same shared/live pattern

```27:31:src/modules/catalog-course/course-detail.sql.ts
/**
 * The caller-independent part of the detail page, cached because it is the
 * expensive part (a dozen+ queries). Per-video `progress` and
 * `isPurchased`/`daysLeft` are excluded and computed live in `buildCourseDetailsSql`.
 */
```

---

##### G5. Catalog videos batching — why N+1 was removed

```146:148:src/modules/client-catalog/client-catalog.service.ts
  // Batched: 3 queries total regardless of category count (one CTE for every
  // subtree, one groupBy for video counts, one for child-edge counts). Doing this
  // per category saturated the Prisma pool on packages with many subjects.
```

**Why this is good:** Performance *why* + query budget. **Materials/exams below should get the same comment when batched** (PERF3).

---

##### G6. Batch subscription map — when to use which API

```29:32:src/modules/commerce-subscription/commerce-subscription.service.ts
/**
 * `packageId → endAt` for every active package subscription, in one query; use
 * on listings instead of a per-row lookup. Presence = `isPurchased`; a `null`
 * value is an active row with no expiry. A null customer yields an empty Map.
 */
```

**Why this is good:** Contract for callers; package list should follow this (PERF2 / CQ0.3).

---

##### G7. Cache TTL constants — never inline magic numbers

```1:15:src/config/cacheTtl.ts
// Route cache TTLs: flushGroups.ts names WHICH resource a cached read belongs
// to; this names HOW LONG it stays fresh. Never inline a raw number in a route.

export const CACHE_TTL = {
  /** Near-static catalog/CMS content. Freshness after an admin edit comes from
   *  the route's `entity` flush tag (flushGroups.ts), not this TTL. */
  DAY: 86400,
  /** Per-user home feed (purchase state + unread badge). */
  DASHBOARD: 60,
  /** Shared across admins and heavier, so it tolerates a longer TTL. */
  ADMIN_DASHBOARD: 120,
  /** Cart / my-subscriptions: seeing one's own write matters more than hit rate. */
  QUICK_REFRESH: 30,
  /** Unread badge, polled frequently by the app. */
  UNREAD_COUNT: 15,
} as const;
```

---

##### G8. Client search — per-entity field drift

```1:6:src/modules/client-search/client-search.service.ts
/**
 * Client search: one search across 6 entity types. Per-type field differences: Package uses
 * `active` (not status); Course isPaid = purchase≠'0'; Book paid = discounted_price>0;
 * Ebook isPaid via price>0 fallback; TestSeries paid = !is_free and is searched on `title`.
 * ws_package_course_subscription has no payment_status, so status=true is the gate.
 */
```

---

##### G9. Trending — paid/free rules per entity

```1:4:src/modules/client-trending/client-trending.service.ts
/**
 * Client trending: trending books/ebooks + free dashboard. Book paid = discounted_price>0. Ebook free = min
 * active plan price is 0 (ws_ebook has no isPaid). ws_package has no isPaid either, so there
 * are no free packages; a free course is purchase='0'.
 */
```

---

##### G10. Dashboard — named limits + reused unread logic

```17:22:src/modules/client-dashboard/client-dashboard.service.ts
const COURSE_CATEGORY_LIMIT = 20;
// Safety ceiling only; the table holds a handful of rows.
const BANNER_LIMIT = 50;
const EXAM_COUNTDOWN_LIMIT = 2;
// Every non-banner section is trimmed to its latest N items.
const DASHBOARD_SECTION_LIMIT = 5;
```

```13:15:src/modules/client-dashboard/client-dashboard.service.ts
// Reused so the dashboard badge matches GET /client/notifications/count (excludes
// read and dismissed notifications).
import { unreadCount as notificationUnreadCount } from "../client-notification/client-notification.service";
```

**Why this is good:** Named caps with reason; documents parity with another endpoint.

---

#### Gaps to fix


| ID   | Severity | Issue                                                                              | Step-by-step                                                                                   |
| ---- | -------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CMT1 | P2       | `admin-live-course.service.ts` needs owns/not-owns header                          | Added in v1.2 pass; split files later (CQ1.2)                                                  |
| CMT2 | P2       | `Faq*MongoInput` / `*Sql` / `*Mysql` names                                         | Rename on touch; comments that say “Mongo path” → delete                                       |
| CMT3 | P2       | Search history comment claims min length 2; `globalSearch` does **not** enforce it | Either enforce `q.trim().length >= 2` in `search.controller.ts` **or** fix the history comment |
| CMT4 | P2       | Magic `ttlSeconds: 60`, `take: 1000` / `500` in live feeds                         | Use `CACHE_TTL.*` / named `MAX_*` + one-line why (see G7)                                      |
| CMT5 | P3       | Some comments only restate the function name                                       | Prefer **why** like G3–G6                                                                      |
| CMT6 | P2       | Non-obvious live exports lack JSDoc                                                | Match G6/G8 style on entitlement/preview helpers                                               |
| CMT7 | P2       | Materials/exams catalog still lack a “batch like videos” comment                   | When implementing PERF3, copy G5 wording                                                       |


**Rule of thumb for new comments:**

1. File header: what this module owns / does not own (see G2, live-course header).
2. Non-obvious invariant: schema quirk, cache key rules, why not N+1 (see G1, G3, G5).
3. Named constants with one-line why (see G7, G10).
4. Do **not** narrate `// increment i` style “what”.

---

### Part 3 — Performance status (re-checked)

#### Still open — high impact


| ID     | Severity | Evidence                                                      | Fix (preserve response)                                            |
| ------ | -------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| PERF1  | P0       | Promoter detail `limit: 100000` × 3                           | Targeted SQL by `customerId` (CQ0.2)                               |
| PERF2  | P0       | Package list per-row `getActivePackageSubscription`           | Use `getActivePackageSubMap` once (CQ0.3)                          |
| PERF3  | P0       | Catalog materials/exams still per-category CTE+count          | Copy videos batch pattern from `client-catalog.service.ts:146-171` |
| PERF4  | P0       | OTP logged to stdout                                          | Stop logging OTP value (CQ0.1)                                     |
| PERF5  | P1       | Package detail group N+1 (masked by 60s cache)                | Batch counts in loader                                             |
| PERF6  | P1       | Package list `enrichPackagesShared` per-row plans/counts      | Batch prices + `groupBy` counts                                    |
| PERF7  | P1       | Trending ebooks: load all → filter free/paid in JS            | SQL filter + `LIMIT` like books path                               |
| PERF8  | P1       | Global search: no min length; all 6 types when `type` omitted | Enforce length ≥ 2; prefer required `type`                         |
| PERF9  | P1       | Directory children per-child counts                           | One `groupBy` for page of ids                                      |
| PERF10 | P1       | Puppeteer still on API request path                           | Queue to `websankul-worker`                                        |


#### Confirmed improved (do not regress)


| Area                                             | Status               |
| ------------------------------------------------ | -------------------- |
| Home dashboard section caps                      | Fixed                |
| Catalog videos batching                          | Fixed + good comment |
| `cache.aside` on package/course/ebook/book paths | Wired                |
| Live client list paging + entitlement batch maps | Improved             |
| Notification token paging                        | Fixed                |
| Body limit / rawBody / readiness MySQL           | Fixed (prior audits) |


---

### Recommended order (safe, response-preserving)


| Order | Work                                      | Response impact                                    |
| ----- | ----------------------------------------- | -------------------------------------------------- |
| 1     | PERF4 OTP log                             | None                                               |
| 2     | PERF1 promoter detail SQL                 | Same JSON, faster                                  |
| 3     | PERF2 package list sub map                | Same JSON, fewer queries                           |
| 4     | PERF3 materials/exams batch (copy videos) | Same JSON                                          |
| 5     | S5 admin test-series filter pagination    | Same fields; **correct** totals when filtering     |
| 6     | S1–S2 payment dedupe                      | Same JSON                                          |
| 7     | PERF8 search min length + type            | May reject empty/`q` length < 2 (document for app) |
| 8     | CMT1–CMT4 while touching files            | None                                               |
| 9     | Split live-course God file                | None (move only)                                   |


---

