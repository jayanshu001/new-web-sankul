# Migration & Query-Level Change Log

> **Purpose:** A running, append-only record of every change that affects the database
> — new collections, new/changed schema fields, indexes, backfill migrations, and
> **query-level logic changes** (filter contracts, query shape, aggregation rollups).
>
> **Why this exists:** During a DB migration / environment cutover these are the things
> that silently break or behave differently if missed. Schema fields need backfilling,
> new collections need their indexes, and query-shape changes need regression QA.
>
> **Maintenance rule:** Whenever a commit introduces a query-level change (new filter,
> changed `$match`/`$in`/aggregation, new collection query, changed count semantics,
> new index), **append a new dated entry below**. Newest entries go at the top. Never
> rewrite history — only append.

---

## 2026-08-03 — `/client/catalog/:type/:id/materials` scopes entitlement to its own path

**Files:** `src/modules/client-catalog/client-catalog.service.ts` (`catalogMaterials`)
**DDL:** none. **Prisma:** unchanged. **Query shape: changed** (two fewer pivot reads, third
narrowed). **Response shape: unchanged.** **No FE change required** — see why below.

Follow-up to the `?courseId`/`?packageId`/`?liveCourseId` scope added the same day. That
param exists because `/client/material-categories/:id/materials` cannot know the entry
point. **This** endpoint always could — the container is literally in its own URL — yet it
called `getPurchasedMaterialIds(customerId, allDirect)` with no scope, so it inherited the
same global-OR leak in the one place it was avoidable for free.

Concretely: `GET /client/catalog/live-course/3/materials` for a student who owns Course 1
but not Live Course 3 reported `isPurchased: true` + a live `mediaToken`, while the path
said live-course 3.

**Change.** The scope is derived from `opts.type` / `opts.id`:

```ts
opts.type === "course"  ? { kind: "course",  id: opts.id }
: opts.type === "package" ? { kind: "package", id: opts.id }
:                           { kind: "liveCourse", id: opts.id }
```

**Blast radius is `type=course` only.** Just the course branch sets `inlineMaterials` and
therefore computes `ownedIds`; `package` and `live-course` return the stripped shape
(category node + count, no `materials[]`, no `isPurchased`), so nothing there changed.

**Verified on staging** (customer 472366 / `9999999999`, owns courses 114 + 990115):

| request | materials | isPurchased | tokens |
| --- | --- | --- | --- |
| `catalog/course/114/materials` (owned) | 6 | 6/6 | 6/6 |
| `catalog/course/990115/materials` (owned) | 13 | 13/13 | 13/13 |
| `catalog/live-course/3/materials` (not owned) | 0 (stripped shape) | — | — |
| `catalog/course/114/materials`, owns-nothing control | 6 | **0/6** | 0/6 |

**Why the two-hop flow still needs the query param.** For `package` / `live-course` this
endpoint hands back category nodes only — e.g. live-course 3 → category 1867, `count: 4`,
no materials. To list them the client must call
`/client/material-categories/1867/materials`, which has no container in its path. That is
exactly the hop where `?liveCourseId=3` (or `?packageId=`) must be passed, and the client
has the id because it is the screen it is already on.

## 2026-08-03 — Material entitlement: per-entry-point scope (`?courseId` / `?packageId` / `?liveCourseId`)

**Files:** `src/modules/client-material/client-material.service.ts`,
`src/client/categories/categories.controller.ts`, `src/client/material/material.controller.ts`
**DDL:** none. **Prisma:** unchanged. **Query shape: changed** (scoped requests skip two
pivot reads and narrow a third). **Response shape: unchanged** — only the *value* of
`isPurchased` / `mediaToken` differs, and only when the new param is sent.
**FE doc:** `docs/client/MATERIAL_ENTITLEMENT_SCOPE.md`

**Problem.** A material category attaches to many containers, and
`getPurchasedMaterialIds` answered "does the customer own *anything* that grants this?".
Inside a specific live course that is the wrong question: a student who owned live course
1 got `isPurchased: true` **and a working `mediaToken`** on materials opened from
**unpurchased** live course 3. Identical defect and identical fix to the shared-live-session
entry-point work (2026-07-30) — a paid container leaking into an unpaid one because access
did not depend on where the user was standing.

Note this only became reachable on 2026-07-31, when live courses got a material pivot at
all; before that live courses granted nothing, so there was nothing to leak.

**Change.** `getPurchasedMaterialIds(customerId, materials, scope?)` takes an optional
`MaterialEntitlementScope`, a discriminated union over **all three** container kinds:

```ts
{ kind: "course" | "package" | "liveCourse"; id: number } | null
```

When set, the two non-matching pivots are **not queried at all** (two fewer round-trips)
and the matching pivot is narrowed to that single id. Inside product N the only question
is whether the customer owns N.

All three kinds are scopeable on purpose: scoping only live courses would leave the
identical leak between two courses, or between a course and a package, since one category
is attachable to all three.

Everything downstream is unchanged, so scoping can only ever **withhold** access, never
widen it — verified against staging with an owns-nothing control.

Threaded through `listMaterialsByCategoryPaged`, `getCategoryContents`, and
`getMaterialDetail`. `getRecentMaterials` deliberately does **not** take it (cross-container
feed, no entry point). `getMaterialDetail` is included because it is the mediaToken-refresh
path — scoping only the list would let the refresh re-mint the withheld token.

**Validation.** New `parseEntitlementScope(query)` returns `null` (none present ⇒
unscoped), a scope object, `"invalid"`, or `"multiple"`. Controllers **400** with
`"Invalid entitlement scope id."` / `"Pass only one of courseId, packageId, liveCourseId."`.
Rejects `0`, negatives, non-integers, repeated params, and any two scope params together —
the student came from ONE place and guessing which would be inventing an answer.
Deliberate: silently treating a malformed value as "no scope" would widen access on a
typo, which is the exact failure being fixed. Absent/empty stays unscoped, which is what
keeps this backward compatible.

**Caching.** No change needed — `cacheRoute.buildKey` hashes the full normalized query
string plus caller identity, so scoped and unscoped responses land in separate entries.

**Verified on `websankul_staging_1`** (customer 472367, owns live courses 1/2/4, not 3;
category 1867 attaches LC 3 + courses 114/990115 + a package on parent 270). Test inserted
2 pivot rows and removed exactly those:

| request | isPurchased | tokens |
| --- | --- | --- |
| no param | true ×4 | 4/4 |
| `?courseId=114` (Course 1 — owned, attached) | true ×4 | 4/4 |
| `?courseId=990115` (owned, attached) | true ×4 | 4/4 |
| `?courseId=999999` (not attached) | false ×4 | 0/4 |
| `?packageId=990096` (attached, NOT owned) | false ×4 | 0/4 |
| `?liveCourseId=3` (attached, NOT owned) | false ×4 | 0/4 |
| `?liveCourseId=1` (owned, not attached) | false ×4 | 0/4 |
| owns-nothing control, scoped or not | false ×4 | 0/4 |

Identical results for both 472366 (`9999999999`) and 472367 (`7777777777`) — two distinct
accounts that share the name "Yug Chetan Gotecha", which is what made the original report
look like a bug. Detail endpoint: unscoped → token issued; live-course scope 3 →
`isPurchased:false`, `mediaToken:null`.

**Not a bug, for the record.** The reported "`true` but he didn't buy it" case was correct:
customer 472366 holds completed Razorpay orders for course 114 (₹699, `pay_TAeGthW7kEtYMM`)
and course 990115 (₹2999, `pay_TBMOxZVuWZlSzt`), and category 1867 is attached to both. The
unscoped answer was right; what was missing was the ability to ask the *scoped* question.

**Pre-existing, NOT changed:** `POST /client/media/resolve` re-verifies entitlement
**unscoped**. That is safe today because a scoped request mints no token to resolve, but a
token obtained from an unscoped browse remains resolvable for its short TTL regardless of
scope. Closing that would require carrying the scope inside the token — flagged, not done.

---

## 2026-08-03 — Material entitlement: ancestor walk stops at `parent > 0` (root sentinel)

**Files:** `src/modules/client-material/client-material.service.ts` (`ancestorsInclusive`)
**DDL:** none. **Prisma:** unchanged. **Query shape: changed** (one extra predicate in the
recursive CTE). **Response shape: unchanged** — verified no `isPurchased` flips, see below.

**Context.** Raised as "if a material is attached to 2 live courses, buying one should
unlock it, the other shouldn't matter." Verified against staging: the read path *already*
does exactly that. `getPurchasedMaterialIds` builds `unlocked` only from pivot rows whose
container the customer owns, so ownership is a pure OR across course/package/live-course,
and a non-owned container contributes nothing. Proven with the real function on
`websankul_staging_1` (customer 472367, who owns live courses 1/2/4 but not 3):

| scenario | result |
| --- | --- |
| category attached to no live course | locked |
| attached to LC 3 only (**not** owned) | locked — un-owned container grants nothing |
| attached to LC 3 (not owned) **+** LC 1 (owned) | unlocked — owning any one is enough |

The write side is also in sync: only `createLiveCourse` / `updateLiveCourse` write
`materialCategories`, both call `syncMaterialCategoryPivot`, and `delete` cascades the
pivot. No other code path mutates that JSON column.

**The real find (latent, not the reported symptom).** Material-category roots are marked
`parent = 0`, **not** `NULL` — confirmed on staging: 6 rows at `parent = 0`, **0** rows at
`parent IS NULL`, and no category with `id = 0`. The CTE terminated only on
`c.parent IS NOT NULL`, so the sentinel `0` was pulled into the ancestor chain: every
root-level material carried a phantom ancestor `0` in `universeIds`.

Harmless *today* — all three pivots currently have zero rows at `mcategory_id = 0`, and
both admin entry points (`parseMaterialCategoryRefs`, `course.controller.parseRefs`) reject
`categoryId <= 0`. But the guard is entirely upstream: **one** `mcategory_id = 0` row
arriving via legacy data, a direct DB write, or a future backfill would have unlocked every
root-level material for every owner of that container. That is an entitlement leak one bad
row away.

**Change.** `WHERE c.parent IS NOT NULL` → `WHERE c.parent IS NOT NULL AND c.parent > 0`.

Behavior-neutral now (re-ran the entitlement trace before/after: category 1867 for customer
472367 stays `true` on all 4 materials via courses 114/990115 + packages on parent 270; the
owns-nothing control stays 0). It closes the hole by construction instead of depending on
the pivots staying clean.

**Not changed / still open:** `ws_live_course.exam_categories` remains JSON-only with no
pivot — exams have the same class of gap materials had before 2026-07-31. Also note the
live-course entitlement predicate requires `paymentStatus: "verified"` while course/package
require only `status: true`; that asymmetry is pre-existing and deliberate, not touched here.

---

## 2026-08-03 — Plan subscriber counts read `pcb_id` (were counting `package_id`) + edit lock

**Files:** `src/modules/admin-plan/admin-plan.repository.ts`, `src/modules/admin-plan/admin-plan.service.ts`,
`src/modules/admin-package/admin-package.repository.ts`, `src/modules/admin-package/admin-package.service.ts`,
`src/admin/plan/plan.controller.ts`
**DDL:** none. **Prisma schema:** unchanged. **Query shape: changed** (wrong column → right column,
plus one new batched `groupBy`). **Response shape: changed** (`subscriberCount` added to the
package-plans list).

**Bug (query-level).** `adminPlanRepository.subscriberCount` counted:

```ts
prisma.packageCourseSubscription.count({ where: { packageId: planId } })
```

`packageId` maps to `ws_package_course_subscription.package_id`; the **plan** FK on that table is
`planId` → `@map("pcb_id")` (verified in `prisma/schema.prisma`, model `PackageCourseSubscription`).
So this compared a *plan* id against a *package* id column — two unrelated id spaces. It returned
0 for plans that genuinely had subscribers, and could return a nonzero count by coincidence when a
plan id happened to collide with a package id. `subscriberCountForPlans` had the identical defect
on the bulk path.

**Fix.** Both now filter `{ planId }` / `{ planId: { in: ids } }`. No other call site of these two
functions changed semantics — they were simply reporting the wrong number before.

**New guard — `PUT /admin/plans/:id` returns 400 when the plan has subscribers.**
`updatePlan` now short-circuits with the sentinel `"has_subscribers"` before building the update
payload; the controller maps that to:

```json
{ "success": false, "message": "Plan has subscribers; it can no longer be edited. Deactivate it and add a new plan instead." }
```

Rationale: customers bought on those terms, so price/duration must not be rewritten retroactively.
`PATCH /admin/plans/:id/status` is deliberately **not** gated — a plan can still be retired from
sale without touching live subscriptions. Note this guard only became reachable *because* of the
count fix above: with the old `packageId` filter the count was ~always 0, so the lock would never
have fired.

**Signature change:** `updatePlan` returns `any | null | "has_subscribers"` — `null` still means
404 (not found). Any future caller must distinguish the two.

**New query — `GET /admin/packages/:id/plans` now returns `subscriberCount` per plan.**
Batched to keep the list at one extra query instead of one count per row:

```ts
prisma.packageCourseSubscription.groupBy({
  by: ["planId"],
  where: { planId: { in: planIds } },
  _count: { _all: true },
})
```

Fired only when the page is non-empty; missing keys default to `0`. This drives the admin UI's
edit lock so the FE can disable the control before the user submits and eats the 400.

**Counting semantics to be aware of:** both the guard and `subscriberCount` count **all** matching
subscription rows — no `status` / `paymentStatus` / `endAt` filter. Expired and unverified
subscriptions therefore still lock a plan. That is the intended conservative reading (someone paid
on these terms at some point), but it is deliberately *stricter* than the entitlement predicate used
on client reads — do not copy this filter into an access check.

**Index note (follow-up, not done here):** `ws_package_course_subscription` has no declared index on
`pcb_id` (`@@index` list covers `promoterId+createdAt`, `createdAt+courseId+amount`,
`customerId+status+endAt`). The new `groupBy` and the per-edit count scan on that column. Verify
whether InnoDB has an FK-backed index on `pcb_id` on staging/prod; if not, add one before this gets
hot — the table is in the hundreds of thousands of rows.

---

## 2026-07-31 — Live-course material entitlement: new `ws_material_category_live_course` pivot

**Bug:** a customer with an active, verified **live-course** subscription saw
`isPurchased: false` on every study material — and `mediaToken: null`, so the PDF
would not open either. Reported on
`GET /api/v1/client/material-categories/69/materials`.

**Cause:** `getPurchasedMaterialIds` (`src/modules/client-material/client-material.service.ts`)
resolves ownership by joining category → container pivot → subscription. Only two
containers had a pivot:

- `ws_material_category_course` → `ws_package_course_subscription`
- `ws_material_category_package` → `ws_package_course_subscription`

LiveCourse never got one in Wave 6 — its attachments live in the JSON column
`ws_live_course.material_categories`, which no join can read — and
`ws_live_course_subscription` was never queried. So a live-course purchase could
not unlock a material by construction. The file header documented this as an
accepted gap; it is not (materials are the point of the with-material plans).

**Schema (DDL):** `docs/migration/schema-changes/2026-07-31_material_category_live_course.sql`

```
ws_material_category_live_course (id, live_course_id, mcategory_id, `order`,
                                  created_at, updated_at)
  UNIQUE uniq_mclc_course_cat (live_course_id, mcategory_id)
  KEY    idx_mclc_cat (mcategory_id)
```

Column names mirror `ws_material_category_course` exactly so the three pivots are
interchangeable. Additive, `CREATE TABLE IF NOT EXISTS`, no FKs (consistent with
the rest of the `ws_live_course_*` block). Prisma model
`MaterialCategoryLiveCourse` added by hand (no `db:pull`).

**Query change** — `getPurchasedMaterialIds` now resolves a third container:

```ts
prisma.materialCategoryLiveCourse.findMany({ where: { materialCategoryId: { in: universeIds } } })
prisma.liveCourseSubscription.findMany({
  where: { customerId, liveCourseId: { in: liveCourseIds }, status: true,
           paymentStatus: "verified", OR: [{ endAt: null }, { endAt: { gte: now } }] },
})
```

The live-course predicate is the one already used in `client-search`,
`exam-countdown.client`, and `client-lecture-progress` (active + verified, null
`endAt` = lifetime). Ancestor rollup is unchanged: a pivot on any ancestor
category still unlocks the leaf.

This helper is shared, so the fix lands on every material surface at once:
`/client/material-categories/:id/materials`, material detail, recent materials,
`client-folder`, `client-catalog`, and the `k:"material"` re-check inside
`POST /client/media/resolve`.

**Write path:** `admin-live-course` mirrors the JSON onto the pivot
(`repo.syncMaterialCategoryPivot`, replace-in-place in one transaction) on
create/update, and deletes pivot rows with the course. The JSON column remains
the admin read/write contract — same "column still written, relation table read"
split as `ws_video_category_relation`. `parseMaterialCategoryRefs`
(`admin-live-course.refs.ts` — its own file, like `customer-profile.name`, so the
backfill script can import it without pulling in the service's exceljs/redis/
streamos deps) tolerates every shape the dashboard has sent (`[{category,order}]`,
bare ids, `{_id}`/`{categoryId}`, JSON-stringified multipart), since the SQL
validator passes the field through as `z.any()`.

**Verified** (local MySQL, staging dump) on category 1869 — chosen because no
course/package pivot touches its ancestor chain, so the live course is the only
possible unlock path:

```
no live pivot   owner: isPurchased=false, mediaToken=null   ← the reported bug
live pivot      owner: isPurchased=true,  mediaToken=set
                non-owner: false     anonymous: false
                owner, endAt backdated:      false
                owner, paymentStatus pending: false
```

Write path: create-sync → 2 rows; re-save with 1 → replaced; duplicate refs
collapse; empty array → cleared; course delete → rows gone. Backfill inserted 4
rows from 3 live courses (dry-run first).

**Backfill:** `scripts/backfill-material-category-live-course.ts` (`--dry`
supported, idempotent — inserts only missing edges, skips + reports refs whose
category row is gone).

**API contract:** unchanged. Same fields, same envelope — `isPurchased` merely
becomes `true` where it was always wrong before. Read-only for course/package
buyers.

**Deploy order:** apply DDL → `yarn prisma:generate` → **restart** (a stale
in-memory client 500s on a healthy DB) → run the backfill.

**Route cache:** no change needed. `/client/material-categories/:id/materials` is
`cacheRoute({ ttl: 86400, entity: "material", scope: "user" })`, and every
entitlement grant already calls `flushUserRouteCache(customerId)` — including the
live-course branch of `client/payment/verify.controller.ts` and the admin manual
grant. Existing keys cached *before* this deploy still carry the old
`isPurchased:false`, so flush the route cache once on release.

---

## 2026-07-30 — Profile dashboard: `pastExams` now counts DAILY + SUBJECT attempts

**Files:** `src/modules/customer-profile/profile-dashboard.sql.ts`
(`pastDailyExamsCount` → renamed `pastExamsCount`), `src/client/profile/dashboard.controller.ts`

**Endpoint:** `GET /api/v1/client/profile/dashboard` → `pastExams`

**Change (product decision):** the badge is the customer's total of **past daily +
past subject** attempts, not daily-only. `ExamType` is exactly `{ daily, subject }`.
The type filter is written `in [daily, subject]` rather than dropped so that result rows
whose exam was deleted don't count as un-nameable "past exams", and so a future third
type forces a conscious decision.

"Past" = finished attempt: `status = true AND inProgress = false AND submittedAt IS NOT NULL`.

**Verified** (staging, over HTTP): customer 472366 `pastExams` 0 → **4** (daily 0 +
subject 4); customer 472367 → 2 (daily 0 + subject 2).

**⚠ Badge no longer matches `/client/quizzes/my/past-daily`,** which is daily-only and
returns 0. Neither existing list endpoint matches the new badge: `/client/exams/my/attempts`
(`myResults`) spans both types but has **no** completed-attempt gate, so it also counts
in-progress rows. A list matching this badge needs `my/attempts` + the
`inProgress:false, submittedAt IS NOT NULL` gate, or `past-daily` widened to both types.
Not done here — pick one before the FE links the badge to a list.

### Superseded note from the earlier entry this replaces

The original predicate also *omitted* `inProgress`/`submittedAt`, justified by a header
comment claiming `ws_exam_result` lacks those columns. That was false (`ExamResult` maps
`qresult_in_progress` / `qresult_submitted_at`; 2 rows have `submittedAt = NULL`). Both
the gate and the corrected comment are in place.

**Why it was 0:** `ws_exam.type` has a single value across the whole DB (`subject`,
6 exams) and **zero** `daily` exams, so a daily-only badge was structurally 0 for every
customer. Customer 472366 had 4 completed `subject` attempts the badge ignored.

### Audit of the other three counts on this endpoint (all verified correct, unchanged)

`GET /client/profile/dashboard` has **no `cacheRoute`** (`customer.routes.ts`) — it is
uncached and recomputed per request, so none of these can be stale.

- `savedAddresses: 0` — correct. Customer has 1 address row with `status = false`;
  `repo.create` defaults `status: true`, so it is a genuine soft-delete.
- `downloads: 7` — correct: 2 saved materials + 1 saved video + 4 active ebook downloads.
  A 5th ebook-download row is excluded because its `ws_ebook` row no longer exists
  (orphaned data; the guard is behaving correctly).
- `activePlans: 20` — correct and matches the My Subscriptions list exactly
  (9 course/package + 3 live + 7 ebook + 1 test series).

**⚠ Performance, NOT changed:** `countActiveSubscriptions` uses `findMany` (not `count`)
across 4 subscription tables to dedup by target id in memory. Customer 472366 has 19,561
`ws_package_course_subscription` rows — 1,687 currently active — that collapse to **9**
distinct targets; the call takes ~140ms and the endpoint is uncached. The dedup result is
correct, but cost scales with raw row count, not with the answer.

---

## 2026-07-30 — Client promocode list: `discountValue` resolved from plan links (was always 0)

**Files:** `src/modules/promo-code/promo-code.service.ts`
(`toPublicPromoDto`, new `resolveEffectiveDiscounts`, `listPublicPromocodes`)

**Endpoint:** `GET /api/v1/client/promocodes` (optionally `?type=&id=`)

**Problem:** the DTO read `ws_promocode.discount_value` straight off the row. For any
code whose discount is configured per-plan — the authoritative model since the TASK 2
checkout work — that column is `0`, so the list advertised `discountValue: 0` for every
such code while checkout correctly charged the real percentage. On staging **both**
active public codes were affected (`POLICE607` id=2, 26 link rows; `GFFG` id=4, 4 link
rows), i.e. the field was 0 for 100% of live rows.

**Change:** the list now mirrors the resolution rule already used by `applyPromocode`:

- Per-plan rows in `ws_promoted_package_course_ebook.customer_percentage` are the
  discount source; `ws_promocode.discount_value` is a **fallback only** for codes with
  no link rows at all (legacy codes keep working unchanged).
- A code with ANY link row is treated as link-driven — the legacy column is never mixed
  in for it.
- `discountType` is reported as `"percentage"` whenever links drive the value.
- When the request filters to one entity (`?type=&id=`), only that entity's own active
  plans contribute, so a code covering many packages can't advertise a different
  package's percentage. Links are matched on `plan_kind` **and** `plan_id`, because plan
  ids are per-table and would otherwise collide across
  `ws_package_course_ebook_price` / `ws_live_course_plan` / `ws_test_series_price`.
- Where an entity's plans carry different percentages the **highest** is reported
  ("up to X% off"); checkout still prices each plan individually.

**Queries added:** one `ws_promoted_package_course_ebook` lookup scoped to the page's
promocode ids, plus (filtered requests only) one plan lookup via the existing
`loadPlansForEntitiesSql`. Both are per-request, page-bounded — not per-row.

**No schema change. No backfill.** Response shape is unchanged; only the *value* of
`discountValue` / `discountType` changes.

**⚠ Deploy note — flush the route cache.** `GET /client/promocodes` is `cacheRoute`d for
24h (`entity: "promo-code"`, shared scope). Existing keys keep serving `discountValue: 0`
until they expire or are flushed — `autoFlush` only fires on admin promocode *writes*, so
a pure read-logic change like this one leaves stale entries behind. Either:

- `await flushEntity(...resolveFlushGroup("promo-code"))` — sweeps `promo-code` +
  `catalog-package` (done on the 192.168.0.15 dev box: 4 keys cleared, verified over HTTP
  returning `discountValue: 20` on both the MISS and the re-cached HIT); or
- bump `CACHE_KEY_VERSION` (default `v1`, part of `ROUTE_CACHE_PREFIX`) to invalidate
  **every** route cache at once — the safer option for staging/prod, where any read-logic
  change has the same staleness problem.

**⚠ Data issue, not fixed here:** `POLICE607` has `title = "60% off"` but its link rows
are all `20`. The title is free text and was never derived from the discount; the list
now shows the true `20`. The title needs correcting in admin.

---

## 2026-07-30 — Resume feeds: live-course cards excluded (drops 5 queries per request)

**Files:** `src/modules/client-lecture-progress/client-lecture-progress.service.ts`
(`listMyLearningProgress`, `buildResumeDashboard`),
`src/client/dashboard/dashboard.controller.ts`, `src/client/learning/progress.controller.ts`
(doc comments)
**FE doc:** `docs/client/DASHBOARD_RESUME_PROGRESS.md` (new — was referenced from the
service in two places but had never been written)
**DDL:** none. **Prisma:** unchanged. **No backfill.**

**Requirement (FE, 2026-07-30).** No `type: "live"` entry may appear in
`GET /client/dashboard/resume` or `GET /client/learning/progress/my`. A live session is not
a resumable lecture — the cards were surfacing with `positionSec: 0` / `durationSec: 9`.

**Query-level change.** Both endpoints funnel through `listMyLearningProgress`
(`buildResumeDashboard` is built on top of it, which is the documented invariant that the
dashboard cannot disagree with the resume feed), so the exclusion is applied **once** there:
the `resumePointers(customerId, "liveCourse")` read is dropped and `livePtrs` is a typed
empty array.

**This REMOVES queries rather than adding a filter.** Every live query was already guarded
by `liveIds.length`, so an empty pointer set short-circuits all of them. Per request, these
no longer run:

1. `enrollmentResume` findMany for `scopeKind = "liveCourse"` (the dropped pointer read)
2. `liveCourse.findMany` hydration
3. `liveCourseSubscription.findMany` (active + `paymentStatus: "verified"`)
4. `completedCounts(... "liveCourseId")` groupBy
5. `sessionPositions` findMany + `resolveSessions` (session→lecture titles)

`containerTotals` also stops counting live totals. The `perLive` card loop iterates zero
times. Net effect on two hot client endpoints is **fewer** round-trips, not more.

**Response contract.** `/dashboard/resume` keeps all three keys — `resumeLecture` is now
hardcoded `null` (written as an explicit null, not a `.find()` guaranteed to miss) so the
shape the app parses is unchanged. `/learning/progress/my` returns only course/package
cards; `resumeNext` can no longer be live, and `pagination.total` counts only the remaining
cards — a user whose only started item was a live course now legitimately gets
`total: 0` + `cards: []`.

**Not cached — no flush needed.** Verified neither route has `cacheRoute` applied
(`dashboard.routes.ts:19`, `learning.routes.ts:13`), unlike the sibling `/dashboard` and
`/free-dashboard` which do. The change is live on the next request after deploy.

**Writes are untouched:** the heartbeat still records `ws_lecture_progress` /
`ws_enrollment_resume` rows for live sessions. This is a read-side exclusion only, so
re-enabling is a one-line revert with no data loss.

**Deliberately NOT changed:** `buildResumeNextCardSql` (used only by
`src/client/learning/resumeCard.ts`) still returns a live card when the FE asks about a
specific live session — it answers "which container owns THIS lecture", a different
question, and is not one of the two endpoints in the request.

---

## 2026-07-30 — `validate({ query })` was a hard 500 on Express 5 (blocked all 3 live-preview routes)

**Files:** `src/middlewares/validate.ts`
**DDL:** none. **Prisma:** unchanged. **No query shape changed** — logged because it made
the new live-preview endpoints unreachable, i.e. none of their queries ever ran.

**Symptom.** `GET /api/v1/client/live-sessions/20?liveCourseId=4` → **500**
`{"message":"Cannot set property query of #<IncomingMessage> which has only a getter"}`.

**Cause.** In Express 5 (`express@5.2.1` installed), `req.query` is a **getter-only accessor
on the request prototype**. `validate.ts:22` did `req.query = schemas.query.parse(req.query)`,
which throws a `TypeError` at request time. `req.body` and `req.params` are plain own
properties, so those two assignments were always fine — **only `query` was affected.**

Not caught by `yarn typecheck`: the Express type declarations still type `query` as
writable, so this is invisible to `tsc` and only appears on a live request.

**Blast radius: the 3 routes added for live-preview watch-time metering** —
`GET /client/live-sessions/:id`, `POST …/:id/preview/heartbeat`, `POST …/:id/preview/stop`
(`src/client/live/live.routes.ts:19,27,32`) — were the codebase's **only**
`validate({ query })` call sites, and every one of them 500'd before reaching its handler.
The trial-metering endpoints could not be exercised at all.

**This was a known trap that got re-introduced.** `src/client/app-version/` had already hit
it and worked around it by parsing the query *inside the controller*, with the reason
written down in both its `.routes.ts:12` and `.controller.ts:12`. The live routes used the
middleware anyway.

**Fix — repair the middleware once rather than copy the per-controller workaround**, so the
trap is gone for every future route and the documented contract ("replaces the request slice
with the parsed value") becomes true again:

```ts
Object.defineProperty(req, "query", {
  value: schemas.query.parse(req.query),
  writable: true, enumerable: true,
  configurable: true, // so a second validate() on the same route can redefine
});
```

Defining an **own** property shadows the prototype getter — the supported replacement path.

**Verified at runtime** (not just typecheck) against the installed Express 5.2.1: assignment
reproduces the 500 with the exact message above; `defineProperty` returns 200 and the
downstream handler sees `{ liveCourseId: 4 }` with `typeof === "number"`, confirming Zod's
coercion survives into the handler.

Behaviour is otherwise unchanged: the live controllers re-derive
`Number(req.query.liveCourseId)` themselves (`live.controller.ts:42,180`), so they never
depended on the middleware's coercion. `app-version`'s local parse still works and was left
alone; it can be simplified onto the middleware later.

---

## 2026-07-30 — `POST /admin/courses`: `ordered` made optional so `nextOrder` is reachable

**Files:** `src/admin/course/course.validation.ts` (`createCourseSqlSchema`)
**DDL:** none. **Prisma:** unchanged. **No column, index, or query shape changed** — this
is logged because it changes which *value* lands in `ws_course.ordered` on insert.

**Problem.** Creating a course without an Order returned **500** with a raw stringified
`ZodError` as `message`:

```
{"success":false,"message":"[{\"code\":\"invalid_type\",\"expected\":\"number\",
  \"received\":\"nan\",\"path\":[\"ordered\"], ...}]"}
```

`ordered` was declared `z.coerce.number().int()`. Zod's `coerce` runs `Number(v)` **before**
the type check and does so even for an **absent key** — `Number(undefined)` → `NaN` — so an
omitted field could not report "Required"; it reported the misleading `received: "nan"`.

**Why it surfaced now.** The 2026-07-29 ordering refactor made
`adminCourse.createCourse` self-assign the order:
`d.ordered ?? nextOrder(findFirst({ orderBy: [{createdAt:"desc"},{id:"desc"}] }))`
(`src/modules/admin-course/admin-course.service.ts:159`, rule in `src/utils/listOrdering.ts:46`).
The service was ready for an absent `ordered`, but the edge validator still required it, so
`createCourseSqlSchema.parse()` at `course.controller.ts:205` threw first — **the `??`
fallback was dead code on this endpoint.** Every create either carried an explicit order or
500'd. The admin UI stopped sending the field (correct, per the refactor) and hit the wall.

**Change.** `ordered` is now `preprocess + optional`, matching the `courseEducatorId`
pattern already in this file (added earlier for the identical `coerce` trap):

```ts
ordered: z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().int("Ordered must be an integer")
).optional(),
```

**Insert-value effect:** omitted / `""` / `null` → `undefined` → `ws_course.ordered` gets
**previous row + 1**. A numeric string still coerces and is honoured verbatim. Junk
(`"abc"`) now fails with the honest `"Ordered must be an integer"`.

`PUT /admin/courses/:id` is unaffected — `.partial()` already made the field optional and
update only writes `ordered` when explicitly present (`admin-course.service.ts:198`); it
never calls `nextOrder`. Client catalog reads still sort `ordered ASC` — unchanged.

**Known, pre-existing, NOT fixed here:** `createCourse`/`updateCourse` call `.parse()`
directly instead of going through the `validate` middleware, so **any** Zod failure on
these routes is a `500` with a JSON-blob `message` rather than the standard `422` +
flat `messages` map. Fixing it changes an error shape the admin FE parses, so it needs a
decision + an FE doc. Other `.parse()` sites in `src/admin/course/` have the same
behaviour and should be swept together.

---

## 2026-07-30 — Live-session preview: wall-clock → WATCH-TIME metering

**Files:** `src/modules/admin-live-course/admin-live-course.service.ts`,
`src/client/live/live.controller.ts`, `src/client/live/live.routes.ts`,
`src/client/live/live.validation.ts`, `src/utils/previewTracking.ts` (new)
**DDL:** `docs/migration/schema-changes/2026-07-30_live_session_preview_watch_time.sql`
**Prisma:** `LiveSessionPreview` gained `consumedSeconds` + `lastHeartbeatAt` (hand-edited
model, not `db:pull`) — **requires `yarn prisma:generate` AND an app restart.**

**Problem.** The trial expired 180 s after `started_at`, i.e. on wall clock. Opening the
player and walking away burnt the whole allowance, and a student who watched 70 s then
left came back to 0 s instead of 110 s.

**New model.** Two columns on `ws_live_session_preview`:
`consumed_seconds INT NOT NULL DEFAULT 0` (committed watch time) and
`last_heartbeat_at DATETIME NULL` (the charging **cursor** and the "window open" flag —
NULL means nobody is watching and nothing accrues). `started_at` is kept and still
written, but is no longer the expiry basis; it is now the "trial first began" audit value
and the backfill source.

**Query-level changes:**

1. **`resolveLivePreviewStateSql` is read-only w.r.t. consumption.** It still creates the
   row on first open (so the trial exists) but charges nothing; remaining time is
   `180 − (consumed_seconds + pending)`. Full access short-circuits *before* any row is
   touched, so a paying student never gets a tracking record.
2. **New `previewHeartbeatSql` / `previewStopSql`** — the only writers that advance
   `consumed_seconds`. Charge is `now − last_heartbeat_at`, **capped at
   `PREVIEW_STALE_SECONDS` (20)**: an abandoned window (app killed, no `stop`) costs one
   missed interval plus slack instead of the whole absence, which satisfies the
   "auto-close stale tracking windows" requirement with **no sweeper job**.
3. **The commit is a compare-and-swap, not a read-modify-write.**
   `updateMany({ where: { id, lastHeartbeatAt: <value read> }, data: {...} })` — two
   devices (or a heartbeat racing a dropped one's retry) read the same cursor and compute
   the same charge; guarding the UPDATE on that cursor means exactly one writer wins and
   the loser observes `count === 0` and re-reads **without** charging. Total consumption
   is therefore bounded by wall-clock time in which at least one device was playing and
   cannot be multiplied by opening more devices. Verified: 6 concurrent heartbeats over
   the same 10 s charged 10 s, not 60 s.
   Deliberately a single conditional UPDATE rather than raw SQL — the IST `$use`
   middleware shifts `where` and `data` args alike, so the cursor round-trips
   consistently; hand-written SQL would bypass the shift and mis-compare by 5.5 h.
4. **Reads include uncommitted open-window time** (`pendingPreviewCharge`, same 20 s cap)
   so a client that heartbeats and immediately re-joins doesn't see its remaining time
   snap back up, and a list card never advertises "preview" for a trial the player would
   instantly end. Still strictly read-only — `previewLevelMapSql` writes nothing.
5. **Exhaustion clears the cursor** (`nextCursor = null` once `consumed >= 180`) so the
   next read cannot compute a phantom pending charge against an already-empty trial.

**Backfill (in the DDL).** Carries over what each existing trial had already burnt under
the old wall-clock rule, so the migration never hands preview time back to a student
whose trial had ended: `consumed_seconds = LEAST(180, GREATEST(0, TIMESTAMPDIFF(SECOND,
started_at, @ist_now)))`. ⚠ `@ist_now = UTC_TIMESTAMP() + INTERVAL 330 MINUTE`, **not**
`NOW()` — `started_at` holds IST wall clock written through the Prisma middleware, and
raw SQL bypasses that shift; on a UTC-session server a bare `NOW()` would make every diff
5.5 h too small and reset every trial started in the last 5.5 hours to a full free 180 s.
`last_heartbeat_at` stays NULL for all legacy rows, so no backfilled trial is treated as
currently-being-watched. **Apply `2026-07-30_live_session_preview_unique.sql` first** —
the CAS relies on one row per (customer, session).

**API surface.** `GET /client/live-sessions/:id` gained `previewTrackingId` (HMAC over
customer+session, derived not stored — see `src/utils/previewTracking.ts`) and
`previewHeartbeatSeconds` (10, server-owned so the cadence is retunable without an app
release). New routes `POST /client/live-sessions/:id/preview/heartbeat` and
`.../preview/stop`, both taking the same `?liveCourseId` entry point as the join so a
heartbeat from an unpurchased course isn't judged against every linked course (which
would report `full` and silently stop metering a trial genuinely being consumed). No
client-supplied "seconds watched" is accepted anywhere. A `previewTrackingId` mismatch is
**422**, not 403 — it is a correlation check; access is always re-derived from the bearer
token.

**Behaviour change for the app:** the trial is now consumed by heartbeat/stop and by
NOTHING else. A client that never heartbeats never consumes it. FE doc updated
(`docs/client/SHARED_LIVE_SESSION_ACCESS.md` §3).

**Env:** `PREVIEW_TRACKING_SECRET` added to `.env.example` — **optional**, falls back to
`MEDIA_TOKEN_SECRET` then `JWT_ACCESS_SECRET`, so no `config/env.ts` boot validation is
needed and no environment breaks without it. Rotating it invalidates in-flight
`previewTrackingId`s (clients re-join and get a new one) but does **not** reset anyone's
`consumed_seconds`.

**Verification.** 29/29 assertions against real MySQL on a temporary fixture (removed
afterwards), driving the service layer directly: join-twice consumes nothing; 2×10 s
watched → 160 s; stop commits and re-join resumes at 155 s; stop idempotent; abandoned
1 h costs 20 s; 6 concurrent heartbeats charge once; consumption caps at 180; exhausted
trial not resettable and hands out no tracking id; the shared-session rule still holds on
the metering endpoints (heartbeat from the purchased course → `full` and meters nothing,
from the unpurchased one → stays `preview_ended`); list feed reflects watch time and
writes nothing.

---

## 2026-07-30 — Live preview: wall-clock trial → WATCH-TIME trial

**Files:** `src/modules/admin-live-course/admin-live-course.service.ts`,
`src/client/live/live.controller.ts`, `src/client/live/live.routes.ts`,
`src/client/live/live.validation.ts`, `src/utils/previewTracking.ts` (new),
`prisma/schema.prisma` (`LiveSessionPreview`)
**DDL:** `docs/migration/schema-changes/2026-07-30_live_session_preview_watch_time.sql` (pending deploy —
apply AFTER `2026-07-30_live_session_preview_unique.sql`)
**FE doc:** `docs/client/LIVE_PREVIEW_WATCH_TIME.md`

**Problem.** The 3-minute preview expired 180s after `started_at` — wall clock.
Opening the player and walking away burnt the entire trial, and a student who
watched 70s then left returned to 0s instead of 110s. The trial must represent 180
seconds of *actual watch time*.

**Schema changes** (`ws_live_session_preview`):

- `+ consumed_seconds INT NOT NULL DEFAULT 0` — committed watch time. Only a
  heartbeat/stop advances it.
- `+ last_heartbeat_at DATETIME NULL` — the charging **cursor** and the
  open-window flag. `NULL` ⇒ nobody is watching ⇒ nothing is accruing.
- `started_at` is retained and still written, but is **no longer the expiry
  basis** — it is now just the "trial first began" audit value.

**Backfill.** `consumed_seconds = LEAST(180, TIMESTAMPDIFF(SECOND, started_at, @ist_now))`
so no already-expired trial is handed time back. ⚠ `@ist_now` is
`UTC_TIMESTAMP() + INTERVAL 330 MINUTE`, **not `NOW()`**: `started_at` holds IST
wall clock (the Prisma `$use` shift), raw SQL bypasses that middleware, and the
staging/prod MySQL session tz is UTC — a bare `NOW()` would under-count every diff
by 5.5h and reset to 0 every trial started in the last 5.5 hours.

**Query-level changes:**

1. **`resolveLivePreviewStateSql`** — no longer computes expiry from `started_at`.
   Returns `180 − min(180, consumed_seconds + pending)`, where `pending` is the
   uncommitted time of an open window, capped at `PREVIEW_STALE_SECONDS`.
   **Reads never charge** — this is the property that makes "leaving the stream
   stops the clock" true. `previewExpiresAt` dropped from `LivePreviewStateSql`
   (internal only; never appeared in any response). `track=false` is now a pure
   read of the existing row instead of always reporting a full 180.
2. **New `previewHeartbeatSql` / `previewStopSql`** → `POST
   /client/live-sessions/:id/preview/{heartbeat,stop}`. Both re-derive entitlement
   through `firstEntitledLiveCourseId` against the **same `?liveCourseId` entry
   point** as the join endpoint — judging a heartbeat against every linked course
   would report `full` for someone previewing an unpurchased shared course and
   stop metering them.
3. **New `commitPreviewTick` — conditional UPDATE (compare-and-swap).**
   `updateMany({ where: { id, lastHeartbeatAt: <value read> }, … })`. A plain
   read-modify-write lets two devices read the same cursor and both add the same
   charge, draining the trial at 2× — the "concurrent heartbeats must not multiply
   consumption" failure. The CAS makes exactly one writer win; the loser sees
   `count === 0` and re-reads without charging. Because every writer advances the
   one shared cursor, total consumption is bounded by the wall-clock time in which
   *at least one* device was playing, for any number of devices.
   Deliberately **not** raw SQL: `$executeRaw` bypasses the IST middleware, which
   shifts `where` and `data` args alike, so a hand-written `NOW()` comparison would
   be 5.5h out.
4. **Stale-window handling needs no sweeper job.** Each charge is capped at
   `PREVIEW_STALE_SECONDS` (20s), so an app that dies without calling
   `/preview/stop` costs ≤20s total however long it stays gone. The window
   self-limits rather than being closed on a timer.
5. **`previewLevelMapSql`** — now selects `consumed_seconds, last_heartbeat_at`
   (was `started_at`) and applies the same watch-time rule, so list cards and the
   detail endpoint cannot disagree. Still strictly read-only.
6. **Full-access short-circuits before any row is touched** on all three paths, so
   a paying student never gets a tracking record.

**`previewTrackingId` is derived, not stored** (`utils/previewTracking.ts`): an
HMAC over `(customerId, liveSessionId)`. No column, no lazy write, no backfill —
and it is stable across devices/reinstalls, which a per-open random id could not
be without invalidating the id a second device is still heartbeating with. It is a
correlation check (mismatch ⇒ 422), never an authorisation one.

**Verified** against local staging MySQL (24/24): starts at 180 · reads/re-joins
cost nothing · 3s watched ⇒ ~177 · stop is idempotent · rejoin resumes the saved
value · 3 simultaneous heartbeats charge one interval, not three · a 10-minute
abandoned window charges 20s not 600s · exhaustion ⇒ `preview_ended` + cursor
cleared + list feed agrees · `isPlaying:false` behaves as stop · full-access users
create no row.

---

## 2026-07-30 — Shared live sessions: per-entry-point entitlement (`?liveCourseId`)

**Files:** `src/client/live/live.controller.ts`, `src/client/live/live.validation.ts` (new),
`src/client/live/live.routes.ts`, `src/client/live-course/live-course.controller.ts`,
`src/modules/admin-live-course/admin-live-course.service.ts`,
`src/modules/client-media/client-media.service.ts`, `src/utils/mediaToken.ts`
**DDL:** `docs/migration/schema-changes/2026-07-30_live_session_preview_unique.sql` (pending deploy)
**FE doc:** `docs/client/SHARED_LIVE_SESSION_ACCESS.md`

**Problem.** A live session may be linked to several live courses
(`ws_live_session_course` is a true N:N). `GET /client/live-sessions/:id` always
evaluated **every** linked course, so a student who owned `C1` got a full stream when
opening the shared session from **unpurchased** `C2` — a paid course leaking into an
unpaid one. Access has to depend on the entry point, which the API had no way to express.

**Query-level changes:**

1. **`resolveLivePreviewStateSql(customerId, sessionId, liveCourseIds, track)`** — the
   `liveCourseIds` argument is now explicitly the *entitlement scope*; callers pass
   `[selectedCourseId]` for a course entry point and all linked ids for Live Now. Same
   query (`activeSubsForCourses`: `status=1 AND payment_status='verified' AND (end_at IS
   NULL OR end_at >= now)`), narrower `IN` list. Return type gained
   `accessGrantedByLiveCourseId`.
2. **New `firstEntitledLiveCourseId()`** — same single `ws_live_course_subscription`
   query as `hasAccessToAnyLiveCourse`, but returns *which* course granted access
   (resolved in the caller's id order) instead of a boolean.
3. **`ws_live_session_preview` reads are now `orderBy: { id: "asc" }`** (was unordered
   `findFirst`). The preview window is keyed on `(customer_id, live_session_id)` — never
   the course — so the **earliest** row must always win; an unordered read could return
   a duplicate row from a concurrent first-open and effectively hand back trial time.
3b. **The preview INSERT is now `createMany({ skipDuplicates: true })`** (was
   `create` in a try/catch) → MySQL `INSERT IGNORE`. Losing the race against the new
   unique index is a silent no-op rather than a thrown P2002, which Prisma's
   `log: ["warn","error"]` would otherwise print on *every* concurrent open. It relies
   on the DB constraint, not a `schema.prisma` `@@unique`, so no client regeneration is
   required and an environment without the index applied still behaves correctly (it
   inserts a duplicate, which oldest-row-wins renders harmless). Verified: 8 concurrent
   first-opens wrote 7 duplicate rows before the index, 1 row after.
3c. **`previewSecondsRemaining` is clamped to `LIVE_PREVIEW_SECONDS`.** `started_at`
   is a second-precision `DATETIME` and MySQL **rounds** the fractional part, so a row
   written at `:00.6` reads back as `:01` — half a second in the *future* — and the raw
   `Math.ceil` answered **181s** for a 3-minute trial (measured, not theoretical).
4. **New `previewLevelMapSql(customerId, sessionIds[])`** — one batched
   `ws_live_session_preview` read for list endpoints. **Read-only by design:** only the
   detail endpoint (`track=true`) may create a preview row, so rendering Live Now can
   never start someone's clock.
5. **Session feeds de-N+1'd.** `sessionFeed()` (backing `/live-courses/live-now-sessions`,
   `/upcoming-sessions`, `/my/upcoming-sessions`) took one
   `hasAccessToAnyLiveCourse` query **per row** from the controllers. It now takes
   `customerId` and resolves the whole page in 3 batched queries (`ws_live_course` by
   linked ids, `ownedCourseIds`, `previewLevelMapSql`). Rows already de-duplicated per
   physical session by `sessionsForCourses`; now they also carry
   `liveCourses[{_id,name,image,isPurchased}]`, `sessionId`, and `accessLevel`.
6. **`liveSessionCourse` link reads ordered** (`orderBy: { id: "asc" }`) in
   `client-media.service.ts` so the Live Now "which course granted access" answer is
   stable across calls.

**Media-token contract.** `MediaClaims` gained optional `lc` (the selected live course).
`/client/media/resolve` re-applies the course-scoped gate instead of re-checking all
linked courses — otherwise a preview token minted under `C2` would be upgraded to full
on resolve because `C1` is owned. It is deliberately **not** a `scope` claim: `scope` is
checked before the per-kind switch and would 403 the legitimate preview caller.
Linkage is re-verified at resolve time, so unlinking a course revokes in-flight tokens.
`signMediaToken` gained an optional TTL that can only *shorten* the default 5 min;
preview tokens are clamped to `previewSecondsRemaining`.

**Response-shape changes** (all additive except one, detailed in the FE doc):
`GET /client/live-sessions/:id` gained `_id` + `accessGrantedByLiveCourseId` and now
accepts `?liveCourseId=`; an unlinked value → **404** (never a silent fallback to the
Live Now rule). `previewSecondsRemaining` for a **SCHEDULED** session now reports `180`
instead of `0` — the trial is untouched, `0` previously read as "consumed".

**Not changed:** the preview length (180s), the `ws_live_session_preview` write path's
keying, and `hasAccessToAnyLiveCourse`'s signature (still used by 8 other call sites).

**Index:** `uq_live_session_preview_customer_session` UNIQUE on
`ws_live_session_preview (customer_id, live_session_id)`, with a keep-earliest dedupe
step ahead of it (never keep-newest — that would hand back trial time). No
`schema.prisma` edit: nothing reads the index by name and no Prisma query shape depends
on it, so there is no client to regenerate and no drift to introduce.
**Applied to the local dev DB (`websankul_staging_1`) — STILL PENDING on staging/prod.**
Behaviour is correct either way; the index removes the duplicate rows a race would leave.

**Verification.** Exercised against real MySQL on a temporary fixture (shared session
linked to 2 active courses, synthetic customer owning only one; all rows removed
afterwards) — 60/60 assertions across the service layer and the controller +
`/media/resolve` layer. Covered: the core leak (owning `C1` must not unlock `C2`),
expired / unverified / `status=0` subscriptions not granting, `purchaseOptions` scoping,
preview non-resettability across courses and re-opens, 8-way concurrent opens sharing one
window, `preview_ended` then purchasing → `full`, unlinking a course revoking an
in-flight token, and an exhausted `C2` token being refused at resolve while `C1` stays
`full`.

---

## 2026-07-29 — Package-category `packageCount` served stale (cache flush-group gap)

**Files:** `src/middlewares/flushGroups.ts`

**Symptom:** `GET /api/v1/client/package-categories` reported `packageCount: 3` for
"IPS Special" (id 3) when the DB held 3 active live courses **plus** 1 active package
(`ws_package.id = 990096`, `package_category_id = 3`) — expected 4.

**Not a query bug.** `listClientPackageCategories` already sums both sides
(`packageCountFor` over `ws_package` + `liveCourseCountFor` over `ws_live_course`);
calling the service directly returned 4. The endpoint is wrapped in
`cacheRoute({ ttl: 86400, entity: "package-category", scope: "shared" })`, and the
response was a **24-hour-old Redis hit** captured before the package was attached
(verified: key `dev:route:v1:package-category:GET:/api/v1/client/package-categories:shared:*`
held the old body; deleting it made the same request return 4).

**Root cause:** `packageCount` is derived from `ws_package.package_category_id` and
`ws_live_course.package_category_id`, but neither write path invalidated the category
cache — `FLUSH_GROUPS.package` and `FLUSH_GROUPS["live-course"]` did not list
`package-category`. So attaching/detaching a package or live course, or toggling its
status, left the category listing stale for up to 24h.

**Fix — flush groups widened:**
- `package` += `package-category`
- `live-course` += `package-category`, `catalog-package`
  (`catalog-package` tags `GET /client/package-categories/:id/packages`, whose `live`
  tab and `counts` are built from `ws_live_course` — same staleness class.)

**Deploy note:** existing stale keys are not retroactively cleared by the code change.
Sweep `{env}:route:v1:package-category:*` and `{env}:route:v1:catalog-package:*` once
after deploy (or wait out the 24h TTL).

**No DDL, no schema change, no query change.**

---

## 2026-07-29 — `ws_material` / `ws_exam` → utf8mb4 (Gujarati PDF file names)

**DDL:** `docs/migration/schema-changes/2026-07-29_material_exam_utf8mb4.sql` (applied to
local staging clone; **pending on staging/prod**). **Backfill:** none. **Schema:**
`prisma/schema.prisma` unchanged — Prisma does not model collation, so no
`prisma:generate`. **Query-level:** none. **Code:** none. **Response shape:** unchanged.

Creating a material with a Gujarati file name blew up the whole request:

```
POST /api/v1/admin/materials
Invalid `prisma.material.create()` invocation
  → admin-material.repository.ts:105
MysqlError 3988: Conversion from collation utf8mb4_general_ci into
                 latin1_swedish_ci impossible for parameter
```

`ws_material` was still `DEFAULT CHARSET=latin1` at the table level, so
`file`, `file_name`, `direct_link`, `file_mime`, `thumbnail` and `language` were all
`latin1_swedish_ci` (`title`/`description` had been converted earlier). The Prisma
driver binds parameters as utf8mb4, and MySQL refuses the bind outright rather than
truncating — so a non-Latin file name fails the insert, not just the column.

Identical defect to `2026-07-27_book_ebook_utf8mb4.sql`; this closes the tail. Swept
`information_schema` for remaining latin1 file/name/title/link columns —
`ws_exam.solution_pdf` + `solution_pdf_name` were the same landmine (Gujarati
solution-PDF upload) and are converted in the same DDL. What is left is
`ws_course.shareable_link`, `ws_customer.profile_picture`, `ws_tag.tag_name`, all
system-generated / ASCII by construction.

Full-table `CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci` on both — each
has `PRIMARY(id)` and no other index, so the 1→4 bytes-per-char widening carries no
index-length risk; both are small (staging: 231 / 6 rows), ROW_FORMAT=Dynamic.
Collation is `utf8mb4_0900_ai_ci`, this DB's standard (see
`2026-07-16_search_columns_utf8mb4.sql`, `src/utils/searchFilter.ts`) — mixing
collations is what produces 3988 in the first place. `ws_exam.type`
(`enum('daily','subject')`) has ASCII labels, so every stored value survives.

Verified on the local clone: a `ગુજરાતી-સામગ્રી.pdf` insert into
`ws_material.file`/`file_name` now succeeds and round-trips byte-identical.

---

## 2026-07-29 (later 2) — Audit: every client list with an `order` column sorts `order ASC`

**DDL:** none. **Backfill:** none. **Schema:** unchanged. **Query-level:** none — audit
only, no code changed. Recorded so the rule and its verified exceptions are on file.

**Rule (client scope only):** every `/api/v1/client/*` list whose underlying table has an
`order` / `order_by` column must sort by that column ASC. Admin screens are explicitly
out of scope (see the entry below).

Method: extracted all 36 Prisma models carrying an order column (the column name drifts —
`order`, `order_by`, `orderBy`, `ordered`, `orderby`), then scanned every module reachable
from `src/client/**` for `findMany` calls on them, keeping only **paginated** queries
(`skip`/`take` present) — i.e. real listings, not hydration.

Result: **12 candidates, 0 genuine violations in client-only modules.** Each was verified
by reading the call site:

| flagged | verdict |
|---|---|
| `catalog-book:50`, `catalog-ebook:43`, `client-purchase-history:129` | `findByIds` / `booksByIds` **bulk hydration**, not a list — sorting is irrelevant |
| `catalog-exam:50` | already defaults to `[{ order_by: "asc" }, { created_at: "asc" }]`; the `created_at DESC` branch is the **admin** `newestFirst` opt-in |
| `offline-city:39` (`listAll`) | **admin-only** function in a shared module (marked "── admin (Wave 8) ──") |
| `client-exam:160` (`dailyInWindow*`) | daily-quiz calendar — `startAt DESC` **is** the semantic; no curated order |
| `client-material:285` (`getRecentMaterials`) | `/client/materials/recent` — "last N days", recency **is** the feature |
| `referral:42,147` | referral transaction history — recency is correct; `RefferalTransaction.order` is not a curation column |

Confirmed already compliant: `catalog-course` `[{ order: "asc" }, { createdAt: "asc" }]`,
`catalog-package` / `catalog-book` `[{ order_by: "asc" }, { created_at: "asc" }]`,
`catalog-video` `[{ order: "asc" }, { created_at: "asc" }]` (76 such call sites total).

**Open — blocked on a concurrent edit.** Five client-serving lists live in modules another
session is editing right now, so they were not touched. They have an order column and no
order sort; re-check once that work lands:

```
cms/cms-extra.service.ts:292            LiveBannerSlider.orderBy   → (none)
exam-countdown/exam-countdown.service.ts:141  ExamCountdownCategory.order → createdAt desc
package-category/package-category.service.ts:185  PackageCategory.order  → (none)
referral-content/referral-content.service.ts:124  RefferalTerm.orderBy   → (none)
referral-content/referral-content.service.ts:192  RefferalFaq.orderBy    → (none)
```

**Naming hazard worth fixing separately:** the order column has five different names
across `ws_*` tables, so no single grep finds every curated list and a new module can
easily pick the wrong field.

---

## 2026-07-29 (later) — Admin lists go recency-first; `order` create switches to append

> Logged from the working-tree diff of an in-flight change set (34 files, not authored
> in this session) so the changelog isn't left behind the code. Amend freely if the
> author's intent differs from what the diff shows.

**DDL:** none (the utf8mb4 DDL shipped alongside is logged in its own entry above).
**Backfill:** none. **Schema:** unchanged. **Query-level:** default `ORDER BY` replaced
across ~20 admin list repositories + `src/utils/listOrdering.ts` rewritten.

**Generalises the 2026-07-28 "later 6" entry from `/admin/videos` to every admin list.**
Default `orderBy` becomes `[{ created_at: "desc" }, { id: "desc" }]` where it was
`[{ order_by: "asc" }, …]`. Touched: `admin-book`, `admin-course`, `admin-ebook`,
`admin-live-course`, `admin-master`, `admin-material`, `admin-package`,
`admin-testseries`, `admin-video`, `banner-slider`, `cms`, `department`,
`exam-countdown`, `offline-batch`, `offline-city`, `package-category`,
`permission-category`, `referral-content` (+ `admin/{cms,examCountdown,live-course,video}`
validation comments).

**Client/catalog is untouched and still sorts `order ASC`** — verified directly:
`catalog-course` `[{ order: "asc" }, { createdAt: "asc" }]`, `catalog-package` /
`catalog-book` `[{ order_by: "asc" }, { created_at: "asc" }]`, `catalog-video`
`[{ order: "asc" }, { created_at: "asc" }]`. Per the new docblock, true sequences keep
`order ASC` on the admin side too (exam questions; package contents; course
videos/books/materials; live-course folder contents).

**`topSlotOrder` → `nextOrder` (`MIN - 1` → `MAX + 1`).** New rows now append to the
BOTTOM of the client catalog instead of jumping to the top. ⚠ The helper is documented
as "MAX(existing order) + 1", but the repositories feed it `prevOrder` — the `order` of
the **newest row** (`findFirst orderBy created_at desc, id desc`), not a `_max`
aggregate. So the result is "newest row's order + 1", which is only the true maximum
when order and recency agree. The docblock acknowledges the consequence: with the
negative leftovers from the old `MIN - 1` era still in several tables, a new row **can
collide** with an existing order value, and tied rows have no defined relative order in
the client's `order ASC` list. Resolution is manual (type an explicit Order, or
drag-reorder). Repository accessors renamed `minOrder` → `prevOrder`.

**Deliberate consequence (carried over):** manual reordering is invisible on admin list
screens. The `order` column is still written; the client catalog is now its only reader.

**Deploy:** code-only, nothing to run.

**Standing rule clarified 2026-07-29 (client scope only):** any **client** (`/api/v1/client/*`)
list whose table has an `order` / `order_by` column sorts by that column ASC. That rule
does **not** apply to admin screens, so the recency-first default above stands. An audit
of every client list against the rule found no violations in client-only modules — see
the entry below.

---

## 2026-07-29 — Invoice route accepts every purchase-history id form (fixes 404 / 400)

**DDL:** none. **Backfill:** none. **Schema:** unchanged. **Query-level:** new read paths
in `src/libs/core/generate.ts` + prefix dispatch in `client/course/course.controller.ts`
(`getOrderInvoiceHandler`). No response-shape change — same PDF, same EJS template.

`GET /client/courses/orders/:id/invoice` understood only two id forms (`lc_`, `ts_`,
else plain) and resolved each against the wrong table for three of them. The id
vocabulary is **defined by `GET /client/purchase-history/subscriptions`**, whose `_id`
encodes which table the id belongs to (the PK spaces are separate and overlap
numerically). Before/after:

| list `_id` | source | was | now |
|---|---|---|---|
| plain | `ws_package_course_order.id` (`service.ts:111`) | looked up as a **subscription** id → 404 | sub first (back-compat), then **order** |
| `lc_` | `ws_live_course_subscription.id` (`:146`) | ✅ worked | unchanged |
| `ts_` | `ws_test_series_order.id` (`:183`) | looked up as a **subscription** id → 404 | **order** first, then sub |
| `pcs_` | `ws_package_course_subscription.id`, orderless (`:220`) | prefix unknown → **400** "Please select valid package" | strict subscription lookup |
| `tss_` | `ws_test_series_subscription.id`, orderless (`:248`) | prefix unknown → **400** | strict subscription lookup |

Overlapping PK spaces made the plain case worse than a plain miss: on the local clone
sub `526165` belongs to customer `472358` while order `526165` belongs to `472366`, so a
customer's own order id matched a **different customer's** subscription and 404'd on the
ownership check. Prefix matching is longest-first so `tss_` is tested before `ts_`.

New/changed loaders in `generate.ts`:
- `loadCourseReceiptFromSubMysql` (extracted, now returns `null` on miss) — **behaviour
  change:** a sub with `order_id IS NULL` (legacy / offline / manual grant) now renders
  from the subscription alone instead of throwing `Order has not been paid yet.` An order
  that *exists* but isn't `complete` is still blocked. This is what makes `pcs_` work.
- `loadCourseReceiptFromOrderMysql` (new) — `ws_package_course_order` by `id` +
  `customer_id`, then `plan_id` → `ws_package_course_ebook_price` → `ws_course` /
  `ws_package` for name/`duration`/`with_material`; razorpay ids, method and
  `discount_price` off the order.
- `loadTestSeriesReceiptFromOrderMysql` (new) — `ws_test_series_order` by `id` +
  `customer_id`, `plan_id` → `ws_test_series_price.duration_days`, title via
  `test_series_id`. Settled state is **`complete`**, matching the writer
  (`test-series-order.service.ts:95`) and the list filter
  (`client-purchase-history.repository.ts:104`) — *not* `verified`. Gating on status
  alone lets free/manual ₹0 orders print.
- `buildCourseReceiptHtmlBySub` / `buildTestSeriesReceiptHtmlBySub` (new exports) for
  `pcs_` / `tss_` — strict, no cross-space fallback.

Ownership (`customer_id`) is enforced on every path; `Order not found.` (404) and
`Order has not been paid yet.` (404) are unchanged strings.

**Known consequence — amounts can differ by which id is used.** The order path prints
`ws_package_course_order.discount_price` (what was charged); the subscription path
prefers `ws_package_course_subscription.amount`. On the local clone order `526164` → ₹299
while its own sub `600026` → ₹897 (`course_amount` 149 + `material_amount` 150 = 299, so
`amount` is cumulative there). The order path now **matches the purchase-history card**,
which renders `amount: o.amount`. Left as-is deliberately; changing the sub path's amount
preference is a separate decision.

Verified on the local clone (`yarn typecheck` green):

```
pcs_594040 c472366 ✅ Course 1 | 365 days | ₹3799     ts_1  c472366 ✅ ₹699
pcs_41     c472366 ✅ Package 1 | 270 days | ₹699     ts_3  c472366 ❌ not paid (pending)
pcs_267    c472366 ✅ Course સિતારો | ₹2499           ts_4  c472369 ✅ ₹0 free order
526165     c472366 ✅ (was 404)                       tss_1 c472366 ✅ ₹699
526164     c472366 ✅ (was 404)                       lc_13 c472366 ✅ ₹487
600026     c472366 ✅ sub-id path intact              lc_8  c472366 ✅ ₹2589
pcs_594040 c472335 ❌ Order not found. (ownership)    888888888 / ts_999 ❌ 404
```

---

## 2026-07-28 (later 6) — Admin video list: recency becomes the PRIMARY sort

**DDL:** none. **Backfill:** none. **Schema:** unchanged. **Query-level:** primary
`ORDER BY` replaced on the admin video list (`admin-video.repository.ts` → `list`,
new `buildOrderBy`). **Supersedes "later 5" below**, which only flipped the tiebreaker.

`GET /admin/videos` now sorts `created_at DESC, id DESC` whenever `sort_by=order`
(the zod default, and what the admin UI sends). `sort_dir` is ignored for that case by
design — the requirement is "newest always on top", and the UI sends `sort_dir=asc`,
which would invert it. Any other `sort_by` (`name` / `created_at` / `updated_at`) still
sorts by its own column in the requested direction, with `id DESC` as the stable
tiebreaker.

**Deliberate consequence:** manual reordering is now invisible on this screen. The
`order` column is still maintained — top-slot-on-create (`MIN(order) - 1`) and `setOrder`
both keep writing it — and the CLIENT catalog still sorts by it
(`order ASC, created_at ASC`, `catalog-video.repository.ts:22` and
`client-category-video.service.ts:52`), so admin and client now order videos differently
on purpose. Requested explicitly after the "later 5" tiebreaker fix proved insufficient
(a curated row could still outrank a newer one). To revert, return
`[{ order: sortDir }, { id: "desc" }]` from `buildOrderBy` for the `"order"` case.

Verified on the local clone: id 990152 (`order = 3`, newest) is row #1; the whole page is
`created_at` descending; `sort_by=name` still sorts by title.

---

## 2026-07-28 (later 5) — Admin video list: newest-first tiebreaker

**DDL:** none. **Backfill:** none. **Schema:** unchanged. **Query-level:** secondary
`ORDER BY` flipped on the admin video list (`admin-video.repository.ts` → `list`).

`GET /admin/videos` sorted `order ASC, id ASC`. Since almost every row sits at `order = 0`
(6 of the top-5 order values on the staging clone are that single bucket), the tiebreaker
*was* the sort for practical purposes, and ascending id put each newly created video at the
bottom of the list. Now `order ASC, id DESC`.

The **primary** sort is untouched — still the curated `order` column, so manual reordering
and the top-slot-on-create behaviour (`MIN(order) - 1`) remain fully visible. Only the run
of rows that tie on `order` changed direction. `id` is the autoincrement PK, so `id DESC`
is create-order DESC and needs no sort of the non-indexed `created_at`.

Verified on the local clone: newest row (id 990151) is now row #1; the `order = 1..3` rows
still sort below it in their curated positions.

---

## 2026-07-28 (later 4) — FCM push payload: full APNs rich-media field set

**DDL:** none. **Backfill:** none. **Schema:** unchanged. **Query-level:** none — outbound
push payload only (`src/utils/fcm.ts` → `buildMessage`).

iOS was still rendering text-only banners when the app was backgrounded/killed. The APNs
fields added earlier today (`apns.fcm_options.image` + `aps.mutable-content`) were correct
but **had not been deployed** — `src/utils/fcm.ts` is still an uncommitted working-tree
change on `migration`, so staging/prod were running the pre-fix payload. This entry closes
the remaining gaps against the client integration doc so the payload is exhaustive:

| Field | Before | Now |
| --- | --- | --- |
| `notification.image` (top-level `imageUrl`) | absent | set when an image exists |
| `data.image` | absent | set (string) alongside `data.imageUrl` |
| `data.imageUrl` | set | unchanged |
| `android.notification.image` | set | unchanged |
| `apns.fcm_options.image` | set (undeployed) | unchanged |
| `aps.mutable-content` | set (undeployed) | unchanged |
| `apns.headers` | absent | `apns-push-type: alert`, `apns-priority: 10` |

`apns-push-type` is now explicit because a push classified as `background` never wakes the
iOS Notification Service Extension, which silently drops the attachment. All `data` values
remain plain strings — no nested `fcm_options` object is ever sent from here (the
`fcm_options` key the client sees inside `data` on iOS is injected by FCM/APNs itself when
`notification.image` is set, not by this service).

**Deploy:** ship `src/utils/fcm.ts`. No DB work. Image URLs must be public HTTPS and
≲1 MB — the NSE downloads them with no app credentials and a ~30s budget.

---

## 2026-07-28 (later 3) — List ordering sweep: curated manual order becomes the default

**DDL:** none. **Backfill:** none. **Schema:** unchanged. **Query-level:** `ORDER BY`
changed on ~70 list queries across the client catalog surface (plus the admin-side changes
noted separately below), and one new shared helper (`src/utils/catalogOrder.ts`).

> **Superseded snapshot corrected 2026-07-28.** An earlier version of this entry was written
> while the sweep was mid-flight and listed only ~14 files. The client sweep is now complete
> and the file list below is the closed set. The admin-side rows (`admin-course`,
> `admin-video`, `admin-package`, `admin-testseries`, `referral-content` admin list) were
> pre-existing working-tree changes from a prior session, not part of the client sweep —
> they are kept in the table because they share the theme.

### The convention (now written down in code)

`src/utils/catalogOrder.ts` states it explicitly, which makes it the reference rather than
this entry:

> Every **client** list whose table carries an admin-managed display-order column sorts by
> that column **ASC**, then `created_at` **ASC** as the tiebreaker. Tables with a display-
> order column but **no** `created_at` (`ws_video_category_relation`, `ws_department`) use
> `id ASC` instead, since id is monotonic and approximates insertion order.

Explicitly **out of scope** per that file: user-owned/activity data — notifications,
purchase history, cart, wishlist, progress, subscriptions — which stays newest-first.

The column name varies per table (`order_by` / `orderby` / `order` / `ordered` / `orderBy`),
so call sites spell the Prisma `orderBy` inline. The file exports one comparator,
`byOrderThenCreatedAt`, for the few places that sort already-fetched pivot rows in memory
instead of in SQL.

### What changed

The theme: the **admin-curated manual order column** becomes the primary sort, where
several lists previously sorted by recency and ignored it. Admins set these columns
(negatives float to the top) and the ordering was not being honoured.

| File | Before | After |
|---|---|---|
| `admin-course.repository.ts` | default sort col `createdAt` | default sort col `ordered` |
| `admin-video.repository.ts` | default sort col `created_at` | default sort col `order` |
| `admin-package.repository.ts` | `created_at desc` | `order_by asc, created_at desc, id desc` |
| `admin-testseries.service.ts` | `createdAt desc, id desc` | `orderBy asc, createdAt desc, id desc` |
| `referral-content.service.ts` | `createdAt desc, id desc` | `orderBy asc, createdAt desc, id desc` |
**Client catalog layer** (`src/modules/catalog-*`):

| File | Before | After |
|---|---|---|
| `catalog-book.repository.ts` | `order_by asc, created_at desc, id desc` | `order_by asc, created_at asc` |
| `catalog-ebook.repository.ts` | `orderby asc, createdAt desc, id desc` | `orderby asc, createdAt asc` |
| `catalog-package.repository.ts` (×2) | `order_by asc, id desc` | `order_by asc, created_at asc` |
| `catalog-package.detail.sql.ts` (×5 package lists) | `order_by asc, id desc` | `order_by asc, created_at asc` |
| `catalog-package.detail.sql.ts` (×3 pivots) | `order asc` / `order_by asc` | `+ created_at asc` tiebreaker |
| `catalog-video.repository.ts` (videos) | `order asc, id asc` | `order asc, created_at asc` |
| `catalog-video.repository.ts` (categories ×2) | `order_by asc, title asc` | `order_by asc, created_at asc` |
| `catalog-material.repository.ts` | `order_by asc, id asc` | `order_by asc, created_at asc` |
| `catalog-exam.repository.ts` (×3 client reads) | `order_by asc, name asc` / `, id asc` | `order_by asc, created_at asc` |
| `catalog-course.repository.ts` (categories ×2) | `order asc, title asc` | `order asc, createdAt asc` |
| `catalog-course.repository.ts` (courses ×2) | `ordered asc, id desc` | `ordered asc, createdAt asc` |
| `catalog-course.repository.ts` (paginated) | `<field> <dir>, id desc` | `<field> <dir>`, then `createdAt asc` (or `id asc` when the field IS `createdAt`) |
| `course-detail.sql.ts` (videos) | `order asc` | `order asc, created_at asc` |
| `course-detail.sql.ts` (material + exam pivots) | in-memory `(a.order ?? 0) - (b.order ?? 0)` | in-memory `byOrderThenCreatedAt` |

**Client service layer** (`src/modules/client-*`):

| File | Change |
|---|---|
| `client-catalog.service.ts` (×8) | subjects/videos/material+exam pivots/course materials → `+ created_at asc`; the materials list flipped `created_at desc` → `asc` |
| `client-material.service.ts` (×3) | child categories `name asc` → `created_at asc`; both material lists → `order_by asc, created_at asc` |
| `client-category-video.service.ts` | `order asc` → `order asc, created_at asc` |
| `client-testseries.service.ts` (×4) | series `createdAt desc` → `asc`; content categories `name asc` → `createdAt asc`; paper links `id asc` → `createdAt asc` |
| `client-exam.repository.ts` (×3) | sub-categories `name asc` → `created_at asc`; both exam lists `createAt desc` → `asc` |
| `client-trending.service.ts` (×4) | books/ebooks/videos tiebreak `desc` → `asc` |
| `client-free.service.ts` (×7) | free exams `startAt desc` → `createAt asc`; categories/videos/ebooks/courses/packages → `created_at asc`; `videoCategoryRelation` → `order asc, id asc` (no `created_at` on that table); the merged course+package list now uses `byOrderThenCreatedAt` instead of `createdAt desc` |
| `client-dashboard.service.ts` (×3) | banners `+ created_at asc`; **courses `createdAt desc` → `ordered asc, createdAt asc`**; course categories `id asc` → `order asc, createdAt asc` |

**Shared modules reached from client routes:**

| File | Change |
|---|---|
| `package-category.service.ts` (×4) | packages / live courses / category lists → `+ created_at asc` |
| `banner-slider.repository.ts` (×2) | client `findMany` → `+ created_at asc`; `findPage` (shared admin+client) gained `created_at asc` as a stable trailing key |
| `offline-city.repository.ts` | `order asc, name asc` → `order asc, createdAt asc` |
| `offline-batch.repository.ts` | banners `orderBy asc` → `+ createdAt asc` |
| `department.repository.ts` (×2) | departments + contacts → `order asc, id asc` (**no `created_at` on these tables**) |
| `cms-extra.service.ts` (×3) | client social links (list + paged) and client live banners → `+ createdAt asc` |
| `exam-countdown.service.ts` (×2) | client categories `name asc` → `createdAt asc`; client countdowns `examDate asc` → `+ createdAt asc` (no order column — `examDate` is the domain sort, `created_at` only stabilises paging) |
| `exam-countdown.client.ts` (raw SQL) | `ORDER BY <col> ASC, id DESC` → `ORDER BY <col> ASC, created_at ASC` |
| `admin-live-course.repository.ts` (×2) | the **client** course reads (`listClientCourses`, `coursesByIdsActive`) `ordered asc, createdAt desc` → `asc` |
| `client/book/book.controller.ts` | merged trending books+ebooks `createdAt desc` → `byOrderThenCreatedAt` |

In `admin-course` / `admin-video` only the *default* changed — an explicit
`?sortBy=createdAt` still works, and both files gained an explicit `createdAt` branch so
the option stays reachable now that it is no longer the fallback.

### Deliberately NOT changed

- **All admin list endpoints** keep their own ordering (including
  `catalog-exam.repository.ts` `listCategoryPackages`/`listCategoryCourses` and
  `exam-countdown` `listCategoriesAdmin`, which are admin-only despite living in shared files).
- **`/client/search`** still sorts every entity `createdAt desc`. It therefore does **not**
  match catalog order — a known, accepted divergence, explicitly excluded from this sweep.
- **Recency feeds stay newest-first by design:** `/client/recently-added` and
  `getRecentMaterials` (`client-material.service.ts`) — inverting them would defeat the feature.
- **User-owned/activity data** — notifications, purchase history, cart, wishlist, folders,
  ebook downloads, lecture progress, subscriptions, addresses, search history — unchanged.
- **Domain-natural sorts** unchanged: pricing plans `duration asc` / `isDefault desc, price asc`,
  lecture notes `timestampSec asc`, my-subscriptions soonest-expiring-first, testimonials `rating desc`.

### `/client/course` default sort changed

`GET /client/course` previously defaulted to `sortBy=createdAt&sortOrder=desc` (newest
first). It now defaults to the curated `ordered asc, createdAt asc`. **The query params
still work** — `?sortBy=createdAt&sortOrder=desc` restores the old behaviour exactly. This
is the one client endpoint where the change is visible as a *default* rather than only as a
tiebreak.

### One additive DTO field, stripped before it reaches the wire

`fetchTrendingBooksOnly` / `fetchTrendingEbooksOnly` now return `orderBy` on each item so the
combined trending feed can interleave books and ebooks by the shared rule. It is removed at
all three emit sites (`listTrendingBooks`, `listTrendingBooksOnly`, dashboard trending
sections); `listTrendingEbooksOnly` already whitelists via `pickList`. **No response shape
changed.**

### Index note (no DDL shipped)

The old client catalog sorts were mixed-direction (`order_by ASC, created_at DESC`), which
MySQL cannot satisfy from a plain composite index. The new all-ASC form
(`order_by ASC, created_at ASC`) *is* index-satisfiable, so this is a mild planner
improvement, not a regression. None of the catalog tables currently declare a
`(order_col, created_at)` composite index — adding one for the hot paginated lists
(`ws_book`, `ws_ebook`, `ws_package`, `ws_material`, `ws_video`, `ws_test_series`) is a
worthwhile follow-up but is **not** required by this change and no DDL was written for it.

### Two asymmetries, noted so they are not "fixed" by accident

1. **Tiebreak direction differs by surface — deliberate.** Admin lists tiebreak
   `createdAt desc` (newest first within an order bucket); client catalog lists tiebreak
   `created_at asc` (oldest first). Admins want recent work on top; the catalog wants a
   stable shelf. Read the surface before copying either.
2. **Client catalog lists end at `created_at asc` with no final `id`.** This follows the
   stated convention, so it is intentional — but note the consequence: if two rows tie on
   both the order column *and* `created_at`, MySQL ordering is unspecified, which on a
   paginated endpoint can duplicate or skip rows between pages. Checked against the current
   database: `ws_package` (10 rows), `ws_book` (15), `ws_ebook` (506) have **zero**
   `(order, created_at)` ties and **zero** NULL `created_at` — so this is latent, not live.
   It holds by data shape, not by construction; two items created in the same second with
   the same order value would surface it. `catalog-course` already guards against the
   equivalent case by appending `id asc`.

### Response-shape impact

None — only row order changes. No field added, removed, or retyped. Client-visible effect
is that catalog lists and the admin course / video / package / test-series /
referral-content lists now return in the admin's configured order.

`yarn typecheck` green.

---
## 2026-07-28 (later 2) — Notification feed exposes tap-routing fields (read projection only)

**DDL:** none. **Backfill:** none. **DB queries:** unchanged — `listNotifications` still
issues the same `findMany` + two `count`s. This is a **response-projection** change.

### Why

`GET /client/notifications` returned only display fields, so tapping a row in the in-app
Notification screen could only open the detail modal — while tapping the *push* for the
same event routed correctly.

The routing was never missing from the database. `ws_notification.deep_link` + `.data` have
carried it since the deep-link work, and all four write paths persist it:
`dispatchAudience` (targeted, per-recipient rows), `createImmediateLog` (broadcast),
`createScheduled`, and `notifyBuyersOnStart` (live-class-started, which also stores
`sessionId`/`streamId`/`liveCourseId`). The loss was at the very last step —
`NOTIFICATION_CLIENT_FIELDS` in `client/notification/notification.controller.ts` is a
`pickList` keep-list, and it dropped `deepLink`/`data` as "metadata".

### What changed

- **`utils/notificationTarget.ts`** — added `extractNotificationRouting(row)`, the exact
  inverse of the existing `buildNotificationRouting(target)`. Both directions deliberately
  live in the same file: the FE contract requires "list and push must match for the same
  event", and that only holds if the two projections are defined together.
- **`modules/client-notification/client-notification.service.ts`** — the feed DTO spreads
  the extracted routing (`viewType`, `deepLink`, `clickAction`, `screen`, `params`,
  `liveCourseId`, `sessionId`, `streamId`), each key present only when the row carries it.
- **`client/notification/notification.controller.ts`** — keep-list extended with those
  eight keys, plus `dropEmptyRouting` to strip nullish ones. The DTO sets
  `deepLink: … ?? null` unconditionally, so without this an unrouted announcement would
  ship `"deepLink": null`; the app's router is presence-based and the FE contract says
  "omit a field when unused; do not invent placeholders".

### Type mapping (the non-obvious part)

FCM forces every `data` value to be a string, so the stored blob holds `params` as a JSON
string and ids as numeric strings. The list API has no such constraint and returns real
types: `params` decoded to an **object**, and `liveCourseId`/`sessionId` to **numbers** —
but **only when lossless** (`/^\d+$/` and `Number.isSafeInteger`). `streamId` is a StreamOS
token, not a SQL id, so a non-numeric value stays a string. Never coerce it blindly.

The raw `data` blob stays **out** of the client feed: it duplicates the same information in
stringified form, and exposing both would let the app read whichever it found first and
disagree with the push.

### Response-shape impact

Additive only. Envelope (`data` array + `unreadCount` + `pagination`) unchanged — the
spec's example showed `data.notifications`/`total`/`totalPages`, which was **not** adopted
because the shipped app already parses the current shape. All existing display fields keep
their values and their `null`s; `customerId`/`readAt`/`broadcast`/`status`/`updatedAt`
remain hidden. `POST /notifications/:id/read` returns the full DTO and now also carries the
flattened routing (it previously already exposed `deepLink`/`data`).

Old notifications sent before the admin target picker existed have `deep_link = NULL` and
an empty `data`; they correctly return zero routing keys and keep opening the detail modal.
No backfill is possible or needed — they never had a destination.

### Verification

New permanent suite `docs/migration/api-tests/notification-routing/client.api.test.ts` —
**13/13** against local MySQL. Seeds one row per mode **through `buildNotificationRouting`
itself**, so list/push parity is enforced by construction rather than by asserting
hand-written literals twice. Covers Modes A–D, live-now id typing (numeric SQL ids vs
string StreamOS token), the zero-routing-keys case for a plain announcement, `data` staying
withheld, and the display fields + envelope being untouched. Suite added because the
original defect was a one-line edit to a field allow-list: no type error, no failing build,
invisible in review. `yarn typecheck` green.

---

## 2026-07-28 (later) — Prisma schema-drift diagnostics (no query/schema change)

**DDL:** none. **Backfill:** none. **DB queries:** unchanged — this is observability only.

### Why

`GET /client/downloads/encryption-key` returned 500 for every caller for ~8 minutes. The
database was healthy and the column existed; the running process held a Prisma client
generated **before** `Customer.downloadKeyHex` was added. `prisma generate` writes into
`node_modules`, which does not trip `tsx watch`, so the dev server never picked it up. The
only evidence was a `PrismaClientValidationError` inside a stack trace behind a generic
`"Something went wrong. Please try again later."`, and the frontend team filed a bug report
guessing at a missing table.

Two different faults produce that same opaque 500 and they have **different fixes**:

| Kind | Meaning | Fix |
|---|---|---|
| `CLIENT_STALE` | generated client is behind `prisma/schema.prisma` | `yarn prisma:generate` **+ restart** |
| `DDL_MISSING` | schema/client know a table/column the DATABASE lacks | apply the pending DDL in `docs/migration/schema-changes/` |

### What was added

- **`src/utils/prismaSchemaDrift.ts`** — `detectPrismaSchemaDrift(err)` classifies an error
  as one of the two kinds (or `null`), naming the exact subject
  (`Customer.downloadKeyHex`, `ws_customer_download_key`, …) and the command that fixes it.
  Covers `PrismaClientValidationError` "Unknown field/arg" (which carries **no** error code —
  the field name only exists in the message), undefined model accessors
  (`Cannot read properties of undefined`), Prisma `P2021`/`P2022`, and the raw-SQL
  equivalents MySQL `1054` / `1146` that `$queryRaw` produces.
- **A `$use` middleware in `config/prisma.ts`**, installed last so it wraps the others.
  This is why the fix lives at the Prisma layer rather than in one controller: it covers
  **every** query in the app, including the many controllers that catch locally and log
  their own generic message.
- **A boot guard** in `connectPrisma()` — warns when `prisma/schema.prisma` is newer than
  the generated client, catching the exact condition above at startup, when it is one
  command to fix, instead of per-request in a stack trace. Warn-only and
  non-production-only: a fresh `npm ci` can legitimately reorder those mtimes, and this
  must never block a deploy.

### Explicitly NOT changed

The drift middleware **rethrows the error untouched** — detection only, no control-flow
change. Requests that failed still fail with the same status. That is deliberate:
`/client/downloads/encryption-key` documents 404 as "no key stored, mint one", so softening
a drift failure into anything non-5xx would tell the app to mint a **duplicate** key and
orphan every file the user had already downloaded.

Logging is deduped to one line per `kind:subject` per 5 minutes — drift is a deploy-state
fault, not a per-request one, and a hot endpoint would otherwise bury every other log line.

### Verification

All four fault shapes replayed against live MySQL/Prisma and correctly classified
(`CLIENT_STALE` × 2, `DDL_MISSING` × 2), plus three negative controls — `P2025` not-found,
a plain `Error`, and a `P2002` unique-constraint violation — confirmed **not** flagged, so
the loud diagnostic stays signal. Boot guard verified in both directions: it fires when the
schema is newer, and stays silent after `prisma:generate`. `download-key` suite still
**20/20**; `yarn typecheck` green.

---

## 2026-07-28 — `ws_customer.download_key_hex` (per-user offline-download AES key)

**DDL:** `docs/migration/schema-changes/2026-07-28_customer_download_key_column.sql`
(**must be applied before deploy** — the endpoints 500 without it). **Backfill:** none —
the column starts NULL for everyone by design; every customer's first `GET` legitimately
404s and the app then PUTs its self-generated key. **Prisma:** one hand-added field on
`Customer`; `yarn prisma:generate` required.

> **Superseded within the same day:** the first iteration of this work created a separate
> `ws_customer_download_key` table. It was never deployed beyond local dev and has been
> replaced by a column on `ws_customer`. The DDL file drops the table if present. Reason:
> per-customer secrets already live on `ws_customer` (`password`, `otp`, `device`), and
> "one key per account" is exactly what the customer primary key already guarantees — a
> side table added a join and a second write path to re-enforce an invariant we get free.

### Why

The mobile app encrypts downloaded videos/PDFs on device (`.wsenc` = magic `WSENC001` +
16-byte IV + AES-256-CTR). It mints one 32-byte key **per user, once**, and needs the
server to hold it so the same key survives logout / reinstall / local-cache expiry. The
server is **pure key custody** — it never decrypts and never needs to parse the container.

### Schema

```sql
ALTER TABLE `ws_customer`
  ADD COLUMN `download_key_hex` VARCHAR(64) NULL DEFAULT NULL AFTER `device`;
```

`NULL` = this user has never stored a key → the API's documented 404 state.

### New queries (all keyed on the customer PK — nothing here can cross accounts)

| Repository method | Query |
|---|---|
| `findByCustomer` | `SELECT download_key_hex WHERE id = ? AND is_account_deleted = 0` |
| `setKey` | `UPDATE … SET download_key_hex = ?, updated_at = ? WHERE id = ? AND is_account_deleted = 0` |
| `clearKey` | `UPDATE … SET download_key_hex = NULL WHERE id = ?` |

Reads use an **explicit `select`** of the single column. Most customer reads in this
codebase pull the whole row; this module has no reason to hold `password` / `otp` in
memory to answer with 64 hex characters. `setKey`/`clearKey` use `updateMany` so a
missing/soft-deleted customer returns `count: 0` instead of throwing P2025 — the caller
turns that into a **401**, not a 500.

### Query-level semantics worth knowing

- **`PUT` is a true no-op when unchanged.** The service reads first and compares
  case-insensitively; an identical key issues **no UPDATE at all**. This matters more on
  a column than it would on a side table: the key shares `ws_customer.updated_at` with
  the rest of the profile, so a churning re-PUT (the app retries after a failed sync)
  would otherwise make the customer row look edited on every app launch.
- **The stored value is byte-for-byte what the client submitted** — no case
  normalization — so a later `GET` returns exactly what was PUT.
- **404 is a state, not an error.** It is the app's trigger to generate its
  one-and-only key, so a DB failure surfaces as **500** and never collapses into 404;
  otherwise the app would mint a second key and orphan every already-downloaded file.
  A vanished/soft-deleted account returns **401**, not 404, for the same reason.

### Changed query: account soft-delete now clears the key

`modules/customer-profile/customer-profile.repository.ts` → `softDelete` now also sets
`download_key_hex = NULL` in the same `UPDATE` (no extra statement). The row survives the
soft delete, so key material would otherwise sit there forever — and nothing can
legitimately ask for it back, since a soft-deleted customer can never authenticate again
and a re-signup on the same phone lands on a **new** `ws_customer` id.

### API (both require Bearer + `requireRole("customer")`)

| Method | Path | Result |
|---|---|---|
| `GET` | `/api/v1/client/downloads/encryption-key` | `200 {data:{key}}` · `404 "Download encryption key not found"` · `401` |
| `PUT` | `/api/v1/client/downloads/encryption-key` | `200 {data:{key}}` · `400 "Invalid encryption key"` · `401` |

Validation is parsed in the controller (not the shared `validate` middleware) so the
FE-specified **400** contract holds — the shared middleware answers 422 with a field map,
which this client does not understand. The body schema is `.strict()`, so a `userId` in
the payload is rejected outright rather than merely ignored; identity comes from the token.

Rate limiting is the existing per-user `clientLimiter` mounted on `/api/v1/client`. The
routes are deliberately **not** wrapped in `cacheRoute` — a shared-scope cache entry over
a per-user secret is exactly the bug that would hand one user another's key. Both
responses set `Cache-Control: no-store, private`.

### Secret handling

`download_key_hex` is plaintext hex and belongs to the same handling class as `password` /
`otp` on the same table:

- `utils/scrub.ts` gained an **exact-match** tier (`SENSITIVE_EXACT_KEYS = ["key"]`) so the
  request logger redacts the PUT body — a substring entry would have redacted every
  `objectKey`/`subjectKey`/`keyword` in the app. Verified: the key appears **0 times** in
  `logs/` after a full test run. Collateral: two admin bodies also use a plain `key` field
  (cms enum, offline search term) and now log as `[REDACTED]`.
- The module's transformer takes the **key string**, not a `Customer` row, so no careless
  spread can return the account with it.
- Customer transformers already pick fields explicitly (that is how `password`/`otp` stay
  out of responses today), and a regression test asserts the key never appears in
  `GET /client/profile`.
- **If `ws_customer` is granted to a reporting/BI user, exclude this column.**

### Verification

`docs/migration/api-tests/download-key/client.api.test.ts` — **20/20 passed** against local
MySQL (`websankul_staging_1`): per-user isolation (customer B 404s while A holds a key, and
B's write does not clobber A's), key stability across repeated GETs, `updated_at`
idempotency, the `no-store` header, and the profile-leak check. `yarn typecheck` green.

---
## 2026-07-27 (later 4) — admin ebook DTO exposes PDF-upload status; `book_url` wipe diagnosed

**DDL:** none. **Backfill:** none (one pending data repair, see below). **DB queries:**
unchanged — the four columns were already selected by the existing `findMany`/`findFirst`.

### A. Admin DTO now returns the upload-status columns (additive)

`modules/admin-ebook/admin-ebook.service.ts` → `toEbookDto` previously dropped
`book_upload_status` / `book_upload_progress` / `demo_upload_status` /
`demo_upload_progress`, with a comment calling them "Mongo-only". **That comment was
stale** — they are real `ws_ebook` columns and the BullMQ pipeline has always written
them. `pdfUpload.controller.ts` even persists `queued` on enqueue with the explicit
intent "so the admin list reflects it immediately (and after a refresh), not just over
the per-session socket" — that intent was unreachable through the API.

Now exposed on `GET /admin/ebooks` + `GET /admin/ebooks/:id`:

- `bookUploadStatus` / `demoUploadStatus` — `queued|in_progress|completed|failed|null`
- `bookUploadProgress` / `demoUploadProgress` — int `0..100`

Additive only; no existing field changed. This is the refresh-safe way to watch an
upload — `GET /admin/ebooks/pdf-jobs/:batchId` requires a `batchId` that is only
returned once, at upload time, and there is **no lookup of jobs by ebookId**.

⚠ `bookUploadStatus === "completed"` does **not** imply `bookUrl` is set — see below.

### B. Root cause of ebook 550's empty `book_url` (supersedes "never uploaded")

The 2026-07-27 (later 3) entry concluded the PDF was never attached to ebook 550. The
job table proves otherwise — **it was uploaded and then cleared**:

```
ws_pdf_upload_job #9  ebook=550 target=bookUrl "high-court-of.pdf"
  status=completed progress=100  finished 15:04:10 IST
  file_url=…/admin/ebooks/1785144849073-high-court-of.pdf   ← HEAD: EXISTS, 8061113 bytes, application/pdf
ws_ebook 550: book_url='' book_file_name='high-court-of.pdf'
  book_upload_status='completed' updated_at=15:04:13 IST     ← 3s AFTER the job finished
```

**Mechanism:** `admin/ebook/ebook.validation.ts` preprocesses `bookUrl: "" → null`, then
`admin-ebook.service.ts` `updateEbook` does `if (d.bookUrl !== undefined) data.bookUrl =
d.bookUrl ?? ""`. Since `null !== undefined`, an empty form field writes `''` — an
implicit wipe. `updateEbook` never writes `bookFileName`, which is exactly why the
filename survived while the URL did not.

`ebook.controller.ts` treats `bookUrl === ""` as a deliberate "remove the PDF" (it also
blanks `bookFileName`), so the Edit-Ebook form's empty file input is indistinguishable
from a delete. Because the async pipeline exists FOR large PDFs, that input is empty by
design after an async upload — so **the next save after any async PDF upload wipes the
URL**. Compare the guard two lines below at `examCountdownIds` ("an update that omits
countdowns must not wipe the stored ids"); `bookUrl`/`demoUrl` never got it.

### Pending — NOT yet applied (both need sign-off)

1. **Data repair for ebook 550** — object verified present, so restoring the pointer is
   sufficient:
   ```sql
   UPDATE ws_ebook
      SET book_url = 'https://websankul-staging.blr1.digitaloceanspaces.com/admin/ebooks/1785144849073-high-court-of.pdf'
    WHERE id = 550 AND book_url = '';
   ```
2. **Stop the implicit wipe** — treat empty/absent `bookUrl`/`demoUrl` as *no change* and
   add an explicit `removeBookPdf` / `removeDemoPdf` flag for intentional removal. This
   is an admin API contract change (admin FE must be told). Related: the controller sets
   `bookFileName = ""` on clear but `updateEbook` never writes it, so a genuine clear
   leaves a stale filename — fold into the same change.

**Note for the earlier `hasBookFile` entry:** `hasBookFile` correctly reported `false`
for 550 — the column really was empty. The flag was right; the *reason* recorded in that
entry ("never uploaded") was wrong.

---

## 2026-07-27 (later 3) — ebook DTO: new `hasBookFile` flag (additive; no query change)

**DDL:** none. **Backfill:** none. **DB queries:** unchanged — reads the existing
`ws_ebook.book_url` already selected by `repo.findActiveById` / `repo.listActive`.

**Context — investigated "bookMediaToken is null for purchased ebooks" (ebook 550).**
**Not a code bug.** `catalog-ebook.transformer.ts` mints the book token on
`cust != null && entitled && bookUrl`. `entitled` cannot disagree with the response's
`isPurchased` — `catalog-ebook.service.ts` derives BOTH from the same `endAt` (lines 72
and 84). The failing conjunct was `bookUrl`: ebook 550 has `book_url = ''` and
`book_file_name = NULL` — the full PDF was never uploaded (its demo was, which is why
`demoMediaToken` worked). Staging scope: 3 of 507 active ebooks (ids 550, 49, 48 — all
"EBook N" test rows, 1 live sub each). Resolution for those is a content upload via
`POST /admin/ebooks/:id/pdf`, not a code change.

Note `ws_ebook.book_url` is **NOT NULL**, so "no PDF" is stored as `''` (admin create
writes `d.bookUrl ?? ''`) — always test it as falsy/`<> ''`, never `IS NULL`.

**Change made:** `bookMediaToken: null` was ambiguous — "not purchased" and "no PDF
uploaded" were indistinguishable, so the app showed a paying customer "not available",
which reads as a broken order. Added to `EbookDto`:

- `hasBookFile: boolean` — `!!row.bookUrl`. Describes the EBOOK, not the caller's
  entitlement, so it is identical for every viewer (safe for anonymous responses: it
  leaks no purchase state and no URL).

Client rule: `isPurchased && !hasBookFile` → "PDF not uploaded yet", not "not available".

**Additive only** — no existing field changed. Both client controllers use `omit`
(denylist) not `pick`, so it flows through `GET /client/ebooks` and
`GET /client/ebooks/:id` with no controller edit. Old clients ignore it.

**Verified** against staging via the real service (not a mock):

| case | isPurchased | hasBookFile | bookMediaToken |
|---|---|---|---|
| 550 as its live subscriber (no PDF) | `true` | `false` | `null` ← reported bug, now explained |
| 550 anonymous | `false` | `false` | `null` |
| 45 as its live subscriber (has PDF) | `true` | `true` | JWT present ← control |

⚠ **Mobile dev must be told** `hasBookFile` exists, or this ticket gets re-filed —
the doc's acceptance criterion "non-null `bookMediaToken` when `isPurchased`" is
unsatisfiable while no PDF is attached.

---

## 2026-07-27 (later 2) — `ws_customer_address` soft-delete predicate applied to all reads

**DDL:** none. **Backfill:** none (see caveat below). **DB queries:** filter contract changed
on 6 reads. Semantics confirmed: address deletion **is** soft-delete (`status = false`) — the
`status` column, `listByCustomer`, and the restore-via-update path all assume it. Kept as-is;
`softDeleteOwned` was NOT converted to a hard `deleteMany`, because historical order/receipt
reads still resolve `customer_shipping_id` → `ws_customer_address` and would lose the address.

**Bug:** admin customer-detail read a different module than the delete wrote, and that module
had no `status` predicate — so deleted addresses reappeared on reload with an unchanged tab count.

Now filtering `status: true`:

- `admin-customer/admin-customer-details.repository.ts` — `addresses`, `countAddresses`,
  `pageAddresses`. Count + page changed **together**; splitting them drifts the pagination envelope.
- `client-cart/client-cart.repository.ts` → `findAddress` — checkout delivery-address gate.
- `promo-code/promo-code.service.ts` → `addressBelongsToCustomerSql` — course/package checkout gate.
- `customer-address/customer-address.repository.ts` → **new** `findActiveOwned`; adopted by
  `client/payment/live-course-payment.controller.ts` (live-course checkout gate). `findOwned` is
  intentionally left unfiltered — `updateOwned` can set `status` back to true (restore) and
  `updateAddress` reads the row back through `findOwned`, so it must still see deleted rows.
- `client/course/course.service.ts` — address-book find-or-create. A soft-deleted row used to
  match, so create was skipped and a re-entered address never returned to the customer's list.

Deliberately **unchanged**: `client-purchase-history.repository.ts` → `customerAddressById`.
That is historical order/tracking/receipt data and must resolve regardless of `status`, or a
delivered order loses its shipping address.

**Also fixed:** `softDeleteOwned` now clears `isDefault` alongside `status`. Deleting the default
address previously left `is_default = 1` on a hidden row — the customer had a default that no
list could display and no other address could take over from.

⚠ **Pre-existing data:** rows soft-deleted before this change may still carry `is_default = 1`.
Harmless (they are now filtered out of every list), but if a "no default address" report shows up,
`UPDATE ws_customer_address SET is_default = 0 WHERE status = 0 AND is_default = 1;` clears it.

**QA:** admin → customer detail → Addresses: delete → row disappears, count decrements, pagination
consistent across pages. Checkout with a deleted address id → 400. Existing orders still show their
delivery address. Client update with `status: true` on a deleted address still restores it.

---

## 2026-07-27 — "Newest on top" ordering: top-slot on create + live-course reorder

**DDL:** none. **Backfill:** none. **List sorts:** deliberately UNCHANGED — see below.
**New endpoint:** `POST /admin/live-courses/reorder`.

Model (agreed with FE): lists keep sorting by their manual order column ASC; a newly created
row is assigned the **top slot** = `MIN(existing order) - 1`, scoped to the list it joins. One
cheap `_min` aggregate per create, no mass update of siblings, negative values sort fine (all four
columns verified plain signed `int`). Sorting lists by `created_at DESC` instead would make
drag-and-drop invisible, so **no list sort was touched.**

Shared helper: `src/utils/listOrdering.ts` → `topSlotOrder(currentMin)`.

| Endpoint | Column | Min scope | New repo query |
|---|---|---|---|
| `POST /admin/videos` | `ws_video.order` | **global** — one list screen with an optional category filter; a global min is top of both filtered and unfiltered views | `adminVideoRepository.minOrder` |
| `POST /admin/cms/banners` | `ws_banner_slider.order_by` | **per `key`** — Packages/Courses/Book/EBook/Explore are independently ordered lists | `bannerSliderRepository.minOrderBy(key)` |
| `POST /admin/cms/live-banners` | `ws_live_banner_slider.order_by` | global (single list) | inline `_min` aggregate |
| `POST /admin/live-courses` | `ws_live_course.ordered` | global | `adminLiveCourseRepository.minOrdered` |

**⚠ Contract change the FE must know:** the order field is now **optional and no longer defaults
to 0** on create — omitting it is what triggers the top slot. An explicitly sent value is still
honoured as-is, so a client that keeps sending `order: 0` will keep landing at the bottom.
Affected: `video.validation.ts` baseShape `order` (dropped `.default(0)`), `cms.validation.ts`
`bannerBaseSchema.orderBy` + `liveBannerCreateSchema.orderBy` (dropped `.default(0)`),
`live-course.validation.ts` `ordered` (was **required**, now optional — a pure relaxation).

**New: `POST /admin/live-courses/reorder`** — mirrors the banners contract.
Body `{ orders: [{ id: "12", ordered: 0 }, ...] }`; returns `{ count }`; **400** when no id in the
batch parses. `adminLiveCourseRepository.reorder` writes the whole batch in ONE
`prisma.$transaction`, so a 20-row drag can't half-apply (the previous workaround would have been
20 non-transactional `PUT /:id` calls). Route sits **above** `/:id` so "reorder" is never parsed as
an id, carries `autoFlushGroup("live-course")`, and RBAC gets
`R("POST", "/live-courses/reorder", "live-courses.edit")` declared **before** `crud()` (first match
wins).

**Verified** against the local clone: video `min 0 → new order -1`, sorts first; banner
`min(key=course) 3 → new 2`, sorts first in its own list with the `ebook` list untouched;
live-banner `min 0 → -1`; live-course `min 0 → -1`, sorts first under
`[{ordered: asc},{createdAt: desc}]`; reorder returns `count=1` and writes, all-invalid ids return
`0`, and a batch containing a nonexistent id **rolls the whole transaction back** (7→7).

**Not done (reported, out of scope of the ask):** `GET /admin/master/video-categories` still
ignores `sortBy`/`sortOrder` (reads only `search`/`limit`), and `admin-master.repository.ts` `vcList`
still does an unbounded `findMany` over every video category and filters in memory.

---

## 2026-07-27 — `ws_book`/`ws_ebook` → utf8mb4 + PDF file-name clearing

**DDL:** `docs/migration/schema-changes/2026-07-27_book_ebook_utf8mb4.sql` — **applied to the
local staging clone 2026-07-27; PENDING on staging and production.**
**Backfill/cleanup:** `scripts/cleanup-orphan-pdf-file-names.ts` (dry-run by default,
`--apply` to write) — **pending everywhere.** **API contract:** unchanged.

### 1. Gujarati/Hindi PDF file names were rejected

Two independent causes, both needed fixing:

**(a) Charset.** `ws_book` and `ws_ebook` were `latin1_swedish_ci` at the **table** level. With
`STRICT_TRANS_TABLES`, writing Indic text throws (`ERROR 1366: Incorrect string value`) rather
than truncating. Converted both tables whole — cleaner than column-by-column and it fixes the
default for future columns. 13 latin1/utf8mb3 columns migrated, including `demo_url` / `book_url`
(the async pipeline derives the Spaces key from the file name, so a non-ASCII name produced a
non-ASCII URL hitting the same wall).

- Collation used is **`utf8mb4_0900_ai_ci`, not `utf8mb4_unicode_ci` as requested** — 0900_ai_ci
  is this DB's standard (see `2026-07-16_search_columns_utf8mb4.sql`, `utils/searchFilter.ts`).
  Mixed collations make MySQL throw error 3988 on cross-column comparisons.
- Verified safe: neither table has any index beyond `PRIMARY(id)`, so the 1→4 bytes-per-char
  widening carries no index-length risk. `ROW_FORMAT=Dynamic`.
- **`ws_book` has no `book_file_name` / `book_url`** — Book has only a demo PDF slot. The report
  listed those columns; they do not exist.

**(b) multer decode.** multer 2.2.0 defaults `defParamCharset` to `'latin1'`
(`node_modules/multer/index.js:22`), so `file.originalname` was already mojibake before any DB
write. Added `defParamCharset: "utf8"` to all five instances — `uploadS3`, `uploadS3Mixed`,
`uploadS3Audio`, `uploadQuestionImages` (via a shared `MULTER_UTF8` in `middlewares/upload.ts`)
and `uploadSinglePdfToDisk` (`admin/pdfUpload/pdfUpload.multer.ts`).

**(c) S3 key.** `pdfUpload.scheduler.ts` put the raw file name into the object key and
concatenated the public URL without encoding. The key is now ASCII-folded with the same rule as
`utils/presignUpload.ts`'s `sanitizeName`; the pretty original name is still stored verbatim in
`*_file_name` for display. No percent-encoding needed since the key can no longer be non-ASCII.

### 2. Removing an Ebook PDF left the file name behind

`admin-ebook.service.ts` `updateEbook` set `bookDemoUrl`/`bookUrl` but never wrote
`demoFileName`/`bookFileName` — those columns were only ever written by the async upload
pipeline. Now clears the name whenever the matching URL is cleared, treating `null` and `""`
identically, mirroring `admin-book.service.ts:216`. `ebook.controller.ts` previously only cleared
on `""`; the admin UI sends JSON `null` (no File → not multipart), so both are now handled.
`createEbook` also silently dropped the name the controller had lifted off the multipart part —
it now persists it, and refuses to store a name for an empty slot.

### 2b. …and left `*_upload_status` / `*_upload_progress` stale

Same trigger, one layer deeper: a cleared slot kept `book_upload_status = "completed"`,
`book_upload_progress = 100`, so any consumer trusting the status believed a PDF was attached.
This was the case merely *documented* in the `toEbookDto` comment ("a completed status does NOT
guarantee bookUrl is still set"); the comment now states the opposite invariant because the code
enforces it.

`updateEbook` now resets the **whole slot in one write** when a URL is cleared —
url + `*FileName` + `*UploadStatus` (→ null) + `*UploadProgress` (→ 0) — for both `demoUrl` and
`bookUrl`, on `null` and `""` alike. `ws_book` needs no equivalent: it has no upload-status
columns (its demo PDF doesn't go through the async pipeline).

`scripts/cleanup-orphan-pdf-file-names.ts` extended to match: a slot is now "stale" if the URL is
empty and **any** companion column still claims a file (leftover name, non-null status, or
non-zero progress), and the reset clears all three. Still idempotent; never touches a slot with a
real file.

**⚠ Route-cache gotcha (cost an hour of confusion — read before running any data script):**
`GET /admin/ebooks` and `/admin/ebooks/:id` are cached for **24h**
(`cacheRoute({ ttl: 86400, entity: "ebook" })`). API writes clear that via
`autoFlushGroup("ebook")`, but a **direct-SQL script bypasses the API and therefore the
flush** — the admin list kept serving the orphan `book_file_name` for ~23.5h after the rows
were already fixed. `cleanup-orphan-pdf-file-names.ts` now calls
`flushEntity("ebook", "book")` itself after a successful `--apply`. **Any future out-of-band
data script must sweep the entities it touches.**

**Verified** on the local clone: 0 non-utf8mb4 columns remain on either table; Gujarati
(`ગુજરાતી-પુસ્તક.pdf`) and Hindi (`हिंदी-पुस्तक.pdf`) names round-trip byte-identical through a
Prisma-bound write+read; `updateEbook({demoUrl: null, bookUrl: ""})` nulls both name columns. The
cleanup script found 1 pre-existing orphan (ebook 49, `high-court-of.pdf`).

---

## 2026-07-27 — Quiz submit path: 4 indexes + `createMany` + SQL-side rank

**DDL:** `docs/migration/schema-changes/2026-07-27_exam_submit_indexes.sql` — **applied to
the local staging clone 2026-07-27; PENDING on staging and production.** **Backfill:** none.
**Response shapes:** unchanged (`rank` string computed identically).

`POST /client/quizzes/:id/attempts/:attemptId/submit` was intermittently exceeding the
gateway timeout (reported on exam 11779, attempt 2722063). Cause: **three full table scans
per request plus one INSERT round-trip per unanswered question**, all growing with table
size / question count.

**Indexes added (pure additions, no column or data change):**

| Table | Index | Fixes |
|---|---|---|
| `ws_exam_result_detail` | `idx_exam_result_detail_attempt_question (qresult_detail_qresult_id, qresult_detail_question_id)` | `detailsForResult` **and** `upsertAttemptDetail`'s probe — the table had ONLY a PRIMARY key, so every saved answer during a quiz also scanned it |
| `ws_exam_question` | `idx_exam_question_exam_status (exam_id, status)` | `questionIdsForExam` scanned the whole question bank |
| `ws_exam_result` | `idx_exam_result_exam_status (qresult_qtest_id, qresult_status, qresult_customer_id)` | rank counters. The pre-existing `idx_exam_result_cust_exam_status` leads with `qresult_customer_id` and so **cannot** serve an exam-only filter |
| `ws_exam_result_detail_analytics` | `idx_exam_result_analytics_user (userId)` | per-submit analytics upsert scanned a one-row-per-customer table |

**Query changes:**

1. `finalizeAttempt` — serial `examResultDetail.create()` loop → one `createMany`. A 100-question
   submit with nothing answered went from 100 sequential inserts (write txn held open) to 1.
2. `bestScoresForExam` **removed**, replaced by `myBestScoreForExam` + `rankForExam`. The old
   query returned one row **per candidate** to Node and ranked in JS — tens of thousands of rows
   over the wire per submit on a popular quiz. Now two `COUNT` queries. Ties still share a rank
   (`#strictly-better + 1`), so the `rank` string is byte-identical. Call sites updated:
   `saveAnswers`, `submitAttempt`, `getAttemptsAggregate`.
3. `recomputeAnalytics` — added `select: { id: true }` to the existence probe.

**Verified** by `EXPLAIN` against the local clone: all 7 affected queries report `type=ref` on
the intended index (4 of them `Using index`); no `type=ALL` remains on a base table.

**⚠ Deploy note:** `ws_exam_result_detail` is the largest table here. MySQL 8 builds these
indexes ONLINE, but check `TABLE_ROWS` first and run off-peak (or via
`pt-online-schema-change`) if it is multi-million-row. `recomputeAnalytics` is still inline on
the request — moving it to BullMQ is the remaining optional win, not needed for the timeout.

---

## 2026-07-27 (later) — Push image restored for iOS, now per-platform + flat `data.imageUrl`

**DDL:** none. **Backfill:** none. **DB queries:** unchanged — `src/utils/fcm.ts` payload
shape only. Supersedes the entry directly below (which removed the iOS image entirely).

Requirement changed: iOS must ALSO receive the image, mirroring Android. `buildMessage()` now:

- **android:** `android.notification.imageUrl` (unchanged).
- **apns:** `apns.fcmOptions.imageUrl` + `aps.mutableContent = true` — both set only when an
  image is present. `mutableContent` is what allows the iOS Notification Service Extension
  to download and attach the image to the banner.
- **data:** new flat `imageUrl` key on BOTH platforms, so the app has one field to read.

**Client-side caveat (not fixable server-side):** iOS never exposes the image on the SDK's
`notification` object — that object is built from `aps.alert`, which carries only
title/body/subtitle. The URL arrives under `data.imageUrl` (and `data.fcm_options.image`).
Rendering it in the tray requires a Notification Service Extension in the iOS app; without
one the payload still arrives, the banner is just text-only.

The top-level `notification.imageUrl` shortcut stays removed — the image is set explicitly
per platform instead.

---

## 2026-07-27 — Push image dropped from the top-level FCM notification (iOS `fcm_options` fix)

**DDL:** none. **Backfill:** none. **DB queries:** unchanged — this is a payload-shape fix
in `src/utils/fcm.ts` only; no repository, transformer, or API response contract touched.

`buildMessage()` used to set `notification.imageUrl` at the top level **and**
`android.notification.imageUrl`. FCM translates the top-level field into an APNs
`fcm_options.image`, which the iOS SDK surfaces **inside `data`** (plus `mutableContent: true`)
while the `notification` object itself stays image-less — so iOS clients received a stray
`data.fcm_options` blob they cannot render, and no image on the notification.

**Change:** removed the top-level `notification.imageUrl` assignment. The image is now
attached on the Android config only.

- **Android:** unchanged — payload still carries `notification.android.imageUrl`.
- **iOS:** now receives `notification: { title, body }` + the usual `data` keys
  (`title`, `body`, `titleHtml`, `bodyHtml`) — no `fcm_options`, no `mutableContent`.

`FcmPayload.image` is still accepted and still persisted wherever it was before; only the
outbound APNs projection changed. `yarn typecheck` green.

**Net effect for iOS clients:** no push image at all — neither in `notification` nor in
`data`. If iOS should later *show* the image in the tray, that is the opposite change
(keep `fcm_options.image` and add a Notification Service Extension in the iOS app to
download and attach it); do not re-add the top-level `imageUrl` without that extension.

---

## 2026-07-25 — `ws_material_category_package` timestamps backfilled

**DDL:** none. **Backfill:** `scripts/backfill-material-category-package-timestamps.ts` —
**run on the local staging clone 2026-07-25; pending on staging and production.**

Structural twin of the `ws_exam_category_package` entry below — same pivot shape, written
by adjacent code in the same repository (`admin-package.repository.ts:108/110/125/140/198`),
same legacy gap, same fix. 15 of 16 rows were NULL on both columns; the single populated
row (id 1317, package 90, `2025-08-01 17:54:13`) carries the **same** timestamp as the exam
pivot's one populated row (id 2226) — one legacy write event created both.

**Forward path needs no fix** — verified 2026-07-25 by writing through the real
`createMany`-inside-`$transaction()` shape: the probe row received both timestamps. The
NULLs are simply rows written before the middleware landed 2026-07-16.

**Source:** parent `ws_package.updated_at`, clamped to the 2026-07-16 cutover, floored at
the package's `created_at` (identical logic and rationale to the exam pivot). Result:
package 3 → its real `2026-07-10 19:18:12`; packages 88/89/91/990092/990093 → the clamp
marker `2026-07-16 05:30:00` IST. Row 1317 untouched. Idempotent; re-run is a no-op.

⚠ Same semantics caveat: `created_at` means "when this pivot row was last written", not
"when the link was first made" — the delete-then-recreate write path resets it on every
package edit that includes material categories.

---

## 2026-07-25 — `ws_exam_category_package` timestamps backfilled (table CONFIRMED in active use)

**DDL:** none. **Backfill:** `scripts/backfill-exam-category-package-timestamps.ts` — **run
on the local staging clone 2026-07-25; pending on staging and production.**

**Removal was considered and rejected — the table is actively used.** It is the
Package ↔ ExamCategory pivot (with a per-package display `order`), with 12 call sites:
- **reads** — `client-free.service.ts:77`, `catalog-exam.repository.ts:114`,
  `catalog-package.detail.sql.ts:80`, `client-catalog.service.ts:414`,
  `admin-package.repository.ts:61/74/76`
- **writes** — `admin-package.repository.ts:113/115/126/142/200`

**The forward path already works — no code change needed.** The columns *are* mapped on
`model ExamCategoryPackage`, and the central timestamp middleware *does* handle
`createMany` (it iterates the array — `src/config/prisma.ts:109-116`). Verified 2026-07-25
by writing through the real `createMany` path: `13:03:34Z` stored as `18:33:34` IST,
matching the wall clock. The 68 NULL rows were simply all written **before** the middleware
landed on 2026-07-16 (commit `de0233e`). As with `ws_customer`, the one row that *did* have
a timestamp was the oldest (id 2226, 2025-08-01), from the legacy writer.

**Backfill source:** the parent `ws_package.updated_at` — the write path REPLACES pivots
(`deleteMany` + `createMany`), so rows were last recreated when the package was last
edited. **Clamped to the 2026-07-16 cutover**, because a pivot written after it would
already carry timestamps, so any later parent `updated_at` provably overshoots. Package
990093 is the proof: updated 2026-07-21 yet its pivots were NULL, because the pivot replace
at `admin-package.repository.ts:113` is *conditional* on `examCategories` being present in
the payload. Floored at the package's `created_at`. Result: package 3 → its real
`2026-07-10 19:18:12`; packages 88/89/990092/990093 → the clamp marker
`2026-07-16 05:30:00` IST (= cutover UTC midnight; an approximate marker, not a real edit
time). Row 2226 left untouched. Idempotent; re-run is a no-op.

**Implementation note worth keeping:** `model Package` does **not** map
`created_at`/`updated_at` (the columns exist in MySQL but were never added to the model),
so the script reads them with `$queryRawUnsafe`. Verified that `$queryRaw` **results still
pass through the IST read shift** (`ws_package.id=3` reads `18:19:44` IST as `12:49:44Z`),
so those Dates are in the same UTC app-space as Prisma reads and can be written back
through Prisma without double-shifting. This contradicts the narrower reading of the
`src/config/prisma.ts` comment that raw queries "bypass Prisma middleware" — that holds for
write ARGS, not for result shifting.

⚠ **Semantics:** `created_at` on this table does **not** mean "when this link was first
made". The delete-then-recreate write path resets it on every package edit that includes
exam categories. It means "when this pivot row was last written" — true of live rows, not
just backfilled ones.

---

## 2026-07-25 — `ws_customer.created_at` backfilled + `last_login_date` now stamped on login

**DDL:** none. **Backfill:** `scripts/backfill-customer-created-at.ts` — **run on the local
staging clone (`websankul_staging_1`) 2026-07-25; pending on staging and production.**

### 1. `created_at` was NULL on pre-2026-07-16 customers

The schema is introspected, so `created_at` has no `@default(now())`, and
`customerAuthRepository.createStub` never passed it. Every customer created **before the
central timestamp middleware landed** (`src/config/prisma.ts`, commit `de0233e`,
2026-07-16 — the IST migration) got NULL. Locally that was 5 of 31 rows, and
counter-intuitively the **newest** ids (472366–472370), because older rows came from the
legacy import which did carry the column.

**New signups are already correct** — verified by creating a customer through the real
`createStub` path: `created_at = 2026-07-25 17:42:22`, matching the IST wall clock, so the
middleware + IST write-shift both work. No code change was needed for the forward path.

**Why the NULLs mattered** (not cosmetic):
- `admin-customer.repository.ts:27-29` filters `createdAt: { gte, lte }` — NULL never
  matches a comparison, so those customers were **invisible in every date-filtered admin
  customer report**.
- Same file orders by `createdAt desc`; MySQL sorts NULLs last, so the newest customers
  appeared at the **bottom** of a "newest first" list.
- `referral.repository.ts:354` aliases this column as `referralCodeCreatedAt` → null in
  referral reporting.

**Backfill source** (best-effort — the true signup instant was never recorded):
`MIN(ws_customer_access_token.created_at)` (first login) per customer, falling back to
`updated_at`, and never producing a value later than `updated_at`. All 5 local rows
resolved from a first token, matching to the second. `updatedAt` is passed explicitly on
the write so the timestamp middleware does **not** bump it — a historical repair must not
look like a fresh edit. Idempotent (only touches `created_at IS NULL`); re-run confirmed a
no-op. Reads/writes go through Prisma so the IST shift round-trips — **must not** be
rewritten as raw SQL, which bypasses it.

### 2. `last_login_date` was never written

`login_count` **was** being maintained (`createStub` seeds it, `setOtpForLogin` bumps it)
while `last_login_date` and `is_login` stayed NULL on all 31 rows — you could see how
often a customer logged in but never when.

**Query-level change:** `lastLogin: new Date()` added to both successful-login branches in
`customer-auth.repository.ts` — `markVerified` (new/unverified user) and `clearTried`
(returning user). Both are pre-existing `prisma.customer.update` calls on the same row in
`validateOtp`, so this adds **no extra query**. Verified on both paths, and it advances on
a subsequent login.

**Backfill:** `scripts/backfill-customer-last-login.ts` — **run on the local staging clone
2026-07-25; pending on staging and production.** Source is
`MAX(ws_customer_access_token.created_at)` per customer. Locally: 28 of 31 filled, 3 left
NULL because they have no token history (never completed a login — NULL is the correct
value there, not a gap). Same `updatedAt`-passed-explicitly guard as the `created_at`
backfill; idempotent (`last_login_date IS NULL` only).

⚠ **The backfilled values are a proxy, not exact.** A token row is inserted on a
successful OTP login (`auth.service.ts:287`) **and** on a token refresh (`:372`), and the
two are indistinguishable by column — so a backfilled value means "last token issued":
the last login or the last silent refresh, whichever is later. It is an upper bound on the
last interactive login. Rows stamped by the live code path from 2026-07-25 onward are
exact.

Sanity note for anyone reading this data: `login_count` and token count **do not agree**
(e.g. id 472335 has `login_count=29` against 18 token rows) because `login_count` is bumped
at OTP *generation* (`setOtpForLogin`) whereas a token row is written only on successful
validation — plus refreshes. Neither is a clean count of interactive logins.

**No API contract change** — neither field is surfaced in the customer DTO.

### 3. `is_login` now maintained (was NULL on every row)

Laravel-era session scaffolding that no code wrote. Now maintained live, on user
instruction — with the caveat below recorded deliberately.

**Query-level changes** (`customer-auth.repository.ts`):
- `markVerified` / `clearTried` — set `isLoggedIn: true` alongside `lastLogin` (same
  pre-existing UPDATE, still no extra query).
- **new** `markLoggedOut(id)` — sets `isLoggedIn: false`. Called from `logoutCustomer`
  (`DELETE /client/auth/logout`) and the `/logout-all-devices` teardown.
  ⚠ Deliberately **NOT** folded into `deactivateTokens`: that also runs mid-login
  (`validateOtp` deactivates the prior token before issuing the new one), so clearing the
  flag there would immediately undo the login stamp.
- **new** `reconcileLoggedOut(now)` — `updateMany` clearing the flag for anyone marked
  `true` who holds no live token (`active AND NOT deleted AND expires_at > now`). Atomic,
  idempotent, safe from multiple PM2 workers.

**New sweep pass:** `otp-unblock.scheduler.ts` now runs `reconcileLoggedOut` alongside the
OTP unblock (same 5-min interval, own try/catch so neither pass can break the other). This
is required, not optional: token **expiry runs no code**, and an uninstall or crash never
reaches the logout route, so without it the flag would report customers logged in forever.

**Seed:** `scripts/backfill-customer-is-login.ts` — **run on the local staging clone
2026-07-25; pending on staging and production.** Derives the initial value from token
liveness: 5 TRUE (the 5 customers holding a live token), 26 FALSE. Verified zero
flag↔token mismatches afterwards. `updatedAt` preserved on every write. Idempotent
(re-run: 31 already correct, 0 writes).

⚠ **`is_login` is DERIVED state, not a fact — do not gate access on it.** Customers may
hold several concurrent device sessions (the single-device gate in `authenticate.ts:146-151`
is commented out for customers), so one boolean can only mean "has at least one live
session" and can never express per-device state. It is also eventually-consistent: an
expired session still reads TRUE until the next sweep (≤5 min). The authoritative sources
remain `ws_customer_access_token` (active/deleted/expires_at), the JWT, and
`libs/tokenRevocation.ts`. Treat this column as reporting-only.

**Still open on this table:** `last_login_ip` holds the literal **string** `'null'` on
every row (the column's `DEFAULT` is the string, not SQL NULL) — a legacy Laravel artifact
that reads as data; `getClientIp` (`src/utils/clientIp.ts`) now exists if it is ever wired
up. `facebook_id` is `'0'` on every row (no social-login route exists at all). Both remain
unwritten and are drop candidates.

---

## 2026-07-25 — `ws_course.featured_order` dropped (dead column)

**DDL:** `docs/migration/schema-changes/2026-07-25_drop_course_featured_order.sql`
(`ALTER TABLE ws_course DROP COLUMN featured_order`; idempotent guard). **Applied on the
local staging clone (`websankul_staging_1`) 2026-07-25; pending on staging and
production.** Re-run verified as a clean no-op.

**Audit finding:** zero code paths touched this column — no read, no write, no filter, no
`orderBy`. Its only repo references were three comments (two doc-comments in
`src/modules/catalog-course/`, one historical note in
`scripts/generate-migrated-modules.ts`) plus the Prisma mapping itself.
`catalog-course.transformer.ts` stated it outright: *"mapped in Prisma but not surfaced
(no consumer reads it)."* `ws_course` was the only table in the schema carrying the name.

It implied a "featured course display order" capability that was never built.
`ws_course.is_featured` **is** live (surfaced as the `isPopular` boolean, filterable on
the course listing) — only the ordering half was missing, so featured courses have no
defined order. If that ordering is ever wanted, it comes back as a deliberate feature
rather than a dormant column.

**Data:** NULL on every row, including the one row with `is_featured='1'`. Nothing lost.

**Code changes** (deployed BEFORE the DDL):
- `prisma/schema.prisma` — removed `featured_order Int? @map("featured_order")` from
  `model Course` + `yarn prisma:generate`.
- `catalog-course.transformer.ts` / `catalog-course.types.ts` — stale drift-notes
  referencing the column updated.

**No API contract change** — the column was never surfaced in any DTO.

**Verified post-drop:** course reads work, `is_featured`→`isPopular` and
`purchase`→`isPaid` still surface correctly, utf8mb4 (Gujarati) names intact, and the
relation includes still resolve.

**Related, NOT fixed here** — two other `ws_course` findings from the same audit:
1. `shareable_link` is `''` on every row. `GET /client/courses/:id` overwrites it with a
   computed `buildShareUrl(...)` (`course.controller.ts:152`), but the shared
   `toCourseDto` returns the stored `''` — so the four surfaces built on it
   (catalog list/detail, recently-added, educator details, admin customer details)
   return an empty share link for the same course. Real inconsistency, still open.
2. `ws_course.course_category_id = 0` on course 990115 — a `NOT NULL` FK holding sentinel
   `0` with no matching `ws_course_subject_category` row. Prisma resolves the optional
   relation to `null` (no crash), but that course has no subject category.

---

## 2026-07-25 — `ws_book_setting` origin columns removed (dead config)

**DDL:** `docs/migration/schema-changes/2026-07-25_drop_book_setting_origin_cols.sql`
(`ALTER TABLE ws_book_setting DROP COLUMN origin_city`, `DROP COLUMN origin_hub`;
idempotent guards on both). **Applied on the local staging clone
(`websankul_staging_1`) 2026-07-25; pending on staging and production.** Re-run verified
as a clean no-op (guards hold).

**Audit finding:** of this table's 7 non-id columns, only
`free_shipping_min_order_amount` is consumed by business logic (`getFreeShippingMin()`,
`book-order.service.ts:48` → checkout shipping waiver). `origin_city` / `origin_hub` had
**zero** consumers: the courier integration (`src/config/courier.ts`,
`src/libs/courier/tracking.ts`) has no origin/pickup/hub concept whatsoever, so there was
nothing to wire them to. They were created with the table
(`2026-06-22_book_setting.sql`) for a feature that was never built, and the admin
settings CRUD merely echoed them back — settable, stored, never read.

**Retained deliberately** (also unconsumed today, but not deleted):
- `gst_rate` — books are taxable; likely a real future requirement. No GST calculation
  exists anywhere yet (the book order breakdown has no tax line), so setting it is
  currently a no-op.
- `support_phone`, `terms_and_conditions` — customer-facing content with **no client
  endpoint to deliver it**. These need a client route, not deletion.

**Code changes** (must deploy BEFORE the DDL runs):
- `prisma/schema.prisma` — dropped `originCity` / `originHub` from `model BookSetting`
  + `yarn prisma:generate`. Prisma names its columns explicitly rather than `SELECT *`,
  so the build is safe to run against a DB where the columns still exist — verified.
- `admin-book.service.ts` — removed from `toBookSettingDto`, from the
  `updateBookSettings` input type, and from both the `update` and `create` halves of the
  upsert.
- `admin/book/book.validation.ts` — removed from `updateSettingsSchema`.

**API contract change (deliberate):** `originCity` and `originHub` no longer appear in
`GET /admin/books/settings` or `PUT /admin/books/settings` responses, and `PUT` no longer
accepts them (unknown keys are stripped by Zod, so an admin panel still sending them gets
a 200 with the fields ignored rather than a 422). **The admin panel's settings form
should drop these two inputs.**

**Deploy order:** deploy the backend build first, then apply the DDL. Reversing the order
leaves a build selecting columns that no longer exist.

**Note:** `scripts/generate-migrated-modules.ts:1020` still carries a stale claim that
there is "NO `ws_book_setting` table at all" — predates the table's creation, left
unchanged here.

---

## 2026-07-25 — `ws_book_cart.user_ip_address` now captured

**DDL:** none. The column (`user_ip_address VARCHAR(50) NULL`) is legacy and already
exists; it was simply **absent from the Prisma `BookCart` model**, so no write could ever
reach it and MySQL's `DEFAULT NULL` applied to every row (0/10 populated).

**Schema:** hand-added `userIpAddress String? @map("user_ip_address") @db.VarChar(50)` to
`model BookCart` in `prisma/schema.prisma` + `yarn prisma:generate`. (Hand-edited one
model — **not** `db:pull`, which rewrites the curated schema.)

**Note this was not silent data loss** — unlike `ws_banner_slider.key_id`, nothing was
being submitted and discarded. The field existed in no request, DTO, or model. The
column is a Laravel-era artifact for identifying an anonymous **guest cart** by IP; that
premise died when `/api/v1/client/cart` went behind `authenticate` (`cart.routes.ts:15`),
so every cart is keyed on `user_id` (0 guest rows). It is now captured for abuse/fraud
review rather than identity.

**Query-level changes:**
- `clientCartRepository.ensureCart(customerId, userIpAddress = null)` — writes the IP on
  create, and **refreshes it on an existing cart when it differs** from the stored value.
  A cart outlives a session, so this keeps a last-acted-from address and also fills the
  column on carts created before the mapping existed. The extra `UPDATE` fires only on an
  actual change, never per read.
- Threaded through the two service entry points that can create a cart:
  `addToCart(..., userIpAddress)` and `attachShipping(..., userIpAddress)`; both default
  to `null` so existing callers are unaffected.
- Controller (`client/cart/cart.controller.ts`) supplies it on `POST /client/cart` and
  the shipping-attach route.

**New util** `src/utils/clientIp.ts` — `getClientIp(req, maxLength = 45)`. Reads `req.ip`
(correct because `app.set("trust proxy", 1)`, `app.ts:42`) rather than the raw
`X-Forwarded-For` header, which is a client-prependable hop list and can overflow a short
column. Unwraps the IPv4-mapped IPv6 form (`::ffff:1.2.3.4`) and clamps to the column
width. The three pre-existing sites that read the raw header directly
(`admin.auth.controller.ts:30`, `tracking.controller.ts:37`,
`promoter.auth.controller.ts:20`) were **left unchanged** — they are candidates to adopt
this helper later.

**No API contract change** — `user_ip_address` is not exposed in any cart DTO.

**Data note:** the 10 existing carts stay `NULL` until their owner next acts on the cart,
at which point `ensureCart` fills them. No backfill is possible; the addresses were never
recorded.

---

## 2026-07-25 — `ws_banner_slider.key_id` un-stubbed (banner deep-link target now persists)

**DDL:** none. The column (`key_id INT NULL`) and the Prisma field
(`BannerSlider.keyId Int? @map("key_id")`) already existed and were correctly typed —
the value was being discarded in application code, not rejected by the schema.

**Bug:** `key_id` was `NULL` on every row and could never be anything else.
`banner-slider.transformer.ts` hardcoded `keyId: null` in `toPrismaBannerCreate` **and**
in `toBannerDto`, and omitted `keyId` entirely from `toPrismaBannerUpdate`. Validation
(`bannerCreateSchema`) accepted `keyId`, so an admin sending a target got a **200 OK with
silent data loss** — no error, nothing written. Introduced as a deliberate migration stub
(comment in `banner-slider.types.ts`: *"the referenced catalog modules are not migrated
yet"*); that premise stopped being true once the catalog modules went MySQL-only, but the
stub was never removed.

**Query-level changes:**
- **WRITE** `toPrismaBannerCreate` now persists `key_id` from input (was: always `NULL`).
- **WRITE** `toPrismaBannerUpdate` now writes `key_id`; `key` and `key_id` always move
  together so re-keying a banner re-points or clears its target in the same statement —
  a row can never retain a target belonging to the previous collection. An update that
  touches neither still leaves `key_id` untouched.
- **READ** `toBannerDto` returns `row.keyId` (was: always `null`). Serving the **scalar
  int**, not a populated document: `key`/`keyRef` already identify the collection, and
  populating would add a per-banner lookup across four tables on a 1h/24h-cached route.

**API contract change (deliberate):** `keyId` in the banner DTO changes from a
permanently-`null` `unknown` to `number | null`. Affects `GET /client/cms/banners`,
`GET /admin/cms/banners`, `GET /admin/cms/banners/:id`, and the banner block of
`GET /client/dashboard` (`client-dashboard.service.ts` reads `prisma.bannerSlider`
directly). Existing rows all read `null` as before until re-saved — no backfill possible,
the original targets were never stored.

**Validation tightened** (`cms.validation.ts`): `keyId` is now **required** when `key` is
`Packages|Courses|Book|EBook`, **rejected** when `key` is `Explore` (standalone CTA, no
target), and must accompany `key` on update. New banner-only `bannerTargetId` accepts a
positive integer as either a string (multipart, what the admin panel sends) or a number
(a JSON client) — the shared `bannerRefId` still accepts a legacy 24-hex ObjectId and is
**left unchanged**, as live-course banners depend on it.

**Not touched:** `ws_live_banner_slider` / live-course banner routes and schemas.

**QA:** admin create/update a banner per key; confirm `key_id` persists, that `Explore`
stores `NULL`, that switching a banner to `Explore` clears a previous target, and that
the client banner + dashboard responses return the id. Cache is flushed automatically by
`autoFlushGroup("banner")` on all five write routes.

---

## 2026-07-24 — `ws_package_course_subscription` covering index (admin dashboard/analytics)

**DDL:** `docs/migration/schema-changes/2026-07-24_pcs_created_at_index.sql`
(`CREATE INDEX idx_pcs_created_course_amount ON ws_package_course_subscription
(created_at, course_id, amount)`). **Applied on staging clone (`websankul_staging_1`)
2026-07-24 during k6 load testing; pending on production.** Mirrored in
`prisma/schema.prisma` as `@@index([createdAt, courseId, amount], name: "idx_pcs_created_course_amount")`.

**Why:** k6 Phase-7 profiling (slow query log under cold-cache load) showed the admin
dashboard + subscription-aggregate queries full-scanning all ~598,743 rows of
`ws_package_course_subscription`. They filter `created_at` range (+ `course_id IS [NOT]
NULL`) and aggregate `amount`; the pre-existing indexes (`PRIMARY(id)`,
`idx_pcs_promoter(promoter_id, created_at)`) couldn't serve a bare `created_at` range.

**Effect:** date-bounded aggregates go `type=ALL rows=598743` → `type=range rows=1 Using
index`. Measured on the identical cold k6 scenario (PM2 2-worker): **group:analytics p95
4.84s → 343ms (~14×), global p95 2.33s → 355ms (~6.6×), dashboard p95 2.02s → 406ms
(~5×)**. No API/response-shape change — pure read-path speedup.

**Follow-up (not covered by this index):** the admin subscription *list* query uses a
wide/absent date range and still scans the table; a non-selective range can't use the
index. Needs app-level date-scoping / pagination.

## 2026-07-24 — `ws_customer_address.city_id` dropped — city is a plain name string

**DDL:** `docs/migration/schema-changes/2026-07-24_drop_customer_address_city_id.sql`
(idempotent `ALTER TABLE ws_customer_address DROP COLUMN city_id`). **Applied on
staging (`websankul_staging_1`) 2026-07-24; still pending on production** — apply after
the backend build below.

Customer addresses no longer reference a city id. The `city` column (NOT NULL
VARCHAR(20)) already stores the city name for every row, so the `city_id` FK is
redundant and removed. Clients/admin now send `city` as a string; there is no more
`cityId` → OfflineCity name resolution on the address write or cart shipping paths.

- `prisma/schema.prisma` — `CustomerAddress.cityId` field removed (regenerated client).
- `src/modules/customer-address/*` — `cityId` dropped from DTO (`AddressDto`), create
  input, transformer, and repository create/update.
- `src/client/address/address.controller.ts` + `address.validation.ts` — `cityId`
  removed from the create/update schemas and handlers; **`city` is now a required
  string** on create; the `cityId`→name `resolveCityForStore` helper is gone. The
  legacy Mongo-era `createAddressSchema`/`updateAddressSchema` (unused) were deleted.
- `src/admin/subscription/subscription.controller.ts` + `subscription.validation.ts`
  (admin create/update customer address) — `cityId` replaced by a required `city`
  string; `resolveCityName` import removed.
- `src/modules/admin-customer/admin-customer-details.transformer.ts` — `cityId`
  removed from the admin customer-detail address DTO.
- `src/modules/client-cart/client-cart.service.ts` — shipping snapshot reads
  `address.city` directly (dropped the `cityId`→OfflineCity resolution + import).

**Response contract change (intended):** the `cityId` field is removed from address
objects in client (`GET /client/address`, `GET /client/address/:id`) and admin
(customer-detail addresses, `/admin/subscriptions/customer-addresses`) responses.
`city` (string) is unchanged. Frontend cutover docs: `docs/client/ADDRESS_CITY_STRING_FRONTEND.md`
and `docs/admin/ADDRESS_CITY_STRING_FRONTEND.md`.

The offline-center `cityId` (`OfflineCenter.city_id`) and the city dropdown endpoints
(`GET /client/address/cities`, `/cities/:cityId/centers`) are a **separate** feature and
are untouched.

## 2026-07-24 — `SHARE_BASE_URL` removed — share links revert to request origin — NO DB change

The dedicated share-host / domain-separation concept (`SHARE_BASE_URL`) is removed as no
longer needed. Share URLs are again built from the request-derived origin (`ORIGIN` env, or
the request host) — the `base` each controller already threads via `resolveBase(req)`.

- `src/utils/shareBase.ts` — **deleted** (was the `SHARE_BASE_URL` reader + share-host detector).
- `src/deeplinking/shareRedirect.ts` — `buildShareUrl(resource, id, base)` now uses the
  passed-in `base` again (previously accepted-and-ignored while pinned to `shareBase()`).
- `src/app.ts` — removed the `/share` 301 redirect that forced requests onto the share host;
  `/share` is now served directly on whatever host it arrives on.
- `src/config/env.ts` — `SHARE_BASE_URL` removed from `REQUIRED_IN_PROD` (no longer boot-blocking).
- `.env` / `.env.example` — `SHARE_BASE_URL` removed.
- Docs `SHARE_DOMAIN_SEPARATION.md` + `infra/SHARE_SUBDOMAIN_SETUP.md` deleted; `DEEPLINKING_SHARE.md` updated.

**Response contract unchanged:** `shareableLink` still resolves to `<origin>/share/<resource>/<id>`.
No schema, index, or query change.

## 2026-07-23 — Catalog video listing: per-category fan-out → 3 batched queries + `ws_video_category_relation` indexes

**DDL:** `docs/migration/schema-changes/2026-07-23_video_category_relation_indexes.sql`
(adds `idx_vcr_parent`, `idx_vcr_child`). **Apply on deploy.**

`catalogVideos()` (`src/modules/client-catalog/client-catalog.service.ts`) ran, for EVERY
selected category: one recursive-CTE subtree walk (`descendantsOf([cat.id])`) + a
`video.count` over that subtree + a `videoCategoryRelation.count`. A package with 20
subject categories issued **60 queries for one request**, which is what saturates the
Prisma pool under concurrency.

Query shape now — constant regardless of category count:
1. `descendantsByRoot(selectedIds)` — NEW helper in
   `catalog-category-tree/category-tree.service.ts`. Same recursive CTE, but carries the
   seed `root` through the recursion so one query returns every `(root, descendant)` pair;
   buckets by root in JS. Semantics identical to calling `descendantsOf([root])` per root
   (root included, deduped, same `MAX_DEPTH`).
2. `video.groupBy({ by: ["videoCategoryId"] })` over the union of subtrees — per-category
   tallies summed per subtree. Equals the old per-subtree `count()` exactly, because a
   video belongs to exactly one category.
3. `videoCategoryRelation.groupBy({ by: ["parent"] })` over the selected ids.

`totals.items` is now summed from (2) instead of a fourth round-trip. The flat `course`
path also gained an explicit `select` (7 fields) instead of reading every column of the
wide legacy `ws_video`.

**Measured on staging:** package with 20 categories — **5 queries total, vs 60 for the
counts alone** before. 4 categories → 5 vs 12. 1 category → 5 vs 3 (marginally more for
trivial cases; flat thereafter).

**Indexes:** `ws_video_category_relation` had ONLY a PRIMARY KEY, so every parent/child
lookup — including each level of the recursive CTE — was a full scan. Verified before:
`type: ALL, key: NULL, rows: 2456`; after: `type: range, key: idx_vcr_parent, rows: 5,
Using index`.

Response contract unchanged — verified by differential test across 20 responses
(10 course/package/live-course ids × logged-in and anonymous): `category.count`,
`havingChildDirectory`, and `totals.items` identical to the pre-refactor logic, 0 mismatches.

---

## 2026-07-23 — Notification token collection: single unbounded read → PK-paged + id-chunked

`collectTokens()` (`src/modules/admin-notification/admin-notification.service.ts`) loaded
every matching `ws_customer` row in one `findMany` — on a ~600k-row customer base a
broadcast materialised the entire result set at once, and a large targeted audience bound
every id into a single `IN (...)` big enough to threaten `max_allowed_packet`.

Query shape now: PK-ordered pages of 5,000 (`cursor` + `skip: 1`), and targeted audiences
chunked 1,000 ids per statement. Dedup is global across pages via a `Set`, so the token
set is identical to the previous single-query behaviour (and `sendPush` already deduped
downstream anyway). No schema change; FCM batching in `utils/fcm.ts` is untouched.

Verified: token set identical to the legacy query for both broadcast and targeted
audiences, including with the page size forced to 3 to exercise the cursor across ~11 pages.

---

## 2026-07-23 — Lecture-progress heartbeat: find-then-create → race-safe upsert — NO schema change

`upsertVideoProgress` / `upsertLiveSessionProgress`
(`src/modules/client-lecture-progress/client-lecture-progress.service.ts`) previously ran
`findFirst` → `update`-by-id or `create`. That is a read-modify-write on the platform's
**highest-frequency write** (every playing student heartbeats on an interval, and the same
student may have two players open), so two concurrent heartbeats for one
`(customer, video)` could both observe "no row" and both INSERT — the loser dying on
P2002 and surfacing as a **500 mid-video**.

Query shape now: `prisma.lectureProgress.upsert()` keyed on the existing unique indexes
`uniq_customer_video` / `uniq_customer_live_session`, wrapped in `upsertRacingSafe()`
which catches P2002 and retries as an `update` by the same unique key.

**Why the wrapper is required:** Prisma only compiles `upsert()` into a native
`INSERT ... ON DUPLICATE KEY UPDATE` when the model carries a *single* unique constraint.
`ws_lecture_progress` has two, so Prisma falls back to select-then-insert and the race
survives. Measured on the staging DB: 12 concurrent heartbeats for one key produced
**11 P2002 failures** with bare `upsert()`, and **0 failures / exactly 1 row** with the
wrapper.

No schema or index change — both unique indexes already exist
(`docs/migration/schema-changes/2026-06-18_create_wave7_blocked_tables.sql:27-28`,
verified present on `ws_lecture_progress`). Read paths and the returned row shape are
unchanged; `set` semantics (additive container pointer, never un-completes) are byte-for-byte
the same as before.

Regression QA: play the same video from two devices/tabs for one customer and confirm no
500s and a single `ws_lecture_progress` row.

---

## 2026-07-23 — Profile dashboard `activePlans` now counts live-course subs — NO schema change

`GET /client/profile/dashboard` under-reported `activePlans`: `countActiveSubscriptions`
queried only `ws_package_course_subscription`, `ws_test_series_subscription` and
`ws_ebook_subscription`, while the `course` tab of `GET /client/my-subscriptions` merges
recorded course/package cards **with live-course cards**. Net effect: a live-course
purchase appeared in My Subscriptions but never moved the profile badge — read to the
user as "the count doesn't sync after purchase". Count semantics change only; no DDL,
no backfill, no response-shape change (`activePlans` is still the single headline int).

- `src/modules/customer-profile/profile-dashboard.sql.ts`
  - `countActiveSubscriptions` — added a 4th parallel query on
    `prisma.liveCourseSubscription`, folded into the `course` bucket and deduped
    per `live_course_id` (`l:<id>`), matching `buildLiveCourseCards`.
  - Predicate deliberately mirrors
    `client-my-subscriptions.repository.activeLiveCourseSubs` (and the entitlement
    checks in `client-lecture-progress`, `client-search`, `exam-countdown`):
    `status = true AND payment_status = 'verified' AND (end_at IS NULL OR end_at > now)`.
    - `payment_status = 'verified'` is REQUIRED — the live-course row is created at
      ORDER time with `status = true, payment_status = 'pending'`, so omitting it
      would over-count unpaid orders.
    - `end_at IS NULL` is REQUIRED — live-course subs can be LIFETIME; the plain
      `end_at > now` used by the other three tables would drop them.

QA: buy a live course → verify payment → `activePlans` increments by 1 and matches the
card count on the `course` tab. A *pending* (unverified) live order must NOT increment it.
Extension of an existing live course must NOT increment it (dedup per live_course_id).

Indexes: none added — `ws_live_course_subscription` is already read with this exact
`(customer_id, status, payment_status, end_at)` shape by the endpoints listed above.

---

## 2026-07-23 — Quiz DTO gaps restored: `solutionText`, `attemptNumber`, `inProgress` — NO schema change

RN client verification of the API-slimming work came back FAIL on three quiz fields the
app reads but the SQL DTOs never emitted (pre-existing gaps, not caused by the slimming).
All three already exist as columns — additive DTO fields only, no query/schema change.

- `src/modules/client-exam/client-exam.service.ts`
  - `toResultDto` (+`attemptNumber` from `ws_exam_result.qresult_attempt_number`,
    +`inProgress` from `qresult_in_progress`, defaulting to `false`). Surfaces on
    `GET /client/quizzes/my/attempts`, `GET /client/quizzes/:id/solution/analytics`, and
    the `lastResult` decoration on the exam-category / daily-test listings.
  - `getSolution` per-question row (+`solutionText` from
    `ws_exam_question.solution_text`) for `GET /client/quizzes/:id/solution`.
    `solution_image` stays unsent — confirmed unread by the client.

No repository change was needed: both `resultsForCustomerExams`/`myResults` and
`questionsByIds` already `findMany` full rows (no `select`), so the columns were being
fetched and simply dropped at the DTO. Controller `omit` lists were checked and do not
strip any of the three. `attemptNumber` on `POST /:id/attempts/start` and
`inProgress` on `GET /:id/attempts` were already present via `toAttemptDto`.

---

## 2026-07-23 — Audio-note `durationSec`: floor before the INT write — NO schema change

> **No DDL, no new query, no index.** Validation-level fix on an already-SQL module.

Audit of the "accept & return `durationSec` on lecture audio notes" request found the
feature already complete end-to-end — `ws_lecture_audio_note.duration_sec INT NULL`
exists (`2026-06-19_create_lecture_note_tables.sql`), the controller passes the field
through, and `audioNoteDto` returns it on both create and list for `recorded` and
`live` alike. One real defect was found and fixed:

- `createAudioNoteBodySchema.durationSec` was `z.coerce.number()` with **no `.int()`**,
  while the column is `INT`. A fractional multipart value (`durationSec=42.7`, which is
  what a client measuring recording length naturally produces) passed Zod and then threw
  at the `prisma.lectureAudioNote.create` write. That lands in the handler's catch, which
  runs best-effort S3 orphan cleanup — so the **just-uploaded recording was deleted** and
  the caller got a 500. Data loss, not just a dropped duration.
- Fix: `.transform(Math.floor)` on the schema (`lecture-audio-note.validation.ts`),
  matching the spec's "integer seconds (floor)" rule. Rows written before this fix are
  unaffected — the bad path never persisted anything.
- Deviation from the spec's stated `1…86400` range: the lower bound stays `0`. Rejecting
  `0` would 400 the whole upload and bin the file for a sub-second note that floored to
  zero, which is worse than the spec's own "not `0` unless truly zero-length" intent.

**Response contract unchanged** — `durationSec` was already in the DTO; it is `null` when
absent, never `0`.

**QA:** `POST /client/lecture-audio-notes` multipart with `durationSec=42.7` → 201 and the
note stores/echoes `42` (previously 500 + lost audio); omit the field → stored `null`;
`GET /client/lecture-audio-notes?lectureType=recorded&videoId=…` and the `live` variant
both return `durationSec` per note.

---

## 2026-07-23 — `hasNotes` flag on the category videos listing (+ 2 new indexes)

> **DDL:** `docs/migration/schema-changes/2026-07-23_lecture_note_customer_video_index.sql`
> (index-only, additive). No column or table change.

`GET /client/video-categories/:id/videos` now returns `hasNotes: boolean` per list item —
true when the calling customer has **at least one** saved note on that video, text
(`ws_lecture_note`) or audio (`ws_lecture_audio_note`).

- **New queries** — `videosWithNotes()` in `client-category-video.service.ts`: two
  `distinct` `findMany`s over the page's video ids,
  `WHERE customer_id = ? AND video_id IN (...)`, selecting `video_id` only. Two queries
  per request regardless of page size — not per row. Anonymous/unresolvable user id
  short-circuits to an empty set (flag is always `false`).
- **Deliberately unscoped by `lecture_type` and `course_id`.** The notes-list endpoint
  filters on `(customer, lectureType, videoId)` and ignores the container; scoping the
  flag tighter would report `hasNotes: false` on a video that still opens with notes in
  it. `video_id` is only ever populated on recorded-video notes, so the id filter is
  already the correct cut.
- **Indexes:** `idx_lecture_note_customer_video (customer_id, video_id)` and
  `idx_lecture_audio_note_customer_video (customer_id, video_id)`. Neither note table
  had *any* secondary index before, so without these every listing request full-scans
  both. Mirrored into `prisma/schema.prisma` as `@@index` on `LectureNote` /
  `LectureAudioNote` (client regenerated).
- **Response contract:** additive only — one new key on each `list[]` item. `progress`,
  `mediaToken`, `qualities`, `recordings` and the pagination envelope are unchanged.
  The route is not `cacheRoute`-wrapped, so the per-customer flag cannot leak across users.

**Deploy order:** apply the DDL first (or accept full scans until it lands), then ship.

**QA:** save a text note on one video and an audio note on another in the same category →
both come back `hasNotes: true`, the rest `false`; delete every note on a video → flips
back to `false`; call as a customer with no notes → all `false`.

---

## 2026-07-23 — Global search now covers Test Series (6th entity type)

> **No DDL, no schema change, no new index.** Query-level only: `GET /client/search`
> gained a sixth searched entity type.

`src/modules/client-search/client-search.service.ts`:

- `SEARCH_TYPES` / `SearchType` extended with `"testSeries"`. Untyped (`?type=` omitted)
  requests now fan out over 6 types instead of 5, so the `results` map has a new
  `testSeries` key and `total` is a 6-way sum.
- **New queries** (all `status = true`, page-scoped):
  - `ws_test_series` — `findMany`/`count`, token search on **`title`** (not `name`;
    the column simply doesn't exist there) via the shared `buildPrismaSearch` helper,
    ordered `order_by ASC, created_at DESC` — same ordering as the test-series listing.
  - `ws_test_series_price` — active plans for the page's series ids,
    ordered `is_default DESC, duration_days ASC` (default plan first).
  - `ws_test_series_subscription` — active subs for the current customer
    (`status = true AND end_at > now()`), latest `end_at` per series → `daysLeft`.
- `isPaid` for test series = `NOT is_free` (mirrors `/client/test-series`).
- Card shape: `title` is mirrored into `name` when the row has no `name` column, and
  `title`/`paperCount`/`isFree` were added to the card field pick-list. Existing five
  types are byte-for-byte unchanged (they own a real `name`, so the mirror never fires).

**QA:** search a known test-series title with and without `?type=testSeries`; confirm
`isPurchased`/`daysLeft` flip for a customer with an active subscription, and that the
other five buckets are unaffected.

---

## 2026-07-22 — Client API slimming: bucket C + PAYMENT — NO DB change

> **No DDL, no query/schema/index change.** Final tranche: the safe leftovers +
> payment response-shape trims. Controller-edge only; no payment LOGIC touched
> (signature/HMAC verify, order creation, amount computation all unchanged).

- **educators/:id** (`client/educator/educator.controller.ts`) — dropped
  `educator.view`, top-level `totalCourses`, per-course `courseEducatorId`/
  `courseSubjectCategoryId`/`shareableLink` (top-level shareableLink kept).
- **contactus** (`client/inquiry/inquiry.controller.ts`) — dropped
  `order`/`active`/`isCallAvailable`/`isWhatsAppAvailable` at department + contact levels.
- **free-courses** (`client/free/free.controller.ts`) — card DTO only
  (`kind,_id,id,name,title,image,isPurchased`), dropped the Prisma spread.
- **exam-countdown/:id/packages** (`client/categories/categories.controller.ts`
  `listProductsByCountdown`) — dropped the `examCountdown` wrapper + package/live meta
  noise. (The look-alike `listPackagesByExamCountdownCategory` = dead endpoint, untouched.)
- **PAYMENT create-order ×6** (`client/payment/{payment,course,ebook,package,
  live-course,test-series}-payment.controller.ts`) — wrapped each `data` object in
  `omit(..., PAYMENT_ORDER_ECHO_KEYS)` (new shared const in `payment/razorpay.ts`),
  dropping order-id/subscriptionId/receiptId/entity-echo/plan/promo. `razorpay` +
  `amountInRupees` + `breakdown` PRESERVED by construction (omit cannot remove them).
  ⚠️ MEDIUM — the doc says verify no web/analytics consumer reads these echoes first.
- **PAYMENT verify** (`client/payment/verify.controller.ts`) — all 6 success returns
  now `{ success: true }` (dropped `data:{kind,subscription/order}`). Fulfillment logic
  untouched. ⚠️ Confirm post-payment navigation does NOT read `data.kind`/`subscription`.

## 2026-07-22 — Client API slimming: long-tail P2 sweep — NO DB change

> **No DDL, no query/schema/index change.** Controller-edge response-shape trims
> across the remaining client list/detail endpoints (books, ebooks, purchase-history,
> subscriptions, packages/categories, courses/catalog/free, live-courses, profile/
> quizzes/exam-countdown/offline/referral-lists). Each endpoint drops ONLY the fields
> its `docs/api-optimization/*.md` marks under "Fields Safe To Remove", via
> `utils/pick` (`omit`/`omitList`/`pick`) at the `src/client/**` controller edge.
> Shared `src/modules` transformers UNTOUCHED (admin unaffected). Pagination envelopes
> preserved. Payment / media-resolve / video-URL / auth endpoints NOT touched.
> Applied via parallel domain-scoped agents; integrated `yarn typecheck` gate.

- **Books** (`client/book/book.controller.ts`) — list/detail metadata + trending-ebook
  card slim + order-tracking hub/pincode trims. Live courier-tracking shape untouched.
- **All domains complete** (integrated `yarn typecheck` green). Endpoints slimmed:
  ebooks (list/detail/downloads), purchase-history (books/ebooks/subscriptions),
  my-subscriptions, packages (list/types/goal), package-categories(+/:id/packages),
  material/video/exam category listings, courses (list), catalog (materials/tests/
  videos), free-videos/resume, live-courses (list/recently-added/:id/recordings/
  session-recordings/my/my-schedule/upcoming-sessions/live-now/:id/schedule),
  live-sessions/:id, live-reminders, profile, profile/dashboard, goals/my-goals,
  quizzes (detail/questions/attempts/aggregate/solution-analytics), exam-countdowns,
  popup, referral (status/terms/faqs/transactions/bank-accounts).
- **⚠️ Higher-attention drops needing FE confirmation** (aggressive/structural, easily
  reverted): `GET /client/profile` (dropped dob/gender/city/goals/educationId/etc — if
  the edit screen prefills from here it breaks); `GET /client/free-videos/resume`
  (dropped the `cards[]` list, kept only `resumeNext`); `GET /client/live-sessions/:id`
  (dropped `canJoin`/`scheduledAt`); `GET /client/live-courses/:id/session-recordings`
  (dropped `scheduledAt`/`locked`).
- Skipped (ambiguous non-enumerated removal specs, or dead/out-of-scope handlers):
  free-courses, free-tests, free-videos, quizzes/daily, exam-countdown categories,
  courses/lecture, various tracking-live (courier shape protected), educators/:id,
  contactus, exam-countdown/:id/packages.

## 2026-07-22 — Client API slimming: search + quiz (Phase 4 cont.) — NO DB change

> **No DDL, no query/schema/index change.** Search card projection (source, client-
> only) + quiz controller-edge omits. Source: `docs/api-optimization`.

- **Search (`modules/client-search/client-search.service.ts`)** — replaced the raw
  full-row spread (`...r`) in `attachPurchaseState` with a SearchCardDto keep-list
  (`utils/pick`): identity + book/ebook meta + price columns only; computed
  `_id/isPaid/isNew/plans/isPurchased/daysLeft` layered on after. Envelope
  (type/page/limit/total/hasMore) KEPT to avoid breaking any paging. ~70–85% smaller.
- **Quiz my-attempts (`client/exam/exam.controller.ts` `listMyResults`)** — dropped
  unused `ratting` per row (controller-edge omit; shared service DTO untouched).
- **Quiz solution (`getSolutionByExam`)** — dropped unused question `image` +
  `answers[].image` (text-only solution UI).
- NOTE: speculative additions (`solutionText`, attempt `attemptNumber`/`inProgress`)
  NOT added — the audit only *conditionally* suggested them and did not confirm the
  FE shape; adding blind risked wrong data.

## 2026-07-22 — Client API FE↔BE mismatch fixes (Phase 4, partial) — NO DB change

> **No DDL, no query/schema/index change.** Additive DTO fixes — add fields the RN
> app already expects but the SQL DTO omitted. Source: `docs/api-optimization`
> (FE↔BE mismatches). Additive → low risk (no existing consumer loses a field).

- **Cart shipping (`modules/client-cart/client-cart.service.ts` `attachShipping`)** —
  the returned `shipping` snapshot now includes `phone` (validated BigInt → String);
  was `{_id, city}` only. Checkout reads `shipping.phone`.
- **Exam-countdown books (`modules/exam-countdown/exam-countdown.client.ts` `bookDto`)** —
  added `listPrice` (`ws_book.list_price`) alongside `discountedPrice` for the FE
  strike-through original price.
- **DEFERRED Phase 4 items:** (a) explicit-`select` hardening — HIGH runtime-break
  risk (any-typed rows, no test runner, shared repos) and payload already won at the
  controller edge → low ROI now; (b) mobile-DTO contract tests — project has NO test
  runner (infra decision needed); (c) remaining mismatches — quiz `solutionText` /
  attempt `attemptNumber`/`submittedAt`/`inProgress` (need data-source check), live
  session `educator`/`canJoin` (video-adjacent — needs care), apply-promo `breakdown`/
  `validUntil` (payment-adjacent — needs sign-off).

## 2026-07-22 — Client API payload slimming (Phase 3, partial) — NO DB change

> **No DDL, no query/schema/index change.** Response-shape trims at the CLIENT
> controller edge via `utils/pick.ts` (`pick`/`omit`). Shared module builders
> UNTOUCHED. Source: `docs/api-optimization` Phase 3 (Detail & commerce).

- **Course detail (`client/course/course.controller.ts`)** —
  `GET /client/courses/:id` — dropped nested `videos`/`materials`/`tests` +
  `availablePromoCode` (RN loads tabs via /client/catalog/…). course/scope/plans/
  shareableLink kept. Course OBJECT field-slim (Prisma spill/educator extras)
  DEFERRED — courseDto is a full Prisma spread; needs FE confirm of isPaid/
  shareableLink placement before projecting. ⚠️ MEDIUM — confirm no web consumer.
- **Package detail (`client/package/package.controller.ts`)** —
  `GET /client/packages/:id` — dropped nested `videos`/`materials`/`tests` +
  `availablePromoCode`; slimmed the (explicit, safe) package DTO: dropped
  `packageType`, `goal`, `isPopular`, `subtitle`, `examCountdownCategoryIds`,
  `examCountdownIds`. scope + plans kept. ⚠️ MEDIUM — confirm no web consumer.
- **Material token refresh (`client/material/material.controller.ts`)** —
  `GET /client/materials/:id` → `{_id, mediaToken, isDirectLink}` (token-refresh
  path; RN reads only mediaToken). mediaToken contract preserved.
- **Referral rewards (`client/referral/referral.controller.ts`)** —
  `GET /client/referral/rewards` → `{customer:{rewardPoints, referralCode}}`
  (dropped customer identity fields + program[]).
- **DEFERRED (payment flows — require sign-off per project rules):** create-order
  family + `POST /client/payment/verify` response trims NOT done.

## 2026-07-22 — Share links pinned to `SHARE_BASE_URL` — NO DB change

> **No DDL, no query/schema/index change, no API response-shape change.** `shareableLink` keeps its
> key and type on every endpoint; only the generated value changes. Verified locally end-to-end.

- **New `src/utils/shareBase.ts`** — `shareBase()` / `shareHostname()`. Share links are now built
  from `SHARE_BASE_URL` only, never from the request `Host` header (client-supplied, so a missing
  env var previously let a caller choose the domain share links point at).
- `src/deeplinking/shareRedirect.ts` — `buildShareUrl` uses `shareBase()`; its third parameter is
  accepted-and-ignored so the ~20 existing call sites keep compiling.
- `src/config/env.ts` — `SHARE_BASE_URL` added to `REQUIRED_IN_PROD` (fails fast in production).
- `src/config/rateLimiter.ts` — new `shareLimiter` (120/min/IP, `RATE_LIMIT_SHARE_MAX`,
  `rl:share:` Redis prefix). `/share/*` previously had **no** limiter of any kind.
- `src/app.ts` — `/share` now runs `shareLimiter` + a host gate: requests arriving on any host other
  than the share host get a **301** to `SHARE_BASE_URL` so links already sent to users keep working.
  Compares `req.hostname` against `URL.hostname` (**not** `.host`) — `req.hostname` strips the port,
  so a `.host` comparison would redirect-loop on any non-443 local setup.
- `public/.well-known/apple-app-site-association` — narrowed from `"components": ["*"], "paths":
  ["*"]` (which claimed **every** URL on the API host, including `/api/v1/*`) to `/share/*`.
- `.env` / `.env.example` — `SHARE_BASE_URL` documented; local value `http://localhost:4001`.

Local verification: share page 200 on the share host; 301 + correct `Location` from another host;
invalid id still 400; `com.gpscvideo.gpsc://course/123` emitted; live API response returned
`"shareableLink":"http://localhost:4001/share/ebooks/550"` (was following `ORIGIN`).

**Deferred (cleanup only):** the request-derived `base`/`baseUrl` argument is still threaded through
~8 controllers and their module services. It is now inert — `buildShareUrl` ignores it — so this is
tidy-up, not a behaviour fix, and it touches many service signatures. Tracked in
`docs/SHARE_DOMAIN_SEPARATION.md` §3.8.

Docs: `docs/SHARE_DOMAIN_SEPARATION.md` (backend/infra plan),
`docs/client/SHARE_DEEPLINK_FRONTEND.md` (app + web integration).

---

## 2026-07-22 — Dead-code sweep: 19 unreachable files + 2 orphan handlers deleted — NO DB change

> **No DDL, no query/schema/index change, no route added or removed.** Every file
> deleted was proven unreachable from `src/index.ts` by a full import-graph BFS
> (616 files → 597 reachable; the 19 unreachable are the deletions). `yarn typecheck`
> green before and after; a re-run of the BFS now reports 0 unreachable files.

Deleted orphan modules (Phase-3a dual-path builds that were never wired to a route,
and whose "flip the flag later" premise died with the Mongo removal on 2026-07-01):

- `src/modules/client-orders/**` — the legacy `/client/orders/*` surface it backed was
  removed 2026-07-01 (see `src/client/client.routes.ts`); superseded by SQL `/client/payment/*`.
- `src/modules/commerce-promocode/**` — superseded by `src/modules/promo-code` (C5), which
  carries the `appliesTo`/`discountValue` contract this module documented as unresolvable.
- `src/modules/commerce-educator/**` — superseded by `src/modules/client-educator`.
- `src/modules/commerce-promoter/**` — superseded by `src/modules/admin-promoter` + `promoter-data`.

Deleted orphan utilities (each had a live replacement):

- `src/utils/cache.ts` → duplicate of `src/libs/cache.ts` (the one `middlewares/cacheRoute.ts` uses).
- `src/utils/pdfCourseReceipt.ts` → superseded by `src/libs/core/generate.ts` (EJS + Puppeteer;
  `buildCourseReceiptHtml`), which serves all four receipt kinds. **`pdfkit` is now an unused
  dependency in `package.json`** — left installed, safe to drop separately.
- `src/utils/categoryTree.ts` → Mongo-shaped (`_id` / `childCategoryIds`), unusable post-Mongo.
- `src/config/storageConfig.ts` → local-disk multer; real uploads go through
  `middlewares/upload.ts` (memory → Spaces). Also removed its import-time `mkdir uploads/` side effect.
- `src/client/learning/collapseProgress.ts` → per-video progress collapsing now lives in
  `src/modules/client-lecture-progress`.

Follow-up in the same sweep — stale tooling that referenced the deleted modules:

- **`docs/migration/api-tests/commerce-{promoter,promocode,educator}/`** — retired. Each suite
  contained only `skip: true` informational stubs and made **zero HTTP calls**, so they asserted
  nothing. Unwired from `run-all.ts`, `run-module.ts`, and `modules.manifest.ts` (26 entries left).
  `yarn migration:api` still loads; no per-module yarn script existed for these three.
- **`scripts/generate-schema-comparison.ts` + `scripts/generate-field-comparison.ts`** — deleted,
  along with their `docs:schema-comparison` / `docs:field-comparison` package.json entries. Both
  were Mongoose↔MySQL comparison generators that crashed on startup (`ENOENT src/models`) ever
  since the Mongo removal on 2026-07-01, and one also required an external sibling checkout
  (`../websankul-staging/database/websankul_staging.sql`). Their last generated output
  (`SCHEMA_COMPARISON.md` / `FIELD_COMPARISON.md`) is kept as a historical record.
- **`scripts/generate-migrated-modules.ts`** — the four entries for the deleted modules are
  **kept for history** (they record why those tables were migrated) but their `code:` paths now
  read "module DELETED 2026-07-22 — superseded by …" instead of pointing at directories that no
  longer exist, each with a matching note. `yarn docs:migrated-modules` runs clean (67 modules).

Deleted orphan handlers (exported but bound to no route):

- `createPermissionCategory` + its `createPermissionCategorySchema` — `POST /admin/permission-categories`
  deliberately returns **410** inline (categories derive from the code catalog). Behaviour unchanged;
  only the unused handler is gone. `permission-category.service.createCategory` was left in place.
- `lookupBookThumbnails` in `client/purchase-history/receipts.controller.ts` — last caller removed earlier.

---

## 2026-07-22 — Admin e-book `link` made optional — NO DB change

> **No DDL, no query/schema/index change.** Validator relaxation only.

- `src/admin/ebook/ebook.validation.ts` — `createEbookSchema.link` changed from
  `z.string().min(1, "Link is required")` to `z.string().optional().nullable()`.
  `updateEbookSchema` is `createEbookSchema.partial()`, so this covers
  `POST /admin/ebooks` and `PATCH|PUT /admin/ebooks/:id`. No URL-format check
  exists on the field, so an empty string passes validation and clears the link.
- **Write path unchanged** — `admin-ebook.service.ts` already coerced
  `d.link ?? ""` on create and `if (d.link !== undefined) data.shareableLink = d.link ?? ""`
  on update. Omitting `link` on update still leaves the stored value untouched.
- **Column stays as-is:** `ws_ebook.link` is `varchar(255) NOT NULL` with no
  default, so a cleared link is persisted as `''`, **not** NULL. Making it
  nullable would require an `ALTER` plus a `schema.prisma` edit and would turn
  `EBook.shareableLink` nullable across the client catalog transformers — not
  done; revisit only if the NULL representation is explicitly required.
- **Response contract unchanged:** `toEbookDto` (list + detail) and
  `catalog-ebook.transformer` emit `link` unconditionally, so a cleared ebook
  returns `"link": ""` rather than omitting the key.

---

## 2026-07-22 — Client API payload slimming (Phase 2, partial) — NO DB change

> **No DDL, no query/schema/index change.** Response-shape trims at the CLIENT
> controller edge via `utils/pick.ts` (`pick`/`pickList`/`omit`/`omitList`). Shared
> module builders/transformers UNTOUCHED. Source: `docs/api-optimization` Phase 2.
> Pagination envelope preserved. Nothing to backfill.

- **`utils/pick.ts`** — added `omit`/`omitList` (inverse of pick).
- **Dashboard (`client/dashboard/dashboard.controller.ts`)**
  - `GET /client/dashboard` — dropped top-level `todayDate`, `logo`,
    `unreadNotifications`; removed dashboard sections `type=course` +
    `type=courseCategory` (RN never renders them; badge uses /notifications/count).
    ⚠️ MEDIUM risk — confirm no web client reads popularSubjects/courseCategory.
    Per-section nested card slimming (banner/daily-test/trending) DEFERRED.
  - `GET /client/free-dashboard` — kept ONLY the `free-ebook` section (dropped
    trending-book/trending-ebook/video sections); slimmed free-ebook cards to
    `_id,name,author,thumbnail,image,isPurchased,daysLeft`; dropped top-level
    `todayDate`/`logo`. (buildFreeDashboard still computes dropped sections — a
    follow-up compute optimization, payload already slim.)
- **Recently Added (`client/recently-added/recently-added.controller.ts`)** —
  `GET /client/recently-added` — dropped per-card `packageType` + envelope `kinds`.
- **Upcoming batches (`client/live-course/live-course.controller.ts`)** —
  `GET /client/live-courses/upcoming-batches` — batch cards → `_id,name,image`;
  category chips → `_id,title,count`; dropped `selectedCategoryId` + the per-batch
  `shareableLink` (no longer computed). allCount/total/page/limit kept.
- **DEFERRED — `GET /client/search`**: the card-DTO reshape (P0, ~70–85%) needs RN
  confirmation of exact card fields (esp. book/ebook price keys) before projecting;
  not done blind. Medium risk per audit.

## 2026-07-22 — Client API payload slimming (Phase 1) — NO DB change

> **No DDL, no query/schema/index change.** Response-shape trims only, applied at
> the CLIENT controller edge via `utils/pick.ts` (`pick`/`pickList`). Shared module
> transformers are UNTOUCHED, so admin/other surfaces keep their full DTO shape.
> Source: `docs/api-optimization` audit (Phase 1, low-risk, backend-only). Pagination
> envelope preserved on every list (standing client-list rule). Nothing to backfill.

- **New util `utils/pick.ts`** — shallow keep-list projection; absent keys skipped.
- **CMS (`client/cms/cms.controller.ts`)** — client responses now project:
  - `GET /client/faqs` → `_id, typeId, question, answer` (drop `type,isExpand,createdAt,updatedAt`)
  - `GET /client/social-links` → `_id, title, link, typeId` (drop `icon,order,status,timestamps`)
  - `GET /client/live-banners` → `_id, image, liveCourseId, orderBy` (drop timestamps)
  - `GET /client/testimonials` → `_id, name, description, rating` (drop `title`)
- **Notifications (`client/notification/notification.controller.ts`)** —
  `GET /client/notifications` rows → `_id, title, titleHtml, body, bodyHtml, image,
  type, isRead, createdAt` (drop `customerId, deepLink, data, readAt, broadcast,
  status, updatedAt`). Envelope `unreadCount` + `pagination` KEPT.
- **Address (`client/address/address.controller.ts`)** —
  - `GET /client/address` → identity/display fields only (drop `phone, alternatePhone,
    email, customerId, status, createdAt, updatedAt`)
  - `GET /client/address/states` → `{_id, name}` (drop `stateCode`)
  - `GET /client/address/cities` → `{_id, name}` (drop `image, status, order, timestamps, stateId` obj)
- **Progress heartbeats → ack-only** (fire-and-forget, body ignored by player):
  - `POST /client/courses/lectures/:videoId/progress` → `{success, data:null}`
  - `POST /client/free-videos/:videoId/progress` → `{success, data:null}`

## 2026-07-21 — Cache TTLs → 24h + per-user purchase flush — NO DB change

> **No DDL, no query/schema/index change.** Route-cache tuning only (Redis).
> Recorded because `src/` files changed. Nothing to backfill.

- **New helper `flushUserRouteCache(userId, role="customer")`** in
  `middlewares/autoFlush.ts` — SCANs and deletes only ONE user's per-user cache
  keys (identity segment of the key) across all entities. Unlike entity-wide
  `flushEntity`, it doesn't wipe other users' caches.
- **Wired at every entitlement grant** so a buyer's `isPurchased` flips instantly:
  `payment/verify.controller` (all 6 kinds: course, package, ebook, book,
  live-course, test-series) and the admin grant controllers (admin/subscription
  `createCourseSubscription`, admin/ebook `createEbookSubscription`,
  admin/live-course `grantLiveCourseSubscription`).
- **All route TTLs bumped to 24h (`86400`)** across 38 route files, EXCEPT
  `GET /client/cart` (30s) and the dashboards (60s). Safe because content is
  flushed on admin edit and per-user `isPurchased` is flushed on purchase/grant.
- **Accepted caveat:** `isPurchased` `true→false` from subscription expiry or
  admin revoke reflects on the catalog card within the TTL (content access is
  gated live, so it's cosmetic). Admin subscription update/delete do NOT yet call
  the per-user flush.

`yarn typecheck` green. No response shapes changed.

## 2026-07-21 — Cart shipping accepts legacy addresses (cityId NULL) — NO DB change

> **No DDL, no query/schema/index change, NO backfill.** Recorded because files under
> `src/` changed (on-disk migration-doc mtime protocol). Post-migration bugfix on the
> already-SQL client-cart module.

- **Symptom:** old customers got *"Address is missing a city. Please update the address
  before using it for delivery."* when attaching a saved address at checkout.
- **Cause:** `ws_customer_address` has BOTH a legacy `city` free-text string and the newer
  nullable `cityId`. Addresses created before the city-picker have `city` populated but
  `cityId = NULL`. `attachShipping` (client-cart.service.ts) resolved the city name ONLY
  from `cityId`, so legacy rows failed the `reason:"city"` guard despite having a valid city.
- **Fix:** `src/modules/client-cart/client-cart.service.ts` — after the `cityId` lookup,
  fall back to the row's own `address.city` string (`(address.city ?? "").trim()`) before
  rejecting. No data migration required — the value was already on the row. New addresses
  (cityId set) are unchanged; the offline-city resolution still wins when present.

## 2026-07-21 — Project-wide route-cache sweep (admin + client) — NO DB change

> **No DDL, no query/schema/index change.** Route-level response caching only
> (Redis), following `docs/CACHING.md`. Recorded because many `src/**/*.routes.ts`
> files changed. Nothing to backfill or regression-test at the DB layer.

Applied `cacheRoute` to read routes and `autoFlushGroup`/`autoFlush` to the matching
writes across the whole API, per the tiering rules in `docs/CACHING.md`:

- **Admin master reads cached + all writes flush** (were previously unflushed): book,
  package (+ package-type), exam (+ exam-category + questions), material (+ material-
  category), video, videoCategory, goal, examCountdown, promocode, plan, live-course,
  cms (faq/popup/banner/testimonial/social-link/current-affair/terms), master
  (educator/subject-category/material/video-category/package-category). course gained
  video-sub-route caching + video-category/material relation flushes. plan-popularity
  pin/recompute now `autoFlush("plan")`.
- **Client Tier-1 shared reads cached:** examCountdown, goal `/`, promocode `/`,
  referral `/terms`+`/faqs`, inquiry `/contactus`, notification `/image-notifications`,
  address dropdowns, app-version `/check`, offline center/batch masters.
- **Client Tier-2 product list/detail** (per-user `isPurchased` overlay) cached
  `scope:"user"` 60s with catalog-* entity, extending the ebook precedent: book,
  course, package, catalog materials, categories listings, material, exam, free,
  educator, testSeries, recently-added, live-course discovery feeds.
- **Security fix:** `GET /client/free/free-videos` was cached `scope:"shared"` but
  mints a customer-bound `mediaToken` per row (`shapeVideo` → `cust:id`) — a shared
  key served one user's token to all. Changed to `scope:"user"`. `free-materials`
  verified safe (its customerId arg is unused) and left `shared`.

`yarn typecheck` green throughout. No response shapes changed (cache is transparent).

## 2026-07-21 — Cart cache now flushed on admin book price edits — NO DB change

> **No DDL, no query/schema/index change.** Recorded because files under `src/` changed
> (on-disk migration-doc mtime protocol). Post-migration cache-invalidation bugfix on the
> already-SQL book + client-cart modules; nothing to backfill or regression-test at the DB
> layer. The cart already reads book prices LIVE (Prisma join, no stored snapshot) — this
> only fixes when the cached HTTP response refreshes.

- **`src/middlewares/flushGroups.ts`** — added `"cart"` to `FLUSH_GROUPS.book`. The client
  cart embeds live book price columns (`discounted_price` / `list_price` / `shipping_price`),
  so an admin book edit must stale cached `GET /client/cart` reads (`entity:"cart"`), not
  just the book/catalog-book/dashboard caches.
- **`src/admin/book/book.routes.ts`** — book write routes previously flushed NOTHING. Wired
  `autoFlushGroup("book")` onto create / update / delete / `:id/status` / `:id/trending` /
  reorder (matching `admin/ebook`), and `autoFlush("cart")` onto `PUT /settings` (it changes
  the free-shipping threshold the cart total depends on). An admin price change now sweeps
  the cart cache immediately instead of waiting out the 30s TTL.

## 2026-07-21 — Client eBook route caching + ebook smoke-test harness — NO DB change

> **No DDL, no query/schema/index change.** Recorded because files under `src/` changed
> (on-disk migration-doc mtime protocol). Post-migration change on the already-SQL ebook
> module; nothing to backfill or regression-test at the DB layer.

- **`src/client/ebook/ebook.routes.ts`** — added route-level response caching to the two
  Tier-2 reads: `GET /client/ebooks` and `GET /client/ebooks/:id` now use
  `cacheRoute({ ttl: 60, entity: "catalog-ebook", scope: "user" })` (per-user key,
  short TTL, `isPurchased` overlay). Invalidation already wired: admin ebook writes call
  `autoFlushGroup("ebook")` → flush map clears `catalog-ebook`. Tier-3 routes
  (subscriptions / invoice / downloads) left uncached. `docs/CACHING.md` updated.
- **Test harness** — new admin ebook smoke test (`docs/migration/api-tests/ebook/admin.api.test.ts`),
  single `ebook` module key (admin + client) in `run-module.ts`, `yarn migration:api:ebook`
  script. Legacy `MIGRATION_MYSQL_MODULES` gate in `_lib/{env,auth}.ts` made a no-op
  (Mongo removal complete → all modules on MySQL). Brittle staging-snapshot assertion in
  `catalog-ebook/client.api.test.ts` changed to a contract check (language filter returns
  only that language). Added `scripts/seed-dummy-ebooks.ts` (test-only `ws_ebook` seeder,
  `DUMMY_SEED`-tagged, `--clean` to remove).

## 2026-07-21 — Merged `caching_management` branch (route-level response cache) — NO DB change

> **No DDL, no query/schema/index change.** Recorded only because merging the branch
> touched files under `src/` (satisfies the on-disk migration-doc mtime protocol);
> there is nothing to backfill or regression-test at the DB layer.

Pulled GitHub `origin/caching_management` into the working branch. Adds **route-level HTTP
response caching** (serialized responses cached in Redis, opt-in per route, invalidated on
write). Does **not** alter any Prisma query, table, column, or index, and does not change
any API response shape (a cache HIT returns the same JSON the handler would).

- New middleware: `src/middlewares/cacheRoute.ts`, `autoFlush.ts`, `flushGroups.ts`
  (`CacheEntity` union + admin→client flush map).
- New admin surface: `src/admin/cache/` (`POST /admin/cache/flush`, `GET /stats`), wired as
  `adminCacheRoutes`.
- eBook reads tagged `entity:"ebook"`; eBook writes call `autoFlushGroup("ebook")`.
- Authoritative doc: `docs/CACHING.md`. Redis outage = fail-open.
- **Not a Mongo→SQL migration** — no changes to `MONGO_ONLY_MIGRATION_PLAN.md`,
  `MIGRATION_TRACKER.md`, or `MIGRATION_TEST_LOG.md`.

---

## 2026-07-20 — `web` permission catalog: cap every module to 5 core actions

> **Code + DB-data change (no DDL).** Drops `list` + all extra actions from the `web`
> catalog; DB rows pruned by the cleanup script at deploy.

Follow-up to the keep-list reconciliation (req: `permission-catalog-minimal-actions-web.md`).
Each `web` module now exposes only `view, create, edit, delete, toggle-status` (reports →
`view`; settings → `view, edit`). `list` and every extra (`duplicate`, `publish`,
`moderate`, `start/end/cancel`, `send`, `bulk-*`, `view-details`, `view-dashboard`,
`update-status`, `assign`, `assign-role`, `reset-password`, `assign-permissions`, `export`,
`import`, `attach/detach`, `invalidate`) were removed.

- **`permissions.catalog.ts`:** `STANDARD_6`→`STANDARD_5` (dropped `list`); removed all
  `extras` and the `extra()` helper; reports (`books.orders`, `ebooks.subscriptions`,
  `subscriptions.reports`, `referrals.report`, `referrals.transactions`) → `["view"]`;
  `tracking`/`guards` → `["view"]`; `permissions`/`permission-categories` → standard 5
  (per keep-list §2 — also clears the earlier pre-existing not-in-catalog flag).
- **`rbacRouteMap.ts`:** `view()` helper now gates on `<m>.view` only (no `.list`), so
  `.list` is no longer enforced/protected and gets pruned. Re-pointed every extra-gated
  route to a standard-5 key: report writes → parent (`books.orders`→`books.edit`,
  `ebooks.subscriptions`→`ebooks.*`, `referrals.transactions`/withdrawals→
  `referrals.settings.edit`); `bulk-status`→`toggle-status`, `bulk-delete`/`send`→
  `delete`/`create`, `assign-permissions`/`assign-role`/`view-details`/`view-dashboard`/
  `moderate`/`start`/`end`/`cancel`/`duplicate`/`update-status` → their CRUD equivalent.
- **Invariant re-verified:** all 265 enforced keys exist in the catalog (no lockout);
  every web module ≤5 actions.
- **DB:** the now-orphan `.list`/extra rows are deleted by
  `scripts/cleanup-web-permissions.ts` (prunes rows outside `catalog ∪ route-keys ∪ *`).

FE impact: none code-wise (FE groups the Role modal by module; ≤5 actions each). No API
envelope change.

---

## 2026-07-20 — `web` permission catalog: full keep-list reconciliation (collapse nested keys)

> **Code + DB-data change (no DDL).** Removes ~26 sub-namespace modules from the `web`
> catalog and re-points their enforcement to parent keys; DB rows deleted by the cleanup
> script at deploy.

Reconciles the `web` catalog to the admin-frontend keep-list
(`docs/backend-requests/permission-catalog-keep-list-web-guard.md`). The frontend gates
each area on its **parent** module key, but `rbacRouteMap.ts` gated many routes on finer
sub-namespaces. Deleting those would lock the routes out under `RBAC_ENFORCE`, so each was
**collapsed into its parent** instead of dropped.

- **`rbacRouteMap.ts`:** re-pointed every rule on a removed sub-namespace to the kept
  parent — `courses.{plans,videos,materials,video-categories}`→`courses`,
  `customers.{addresses,course/ebook-subscriptions}`+`customer-masters.*`→`customers`,
  `live-courses.{plans,folders,videos,subscriptions}`→`live-courses`,
  `quizzes.{questions,submissions,analytics}`→`quizzes`,
  `test-series.{plans,subscriptions}`→`test-series`, `ebooks.plans`→`ebooks`,
  `packages.plans`→`packages`, `live-sessions.polls`→`live-sessions`,
  `promoters.subscriptions`→`promoters`, `video-categories`→`videos.categories`.
- **`permissions.catalog.ts`:** removed those modules. Invariant verified — all 344
  enforced keys still exist in the catalog (no ungrantable/lockout keys introduced).
- **Retained + flagged (no parent to collapse into):** `subscriptions` (mgmt, §4 verify),
  `cms.app-version`, `cms.app-update`, `offline.banners`, `inquiries` (general),
  `tracking`, `guards` — kept enforced pending FE confirmation.
- **DB:** removed keys are deleted + unassigned from roles by the existing
  `scripts/cleanup-web-permissions.ts` (it prunes rows outside `catalog ∪ route-keys ∪ *`).

FE impact: `docs/admin/PERMISSION_CATALOG_KEEPLIST_FRONTEND.md`. No API envelope change.

---

## 2026-07-20 — `ws_permissions` / `ws_permission_category`: populate & backfill `created_at` / `updated_at`

> **DB data change (no DDL).** Sets timestamps on new rows and backfills legacy NULLs.

Rows seeded before the Prisma timestamp middleware existed (pre-2026-07-16) have NULL
`created_at`/`updated_at`. Fixed on both the write and the existing-data side:

- **Create path (`permissions.seeder.ts`):** the catalog sync now **reuses** existing rows
  by (name, guard) as before, and stamps `createdAt`/`updatedAt` **explicitly** on every
  newly-created permission (`createMany`) and category (`upsert.create`) — no longer
  relying solely on the middleware.
- **Self-heal backfill (`permissions.seeder.ts`):** after seeding, one `updateMany` per
  table sets `createdAt`/`updatedAt = now()` where either is NULL. Idempotent (0 rows after
  first run); flows through the IST write-shift like any Prisma write.
- **Admin create (`permission-category.service.ts`):** the create-category endpoint now sets
  explicit timestamps too (matches `admin-rbac.repository.ts`, which already did).

No response-shape change: the catalog endpoint doesn't surface timestamps; the RBAC/category
admin lists already returned `created_at`/`updated_at` (type `Date | null`) — values simply go
from `null` → populated. See `docs/admin/PERMISSION_TIMESTAMPS_ADMIN.md`.

---

## 2026-07-20 — `web` permission catalog cleanup: prune legacy/non-catalog `ws_permissions` rows

> **DB data change (no DDL).** Deletes rows from `ws_permissions` (+ dependent grants in
> `ws_role_has_permissions` / `ws_model_has_permissions`) for guard `web`. Run at deploy.

Reconciles the `web`-guard permission catalog toward the admin frontend keep-list
(`docs/backend-requests/permission-catalog-keep-list-web-guard.md`). The catalog endpoint
renders from `ws_permissions` rows, not the in-code registry, so removal requires a DB
cleanup, not just a registry edit.

- **Registry:** removed module `customer-masters.states` from `PERMISSION_CATALOG`
  (`src/admin/permission/permissions.catalog.ts`) — the only removal candidate that was
  both unlisted by the frontend **and** not enforced by `rbacRouteMap`. `CATALOG_VERSION`
  → `2026.07.20-1`.
- **Cleanup script:** `scripts/cleanup-web-permissions.ts` (dry-run default, `--apply`).
  Deletes `web` `ws_permissions` rows whose name ∉ `catalogKeysForGuard("web") ∪
  RBAC_ROUTE_KEYS ∪ {"*"}`, unassigning them from role/model grant pivots first. Clears
  legacy pre-registry keys (bulk of the reported 661) with no enforcement impact.
- **New export:** `RBAC_ROUTE_KEYS` from `src/middlewares/rbacRouteMap.ts` (deduped set of
  every enforced key) so the cleanup computes its protected set from the enforcement map.
- **Deliberately NOT removed:** ~31 namespaces the frontend keep-list omits but the backend
  route map still gates (e.g. `courses.plans`, `live-courses.*`, `test-series.*`,
  `inquiries`, `subscriptions`) — deleting them would deny non-super-admins once
  `RBAC_ENFORCE` flips on. Pending cross-team decision; see the `-RESPONSE.md` doc.

**Deploy:** `npx tsx scripts/cleanup-web-permissions.ts` (review) → `--apply`.

---

## 2026-07-20 — Admin `/admin/address/cities` list: newest-first (id desc) instead of name asc

> **No schema/DDL change.** Query-order change only. Post-migration bugfix on an
> already-SQL module (customer-lookups).

`src/modules/customer-lookups/customer-lookups.repository.ts` `listAdminDistricts` changed
`orderBy` from `{ name: "asc" }` to `{ id: "desc" }` so last-created cities appear at the top
of the admin list. Cities are sourced from `ws_customer_distict`, which has **no timestamp
column** (DTO returns `createdAt: null`), so the auto-increment PK `id` is used as the
creation-order proxy. Scoped to the admin list (`listAdminDistricts`) only — the client
`/client/address/cities` path (`listActiveDistricts`) still orders `name: "asc"`. Response
shape unchanged; pagination (`countAdminDistricts`) unaffected.

---

## 2026-07-21 — Client dashboard: `unreadNotifications` now dismissal-aware (badge sync fix)

> **No schema/DDL change.** Query-shape fix only.

`buildHomeDashboard` (`client-dashboard.service.ts`) counted `notification.count({ isRead:false,
OR:[{customerId},{broadcast}] })` — it did **not** exclude dismissed ids, so after a client
delete (`/notifications/delete`) the home dashboard badge stayed lit while the feed +
`/notifications/count` had already dropped it. Fixed by reusing
`client-notification.service.unreadCount(customerId)`, which excludes `ws_notification_dismissal`
ids. All three badge sources (dashboard `unreadNotifications`, feed `unreadCount`, and
`GET /notifications/count`) now use the identical filter and stay in sync.

## 2026-07-21 — Client: new lightweight unread-count endpoint `GET /client/notifications/count`

> **No schema/DDL change.** New read-only route + controller only. Doc:
> `docs/client/NOTIFICATION_UNREAD_COUNT_FRONTEND.md`.

Added `GET /api/v1/client/notifications/count` (`getUnreadCount` controller) so the app can
refresh the bell badge without re-fetching the full paginated feed. It wraps the existing
`client-notification.service.ts → unreadCount(customerId)`, which counts
`(customerId = me OR broadcast) AND isRead = false AND id NOT IN (dismissed)`. Because it
reuses the same filter as the feed's `unreadCount` and excludes dismissed ids, the badge
stays in sync across mark-read / mark-all / delete. Route registered **before**
`/notifications/:id/read` so `count` isn't captured as an `:id`. Postman updated.

## 2026-07-20 — FCM: reverted per-platform HTML tray split → PLAIN on both Android + iOS

> **No schema/DDL change.** Push-payload shape only. `title_html`/`body_html` columns and
> the client-feed `titleHtml`/`bodyHtml` fields are untouched. Doc:
> `docs/admin/NOTIFICATION_PER_PLATFORM_HTML.md`.

`src/utils/fcm.ts` `buildMessage` previously fed the HTML variant into `android.notification`
(formatted Android tray) while iOS got plain. Per request, the tray is now **plain on both
platforms** — `android.notification` and `apns.aps.alert` both use the plain `title`/`body`.
The HTML is still carried in the FCM `data` payload (`titleHtml`/`bodyHtml`) and persisted on
`ws_notification`, so the **in-app inbox** still renders rich text; only the push tray/banner
reverted to plain. Immediate + scheduled + targeted paths all inherit this via the shared
`sendPush`.

## 2026-07-20 — Admin Offline Section: re-mounted its own offline-city CRUD (`ws_offline_city`)

> **No schema/DDL change.** Route mount only. Frontend contract:
> `docs/admin/OFFLINE_CITY_VS_DISTRICT_ADMIN.md`.

The admin panel has two distinct "city" masters and they must not be conflated:
- **`/admin/offline/cities`** → `ws_offline_city` (offline centers reference these ids;
  carry image + order + state).
- **`/admin/address/cities`** → `ws_customer_distict` districts (customer addresses
  reference these ids) — unchanged.

The offline-city admin CRUD handlers already existed in
`src/admin/offline/offline.controller.ts` (backed by `modules/offline-city/*`) but their
routes were commented out when the admin "Cities" master screen was repointed to districts —
which left the **Offline Section with no city API of its own**. Re-mounted
`GET/POST /admin/offline/cities`, `GET/PUT/DELETE /admin/offline/cities/:id`
(`src/admin/offline/offline.routes.ts`). Delete is guarded `409` when the city still has
centers. Mirrors the already-differentiated client side (`/client/address/cities` = districts,
`/client/offline/*` = offline cities).

---

## 2026-07-20 — Admin profile: empty-string `image` now clears the profile photo

> **No schema/DDL change.** Controller input handling only. Source:
> `docs/backend-requests/profile-remove-image-not-persisting.md`.

`PUT /admin/auth/profile` (multipart) previously only set `image` from an uploaded
file, so a "Remove Photo" submit (empty-string `image`, no file) resolved to
`undefined` → the repo skipped the column → the old image persisted. The handler now
distinguishes three cases (mirrors goal / video-category): file → new URL; `image=""` →
clear; absent → unchanged. `AdminUser.image` is `NOT NULL VarChar(255)`, so cleared is
stored as `""` (not SQL NULL) and the DTO returns `image: ""`. Service-level S3 cleanup
of the previous image already fires because `"" !== oldUrl`.

---

## 2026-07-20 — Admin picker unblockers: by-id reads, promoter/category filters, pc-material pagination

> **No schema/DDL change.** Query-shape + new read endpoints only (server-search
> support for admin dropdown pickers). Source: `docs/backend-requests/server-search-blockers.md`.

Backend support so the admin frontend can drop capped `limit: 200/500` eager dropdown
fetches in favor of server-searched type-ahead pickers:

- **`GET /admin/goals/:id`** — new. `customerTargetGoal.findUnique({ where: { id } })` →
  old ws_goal DTO (`_id, title, labels:[{id,name}], image, isActive`). Lets a picker
  resolve the selected goal's `labels[]` for its dependent Goal-Label sub-dropdown.
- **`GET /admin/educators/:id`** — new lightweight read. `courseEducator.findUnique` →
  `toEducatorListDto`. (Distinct from the existing heavy `/:id/details` aggregate.)
- **`GET /admin/subject-categories/:id`** — new. `courseSubjectCategory.findUnique` →
  subj DTO.
- **`GET /admin/promocodes?promoterId=<id>`** — new optional list filter. Adds
  `where.promoterId = <id>` to `listPromocodes`. Invalid id → 400.
- **`GET /admin/exam-countdowns?categoryId[]=…` / `?categoryIds=a,b`** — countdown list
  now scopes by an **array** of categories (`where.categoryId = { in: [...] }`); still
  accepts a single `categoryId` (back-compat). Any invalid id → 400.
- **`GET /admin/pc-materials`** — now supports `?search=` + opt-in `?page/?limit`
  pagination (`buildPrismaSearch` on title + `packageCourseMaterial.count`). No
  page/limit → full list (back-compat, unchanged shape for eager callers incl.
  `GET /admin/materials`).

---

## 2026-07-20 — Notifications: per-platform HTML (Android) / plain (iOS) + `title_html`/`body_html`

> **New columns.** DDL: `docs/migration/schema-changes/2026-07-20_notification_html_columns.sql`
> **No backfill** (existing rows keep NULL html). Apply DDL on deploy, then `prisma:generate`.
> **Frontend contract:** `docs/admin/NOTIFICATION_PER_PLATFORM_HTML.md`

Adds optional rich-text (HTML) variants to admin notifications so pushes render
per-platform: **Android → HTML title/body**, **iOS → plain** (iOS banners show raw tags
otherwise). The frontend sends `title`/`body` (plain, always) plus `titleHtml`/`bodyHtml`
(only when formatting exists). Endpoint unchanged: `POST /api/v1/admin/notifications/broadcast`.

- **Schema:** `ws_notification` gains `title_html TEXT NULL`, `body_html TEXT NULL`
  (Prisma `Notification.titleHtml` / `.bodyHtml`). Persisted on immediate log, scheduled
  row, and per-recipient fan-out rows — so the in-app inbox + re-send keep formatting.
- **FCM (`utils/fcm.ts`):** one multicast now carries per-platform overrides —
  top-level `notification` = plain (fallback), `android` config = HTML-source title/body,
  `apns` alert = plain (iOS never receives tags), and `data` carries plain + html for the
  Android app's `Html.fromHtml` path.
- **Client feed DTO** (`client-notification.service.ts`): now returns `titleHtml`/`bodyHtml`
  (nullable) alongside `title`/`body` for rich in-app rendering.

---

## 2026-07-20 — Postman collection reorg: removed "Auto-synced" dumping folders

> **Docs-only** (no code / DB change). File: `docs/postman/WebSankul-Complete-2026.postman_collection.json`

Dismantled the `🔄 Auto-synced (missing endpoints) — 2026-07-16` wrapper folders (a
one-off staging dump, not produced by any generator) across all four surfaces. Their
107 lowercase subfolders were merged into the matching curated `emoji + Title` folders
(dedup by `METHOD + path`) or promoted to their own well-named `Surface + Title Case`
folders. All **925 endpoints preserved**, zero duplicates introduced, no wrapper left.

---

## 2026-07-20 — Client notification delete (per-user dismissal): NEW `ws_notification_dismissal`

> **New table.** DDL: `docs/migration/schema-changes/2026-07-20_notification_dismissal.sql`
> **No backfill** (starts empty). Apply the DDL on deploy, then `yarn prisma:generate`.
> **Frontend contract:** `docs/client/NOTIFICATION_DELETE_FRONTEND.md`

Adds client-side notification delete (single / multi / all). "Delete" is a **per-customer
dismissal**, not a row delete — broadcast notifications (`ws_notification.broadcast = 1`)
are shared across all customers, so a hard delete would wipe them from everyone's feed.
Each delete inserts `(customer_id, notification_id)` into `ws_notification_dismissal`
(unique pair, idempotent via `skipDuplicates`/`upsert`).

**Query-shape change** — `client-notification.service.ts`:
- `listNotifications` + `unreadCount` now exclude dismissed ids: the visibility filter
  `(customer_id = me OR broadcast = true)` gains `AND id NOT IN (<dismissed for me>)`.
  Applies to the feed list, its total, AND the unread badge (a deleted item must not
  keep the badge lit).

**New endpoint** (Bearer-auth, under `/api/v1/client`) — one route covers single/multi/all:
- `POST /notifications/delete` — body `{ ids: number[] }` dismisses those ids (single =
  one-element array); body `{ all: true }` dismisses the whole visible feed. Returns
  `deleted` count. Ids not visible to the caller are silently skipped.

Model `NotificationDismissal` → `prisma.notificationDismissal` → `ws_notification_dismissal`.

---

## 2026-07-17 — Quizzes: multiple parent categories (`ws_exam_category_pivot` re-purposed)

> **No schema change.** Query-semantics + write-contract change on an existing table.
> **Cleanup script:** `scripts/cleanup-exam-category-pivot-ancestors.ts` (dry-run by default)

A quiz may now be filed under **one or more** leaf exam categories, not exactly one.
Frontend spec: `docs/backend-requests/exam-multiple-parent-categories.md` (§4 asks for a
new `ws_exam_exam_category` table — **not built**: `ws_exam_category_pivot` already has
that exact shape, unique pair + cascade + category index).

**Meaning of `ws_exam_category_pivot` changed.** It previously held the primary category
**plus every ancestor** (a denormalized rollup written by `replaceExamCategoryPivot`). It
now holds **only the categories an admin chose** — always leaves. Rationale: with rollup
rows in the same table there is no way to read the admin's actual selection back out for
the edit modal's chips (an ancestor is indistinguishable from a selection), and the rollup
could not express a second category's ancestors anyway.

- `replaceExamCategoryPivot(examId, primaryCategoryId)` → **`setExamCategories(examId, categoryIds[])`**
  (full-replace; deletes rows not in the set, `skipDuplicates` insert → idempotent, preserves `created_at`).
- New `validateLeafCategoryIds()` — each id must exist, not be soft-deleted, and be a leaf.
- New `descendantExamCategoryIds(rootId)` — recursive self-FK walk (`WITH RECURSIVE`).

**Query-shape change — parent lookups now expand at READ time.** Because the pivot no
longer stores ancestors, matching a parent id against it directly returns nothing. Sites
passing a single unexpanded id were changed to expand first:

- `client-exam.repository.examsByCategory` / `examsByCategoryPaged` / `countExamsByCategoryPaged`
  now take `categoryIds: number[]` (subtree) instead of `categoryId: number`;
  `client-exam.service` expands via `descendantExamCategoryIds`. **Behaviour preserved**
  (a parent still surfaces its subtree's quizzes) but now explicit rather than dependent
  on pivot contents.
- **Unchanged on purpose:** `catalog-exam.repository.countExams` (result only consumed for
  leaf nodes — `havingChildDirectory ? folders : examCount`), `examCountForCategory`
  (delete guard; categories with children are already blocked by `has_children`), and the
  admin `?categoryId=` filter (spec §5.3 wants an exact match, no roll-up).
- `client-catalog`, `catalog-course`, `catalog-package`, `client-free` already expanded
  their own descendant sets → unaffected.

**API contract:** `POST/PUT /admin/quizzes` accept `categoryIds: string[]` (JSON) or
repeated `categoryIds[]` keys (multipart; a lone scalar is lifted to a 1-element array).
Non-empty; deduped; omitted ⇒ links untouched; present-but-empty ⇒ 400. Legacy scalar
`categoryId` still accepted. `GET /admin/quizzes` + `/:id` return populated
`categoryIds: [{_id,name}]` (soft-deleted categories excluded). `ws_exam.exam_category_id`
is **retained** as the primary (first chosen) category — it is `NOT NULL` and still
OR-matched by `examInCategoriesWhere`; §6's `DROP COLUMN` is **not** done.

**Legacy data:** pivot rows written before this change include ancestors and would render
as bogus chips. Run the cleanup script (`--apply`) to strip rows whose category has active
children; it skips (and reports) any exam filed only on a non-leaf, rather than orphaning it.
`scripts/seed-exam-category-pivot.ts` also updated to stop seeding ancestors.

**Verified** against `websankul_staging_1` (exam 300004): pivot `[112,124,149]` →
`[148,149]`; populated `categoryIds` on detail + list; `?categoryId=` finds the quiz via
**both** 148 and 149 with no duplicate rows; re-save idempotent; empty / non-leaf / missing
ids rejected with the pivot left unchanged.

**Still open:** category-delete relaxation (block only when a delete would leave a quiz
with zero categories, instead of the current blanket `has_exams` 400) + the bulk-reassign
endpoint that gives admins an exit. Not yet implemented.

---

## 2026-07-17 — Dropped 2 stale tables: `ws_user_inquiry` + `ws_live_course_category`

> **DDL:** `docs/migration/schema-changes/2026-07-17_drop_stale_tables.sql`
> (applied to LOCAL only — see the prod gate below). Schema model removed + client regenerated.

Found by a full static audit of `src/`: no Prisma accessor, no relation `include`, no
raw-SQL mention, and **zero inbound foreign keys** on either. Local row counts: both 0.
Table count 133 → 131.

- **`ws_live_course_category`** — architecturally **superseded**, not merely unused. Live-course
  categories live as JSON on `ws_live_course.material_categories` / `exam_categories`, read via
  a local helper. The near-miss worth recording: `client-catalog.service.ts:61` defines
  `liveCourseCategoryIds`, a *function name* that greps identically to a
  `prisma.liveCourseCategory` accessor — the table looked used and wasn't. Its
  `LiveCourseCategory` model is removed from `schema.prisma` (hand-edited, per the
  never-`db:pull`-for-small-changes rule) and the client regenerated.
- **`ws_user_inquiry`** — contact/inquiry form, never modelled, no code path. latin1 charset +
  camelCase columns = pre-migration legacy.

**Verified:** both absent from `information_schema`; `yarn typecheck` green; Prisma client
regenerates without the dropped model; live-course reads still work (4 rows).

### 🚩 PROD GATE — do NOT run this DDL on staging/prod unchecked

`ws_user_inquiry` holds **personal lead data**: name, email, phone, city, dob, gender,
education, inquiryFor. It is empty and code-stale *locally*, but **"no code reads it" is not
"no data in it"** — a lead-capture table like this is commonly read by hand (exports /
phpMyAdmin) by sales, which no code audit can detect. Before running anywhere else:

1. `SELECT COUNT(*) FROM ws_user_inquiry;`
2. If > 0: **export the rows and confirm with the business** before dropping.

`ws_live_course_category` carries no such risk (superseded by design, no personal data).

The DDL file records the exact `CREATE TABLE` statements for both as a rollback — **structure
only; dropped rows are not recoverable from it.**

---

## 2026-07-17 — `ws_test_series` created_at/updated_at never written (same hazard as the order table)

> **Write-path fix — no schema/DDL, no query-shape change.** Post-migration bugfix on an
> already-SQL module (`admin-testseries`).

`ws_test_series` rows read back `created_at: null`. Neither write path set the
timestamps: `createTestSeries` omitted both, `updateTestSeries` omitted `updatedAt`.
Nothing else fills them in — the column has **no DB default and no ON UPDATE**, and the
Prisma model declares **neither `@default(now())` nor `@updatedAt`**. Same defect as
`ws_test_series_order` (logged below), one table up.

Now: `createTestSeries` sets `createdAt` + `updatedAt`; `updateTestSeries` sets
`updatedAt`. Both take an injectable `now` for testability, matching `createOrderMysql`.

**Verified** by round-tripping the real service against MySQL: `createdAt` populates on
create, is preserved across a subsequent update, and `updatedAt` advances independently.
Probe row deleted afterwards.

**No backfill** — the one existing row has no recoverable creation time. Consistent with
the order-table decision: a fabricated timestamp is indistinguishable from a real one,
and a null that reads "unknown" is more honest.

### ⚠ Systemic — this is a table-family hazard, not two isolated bugs

**Every** `ws_test_series*` table has a `created_at` with no default and no auto-update,
so each write path must remember to set it by hand — and two authors already forgot:

| Table | created_at write path |
|---|---|
| `ws_test_series` | ✅ fixed here |
| `ws_test_series_order` | ✅ fixed (entry below) |
| `ws_test_series_subscription` | ✅ already explicit (has the warning comment) |
| `ws_test_series_content_category` | ⚠ **unaudited** |
| `ws_test_series_exam` | ⚠ **unaudited** |
| `ws_test_series_price` | ⚠ **unaudited** |

The durable fix is a DDL adding `DEFAULT CURRENT_TIMESTAMP` / `ON UPDATE CURRENT_TIMESTAMP`
so the DB guarantees the value instead of relying on every future author. **Not done
here** — it interacts with the IST-in-DB Prisma middleware (which shifts writes +5:30;
a DB-side `CURRENT_TIMESTAMP` would NOT be shifted and would land 5.5h off the
app-written rows). Needs deliberate design — see docs/migration/IST_STORAGE_MIGRATION.md.

---

## 2026-07-17 — Report `status` filter: reject unknown values (was silently unfiltered) + test-series order timestamps

> **Filter-contract change (all four subscription reports) + a write fix.** No schema/DDL.

### 1. `statusWhere` silently ignored unrecognised values

`statusWhere(status)` (`utils/reportFilters.ts`) is a **JS switch on exact lower-case
strings** and returned `{}` — no filter — for anything it didn't recognise. So
`?status=ACTIVE` (what the admin UI sent) wasn't rejected, it was **ignored**: the
endpoint returned a plausible, unfiltered list that an admin would trust. Worst failure
mode available. `isReportStatus` existed as the validator all along and had **zero
callers** — written, never wired up.

- `statusWhere`: absent/`""` → `{}` (unchanged — most callers pass nothing and mean
  "no filter"); unrecognised → **throws 422**. Backstop so no future caller can
  reintroduce the silent swallow.
- New `assertReportStatus(status)` — boundary validator, wired into the three parsers
  that passed `q.status` through raw: `subscription.controller.ts` (`reportQueryFrom`),
  `testSeries.controller.ts` (`parseSubReportQuery`), `live-course.subscription.controller.ts`
  (`buildSubReportQuery`).
- New `failureFrom(res, err, fallback)` (`utils/httpResponse.ts`) — honors a thrown
  `HttpError`'s 4xx instead of flattening it to an opaque 500; wired into the 6 affected
  test-series/live-course handlers (list + CSV + Excel each). `subscription.controller`'s
  three handlers return a hand-rolled `{success,message}` envelope — **left as-is**, only
  the status code corrected via a local `errStatus` helper.
- `ebook-subscription.controller.ts` had a **separate copy** of the same silent-drop and
  now rejects via its existing `ok:false` → 400 channel. It still accepts legacy
  `true`/`false` booleans, which is why it can't reuse `assertReportStatus` directly.

**Behaviour change:** `?status=<unknown>` now 422s (400 for ebook) instead of returning
everything. FE has already shipped lower-case for both filters and dropped the
nonexistent `Failed`/`Cancelled`/`Revoked` options, so no compatibility risk. `Revoked`
never existed in any casing — the enum is `active | expired | inactive`.

**Verified:** `undefined`/`""` → `{}`; `active`/`inactive` → correct fragments;
`ACTIVE`/`revoked` → 422; ebook still accepts `true`/`false`.

**Deliberately NOT tightened:** `book.controller.ts:274` (`BookOrderStatus`) has the same
silent-drop shape but a different enum and doesn't use `statusWhere`. Tightening it could
break a caller that sends a value today — needs its own FE check first.

### 2. `ws_test_series_order.created_at` / `updated_at` never set on client checkout

`created_at` is nullable with no DB default, and `createOrderMysql`
(`test-series-order.service.ts`) omitted it — so client-checkout orders read back
`createdAt: null`, rendered `—` in the admin Orders tab, and sorted unpredictably under
the list's `orderBy: { createdAt: "desc" }`. The **admin grant path already set them**
(`admin-testseries.service.ts`), which is why admin-granted rows were the only populated
ones. The identical hazard was already documented three lines below, on the subscription
create.

Now sets `createdAt`/`updatedAt` on create and `updatedAt` on the verify →
`complete` transition. **No backfill** — orders with a null `created_at` have no reliable
creation time anywhere, and a fabricated timestamp would be indistinguishable from a real
one. A null that reads "unknown" is the honest answer.

### ⚠ Related, NOT fixed — test-series payments have no webhook

The only writer of `status: "complete"` on the client path is `verifyOrderMysql`, called
solely from `client/payment/verify.controller.ts` — a synchronous, browser-driven call
after Razorpay returns. **No webhook backs it.** If a customer pays and closes the tab,
Razorpay captures the money and the order stays `pending` forever with no subscription
granted — indistinguishable from ordinary abandonment. So **`pending` is not a safe proxy
for "didn't pay"**, and the Orders tab can't be trusted for reconciliation until this is
addressed. Read-only first step (agreed with FE): query Razorpay for captured payments
whose `order_id` matches a `pending` row, to establish whether this has already bitten
anyone. Payment-flow change — needs sign-off before design.

---

## 2026-07-17 — Strip legacy ancestor rows from `ws_exam_category_pivot` (ran the cleanup)

> **Data fix only — no schema, no query-shape, no code change.**
> **Script:** `scripts/cleanup-exam-category-pivot-ancestors.ts --apply`

`PUT /admin/quizzes/300003` was rejected with `Category 108 is not a leaf category`,
using a `categoryIds` the **read endpoint itself had just returned** — breaking the
invariant *whatever GET returns must be a legal PUT body*.

**Cause:** the pivot was re-purposed from ancestor-rollup → chosen-leaves-only, but the
cleanup script written at that time was never run. Exam 300003 still had the old rollup
on disk — rows `108, 109, 150` (all `created_at 2026-07-15 15:59:35`), where only `150`
is a leaf and `ws_exam.exam_category_id = 150` confirms the true selection. The admin
could not fix it from the UI: the picker greys out non-leaves, so `108`/`109` were
un-deselectable.

**Not** read-side expansion leaking into the serialised field — `descendantExamCategoryIds`
stays in the filter path. Disk was wrong, and the read faithfully reported it.

**Applied:** dry run → 2 deletable rows, 0 exams stranded → `--apply` removed exam 300003's
`108` + `109`. Verified after: exam 300003 has exactly `[150]`; that set passes
`validateLeafCategoryIds` (returns null); **0 non-leaf rows remain table-wide** (8 → 6).

**Deploy:** this script must be run on staging/production — they will carry the same
artifacts. It is a dry run by default and skips exams that would be left with zero
categories (reporting them for manual assignment).

---

## 2026-07-17 — Repair orphaned `ws_customer_distict.state` (admin cities list 500)

> **Data fix only — no schema, no query-shape, no code change.**
> **DDL:** `docs/migration/schema-changes/2026-07-17_fix_orphan_district_state.sql`

`GET /api/v1/admin/address/cities` failed for any page containing district `id=1`:

```
Inconsistent query result: Field state is required to return data, got `null` instead.
```

**Cause:** legacy blank "unset" placeholder row `ws_customer_distict` `id=1`
(`name=''`, `active=0`) had `state=0`, and no `ws_customer_state` row with `id=0`
exists. `CustomerDistict.state` is a **required** relation in `prisma/schema.prisma`,
so the `include: { state }` join returning nothing is a hard Prisma error.

Only the admin list tripped it: `listAdminDistricts` includes inactive rows by design,
while the client `listActiveDistricts` filters `active: true` and skipped the bad row.
`findDistrictWithState(1)` was broken by the same cause.

**Fix:** repointed the placeholder district at the matching placeholder **state**
(`id=1`, likewise `name=''`, `active=0`) — the same legacy "unset" convention. The row
stays blank + inactive, and the **24 `ws_customer` rows referencing `district=1`** are
untouched. The `UPDATE` is guarded on `state = 0`, so it is idempotent.

**Deploy:** apply the DDL. Verified post-apply: 35 districts, 0 orphaned state refs.

**Watch-list:** `state`/`district` have **no FK constraints** in MySQL, so nothing
prevents this drift from recurring. Same family as the `ws_video_category`
`parent`/`educator_id` NOT NULL `default 0` drift — legacy `0` used as "unset" where a
required Prisma relation expects a real parent row.

---

## 2026-07-16 — Harden client create-order preconditions (plan/parent active-status + friendly errors)

> **Query-shape changes (create-order guards).** No schema/DDL change; adds `status`
> to two plan selects and one parent-entity filter so deactivated catalog rows can no
> longer be purchased. Affects the client `/payment/create-order/*` endpoints only.

**Query changes**
- `commerce-order.repository.findPlan` — added `status: true` to the `ws_package_course_ebook_price` select. Consumed by `findCoursePlanForOrder` / `findPackagePlanForOrder`, which now return `null` when `status === false` (course + package create-order reject an inactive plan). Verify path is unaffected (extra column only).
- `ebook-order.repository.findPlan` — added `status: true` to the same table's select; `findEbookPlanForOrder` now returns `null` for an inactive plan.
- `live-course-order.service.findLiveCourse` — select now includes `status`; live-course create-order rejects a deactivated `ws_live_course` (previously the lookup was non-blocking / name-only).
- `package-payment.controller` — the parent-package lookup now filters `where: { id, active: true }` (`ws_package.status`) and is a hard guard (404) instead of a name-only, non-blocking read.
- Test-series + live-course *plan* lookups already filtered `status: true` — unchanged.

**Behavioral / contract notes (no query change)**
- Friendly user-facing error strings replace internal-leaking ones on all order endpoints; raw Zod `issues` blobs replaced by a `{ message, errors }` map via new `utils/httpResponse.formatZodError`. 500 handlers no longer echo `e.message` to clients. Success responses and status codes are unchanged.
- **Not enforced (no column exists — would need DDL):** promocode usage-limit / per-user cap (`ws_promocode` has no such column) and book stock/inventory (`ws_book` tracks no quantity). Already-owned/duplicate-purchase blocking intentionally skipped (app has an "Extend Validity" flow).

---

## 2026-07-16 — Auto-populate created/updated timestamps on every write (fix ws_customer.created_at NULL)

> **Central Prisma middleware.** The introspected schema leaves most `created_at`/`updated_at`
> columns without `@default(now())`/`@updatedAt`, so unless a caller passed them they landed
> NULL (e.g. every `ws_customer.created_at`). Now set centrally for ALL models.

- **Root cause:** `customer-auth.repository.ts#createStub` (and many other create paths) never
  set `createdAt`; the column has no DB default → NULL. `updated_at` looked fine only because
  its column has `DEFAULT CURRENT_TIMESTAMP` — but that uses the DB session tz and bypasses the
  IST write-shift, so it was inconsistent anyway.
- **Fix** (`config/prisma.ts`): a `$use` middleware built from the DMMF maps each model → its
  DateTime created/updated fields (name variants `createdAt`/`created_at`/`createAt`,
  `updatedAt`/`updated_at`; business timestamps like `startAt`/`expiresAt` excluded). On
  `create`/`createMany` it fills created+updated when the caller omitted them; on
  `update`/`updateMany`/`upsert` it fills updated. Installed BEFORE the IST-shift middleware so
  the populated `new Date()` flows through the +5:30 shift → stored as IST, consistent with
  everything else. Only fills when `undefined` (never overrides an explicit value).
- **Coverage (audit):** 126 models — 94 have both created+updated (both filled), 9 created-only
  (tokens/logs/results: CustomerOtp, *AccessToken, ExamResult, OfflineEnquiry, LiveSessionCourse,
  SearchHistory — filled), 23 have no audit timestamps (nothing to fill). No raw `INSERT INTO ws_*`
  exists, so nothing bypasses the middleware.
- **Verified:** customer create → `created_at`+`updated_at` populated as IST, Prisma reads UTC;
  update refreshes `updated_at` only, leaves `created_at`. `typecheck` green.
- **Limitation:** nested relation creates (`data:{ rel:{ create:{…} } }`) are not auto-filled
  (only top-level `data`); such nested rows should pass timestamps explicitly if needed.

---

## 2026-07-16 — Timestamps now STORED as IST in the DB (Prisma shift middleware + backfill)

> **Storage-timezone migration (client requirement).** DB now holds IST wall-clock;
> app layer stays UTC; API still returns IST. Full runbook:
> `docs/migration/IST_STORAGE_MIGRATION.md`. **No API contract change → no frontend change.**

- **Middleware** (`config/prisma.ts`): `$use` shifts every write Date `+5:30` (DB = IST) and
  every read Date `-5:30` (app = UTC). Recurses only into plain objects/arrays (Decimal/BigInt/
  Buffer safe). Verified it also intercepts `$queryRaw*`, so raw Date params (WHERE bounds) and
  raw Date results are auto-shifted — the whole app/filters/sort/`istJsonReplacer` are unchanged.
- **Only raw SQL fix** (`admin-dashboard.service.ts`): `HOUR/DAYOFMONTH(CONVERT_TZ(created_at,
  '+00:00','+05:30'))` → `HOUR/DAYOFMONTH(created_at)` (column is already IST). This was the sole
  SQL-side timezone function in the codebase (grep-confirmed: no other `CONVERT_TZ`/`NOW()`/
  `UNIX_TIMESTAMP` in raw queries). Report buckets that used `YEAR/MONTH/DAY/DATE_FORMAT` on the
  raw column now bucket by IST day (was UTC day) — intended under IST-everywhere.
- **Backfill** (`scripts/backfill-ist-timestamps.ts`): one-time `+INTERVAL 330 MINUTE` on all
  `ws_*` datetime/timestamp columns (261 of them). **Batched by PK (20k) + resumable per-column
  ledger `_ist_backfill`** after the naive single-UPDATE version overflowed the binlog and crashed
  MySQL on the 600k-row subscription tables. Guarded by `IST_BACKFILL_CONFIRM=YES`.
- **Deploy:** code + backfill must cut over together (maintenance window) — un-backfilled UTC rows
  read `-5:30` wrong under the new middleware, and IST rows read wrong under old code.
- **Verified on local:** all 261 columns shifted; legacy inquiry id=1 `09:36`UTC→`15:06`IST stored,
  Prisma reads `09:36Z`, API `15:06+05:30`; `typecheck` green.

---

## 2026-07-16 — Inquiry submit now snapshots the customer profile (name/mobile/email/city)

> **Write-behavior fix, no schema change.** `POST /client/inquiry` was persisting only
> `{ customerId, description, source }`, leaving `name/mobile/email/city` NULL on
> `ws_website_inquiry` — so the admin inquiry list showed those columns empty.

- **Fix** (`modules/inquiry/inquiry.service.ts#submitInquiry`): before insert, fetch the
  submitting customer (`fullName`, `phoneNumber`, `emailAddress`, `city`) and write them to
  `name`/`mobile`/`email`/`city`. Response now also hydrates the `customerId` nested object
  (was `customer: null`).
- **Timezone note (no code change needed):** `createdAt`/`updatedAt` are written as
  `new Date()` (UTC instant). Verified empirically that Prisma persists these as UTC to the
  DATETIME columns **even when the DB session `time_zone` is forced to +05:30** — the model's
  `@default(now())`/`@updatedAt` mean Prisma always supplies an explicit UTC value, so the DB's
  `DEFAULT/ON UPDATE CURRENT_TIMESTAMP` (which would use session tz) never fires. Any IST rows
  are legacy (old PHP app) or from a pre-migration deployment, not the current write path.
- Verified on local DB: submit → row + DTO carry name/mobile/email/city; `getInquiry` returns
  them; `createdAt` stored == UTC now.

---

## 2026-07-16 — Admin /address/cities full CRUD moved to ws_customer_distict (was ws_offline_city)

> **Data-source change on an admin management surface, same response contract.** Follows
> the client `/address/cities` switch — the admin Cities screen now creates/reads/updates/
> deletes DISTRICTS (`ws_customer_distict`), keeping the offline-city DTO shape.

- **Scope:** all of `GET/POST/GET:id/PUT/DELETE /admin/address/cities`. Repointed
  `admin.address.routes` from `offline.controller` to the new
  `src/admin/address/admin.cities.controller.ts`. Offline-city CRUD
  (`/admin/offline`, cart `cityId`→name, `/cities/:cityId/centers`) is untouched and still
  uses `ws_offline_city`. Districts also remain managed at `/admin/customer-master/districts`.
- **New repo methods** (`customer-lookups.repository`): `listAdminDistricts` /
  `countAdminDistricts` (shared `adminDistrictWhere`: optional `active` status + `stateId` +
  name `buildPrismaSearch`, name order, state included, paginated), `findDistrictWithState`,
  `createDistrictWithState`, `updateDistrictWithState`, and `countCustomersInDistrict`
  (`prisma.customer.count({ where: { districtId } })` — delete guard).
- **New service** (`customer-lookups.service`): `listCityDistrictsAdmin` /
  `getCityDistrictAdmin` / `createCityDistrict` / `updateCityDistrict` / `deleteCityDistrict`,
  all returning the offline-city `CityDto` via the shared `districtToCity` mapper (image "",
  order 0, timestamps null, status ← active, stateId ← state).
- **Contract deltas forced by the district schema (FRONTEND-visible):**
  - `stateId` is now **REQUIRED** on create (district FK is NOT NULL) → 400 if missing/invalid.
  - `image` and `order` are accepted but **ignored** (no district columns); response always
    `image:""`, `order:0`, `createdAt/updatedAt:null`.
  - DELETE returns **409** when any customer references the district (`ws_customer.district`).
- Verified on local DB: create/get/list(+state/search/status filters)/update/delete +
  bad-state 400 + not-found 404, DTO keys byte-identical to the old city response.

---

## 2026-07-16 — GET /client/address/cities now sourced from ws_customer_distict (was ws_offline_city)

> **Data-source change, identical response contract.** The client city dropdown now
> reads districts (`ws_customer_distict` / `CustomerDistict`) instead of
> `ws_offline_city`. Response shape and all filters are unchanged.

- **Why:** business decision — the address city picker should list districts.
- **Scope:** ONLY `GET /client/address/cities` (`address.controller.listCities`). The
  offline-city module (`listActiveCities`) is untouched, so `/client/offline` cities, cart
  `cityId`→name resolution (`resolveCityName`), `/cities/:cityId/centers`, and admin city
  CRUD still use `ws_offline_city`.
- **New query:** `customer-lookups.repository.listActiveDistricts({ search?, stateId? })` —
  `prisma.customerDistict.findMany` where `active: true` (+ name `buildPrismaSearch` + optional
  `stateId`), `include` parent state, `orderBy name asc`. Same conditions as the old city list;
  districts have no `order` column so name-order stands in for the city `(order, name)` sort.
- **Contract parity:** `customer-lookups.service.listActiveCitiesFromDistricts` reuses
  offline-city's `toCityDto` transformer, defaulting the columns districts lack — `image: ""`,
  `order: 0`, `createdAt/updatedAt: null`; `status` ← `active`; `stateId` ← populated state
  `{ _id, name, stateCode }`. DTO keys byte-identical to the old city response.
- Verified on local DB: 33/34 districts active → 33 returned; active-only, name sort, `stateId`
  scope, and name `search` all hold; DTO keys `_id,name,image,status,order,stateId,createdAt,updatedAt`.

---

## 2026-07-16 — GET /admin/master/subject-categories: honor the `status` filter (was ignored)

> **Query-shape fix (no schema change).** The `?status=` query param on the subject-
> category list was silently dropped — the endpoint returned rows of any status AND
> counted all rows for `pagination.total`.

- **Bug:** `subjectCategory.controller.ts#getSubjectCategories` never read `status` from
  the query, and `subjList`/`subjCount` (service + repo) had no `status` param. So
  `?status=true` returned inactive rows (reported: a `status:false` row under
  `status=true`) and `pagination.total` ignored the filter.
- **Fix:** threaded an optional `status?: boolean` through `subjWhere` (adds
  `where.status`), `repo.subjList`, `repo.subjCount`, and `service.subjList` — the count
  now receives the same status as the list. Controller parses the param: `true`/`active`
  → true, `false`/`inactive` → false, absent/other → undefined (no filter). Accepts both
  the boolean form (frontend sends `status=true`) and the `active`/`inactive` form used by
  sibling master lists.
- Verified on local DB: `status=true`→0/total 0, `status=false`→1, no-filter→1, and
  `total(true)+total(false)==total(all)`. DTO shape unchanged. No new index (small master
  table, existing scan).

---

## 2026-07-16 — Add PATCH /admin/courses/:id/status (course status toggle)

> **New endpoint (no DB/schema change).** Brings Courses in line with every other
> admin module's dedicated status-toggle. Frontend previously faked this via full
> `PUT /admin/courses/:id` with `{ status }`, which now correctly 422s on the
> required `courseEducatorId` — see the entry below.

- **Route:** `PATCH /admin/courses/:id/status` (auth-gated via the admin router, same as
  the sibling `PATCH /:id/popular`). Mounted in `src/admin/course/course.routes.ts`.
- **Behavior:** flips `ws_course.status` by default; an explicit `status` in the body
  (`true`/`false` or `"true"`/`"false"`) sets it directly. No required-field validation —
  a status flip never trips `courseEducatorId`. Mirrors `toggleCoursePopular` exactly.
- **Response:** envelope `data = { _id: string, status: boolean }` (e.g.
  `{ "_id": "990115", "status": false }`) — key is **`status`** (course column is
  `status`), consistent with material's toggle; packages use `{ active }` only because
  their column is `active`. `_id` included to match `toggleCoursePopular`'s shape.
- **Layers:** repository `setStatus` (`admin-course.repository.ts`), module service
  `toggleCourseStatus` (`admin-course.service.ts`), admin wrapper `toggleCourseStatus`
  (`course.service.ts`, 404 on not-found), controller `toggleCourseStatus`
  (`course.controller.ts`). Verified end-to-end on course 990115: flip, explicit set,
  not-found→404, state restored. No new query filters/indexes.

---

## 2026-07-16 — Course update: courseEducatorId returns "Educator is required" instead of "received nan"

> **Validation-contract fix (no DB change).** `PUT /admin/courses/:id` and
> `POST /admin/courses` — `courseEducatorId` stays **required** (create and update);
> only the error for the missing/empty case is fixed.

- **Root cause:** the field used `z.coerce.number()`. On an omitted field Zod ran
  `Number(undefined)` → `NaN`, failing with the misleading `"expected 'number', received
  'nan'"`. Update re-requires the field via `.partial().required({ courseEducatorId: true })`,
  so a missing key hit coercion before any "required" check.
- **Fix** (`src/admin/course/course.validation.ts`): replaced `z.coerce.number(...)` with a
  `z.preprocess` that maps `""`/`null`/`undefined` → `undefined` (→ clean `422 "Educator is
  required"`) and coerces real numeric id strings via `Number()` into a plain
  `z.number({ required_error, invalid_type_error }).int().positive()`. Empty/null/garbage all
  now return "Educator is required"; `"42"`→`42` unchanged.
- Removed the TEMP `console.log` diagnostics from `updateCourse` (`course.controller.ts`).
- **Decision (product):** `courseEducatorId` is REQUIRED on every course update — frontend
  must always send it. No schema/query/index change; verified via safeParse across
  omitted/empty/null/valid/garbage/zero inputs.

---

## 2026-07-16 — Collapse device tokens into ws_customer.device (drop ws_customer_device_token)

> **Schema drop + query-shape change.** Notification device tokens now live in the
> single `ws_customer.device` (firebaseToken) column — one token per customer,
> last-device-wins. The `ws_customer_device_token` multi-device table is removed.

- **DDL:** `docs/migration/schema-changes/2026-07-16_drop_customer_device_token.sql` —
  backfills the newest token from `ws_customer_device_token` into `ws_customer.device`
  for any row where `device` is empty (safety; the dual-write window kept most rows in
  sync already), then `DROP TABLE ws_customer_device_token`. Reverses the 2026-06-18
  create. **Behavior change:** multi-device delivery is gone — a customer receives pushes
  only on their most-recently-registered device (older devices go silent). Deliberate
  product decision.
- **Schema:** removed the `CustomerDeviceToken` model from `prisma/schema.prisma`
  (`prisma:generate` regenerated).
- **Repository** (`customer-profile.repository.ts`): `setDeviceToken` /
  `setDeviceTokenByPhone` now write `ws_customer.device` directly (first clearing the
  token off any other customer that held it, to preserve token-ownership-move semantics);
  `clearDeviceToken` and `pruneDeviceTokens` null the column; `listDeviceTokens` removed
  (was unused) and the token-keyed upsert replaced by `writeDeviceToken`.
- **Audience/dispatch** (`admin-notification.service.ts`): `resolveAudience` folds the
  token-owning gate into the `ws_customer` query via `firebaseToken: { not: null }`
  (was a `distinct customerId` scan of the token table); `collectTokens` reads
  `firebaseToken` off `ws_customer` for both broadcast and targeted sends. Recipient set
  is unchanged in shape — still "live, non-deleted customers with a token, matching
  platform/user/course filters".
- Invalid-token pruning (`utils/fcm.ts`) unchanged at the call site
  (`customerProfileRepository.pruneDeviceTokens`); it now nulls the `device` column for
  the owning customer(s) instead of deleting a token row (comment updated to match).
- Verify scripts (`scripts/verify-device-token.ts`, `verify-notification-sql.ts`) updated
  to the single column (the notification-sql harness now stashes + restores the real
  customer's original token so verification never clobbers a live device).

---

## 2026-07-16 — Sweep remaining searched columns to utf8mb4 (full audit)

> **DDL only.** Closes the leftover latin1/utf8mb3 gaps after the three earlier
> utf8mb4 search DDLs (name-only → promoter/misc → customer).

- **Symptom:** MySQL 3988 on free-text `search` with emoji/Gujarati against still-legacy
  columns — e.g. `course`/`ebook` description+author (`utf8mb3`), `book.author` /
  `banner_slider.image|key` / offline `name` columns (`latin1`), plus customer
  `referral_code` and master lookups (`state`/`district`/`education`/`goal`).
- **DDL:** `docs/migration/schema-changes/2026-07-16_remaining_search_columns_utf8mb4.sql`
  converts **54 columns across 29 tables** to `utf8mb4 / utf8mb4_0900_ai_ci`
  (searched / search-adjacent free-text only). No `schema.prisma` change. Apply via
  `yarn db:migrate`. Re-running is a no-op; re-audit with the SQL header query before
  other environments.

---

## 2026-07-16 — Admin customer search: `ws_customer` name/phone/email → utf8mb4

> **DDL only.** Closes the gap left by `2026-07-16_search_columns_utf8mb4.sql`, which
> converted `ws_promoter` search columns but omitted `ws_customer`.

- **Symptom:** `GET /admin/customers?search=સિતારો` (any Gujarati/Hindi/emoji term)
  → MySQL 3988 on `prisma.customer.count()` /
  `Conversion from collation utf8mb4_general_ci into latin1_swedish_ci impossible`.
  English search worked; non-Latin did not.
- **DDL:** `docs/migration/schema-changes/2026-07-16_customer_search_columns_utf8mb4.sql`
  converts `ws_customer.full_name`, `phone`, `email_address` to
  `utf8mb4 / utf8mb4_0900_ai_ci`. No code / `schema.prisma` change (collation not
  tracked). Apply via `yarn db:migrate`. Re-running is a no-op.

---

## 2026-07-16 — Uniform Unicode + case-insensitive search across all modules

> **DDL + query-shape change.** Charset conversion of the remaining searched columns,
> plus a shared search-predicate builder (trim + multi-word token-AND).

- **DDL:** `docs/migration/schema-changes/2026-07-16_search_columns_utf8mb4.sql` converts
  the searched columns still on `latin1`/`utf8mb3` to `utf8mb4 / utf8mb4_0900_ai_ci`
  (19 columns across `ws_material`, `ws_popup_notification`, `ws_promocode`, `ws_promoter`,
  `ws_user_inquiry`, `ws_video`, `ws_video_category` in the current app DB). Generalizes
  the 2026-07-09 `name`-only fix to EVERY searchable column so emoji (🔥) and
  Gujarati/Hindi both STORE and MATCH, and English is case-/accent-insensitive.
  Lossless (`latin1`→utf8mb4 transcodes; `utf8mb3`→utf8mb4 superset). Collation is NOT in
  `schema.prisma` → no `db:pull`/`prisma:generate`. Re-running is a no-op; before another
  environment, re-run the audit query in the SQL header and add any still-non-utf8mb4 cols.
  **Follow-ups:** `ws_customer` search columns — see
  `2026-07-16_customer_search_columns_utf8mb4.sql`; remaining searched tables — see
  `2026-07-16_remaining_search_columns_utf8mb4.sql`.
- **Connection:** verified the Prisma MySQL driver already carries 4-byte utf8mb4 end to
  end (emoji insert + `contains` round-trip succeeds) — no `DATABASE_URL` change required.
- **Query shape:** new shared helper `src/utils/searchFilter.ts` (repurposed from the dead
  Mongo-`$regex` version): `buildPrismaSearch`, `buildLikeTokens` (raw SQL), `matchesAllTokens`
  (in-memory), `searchTokens`. Search terms are now **trimmed and tokenized on whitespace,
  ANDing each token** (each token OR-ed across the searched fields). Adopted at ~130 sites
  across ~80 files on all four surfaces: the Prisma `contains` list/detail searches (flat +
  nested-relation, via `buildPrismaSearch`/`searchTokens`), the raw-SQL `LIKE` clusters
  (`admin-book` order_items, `referral` withdrawal/referrer reports incl. JSON bank fields,
  `exam-countdown`), and the in-memory `.toLowerCase().includes()` post-fetch filters in both
  services and `src/client/**` controllers (`address`, `my-subscriptions`, `package`,
  `live-reminder`, `client-wishlist`, `admin-live-course`, etc.).
- **Intentionally NOT touched:** exact code/email lookups (login, `/refresh`, promocode
  APPLICATION via `promocode: { contains: term.toUpperCase() }`) — these are identity/code
  matches, not free-text list search.
- **Behavior change to QA:** multi-word queries now match rows containing ALL words in any
  order (e.g. `"ram sita"` → rows with both). Single-word queries are unchanged. No
  `LOWER()`/`BINARY`/`mode:"insensitive"` — case-insensitivity is collation-driven, so
  indexes still apply. Response envelopes/DTOs are unchanged (only the `where` differs).

---

## 2026-07-16 — Client package `isPopular` filter + DTO field

> **Read/query change only. No DDL** (reuses the `ws_package.is_popular` column added below).

- **Filter (no new endpoint):** `GET /client/packages` now accepts `?isPopular=true|false`
  (`client/package/package.controller.ts` → `listPackages`). `true` → only popular, `false`
  → only non-popular, omitted → unfiltered. Combines (AND) with existing
  `search`/`type`/`packageTypeId`/`goalId` + pagination. The "Popular Packages" screen is
  just this endpoint with `isPopular=true`.
- **Query:** `listPackagesPaginatedSql` gained an optional `isPopular?: boolean` filter
  (`where.isPopular` when defined); existing callers unaffected (undefined → no filter).
- **DTO:** `isPopular` now surfaced on the client package **list** row (`enrichPackagesSql`)
  and the package **detail** (`buildPackageDetailSql`) — additive boolean field, present on
  `GET /client/packages`, `/type/:typeId`, and `/:id`.
- Frontend doc: `docs/client/POPULAR_PACKAGES_CLIENT.md`.

---

## 2026-07-16 — Package `isPopular` flag (admin panel)

> **DDL.** New non-null boolean column on `ws_package`.

- **Column:** `ws_package.is_popular TINYINT(1) NOT NULL DEFAULT 0` — see
  `docs/migration/schema-changes/2026-07-16_package_is_popular.sql`. Mirrors `is_paid` /
  `is_individual`. No backfill needed (default 0). Prisma model `Package.isPopular`
  (`@map("is_popular")`, `@default(false)`).
- **Write:** admin package create/update now accept `isPopular` (boolean). Controller
  coerces the multipart `"true"/"false"` string (same as `isPaid`). Create defaults to
  `false`; update is partial-merge (absent `isPopular` leaves the column unchanged).
- **Read:** `isPopular` surfaced on the package detail + list DTOs via `toPackageDto`
  (reads directly off the row; `include`-based selects pick the new scalar up
  automatically — no repository change).
- **Note:** distinct from the plan-row `is_most_popular` (plan-popularity) concept — this
  is a package-container flag, matching Course's `isPopular` (which maps to `is_featured`).

---

## 2026-07-15 — Deactivating an item (status=false) grandfathers active subscribers

> **Read/query change only. No DDL.** When an admin deactivates a Course / Package /
> Live-Course / EBook / Test-Series, it stays HIDDEN from public browse & new purchase but
> remains fully visible + playable for customers with an ACTIVE subscription.

- **Rule:** OWNED-CONTENT/ACCESS paths that filtered the CONTAINER by its own status now
  relax (a subscription/ownership gate runs downstream); BROWSE/PURCHASE paths keep their
  filters; inner-item status (video/material/exam) is untouched. Container flags:
  `Course.status`, `Package.active` (@map status), `LiveCourse.status`, `EBook.active`,
  `TestSeries.status`.
- **Video (course/package/live)** — `catalog-category-tree.service`: `reachableCategoryIds`,
  `resolveVideoScope`, `resolveVideoScopes`, `resolveVideoCourseId` dropped the container
  status filter (kept row-level subject/relation `status`). This one change propagates to
  video listing, single-video, lecture detail, and the progress heartbeat.
- **Live-course** — `admin-live-course.service`: `getLiveCourseDetailForClient`,
  `getRecordingsForClient`, `listSessionRecordingsForClient` are now owner-aware (fetch
  without status; 404 only when `!status && !subscribed`, reusing `hasAccessToAnyLiveCourse`).
- **Dashboard/continue-watching/resume** — `client-lecture-progress.service`: owned-item
  hydration (course/package/live) + heartbeat free-container checks dropped the container
  status filter (deleted rows still drop out — no row for the id).
- **EBook** — `client-media.service` ebook resolve + `client-ebook-download.service`
  (`findActiveEbook`, `listDownloads`, `countActiveDownloads`) dropped `active` (subscription
  is the gate).
- **Test-series** — `client-testseries.service`: `getTestSeriesDetailMysql` +
  `listSeriesPapersMysql` owner-aware (a deactivated series 404s unless the caller has an
  active sub; a deactivated FREE series 404s for all — no subscriber to grandfather).
- **Book** — no change (owned order/receipt/tracking views already read the book via an
  unfiltered relation). Kept unchanged: catalog-course/package/book/ebook browse repos,
  test-series browse, create-order gates, dashboard "recently added", book/ebook demos.
- Verified on staging (owner vs non-owner) for package video scope, test-series detail+papers,
  ebook download, and live-course detail+recordings.

## 2026-07-15 — Client "Recently Added" = Planner + Smart packages + live courses

> **New client read endpoint + dashboard section reshape. No DDL.** Frontend guide:
> `docs/RECENTLY_ADDED_CLIENT.md`.

- The dashboard "Recently Added" section previously listed the newest active
  **packages** (`type: "package"`). It now shows the newest items merged across three
  kinds — Planner packages, Smart packages, live courses — sorted by created date desc,
  capped to 5 total, each tagged with `kind` + `type`. Section `type` is now
  `"recently-added"`.
- New feed module `modules/client-recently-added` over-fetches each source table to
  `skip+take`, merges by `created_at`/`createdAt` desc, slices the page, then decorates
  only that page (package plans + ownership, live plans + ownership). Queries:
  `package.findMany({ active, packageTypeId in [...] })` + count,
  `liveCourse.findMany({ status })` + count, `packageCourseEbookPrice` plans,
  `packageCourseSubscription` ownership. Reuses live helpers `plansGrouped` /
  `getDaysLeftMap` / `getOwnedCourseIds` from `admin-live-course.service`.
- New route `GET /api/v1/client/recently-added?kind=&search=&page=&limit=` (the
  "View All"): CSV `kind` filter (planner/smart/live-course), server-side search +
  pagination.
- Planner/Smart package types resolved by **name** from `ws_package_type` at request
  time (`resolveKindTypeIds`): type name contains "planner" → planner, "smart" → smart
  (e.g. "Planner Course" id 3, "Smart Course" id 4). No env/config — survives id
  changes; a rename away from those keywords drops the type from the feed. (Replaced an
  earlier env-based `config/packageTypes.ts` approach, now removed.)

---

## 2026-07-15 — Subject exams gated by start date in client catalog counts + lists

> **Query-shape change on three client endpoints. No DDL.**

- `GET /client/exam-categories/:id/exams`, `GET /client/exam-categories/:id/children`
  (per-child `count`), and `GET /client/catalog/:type/:id/tests` counted/listed
  subject-type exams by `status=true` + `type="subject"` only — a subject exam
  scheduled for a future `start_date` was already appearing/counting.
- Now subject exams are additionally gated on the window **start**: visible only once
  `start_date <= now` (a NULL `start_date` = "no schedule" → always available). New
  shared helper `subjectStartedWhere(now)` in `catalog-exam/exam-category-pivot.where.ts`
  (`OR: [{ startAt: null }, { startAt: { lte: now } }]`), AND-merged into:
  `client-exam.repository` `examsByCategoryPaged` + `countExamsByCategoryPaged`,
  `catalog-exam.repository.countExams`, and `client-catalog.service.catalogTests` itemCount.
- The pre-existing end-of-window gate (`endAt null || >= now`) on the `/exams` list is
  unchanged; this only adds the start-of-window gate.

---

## 2026-07-15 — Ebook purchase-history resolves plan-less orders via subscription

> **Query-shape change on `GET /client/purchase-history/ebooks` + its receipt. No DDL.**

- Plan-less ebook grants (manual duration/price, `plan_id = NULL`) previously showed
  the generic "E-Book purchase" title with `ebookId: null` because resolution only
  hopped `order.plan_id → price.ebook_id → ebook`. Now the ebook falls back to
  `ws_ebook_subscription.ebook_id` (linked by `order_id`) when the plan hop yields nothing.
- `client-purchase-history.repository.ebookSubStartByOrderIds` now also selects `ebookId`;
  new `ebookIdBySubForOrder(orderId)` for the receipt path.
- **Title prefixes dropped:** list + receipt now show the raw title (`ebook.name` /
  `ts.title`) with no `E-Book:` / `Test Series:` prefix; fallbacks
  ("E-Book purchase" / "Test Series subscription") unchanged.

---

## 2026-07-15 — Category-video entitlement checks ALL owning packages (not just the first)

> **Read/query change only. No DDL.** Fixes wrongful 403 / null media token for a video
> whose category belongs to multiple packages when the buyer owns a non-first one.

- **Bug:** `resolveVideoScope` returns only the FIRST owning container (findFirst per
  kind), so a video-category under several packages resolved to one package; a customer
  who bought a DIFFERENT owning package was denied a playable token (listing) or 403'd
  (`getVideoByCategory`), and the media token was scoped to the wrong package.
- **Fix** (`catalog-category-tree.service`): new `resolveVideoScopes()` returns EVERY
  owning course/live-course/package (findMany over the DAG ancestors). `client-category-video.service`
  adds `scopesForCategory()` + `entitledScopeFor(customerId, scopes)` — the same gates as
  `isEntitledForScope` (status=true + endAt>now; live also payment_status=verified) but
  across ALL owners, returning WHICH scope the customer owns.
- `client/categories/categories.controller` (listVideosByCategory + getVideoByCategory):
  entitlement now grants if the customer owns ANY owning container, and the media token is
  scoped to that owned container so `/media/resolve`'s single-scope re-check still passes
  (that path is unchanged). Response `scope` stays the representative first owner (shape
  unchanged).
- Parity note: lecture-detail (`client-lecture`) + the progress heartbeat still gate on a
  single owning scope — a follow-up if those playback paths must match this multi-owner rule.

## 2026-07-15 — Maintain ws_video_category_package_relation (denormalized cache)

> **No DDL. Backfill + runtime sync of an existing table the SQL flow left unmanaged.**

- **Problem:** on MySQL nothing ever inserted into `ws_video_category_package_relation`
  (only `deletePackage` cleaned it), so new/edited packages had stale/absent rows. The
  table is a denormalized cache: for each package it should hold every
  `ws_video_category_relation` edge in the DOWNWARD closure of the package's active
  specific-subjects (`ws_package_specific_subject`).
- **Runtime sync** (`src/modules/admin-package/package-relation-sync.ts`, best-effort /
  non-throwing):
  - `resyncPackageRelations([pkgId])` — on package create/update when specific-subjects
    change (`admin-package.service`).
  - `resyncAllPackageRelations()` — after any video-category **DAG edge** mutation in
    `admin-master.service` (vcCreate w/ parent, vcUpdate parent-change, vcDelete,
    reconcileChildren attach/detach, fullVcDelete, fullVcDuplicate), since one added/moved/
    removed edge can change any package whose subtree includes it. Full rebuild is ~200ms
    for all packages (122 packages / ~2.5k edges).
- **Backfill:** `scripts/backfill-package-video-category-relation.ts` (idempotent). Uses
  `rebuildAllPackageRelations()` — an ATOMIC full-table clear+rebuild in ONE transaction
  (fail-loud, rolls back on error, leaving existing rows intact), distinct from the
  best-effort runtime syncs. Run once on deploy (targets `DATABASE_URL`).
- Note: the SQL client tree/scope/media path reads subjects + the DAG directly and does
  NOT depend on this table — it's kept current for consumers that read it directly.

## 2026-07-15 — Exam update can CLEAR the availability window (startAt/endAt → null)

> **DDL: widen `ws_exam.start_date` / `end_date` to NULL.** Matches the clear-support the
> solution PDF already had.

- **DDL** (`docs/migration/schema-changes/2026-07-15_exam_start_end_nullable.sql`):
  `ALTER TABLE ws_exam MODIFY start_date DATETIME NULL, MODIFY end_date DATETIME NULL;`
  The Prisma model already mapped these `DateTime?`, but the real columns were NOT NULL,
  so nulling threw a constraint violation. No backfill; `createExam` still defaults a
  missing window to `now`.
- **Zod** (`admin/exam/exam.validation.ts`): `startAt`/`endAt` were
  `z.coerce.date().optional()` — a JSON `null` coerced to the 1970 epoch and a multipart
  `""` 422'd, so the clear never persisted. Now `z.preprocess((v)=> v===""?null:v,
  z.coerce.date().nullable().optional())`, mirroring `solutionPdfUrl`. The service
  (`admin-exam.service updateExam`) already writes null through.
- **Controller** (`admin/exam/exam.controller.ts` updateExam): effective-window calc now
  distinguishes cleared (`null`) from not-provided (`undefined`) so clearing a **daily**
  test's window is correctly rejected (was masked by `?? current`).

## 2026-07-15 — With-material validity extension ships (tracks) a new kit

> **Write-path change in the verify FOLD (extend) branch. No DDL.**

- Previously the extend branch of `verifyCourseTx`/`verifyPackageTx` returned before
  creating a dispatch row, so a with-material *extension* got no shipment/AWB and its
  purchase-history row showed `tracking: null`. Now the extend branch creates a fresh
  `ws_package_course_subscription_tracking` row keyed by the extension **order** id (only
  when `material.withMaterial`) and advances the sub's `tracking` FK to it — so the
  extension row is trackable, resolved by order id like any other purchase.
- Live-course extend (`verifyLiveCourseOrderMysql`): the retired pending row IS the
  extension's history row, so a with-material extension now stamps its own
  `tracking_id`/`tracking_status` on that retired row (was only set on the surviving sub).
- **Not retroactive** — extension orders completed before this change have no tracking
  row; a backfill would be needed if historical extensions must become trackable.

## 2026-07-15 — Purchase-History Subscriptions tab is order-based (each purchase = one row)

> **Read/query change only — NO DDL, NO change to payment/entitlement.** A validity
> extension still FOLDS onto the entitlement subscription (access / My-Subscriptions /
> dashboards / reporting unchanged). Only what Purchase History LISTS changed.

- **Why:** package/course + test-series verify FOLD an extension onto the existing
  subscription (bumps `end_at` + sums `amount`), so an extension never appeared as its
  own row — the sub just showed a higher price. Now each completed **order** is its own
  history row.
- **List** (`GET client/purchase-history/subscriptions`): package/course now reads
  `ws_package_course_order` (status="complete"); test-series reads `ws_test_series_order`
  (status="complete"). Live-course unchanged (its retired extend rows already stay
  `payment_status="verified"`). **Legacy pre-migration purchases have no order row**, so
  active subs with `order_id IS NULL` are unioned back in (else they'd vanish) under a
  `pcs_`/`tss_` id prefix.
- **`_id` prefixes** now emitted: (plain)=pc order id, `lc_`=live sub id, `ts_`=ts order id,
  `pcs_`=legacy pc sub id, `tss_`=legacy ts sub id. razorpay ids now populate from the
  order (were null on the sub path).
- **Receipt + tracking resolvers repointed to order id** for plain/`ts_` ids
  (`courseOrderByIdForReceipt`, `testSeriesOrderByIdForReceipt`, order-keyed tracking via
  `packageCourseSubscriptionTracking.order`); `pcs_`/`tss_` keep the sub-based path
  (`getCourseReceiptBySubMysql`, `getTestSeriesReceiptBySubMysql`). Window (`start/endAt`)
  read from the entitlement sub (fold-aware), scoped to the page's course/package targets.
- Also fixed: with-material detection now uses `material_amount` (set by the payment
  split) not `pc_material_id` (null when the package has no kit configured); the tracking
  detail resolves the delivery address from `ws_customer_shipping` OR `ws_customer_address`
  (the sub/order `shipping` FK is inconsistent across order paths).

## 2026-07-15 — Track Order for with-material subscription orders (Books-parity)

> **DDL: 2 new columns on `ws_live_course_subscription`.** Adds shipment "Track Order"
> to the Purchase History → Subscriptions tab for package/course + live-course orders
> bought on a with-material plan, mirroring the existing Books tab tracking.

- **DDL** (`docs/migration/schema-changes/2026-07-15_live_course_material_tracking.sql`):
  `ALTER TABLE ws_live_course_subscription ADD COLUMN tracking_id BIGINT NULL,
  ADD COLUMN tracking_status VARCHAR(20) NULL;` — live-course had `with_material` +
  `customer_shipping_id` but no place to store a shipment AWB/status (package/course
  already has `ws_package_course_subscription.tracking` + `ws_package_course_subscription_tracking`;
  books use `ws_book_order.tracking_id`). Schema: `LiveCourseSubscription.trackingId` /
  `trackingStatus`. **No backfill** — historical live-course subs stay `tracking:null`.
- **Write:** `verifyLiveCourseOrderMysql` now sets `tracking_id` (= the sub id, a synthetic
  AWB below the Tirupati threshold, same idea as SQL book AWBs) + `tracking_status="pending"`
  at payment-verify for `with_material` orders (fresh grant + extend + webhook paths).
  Package/course already wrote its tracking row at verify — no change there.
- **List query** (`GET client/purchase-history/subscriptions`): `listSubscriptions` now
  `include`s `packageCourseSubscriptionTracking.status`. Each subscription row gains
  `withMaterial` (package/course = `pc_material_id != null`; live = `with_material`; test
  series = false), `status` (shipment status, material only), and `tracking` (`{trackingId,
  courier}` or `null`). `courier` derived from the AWB range.
- **Detail reads** (new): `GET client/purchase-history/subscriptions/:id/tracking` and
  `/tracking/live` — owner-scoped `packageCourseSubscription.findFirst` (incl.
  `customerShipping` + tracking row) / `liveCourseSubscription.findFirst` (+ `customerAddress`
  by `customer_shipping_id`). Returns the Book tracking DTO shape; live path scrapes the
  Tirupati AWB API (synthetic AWBs are below-threshold → 422 with static `trackingUrl`).

## 2026-07-15 — Admin grant/create endpoints accept plan-less subscriptions

> **Write-shape change on the admin manual-grant endpoints. No DDL — `plan_id`
> (`ws_package_course_subscription`, `ws_package_course_order`, `ws_live_course_subscription.pcb_id`)
> is already nullable.**

- The frontend Add-Subscription form can now POST without `planId`. The create/grant
  endpoints no longer require it; when absent, the request's `amount`/`price` becomes the
  paid amount and `durationDays` drives `startAt`/`endAt` (instead of deriving both from a
  plan). At least one window source is required — validation now enforces
  `planId || durationDays` (or `durationMonths`/`endAt` for live courses).
- **Course/Package** (`POST /admin/subscriptions`): `createSubscriptionSchema.planId` now
  optional + refine `planId || durationDays`; `admin-subscription.service.createCourseSubscription`
  skips the plan lookup / course-package-mismatch checks when no plan, writes `plan_id = NULL`
  on both the order and subscription rows, and prices from `amount` (`course_amount`/
  `material_amount` NULL without a plan). Repo `createPaymentOrder`/`createSub` `planId` widened
  to `number | null`.
- **Live course** (`POST /admin/live-courses/:id/grant`): `planId` now optional + refine;
  `admin-live-course.service.grantSubscription` requires a window when no plan (new
  `code:"duration"` → 422) and writes `pcb_id = NULL`.
- **Test series** (`POST /admin/test-series/:id/grant`) and **ebook**
  (`POST /admin/ebooks/subscriptions`): already accepted an absent `planId` (refine
  `planId || durationDays`) — unchanged.

---

## 2026-07-15 — Permission catalog rendered entirely from DB

> **Query-shape + response-contract change on `GET /admin/permissions/catalog`. No DDL.**

- `catalog.controller.ts` / `permission-catalog.service.ts` no longer source the
  response from the in-code registry (`permissions.catalog.ts`). The catalog is now
  built **only from the database**: `ws_permissions` rows for the `?guard=` (default
  `web`), grouped under their `ws_permission_category` via `category_id`.
- New query `getCatalogFromDb(guard)`: `adminPermissionRow.findMany({ where:{guardName}, select:{id,name,categoryId} })` + `permissionCategoryRow.findMany` ordered by `order_by,id`.
- **Response shape changed** (only DB-available fields survive): `data = { guard, categories: [{ id, title, slug, orderBy, permissions: [{ id, name }] }] }`. Dropped code-only fields: `version`, module `key/label/group/description`, per-permission `label/action/subResource`, and the code-diff `deprecated[]`. Uncategorised rows fall into a trailing `{ id:null, ... }` bucket. Frontend RBAC tree must adapt to category-grouped rows.

---

## 2026-07-14 — Offline batch-enquiry: block duplicate submissions per day

> **New query on `ws_offline_enquiry`. No DDL** (uses existing `customer_id`,
> `batch_id`, `qualification`, `created_at` columns).

`POST /client/offline/batch-enquiry` previously accepted unlimited identical
submissions. It now rejects a re-submission by the **same logged-in customer** for
the **same batch AND same qualification** on the **same calendar day** with HTTP
**409**.

New repo query `offlineEnquiryRepository.existsSameDayForBatchQualification` —
`count` on `ws_offline_enquiry` where `userId = customerId AND batchId = batchId AND
qualification = qualification AND createdAt BETWEEN dayStart..dayEnd` (local-day
bounds). Guard runs in `submitBatchEnquiryMysql` before insert; throws the new
`DuplicateEnquiryError` → controller maps to 409. Skipped for anonymous (0 sentinel);
the route is auth-required so customerId is always real. `POST /client/offline/enquiry`
(anonymous public form) is intentionally unchanged.

---

## 2026-07-14 — Invoice download: gate on order status, not gatewayPaymentId

> **Query-shape change only. No DDL** (`status` already exists on every order table).

Invoice/receipt generation in `src/libs/core/generate.ts` blocked download whenever
`gatewayPaymentId` was absent. Offline / free orders (cash, bank, QR, `Backend`, `free`
payment methods) never carry a `gatewayPaymentId` — only razorpay online orders do — so
manually-settled and free subscriptions could not download invoices even though they are
fully processed.

Fix: each MySQL receipt loader now selects `status` and gates on the completed-order
state that the purchase-history listing already uses, instead of `gatewayPaymentId`:

- `loadBookReceiptFromMysql` — added `status` to the `bookOrder` select; allow when
  `status ∈ {verified, shipped, delivered}`.
- `loadEbookReceiptFromMysql` — added `status` to the `eBookOrder` select; allow when
  `status === "complete"`.
- `loadCourseReceiptFromMysql` — added `status` to the `packageCourseOrder` select; allow
  when `packageCourseOrder.status === "complete"`.
- `loadLiveCourseReceiptFromMysql` — unchanged; already gates on `paymentStatus === "verified"`
  and does not require `razorpayPaymentId`.

No response-shape change; `razorpayPaymentId` still renders `"-"` when absent.

---

## 2026-07-14 — OTP login: block after 5 wrong attempts + auto-unblock sweep

> **Behavior + new queries on `ws_customer`. No DDL** (`tried_otp`, `otp_blocked_at`,
> `status` already exist).

`POST /client/auth/otp/validate` previously kept decrementing "attempts remaining"
past zero into negatives and never blocked. Now, on the `OTP_MAX_ATTEMPTS`-th (5th)
wrong OTP it **blocks the account**: `status=false`, `otp_blocked_at=now`,
`tried_otp=5` (new `customerAuthRepository.blockOtp`), returning "Due to too many
wrong attempts, your account has been blocked for 24 hours." Earlier wrong attempts
return "Invalid OTP. N attempt(s) remaining." with N ∈ {4,3,2,1} — never 0/negative.

While blocked: validate → "Invalid user." (`findLoginableByPhone` already requires
`status=true`); generate/resend → "Your account has been blocked, please contact the
helpline number." A correct OTP is still checked *before* the counter, so a valid
code always succeeds up to the block (a real 5 attempts, matching the message).

Auto-unblock: new lightweight `setInterval` sweep (`otp-unblock.scheduler.ts`, every
`OTP_UNBLOCK_SWEEP_MINUTES`=5) runs one atomic idempotent `updateMany`
(`unblockExpiredOtp`): `WHERE status=false AND otp_blocked_at < now-OTP_BLOCK_HOURS`
→ `status=true, otp_blocked_at=NULL, tried_otp=0`. The `otp_blocked_at < cutoff`
predicate excludes NULL, so **admin-disabled accounts (otp_blocked_at NULL) are never
auto-re-enabled**. No Redis "is-running" lock (the old design's stuck-flag-after-crash
bug) — the sweep is idempotent, so concurrent runs across PM2 workers are safe.
New env (optional): `OTP_BLOCK_HOURS` (24), `OTP_UNBLOCK_SWEEP_MINUTES` (5).

---

## 2026-07-14 — Study materials are ALWAYS paid (never free)

> **Behavior + data change on `ws_material` only** (not books/ebooks). DML migration:
> `docs/migration/schema-changes/2026-07-14_material_always_paid.sql`.

Study materials are conceptually paid, gated PDFs — there is no free tier. Enforced
at three layers so a stray/legacy `is_paid=0` can never serve a material for free:

1. **Write (admin):** `admin-material.createMaterial` forces `isPaid=true`;
   `updateMaterial` forces `isPaid=true` on every edit (ignores any client value).
   (`ws_material.is_paid` already defaults `true` in schema.)
2. **Read/gating (hard rule):** `client-material.getPurchasedMaterialIds` now
   entitlement-checks EVERY material (dropped the `.filter(m => m.isPaid)`), and all
   material shapers hard-code `isPaid=true` / `isPurchased = owned.has(id)`
   (`client-material.shapeMaterial`, `client-catalog.shapeMaterialDoc`,
   `client-folder.hydrateRefs`). So `mediaToken` is null unless the caller owns an
   active course/package sub covering the material's category chain.
3. **`/free-materials` endpoint** now returns an empty page unconditionally
   (`client-free.freeMaterials`) — there are no free study materials to list. (Its
   old free-only tree walker + the free-material shaper were removed.)

Data cleanup: `UPDATE ws_material SET is_paid=1 WHERE is_paid=0 OR is_paid IS NULL`
(idempotent). Staging already 227/227 `is_paid=1`. Response field `isPaid` on every
material is now always `true`; frontend has dropped the Paid/Free control accordingly.

---

## 2026-07-14 — Subscription audit: stamp created_by / updated_by with the acting admin

> **Schema change (3 tables get new columns) + write-logic change across 4 admin modules. DDL: `docs/migration/schema-changes/2026-07-14_subscription_created_by_updated_by_audit.sql` (applied to staging).**

Admin-initiated manual subscription create/update now stamps `created_by` / `updated_by`
with the **acting admin's id, derived server-side from the JWT** (`req.user?.id`), never
from the request body. Covers all four subscription surfaces:

| Product | Create endpoint | Update endpoint | Table |
|---|---|---|---|
| Package / Course | `POST admin/subscriptions` | `PUT admin/subscriptions/:id` | `ws_package_course_subscription` |
| Live Course | `POST admin/live-courses/:id/grant` | `PUT admin/live-courses/subscriptions/:id` | `ws_live_course_subscription` |
| Test Series | `POST admin/test-series/:id/grant` | `PUT admin/test-series/subscriptions/:id` | `ws_test_series_subscription` |
| EBook | `POST admin/ebooks/subscriptions` | `PUT admin/ebooks/subscriptions/:id` | `ws_ebook_subscription` |

Rules implemented:
- **Create** → `created_by = updated_by = actingAdminId`.
- **Update** → `updated_by = actingAdminId`; `created_by` left untouched (only set when
  the admin id resolved, so a system/unauthenticated caller never nulls it).
- **Extend** paths: package/course extend creates a NEW row → both columns set. Live /
  test-series / ebook extend UPDATE an existing row → `updated_by` only (per contract).
- **Source of truth = JWT.** Any `created_by`/`updated_by` in the body is ignored; the
  Zod schemas were NOT widened — the id is threaded as a separate `actingAdminId` param
  controller → service → repository.
- Online/system purchases are unchanged (not admin-attributed → stay NULL).

Schema: `ws_package_course_subscription` already had both columns. Added `created_by INT
NULL` / `updated_by INT NULL` to `ws_live_course_subscription`,
`ws_test_series_subscription`, `ws_ebook_subscription` (DDL above; `schema.prisma` models
hand-edited to match; `prisma:generate` run). Existing rows stay NULL (no backfill —
historical admin actor is unknown). Verified on staging: a create on each of the four
tables persists `created_by = updated_by = <admin id>`.

## 2026-07-14 — `EBookOrder.paymentMethod` relaxed enum → nullable String (dirty legacy data)

> **Schema type change on ONE field (no DDL). Fixes a hard read crash on the eBook subscription export.**

The eBook subscription export (`admin-ebook.repository.ts` `listSubscriptions` /
`listSubscriptionsPageKeyset`) reads the joined `eBookOrder.paymentMethod`. Legacy
`ws_ebook_order` rows store an **empty string** in `payment_method`, which is not a valid
`PaymentMethod` enum member, so Prisma threw on deserialization:

```
Invalid `prisma.eBookSubscription.findMany()` invocation:
Value '' not found in enum 'PaymentMethod'
```

Fix: `prisma/schema.prisma` `EBookOrder.paymentMethod` changed from `PaymentMethod` →
`String?`. Prisma no longer validates the value against the enum on read, so `''`/null
rows read through as-is and the export succeeds. **No DDL** — the MySQL column already
holds these values; only Prisma's interpretation changed. Regenerated the client
(`prisma:generate`). Writers were already `as any` / string literals (`"razorpay"`), so
unaffected. Consumer type widened: `admin-customer-details.transformer.ts` `toEbookDto`
`orders` Lookup `paymentMethod: string` → `string | null`. The export/DTO now surfaces the
raw value (`''` for legacy rows) instead of crashing.

**Watch:** the same `PaymentMethod` enum is still strict on `PackageCourseOrder.paymentMethod`
and `BookOrder.paymentMethod`; if their tables also contain blank `payment_method` rows,
their exports will hit the identical error and need the same relaxation.

## 2026-07-14 — Study materials moved to the encrypted media-token contract

> **Response-shape change (deliberate, coordinated w/ frontend). No schema/DDL change.**
> Frontend integration doc: `docs/client/MATERIAL_MEDIA_TOKEN_FRONTEND.md`.

Study-material responses previously inlined the raw `file` (Spaces URL) and
`directLink`. They now follow the same media-token contract as video/ebook/audio:
list/detail endpoints emit an opaque **`mediaToken`** (never the URL), which the
client exchanges at `POST /client/media/resolve` for a short-lived URL. New
`MediaKind: "material"`; resolver `case "material"` presigns the `file` Spaces
object (or passes through an external `direct_link`), re-checking ownership for
paid materials via `getPurchasedMaterialIds` (free tokens skip). Token minting is
centralized in `client-material.materialMediaToken()`.

Shape delta on every material object (all endpoints below): `file` and `directLink`
are now always `""`; added `mediaToken: string | null` (null = locked/unpurchased
or unauthenticated) and `isDirectLink: boolean` (external link vs uploaded PDF).
Resolve returns `media: { url, mime, isDirectLink }`.

Endpoints updated (all four material-bearing surfaces):
- `client-material.service` — `/materials/categories/:id/contents`,
  `/material-categories/:id/materials`, `/materials/:id`, `/materials/recent`
- `client-free.service` — `/free-materials` (free-only)
- `client-catalog.service` — `/catalog/:type/:id/materials` (course inlined list)
- `client-folder.service` — saved material folders (`/material-folders/:id`, `/all-items`)

---

## 2026-07-14 — Media resolve: presign path-style own-bucket URLs + book/ebook demo audit script

> **No schema/DDL change. Behavior fix in `client-media.service.resolveMediaToken` + new read-only audit script.**

**Problem:** `/client/media/resolve` returned `404 "This book demo is not available."`
(and the ebook equivalent) for some OLD rows. Two distinct causes:

1. **Path-style own-bucket URLs served raw.** The `bookDemo` branch passed a URL
   through as-is when `isOwnBucketUrl(src)` was false. That helper only recognizes
   the **virtual-host** layout (`<bucket>.<endpoint-host>/…`); a legacy row stored
   path-style (`<endpoint-host>/<bucket>/…`) was mistaken for external and returned
   unsigned → private object → client 403/blank. Fixed: added `pointsAtOurSpaces()`
   (matches either Spaces layout) and gate passthrough on it, so any own-bucket URL
   is HEAD-checked + presigned. Truly external hosts (e.g. `gpsconline.com`) still
   pass through.

2. **Genuinely missing objects (data drift).** Rows whose `demo_url`/`book_url`
   point at an object absent from the CURRENT bucket (carried over from another
   environment, deleted file, corrupted key) correctly 404 — the resolver can't
   invent the PDF. New script **`scripts/audit-book-demo-media.ts`** lists exactly
   which `ws_book.demo_url` / `ws_ebook.demo_url` / `ws_ebook.book_url` rows are
   broken (id, name, derived key) so the file can be re-uploaded or the URL fixed.
   It reuses the resolver's own key-derivation + passthrough logic, so its verdict
   matches runtime. Read-only; run per environment:
   `npx tsx scripts/audit-book-demo-media.ts [--books|--ebooks|--materials]`.
   The script now ALSO probes external URLs (HEAD/GET) and flags 4xx/5xx as
   `external_DEAD` (bounded concurrency; `AUDIT_HTTP_TIMEOUT_MS`/`AUDIT_CONCURRENCY`
   env knobs), and covers `ws_material.file`.
   Staging audit at write time: books/ebooks 0 broken; **materials 226/227
   external_DEAD** — every legacy `gpsconline.com/uploads/materials/*.pdf` link
   returns HTTP 500 (host endpoint dead) and the files are NOT in our Spaces bucket.
   Those reach the client verbatim (public passthrough), so the app shows the
   origin's "Internal server error" when opening. Remediation is data-side:
   re-host the PDFs to Spaces + repoint `ws_material.file` (new admin uploads
   already write to Spaces correctly). No code fix can open a dead origin file.

---

## 2026-07-14 — Video-category DAG walkers also follow the self-FK `parent` (fix null mediaToken on deep hierarchies)

> **Query-shape change (read-only). No schema/DDL change. Response shapes unchanged.**

`catalog-category-tree.service` `ancestorsOf`/`descendantsOf` (the recursive-CTE DAG
walkers backing `resolveVideoScope`, `resolveVideoCourseId`, `reachableCategoryIds`,
and the client catalog subtree/counts) previously walked **only**
`ws_video_category_relation`. Admin historically links subcategories via the legacy
self-FK `ws_video_category.parent` and only later mirrors them into the pivot (see the
`2026-07-13_video_category_relation_backfill.sql`). On any environment not yet fully
backfilled, a video category nested **more than one level deep** had its pivot ancestor
edge missing → the up-walk truncated → `resolveVideoScope` returned `null` →
`isEntitledForScope` → `false` → paid videos got `mediaToken: null` (unplayable).

Both CTEs now recurse over the **UNION** of the pivot edges and the self-FK `parent`
column, so the walk is correct regardless of pivot-backfill completeness:

- up-walk (`ancestorsOf`): `relation(child→parent)` ∪ `ws_video_category(id→parent)`
- down-walk (`descendantsOf`): `relation(parent→child)` ∪ `ws_video_category(parent→id)`

The self-FK arm only ADDS edges (never contradicts the pivot); dedup + the existing
`MAX_DEPTH` cap keep it cycle-safe. No response shape changes; this only restores
media tokens / scope that were incorrectly null for deep folder trees.

---

## 2026-07-14 — Video-category hierarchy READS now sourced from `ws_video_category_relation`

> **Query-source change (read-only). No schema/DDL change. Response shapes unchanged.**
> Backfill required before flip: `scripts/backfill-video-category-relation-from-parent.ts`.

Video categories carry two hierarchy stores kept in sync by the admin CRUD — the
single-parent `ws_video_category.parent` column and the many-to-many
`ws_video_category_relation` edge table (the DAG the client catalog + package
composition already trust). All **parent/child reads** were moved off the column and
onto the relation table. Writes are unchanged (`vcSetParent`/`vcCreate`/`vcDuplicate`
still keep the column + edges in sync; the column stays populated).

Single-parent surfaces (picker `parentId`, admin category tree, ancestor chains)
collapse the DAG to a deterministic **primary parent** (lowest edge `order`, then
lowest `parent` id) via new util `src/utils/videoCategoryRelation.ts` — so for
well-formed data (one edge per child) the value equals the old column, and the JSON
is byte-identical.

Changed reads:
- `admin-master.repository`: `vcChildren`, `hasChildren` (now `videoCategoryRelation.findFirst`),
  `vcCategoriesByIds` (parent from relation), new `vcAllEdges` / `vcPrimaryParents`.
  `admin-master.service`: `vcList` (in-memory tree from edges), `fullVcList` / `loadFullVc`
  (batched primary parent). `vcDuplicate`'s internal clone BFS intentionally stays on the
  in-sync column (write path).
- `admin-video.repository`: `childParentIds` (distinct relation parents), `categoriesByIds`
  (parent from relation), new `primaryParents`; `listActiveCategories` no longer selects
  `parent`. `admin-video.service.getPreRequisites`: `parentId`/`ancestors` from relation.
- `catalog-video.repository`: `listActiveChildren` / `countActiveChildren` (children via
  `childIdsOf`), `childCountsByParent` (per-parent active child-folder count over edges).

Behavior note: values change only where the DAG genuinely holds **multiple** parents for
a child (the column could hold only one) — there the relation table now wins, which is the
intended, more-correct semantics.

---

## 2026-07-14 — Admin video-categories: `status` filter accepts boolean-style values

> **Validation contract fix (query-shape). No schema/query change.** Endpoints: `GET /admin/video-categories`, `/:id/courses`, `/:id/videos`.

The list `status` filter was a strict Zod enum `active|inactive`, but the FE toggle
sends `status=false` / `status=true`, so `GET /admin/video-categories?...&status=false`
422'd with `Invalid enum value. Expected 'active' | 'inactive', received 'false'`.

Fix (`src/admin/videoCategory/videoCategory.validation.ts`): added a `statusFilter`
preprocessor that normalizes before enum validation and applied it to `listQuerySchema`,
`categoryCoursesQuerySchema`, `categoryVideosQuerySchema`:
- `true|"true"|"1"|1` → `"active"`, `false|"false"|"0"|0` → `"inactive"`
- `""|"all"|"null"|"undefined"` → undefined (no filter)
- `"active"|"inactive"` still pass through unchanged (no breaking change)

The service (`admin-master.service.ts` `fullVcList`) already maps the enum to the
boolean column filter, so `status=false` now correctly returns inactive categories.

---

## 2026-07-14 — Books purchase-history: real book titles + full per-book details

> **Read-shape fix + additive response field. Course of the "Book" placeholder title on `GET /client/purchase-history/books`.**

The books tab (`listBooks`, `src/modules/client-purchase-history/client-purchase-history.service.ts`)
read each order's line items as `{ item, name }`, but the SQL book-order create path
(`book-order.service.ts` → `JSON.stringify(preview.items)`) writes
`{ bookId, qty, listPrice, price, shippingPrice }` — **no `name`, and the id key is
`bookId`, not `item`**. So for every SQL-created order the id list was empty, the book
lookup resolved nothing, and the title fell back to `"Book"`.

Fix:
- New `itemBookId()` helper resolves the line's book id from **either** shape
  (`bookId` for SQL rows, `item` for legacy Mongo-migrated rows).
- `listBooks` now resolves **all** referenced books (not just the first) via `booksByIds`,
  backfills each line's name/thumbnail from `ws_book`, and computes the title from the
  resolved name (`"<First> +N more"`).
- **Additive:** each order now carries a `books: [{ bookId, name, thumbnail, qty, price }]`
  array so the app can render the full list of purchased books. Existing fields
  (`title`, `thumbnail`, `meta.itemsCount`, `tracking`) are unchanged.
- Same latent bug fixed in `getBookReceiptMysql` (receipt line names): `Number(it.item)`
  → `itemBookId(it)`, so SQL-created orders' receipt items resolve their names too.

No schema/index/query change — purely how the already-fetched `order_items` JSON is
interpreted + one extra `booksByIds` read.

## 2026-07-14 — No tracking row for "Without Material" course/package subscriptions

> **Write-logic fix (no schema/index change). Digital-only subs were getting a spurious tracking row + `tracking` FK.**

On payment verify, both `verifyCourseTx` and `verifyPackageTx`
(`src/modules/commerce-order/commerce-order.repository.ts`) unconditionally created a
`ws_package_course_subscription_tracking` row (status `pending` for material, `complete`
otherwise) and set `ws_package_course_subscription.tracking` to its id — **even for
"Without Material" / digital-only plans**, which have nothing to ship. That produced a
Tracking ID on subscriptions that should never have one.

Fix: the tracking (dispatch) row is now created **only when `material.withMaterial` is
true** (status `pending` — a kit to ship). For without-material plans no tracking row is
created and `trackingId` stays NULL. The DTO already surfaces `trackingId` as
`number | null` (transformer `trackingToNumber`), so response shapes are unchanged; the
book-order verify path (physical books, always shipped) is a separate flow and untouched.

**Note:** this fixes new fulfillments. Existing digital-only rows that already carry a
`tracking` FK are not backfilled here — a cleanup could null out `tracking` (and delete the
orphan tracking rows) for subs whose plan is without-material, if desired.

## 2026-07-14 — Populate `unique_id` / `razorpay_order` / `created_at` / `updated_at` on course+package orders

> **Write-shape fix (no schema/index change). The client checkout create-order path left four `ws_package_course_order` columns NULL on every new row.**

`createPendingOrder` (`src/modules/commerce-order/commerce-order.repository.ts`), shared by
the client course + package create-order endpoints, never set these columns; they are
nullable with no DB default, so they landed NULL:

- **`unique_id`** ← the receipt id (`course-…` / `package-…`), the order's business key —
  same convention as the ebook create path.
- **`razorpay_order`** (`gatewayOrder`, distinct from `razorpay_order_id`/`gatewayOrderId`)
  ← `JSON.stringify(rzpOrder)`, the full Razorpay order response — mirrors the book-order
  path (`gatewayOrder: razorpayOrderPayload`).
- **`created_at` / `updated_at`** ← explicit `new Date()` stamps (mirrors ebook-order).

Wiring: `uniqueId` + `razorpayOrderPayload` added to `createPendingOrder` and to
`createCourseOrderMysql` / `createPackageOrderMysql` (service), passed from
`course-payment.controller.ts` and `package-payment.controller.ts` (both already had
`receiptId` + the `rzpOrder` object). No response-shape change. The admin manual-grant
order path (`admin-subscription.createPaymentOrder`) already stamped unique_id/created_at/
updated_at and has no Razorpay payload, so it was left as-is.

## 2026-07-14 — Subscription Report `hasWsCoin` filter

> **Query-shape change (new filter on the merged course+package subscription report). No schema/index change — `ws_coin` already exists on `ws_package_course_order`.**

`GET admin/subscriptions` (+ `/export/csv`, `/export/excel`, and the async export job)
gained an optional tri-state `hasWsCoin` query param that scopes the merged
course+package subscription list (both the Subscription Report and Subscription Material
Report) by whether the linked order redeemed Ws Coin.

- `hasWsCoin=true` → only subs whose order has `ws_coin > 0`.
- `hasWsCoin=false` → the complement: order-less subs (`order_id` NULL) **plus** orders
  with `ws_coin` NULL or ≤ 0. (Order-less counts as "without" per the request.)
- omitted → no Ws Coin filter (prior behaviour).

Implementation: `ws_coin` lives on `ws_package_course_order`, reached via the
`packageCourseOrder` relation (the same relation `orderMethod` uses). The filter is added
as an ANDed relation fragment in `buildSubWhere`
(`src/modules/admin-subscription/admin-subscription.repository.ts`), so it feeds the base
`where` and therefore scopes the list, the revenue aggregate, and the active/expired
counts — `pagination.total` and `summary` reflect the filtered set. Composes (AND) with
every existing filter. Wired through `reportQueryFrom` (controller) →
`CourseSubReportQuery` / `resolveCourseSubWhere` (service) → `CourseSubFilter` (repo), so
the list and both exports honor it identically. The `false` branch is spelled out via
explicit `orderId: null` / `wsCoin: null` / `wsCoin ≤ 0` OR-branches rather than a
relation `isNot`, whose null-relation handling is unreliable in Prisma.

**Note:** the sibling Activation Type dropdown needs no backend work — it reuses the
existing `paymentMethod` param (not the no-op `activationType`).

## 2026-07-14 — All API response dates now rendered in IST (+05:30) instead of UTC (Z)

> **Response serialization change only. Storage stays UTC — this is display-only, applied centrally.**

Every `Date` value in JSON responses (`created_at`/`updated_at` and all other Date fields)
was serialized as a UTC ISO string (`2026-07-10T12:42:45.000Z`). Admins wanted IST. Rather
than change storage (anti-pattern: would corrupt existing UTC rows + break report filters /
date comparisons / payment reconciliation across ~396 `new Date()` sites), the output is now
formatted centrally:

- **New:** `src/utils/istJson.ts` — `istJsonReplacer` (+ `toISTISOString`). Emits ISO-8601 in
  IST: `2026-07-10T18:12:45.000+05:30`. Still a valid instant, so `new Date(str)` on any client
  resolves to the SAME moment — clients doing date math are unaffected; clients showing the raw
  string now see IST.
- **Wired:** `src/app.ts` — `app.set("json replacer", istJsonReplacer)` right after
  `trust proxy`. Applies to every `res.json()`; no transformer/DTO changes.
- **Mechanism:** JSON.stringify calls `Date.prototype.toJSON` before the replacer, so the
  replacer inspects `this[key] instanceof Date` (the original Date) to reformat.
- **Caveat:** only raw `Date` values are converted. A few call sites that pre-stringify with
  `.toISOString()` still emit `...Z`; migrate those to raw Date passthrough if full uniformity
  is needed. No DB/schema/query change. `yarn typecheck` green; runtime-verified round-trip.
- **Contract note:** date fields change from `...Z` to `...+05:30`. Any consumer string-matching
  the literal `Z` suffix (rather than parsing) must be updated.

> **Query-source change only (no DB/schema change). Fixes a split-brain where the admin setting never reached checkout.**

`getFreeShippingMin()` (`src/modules/book-order/book-order.service.ts`) — used by BOTH the
book cart preview (`client-cart.service.ts`) and book order create — previously read
`ws_termsandcondition.freeShippingMinimumOrderAmount` (`module='book', status=true`). But
the admin edits the threshold via `PUT /admin/books/settings`, which writes a **different**
table/column: `ws_book_setting.freeShippingMinOrderAmount` (`settingKey='default'`). So the
admin value never affected the shipping waiver — it worked in envs where the terms row
happened to be populated (local) and silently failed where it wasn't (deployed server).

- **Change:** `getFreeShippingMin()` now reads `prisma.bookSetting.findFirst({ where:
  { settingKey: "default" }, select: { freeShippingMinOrderAmount } })` → `?? 0`.
- **Effect:** the `/admin/books/settings` `freeShippingMinOrderAmount` value now drives the
  waiver everywhere (`shippingWaived = min > 0 && discountedSubtotal >= min`). No API
  response shape changed. No DDL / schema change (reads an existing column). `yarn typecheck` green.
- **Ops note:** no DB migration needed. On deploy, ensure `ws_book_setting` (settingKey
  'default') has the intended `free_shipping_min_order_amount`; the old
  `ws_termsandcondition` book value is no longer consulted for shipping.

> **Schema change: +`ws_offline_batch.deleted_at` (DDL `2026-07-14_offline_batch_soft_delete.sql`) + Prisma field. Behavior change to the batch delete flow.**

`DELETE /api/v1/admin/offline/batches/:id` previously HARD-deleted the batch **and**
cascade-deleted all of its enquiries (`deleteEnquiriesInBatch` → `offlineEnquiry.deleteMany`),
so the enquiries vanished from `/api/v1/admin/offline/batch-enquiries`. Since
`ws_offline_enquiry.batch_id` is a **required FK**, enquiries can't outlive a hard-deleted
batch — so the batch is now **soft-deleted** instead:

- **Schema:** `OfflineBatch.deletedAt DateTime? @map("deleted_at")` (nullable, no default —
  existing rows = not deleted). DDL: `docs/migration/schema-changes/2026-07-14_offline_batch_soft_delete.sql`
  (`ADD COLUMN deleted_at` + `idx_ws_offline_batch_deleted_at`). `prisma:generate` run.
- **Write (`offline-batch.repository.ts`):** `deleteBatch` now `update({ data: { deletedAt: new Date() } })`
  instead of `.delete()`; the `deleteEnquiriesInBatch` cascade was removed (call + helper).
- **Reads (`offline-batch.repository.ts`):** all batch queries now filter `deletedAt: null` —
  `batchListWhere`, `clientBatchWhere` (→ listBatches/countBatches/listBatchesAdmin/countBatchesList),
  `findBatchById` (changed `findUnique`→`findFirst` to allow the non-unique filter),
  `listUpcoming`, `listBatchesByCenters`, `countBatchesInCenter`.
- **Result:** deleted batch disappears from every batch list, but its enquiries remain and
  still show in `/batch-enquiries` with their batch name (the `include: { batch }` relation
  in `offline-enquiry.repository.ts` does not filter `deletedAt`, so the soft-deleted batch
  still resolves). No API response shape changed. `yarn typecheck` green.
- **Deploy:** apply the DDL (`npx prisma db execute --file docs/migration/schema-changes/2026-07-14_offline_batch_soft_delete.sql`) before/with the code deploy.

> **Controller-only change (no DB/query/schema change). Response body made readable; status code unchanged (400).**

`POST /api/v1/client/payment/create-order/ebook` (`src/client/payment/ebook-payment.controller.ts`)
previously returned the raw `ZodError.issues` array on validation failure — an
unreadable blob of `{ code, minimum, type, path }` objects (e.g. `"Number must be
greater than or equal to 0"`). Fixed:

- **Schema messages:** `createEbookOrderMysqlSchema` now carries human-readable messages —
  `planId` → "Please select a valid eBook plan.", `promocode` → "Promo code cannot be
  empty…", `coin` → "Coins to redeem cannot be negative." / "…must be a whole number."
- **Response body:** the catch block now returns a flat `{ field: message }` map under
  `errors` plus the first message as top-level `message`, instead of `errors: e.issues`.
  Full raw issues still logged via `logger.warn` for debugging.
- **Unchanged:** HTTP status stays **400**; no query/schema/index change; scope limited to
  the client eBook create-order endpoint only. `yarn typecheck` green.

> **DDL-record edit only (no schema.prisma change, no new columns). Amends the un-applied `2026-07-08_merge_promo_code_into_promocode.sql`.**

Per client request, `description` is now left **entirely unchanged** by
`docs/migration/schema-changes/2026-07-08_merge_promo_code_into_promocode.sql`. The
`MODIFY COLUMN description ...` line was removed; the migration now only `ADD`s the four
discount/appliesTo columns (`discount_type`, `discount_value`, `applies_to_type`,
`applies_to_ids`) plus the two indexes.

- **Was:** `MODIFY COLUMN description TEXT NULL` (later `TEXT ... utf8mb4`) to widen the
  column to match the former `ws_promo_code` rule table's `TEXT` description.
- **Now:** no `description` change at all.
- **Caveat to watch:** if `ws_promocode.description` is currently narrower than the rule
  table's `TEXT` (e.g. a `VARCHAR`), the backfill (`scripts/backfill-merge-promo-code.ts`)
  could **truncate** long rule descriptions when copying `ws_promo_code` rows over. Confirm
  the existing `ws_promocode.description` type is wide enough before running the backfill.
- **Scope:** `prisma/schema.prisma` unchanged (`description String? @db.Text` already
  declared); no `prisma:generate` needed.

---

## 2026-07-13 — Fix: ws_book_order left user_ip / transaction_id / paid_at / created_at / updated_at NULL on the SQL path

> **Write-path fix + one Prisma field addition (column already exists — NO DDL). `admin`/legacy rows unaffected.** `yarn typecheck` green, `prisma:generate` run.

The migrated book-order write path never set these columns, so new orders inserted them
NULL (only `order_date` populated — it has a DB `DEFAULT CURRENT_TIMESTAMP`). `created_at`/
`updated_at` have **no** DB default and **no** Prisma `@default`/`@updatedAt`, so they must
be set in code. (`user_ip`/`transaction_id`/`paid_at` were NULL even in legacy Laravel rows;
now populated meaningfully.)

- **`prisma/schema.prisma`** — added `userIp String? @map("user_ip")` to `BookOrder`
  (the `user_ip` column already existed in `ws_book_order`; introspection had never mapped
  it — **no ALTER**). `prisma:generate` run.
- **`createPendingOrder`** (`book-order.repository.ts`) — now sets `createdAt`/`updatedAt`
  = `new Date()` and `userIp` (from `req.ip`, threaded via `writeBookOrderMysql` +
  `payment.controller`).
- **`verifyBookTx`** (`book-order.repository.ts`) — on fulfillment now also sets
  `transactionId` = razorpay payment id (previously only `gatewayPaymentId` /
  `gateway_transaction_id` got it), `paidAt` = `new Date()`, and bumps `updatedAt`.
- **Note:** the customer order list sorts by `createdAt desc`; migrated orders had NULL
  `createdAt` and sank to the bottom — this fix corrects new orders' ordering. Existing
  NULL rows would need a one-off backfill (`created_at = order_date`) if we want them to
  sort correctly too — not done here.
- **Ops note:** because `schema.prisma` changed, the Prisma client was regenerated
  (`yarn prisma:generate`). A running `tsx watch` dev server does NOT reload the
  regenerated client on a source hot-reload — it must be **fully restarted**, else
  `bookOrder.create` throws `Unknown argument userId` (stale in-memory client). Verified
  the on-disk client accepts the new create (`userId` + `userIp`) via a rolled-back txn.

---

## 2026-07-13 — Fix: media resolve mis-parsed SCHEME-LESS path-style Spaces URLs (book demos 404'd)

> **Bugfix in `toObjectKey` (client-media resolve). Affects all presigned kinds (book demo, ebook, audio). No schema change.** `yarn typecheck` green.

Some `ws_book.demo_url` rows store a **scheme-less path-style** Spaces URL, e.g.
`blr1.digitaloceanspaces.com/websankul-staging/admin/profiles/…-demoUrl.pdf` (no
`https://`). `toObjectKey` in `src/modules/client-media/client-media.service.ts` only
parsed values that began with `http(s)://`; anything else was returned verbatim as the
object key. So the **entire `host/bucket/path` string** became the S3 key → the
presigned GET 404'd with `NoSuchKey` → the FE showed "Demo not available."

- **Fix:** when the value looks like `<host.tld>/…` but has no scheme, prepend
  `https://` before `new URL()` parsing, so the host + `<bucket>/` prefix are stripped
  and the real key (`admin/profiles/…-demoUrl.pdf`) is produced. Truly bare keys (no
  host) still pass through unchanged.
- **Verified end-to-end** by resolving + fetching the presigned URL for four books:
  external `gpsconline.com` (returned as-is), own-bucket URL (#192), and the two
  scheme-less rows (#194/#195) — all now return HTTP 200 with `%PDF` bytes (previously
  #194/#195 returned `NoSuchKey`).
- **Note (ops):** in staging the Spaces credentials return **403 on `HeadObject`**, so
  the `MEDIA_VERIFY_EBOOK_OBJECT` existence guard is inconclusive (treats non-404 as
  "exists" and presigns anyway). Presigned **GET** works regardless. If a demo file is
  genuinely missing, resolve will still hand out a URL that 404s — prefer storing a
  null `demo_url` over a dangling key.

---

## 2026-07-13 — Physical-book demo PDF now served via encrypted media token (like the ebook demo)

> **Response-contract change on client book surfaces + new `bookDemo` media-token kind. No DB schema/index change.** `yarn typecheck` green.

The physical-**book** demo PDF was emitted as a **raw** `demoUrl` (Spaces URL) in the
client book responses, unlike the ebook demo which already goes through the encrypted
short-lived media-token flow (`signMediaToken` → `POST /client/media/resolve` →
presigned GET). Brought books to parity.

- **New media kind:** `bookDemo` (free) in `src/utils/mediaToken.ts`; resolved in
  `src/modules/client-media/client-media.service.ts` — fetches `ws_book.demo_url`
  (`prisma.book.findFirst({ where: { id, active: true }, select: { demo_url: true } })`),
  HEAD-verifies the object, then presigns (same guard as the ebook demo,
  `MEDIA_VERIFY_EBOOK_OBJECT`).
- **Contract change:** the book DTO field `demoUrl: string | null` is **replaced** by
  `demoMediaToken: string | null` (`src/modules/catalog-book/catalog-book.types.ts` +
  `catalog-book.transformer.ts`, now takes `{ customerId }`). Affected client endpoints:
  `GET /client/books` (list), `GET /client/books/:id` (detail),
  `GET /client/books/trending[/books]`, and the home/free dashboards.
- **Demo is PUBLIC** — the encrypted `demoMediaToken` is emitted whenever the book has a
  demo PDF, **independent of login OR purchase** (null only when there is no demo). The
  token is customer-bound when a viewer id is known (else a `0` sentinel), and the
  resolver **skips the issuer-match check for `bookDemo`** (a demo resolves for any
  caller). Every other media kind stays account-bound.
- **External legacy demos:** most `ws_book.demo_url` values are fully-qualified URLs on
  an EXTERNAL host (e.g. `gpsconline.com/uploads/e-books/demo_book/*.pdf`), NOT Spaces
  objects. The `bookDemo` resolver returns those **as-is** (guarded by `isOwnBucketUrl`);
  only own-bucket URLs get the HEAD-verify + presign path. Without this, resolve 404'd
  every book demo (it tried to presign an external URL against our Spaces bucket).
  Verified: book id 1 resolves to its raw external PDF URL.
- **`customerId` threaded** through `catalog-book.service` (`getBookById`/`listBooksData`),
  `book.controller`, and `client-trending.service.fetchTrendingBooksOnly` (+ its callers in
  `client-dashboard.service` and `buildFreeDashboard`).
- **Incidental fix:** the trending books builder read `b.demoUrl` (undefined — the Prisma
  column is `demo_url`), so the trending demo field was always null; the token now reads
  `b.demo_url` correctly.
- **Not changed:** the trending **ebook** item still carries a (legacy, always-null)
  `demoUrl` — the ebook catalog already uses `demoMediaToken`; left as-is to keep this
  scoped to books.

---

## 2026-07-13 — Exam catalog test count: only active, subject-type quizzes

> **Query-level count-filter change on the catalog test counts. No schema change.** `yarn typecheck`
> green; verified against the live DB.

The client-facing catalog test `count` (the "test count" leg of `havingChildDirectory ? childCount
: testCount`) was counting quizzes that should not appear: **draft** quizzes (`ws_exam.status = false`)
and **`daily`-type** quizzes. It must count only **active, subject-type** quizzes
(`status = true AND type = 'subject'`).

- **`catalog-exam.repository.countExams`** (children endpoint leaf count) — was UNCONDITIONAL (no
  status/type filter); now `AND [{ status: true, type: "subject" }]`.
- **`client-catalog.service` test-tab count** (`/catalog/:type/:id/tests`, all product types) — had
  `status: true` only; added `type: "subject"`. This feeds both the per-category `count` and
  `totals.items`.

`ExamType` enum = `daily | subject`; drafts are `status = false`. Verified: categories 149 & 150
each hold one draft subject quiz → old count 1, new count 0.

NOT changed (different context / not the ternary count, flagged for follow-up if desired):
`catalog-package.detail.sql` + `catalog-course/course-detail.sql` detail-bundle counts (already
`status: true`, no type filter) and `client-free.service` free-test listing.

**Files:** `src/modules/catalog-exam/catalog-exam.repository.ts`,
`src/modules/client-catalog/client-catalog.service.ts`.

---

## 2026-07-13 — exam-categories/:id/children `count` now = child-folder count for directory nodes

> **Query-level `count` semantics change on one client endpoint. No schema change.** `yarn typecheck`
> green; verified against the live DB.

Same fix as the video children endpoint, applied to `GET /client/exam-categories/:id/children`
(`getCategoryChildren` in catalog-exam.service). `count` was the category's **direct test count**
unconditionally, so a folder that only holds sub-folders showed a misleading number next to
`havingChildDirectory: true` (e.g. category 112 "Ancient History": 1 direct test but 2
sub-categories). Now: `count = havingChildDirectory ? childFolderCount : testCount`.

- **`repo.childCountsByParent`** (new, `groupBy parent`, `status:true, deleted:false`) returns the
  active child-folder count per category — drives both `havingChildDirectory` (count > 0) and the
  directory-node `count`. Replaces the membership-only `parentsWithChildren` (removed from the exam repo).
- Leaf nodes still report their own test count (`countExams` = `ws_exam` primary FK OR `ws_exam_category_pivot`).
- Category hierarchy is still self-FK-based (`ws_exam_category.parent_id`); `ws_exam_category_pivot`
  is only the exam↔category link behind the test count.

**Files:** `src/modules/catalog-exam/catalog-exam.service.ts` (`getCategoryChildren`),
`src/modules/catalog-exam/catalog-exam.repository.ts`.

---

## 2026-07-13 — video-categories/:id/children `count` now = child-folder count for directory nodes

> **Query-level `count` semantics change on one client endpoint. No schema change.** `yarn typecheck`
> green; verified against the live DB.

`GET /client/video-categories/:id/children` returned `count` = the category's **direct active video
count** unconditionally, so a folder that only contains sub-folders (no loose videos) showed
`count: 0` alongside `havingChildDirectory: true` — confusing (e.g. category 296 "Law – Hima Desai":
0 direct videos but 3 sub-categories). Now aligned with the catalog contract:
`count = havingChildDirectory ? childFolderCount : videoCount`.

- **`repo.childCountsByParent`** (new, `groupBy parent`) returns the active child-folder count per
  category — drives both `havingChildDirectory` (count > 0) and the directory-node `count`. Replaces
  the membership-only `parentsWithChildren` (removed from the video repo; the material/exam repos keep
  their own copies).
- Leaf nodes still report their own video count (a leaf's direct count = its subtree count).
- Still self-FK-based (this endpoint derives children from `ws_video_category.parent`), unchanged.

**Files:** `src/modules/catalog-video/catalog-video.service.ts` (`getVideoCategoryChildren`),
`src/modules/catalog-video/catalog-video.repository.ts`.

---

## 2026-07-13 — Video categories: pivot (ws_video_category_relation) as the single source of truth

> **Data backfill + admin write-sync. No schema change.** Applies data DDL
> `docs/migration/schema-changes/2026-07-13_video_category_relation_backfill.sql`. `yarn typecheck`
> green; create/move/detach + package-link preservation smoke-tested against the live DB.

The client catalog video tree reads **only** the `ws_video_category_relation` pivot
(`havingChildDirectory` = active pivot-child count; the `descendantsOf` drill-in subtree; and
the counts). Admin, however, wrote parent/child links **only** via the single-parent self-FK
`ws_video_category.parent` and never mirrored them into the pivot — so admin-created (or
duplicated) subcategories were invisible client-side: `havingChildDirectory:false`, unreachable
on drill-in, wrong `count`. 28 of 30 active self-FK child links had no pivot edge.

**Backfill (existing data):** insert the missing `(parent, child, order)` pivot edges from the
self-FK where absent. Non-destructive (insert-only; existing edge ids preserved — they're
referenced by `ws_video_category_package_relation.video_category_relation_id`, i.e. package
composition). Fixed all 28 (verified: 0 remaining).

**Admin write-sync (new data):** every parentage write now keeps the pivot in sync —
- `repo.vcSetParent` (attach/detach/move, used by `reconcileChildren` + the master `vcUpdate`
  parent path): updates the self-FK AND the pivot. On a **move** it **updates the child's
  existing edge in place (same edge id)** so package links follow; a brand-new link inserts;
  detach-to-root deletes only that child's edge.
- `repo.vcEnsureEdge` (new): the master `vcCreate` inserts a pivot edge when created with a parent.
- `repo.vcDuplicate`: clone rewiring now inserts pivot edges for the cloned subtree.

**Why update-in-place, not delete+recreate:** package composition references pivot edge **ids**;
recreating an edge would silently drop the subject from every package that included it.

**Files:** `src/modules/admin-master/admin-master.repository.ts` (`vcSetParent`, `vcEnsureEdge`,
`vcDuplicate`), `src/modules/admin-master/admin-master.service.ts` (`vcCreate`, `vcUpdate`).

**Deploy:** apply the backfill SQL. No `prisma:generate` needed (no schema change).

---

## 2026-07-13 — Wallet ("coin") redemption wired into payment create-order + verify

> **New columns + charge/verify logic across all 5 create-order flows.** Applies DDL
> `docs/migration/schema-changes/2026-07-13_wallet_coin_in_payment.sql`. `yarn typecheck` green;
> validation + idempotent-debit smoke-tested against the live DB.

The wallet contract in `docs/FE_WALLET_IN_PAYMENT.md` was documented as "backend complete" but
had **zero implementation** — the `coin` field was silently ignored, so the charged amount was
never reduced and the wallet never debited. Now implemented for course, package, ebook,
live-course, test-series (book cart excluded per contract). The wallet balance IS
`ws_customer.reward_points` (the referral wallet).

**Schema / DDL:**
- `ADD COLUMN wallet_coin INT NULL` on `ws_ebook_order`, `ws_live_course_subscription`,
  `ws_test_series_order`. Course + package **reuse the existing `ws_package_course_order.ws_coin`
  column** (already surfaced in admin subscription reports).

**Create-order (query-level):** each of the 5 controllers now accepts optional `coin` (integer
rupees), validates it via `referral.resolveWalletUsage` — `coin ≤ reward_points` AND
`coin ≤ floor(planPrice × 0.5)`, integer ≥ 0 — reduces the Razorpay charge by `coin`, and
persists `coin` on the pending order (`ws_coin` / `wallet_coin`). Post-discount total < ₹1 is
rejected. 400 messages match the FE contract exactly.

**Verify (query-level, new side effect):** each `verify*Mysql` fulfillment path now debits the
wallet — `referral.debitWalletForOrder`: decrement `reward_points` by `min(coin, balance)` +
write a **source-tagged** `ws_refferal_transaction` DEBIT row (status `successful`, no
`bank_account`). Idempotent on `(source, order_id, customer, type='debit')`; deducts
what's-available so a dropped balance never blocks provisioning. Non-throwing (`debitWallet`
wrapper) — a debit failure is logged, never blocks a paid order. Reuses the razorpay webhook
fulfillment paths, so debit also fires on webhook-first.

**Admin rollup fix:** `referral.repository.referrerRows` withdrawal aggregates (`totalWithdrawn`,
`pendingWithdrawals`, `failedWithdrawals`, `successfulWithdrawals`, `lastWithdrawalAt`) now add
`AND t.source IS NULL` so wallet-spend debits (which set `source`) are NOT miscounted as bank
withdrawals. Withdrawals leave `source` NULL.

**Files:** `prisma/schema.prisma` (3 models), the 5 create-order payment controllers, the 5
`*-order` services/repos + course/ebook row types & transformers, `src/modules/referral/referral.service.ts`
+ `.repository.ts`, `src/client/referral/debit-wallet.ts` (new).

**Deploy:** apply the DDL, then `yarn prisma:generate`. No backfill.

---

## 2026-07-13 — Referral reward on purchase (creditReferrer wired into verify)

> **New columns + new query-level side effect on the purchase verify flow.** Applies DDL
> `docs/migration/schema-changes/2026-07-13_referral_reward_on_purchase.sql`. `yarn typecheck` green.

`creditReferrer` existed but had **zero callers** — a buyer using someone's referral code got
the discount, but the referrer was never credited. Now, on successful payment verification,
the referrer is credited `ReferralProgram.refferalReward %` of the paid amount into
`ws_customer.reward_points` with a `ws_refferal_transaction` CREDIT row (surfaced by
`GET /client/referral/rewards`). Covers all 5 referral-eligible types: course, package,
ebook, live-course, test-series.

**Schema / DDL:**
- `ADD COLUMN referrer_id INT NULL` on `ws_package_course_order`, `ws_ebook_order`,
  `ws_live_course_subscription`, `ws_test_series_order`. Stamped at create-order when a
  referral code resolves (referral codes are NOT promocodes, so `promocode_id` can't carry
  the referrer); read back at verify.
- `ADD COLUMN source VARCHAR(20) NULL` on `ws_refferal_transaction`. Order ids are per-table
  (a course order #100 and an ebook order #100 are different purchases), so the credit
  **idempotency key changed from `(order_id, referrer)` → `(source, order_id, referrer)`**.
  Added index `idx_refferal_txn_credit_dedupe (customer_id, source, order_id, type)`.
  NOTE: `order_id` has **no physical FK** to `ws_package_course_order` in this DB (the Prisma
  relation is logical only) — nothing dropped; `order_id` is now polymorphic per `source`.

**Query-level:**
- `resolvePromoForPlanSql` now returns `referrerId` on the referral branch (`resolveReferralForPlanSql`).
- `referral.repository.findCreditByOrder` / `creditReferralReward` now take + filter/write `source`.
- `creditReferrer` is now **idempotent + non-throwing** — a credit failure logs and is swallowed
  so a verified purchase is never blocked. Called in every `verify*Mysql` fulfillment path
  (which the razorpay webhook fulfillment reuses, so credits also fire on webhook-first).

**Files:** `prisma/schema.prisma` (5 models), the 5 `*-order` services/repos + row types/transformers,
the 5 create-order payment controllers, `src/client/referral/credit-referrer.ts`,
`src/modules/referral/referral.service.ts` + `.repository.ts`, `src/modules/promo-code/promo-code.service.ts`.

**Deploy:** apply the DDL, then `yarn prisma:generate`. No backfill (existing orders predate
referrer capture — they were never credited and stay uncredited; only new purchases credit).

---

## 2026-07-13 — New: GET admin/test-series/subscriptions/:subscriptionId (detail endpoint)

> **Additive read-only endpoint on the already-SQL `admin-testseries` module. No schema/index change.** `yarn typecheck` green.

Test-series was the only subscription product type without a GET-by-id detail endpoint
(it had list/update/delete only), so the admin **Subscription Details** page had no
source for razorpay ids / order type / remarks. Added it to match the course/package/
ebook/live-course detail contract.

- **Route:** `GET /api/v1/admin/test-series/subscriptions/:subscriptionId` (admin Bearer;
  registered AFTER `/subscriptions/export/*` so those aren't matched as an id). RBAC map:
  `view("test-series.subscriptions")`.
- **Files:** `src/admin/testSeries/testSeries.controller.ts` (`getSubscription`),
  `src/admin/testSeries/testSeries.routes.ts`, `src/middlewares/rbacRouteMap.ts`,
  `src/modules/admin-testseries/admin-testseries.service.ts` (`getSubscriptionById`).
- **Queries:** `testSeriesSubscription.findUnique` + parallel populate of `customer`
  (fullName→firstName/lastName via `splitFullName`), `testSeries` (title/thumbnail),
  `testSeriesPrice` (name/durationDays/price) and the linked `testSeriesOrder`
  (paymentMethod/orderType/razorpayOrderId/razorpayPaymentId/transactionId). Returns
  `"not_found"` → controller 404.
- **DTO:** `{ _id, customerId{_id,firstName,lastName,phoneNumber,emailAddress},
  testSeriesId{_id,name,image}, planId{_id,name,duration,price}, orderType,
  paymentMethod, razorpayOrderId, razorpayPaymentId, bankTransactionId, price,
  paidAmount, startAt, endAt, remarks, paymentType, isActive, status, createdAt,
  updatedAt }`. `isActive` = `normalizeStatus(...) === "active"`.

---

## 2026-07-13 — Client catalog COURSE videos endpoint returns a flat, searchable video list (no category grouping)

> **Query-shape change scoped to `type === "course"` only. `package` / `live-course` unchanged.** `yarn typecheck` green.

`GET /api/v1/client/catalog/course/:id/videos` previously returned a category-grouped
payload (`list: [{ category, list: [videos] }]` + `availableCategories` + `totals`,
where `pagination.total` counted categories). It now returns a **flat** `list` of video
items with server-side title search across the **entire root subtree** and pagination
that counts videos.

- **Files:** `src/modules/client-catalog/client-catalog.service.ts` (`catalogVideos` —
  new early return for `type === "course"`), `src/client/catalog/catalog.controller.ts`
  (course response message → "Videos fetched.").
- **New query shape (course):** one `prisma.video.findMany({ where: { videoCategoryId:
  { in: descendantsOf([root]) }, status: true, title?: { contains: search } }, orderBy:
  { order: "asc" } })` over the full subtree, instead of the per-root-category grouped
  queries. Progress + media-token gating identical to the old grouped course path.
- **Response contract change (course only):** `data.list` is now the flat video array
  (each item: `_id,title,topic,platform,priceType,order,recordings,qualities,mediaToken,
  progress` — same item shape as before). `availableCategories`, `totals`, and the
  `category` wrapper are removed. `pagination` retained; `pagination.total` now = video
  count. `package`/`live-course` responses are byte-identical to before.
- No schema/index change.

---

## 2026-07-13 — Export jobs: live incremental progress (0→1) instead of stuck-at-10%

> **No DB/query-shape change — progress is persisted more often during streaming.** `yarn typecheck` green.

Per docs/backend-requests/export-progress-granular-updates.md: the async export worker only
wrote `progress` once (10 at start, 100 at ready), so the FE bar stuck at ~10% then jumped.
Now `runExportJob` persists progress as rows stream: `streamReportToWritable` gained an
`onProgress(rowsWritten)` callback (fires per ~5 000-row batch); the worker throttles a DB
write to every 5 000 rows. When the source can cheaply COUNT the filtered set it reports true
`rowsWritten/total` (and seeds `rowCount = total` up front for "of N"); otherwise it ramps
monotonically toward 0.95. Always monotonic, capped 0.95 mid-run, 1 on `ready`. `ReportSource`
gained optional `countTotal()`. Exact total wired for `subscription` (reuses
`resolveCourseSubWhere` + `repo.countSubs`); the other 4 types (liveCourseSub/testSeriesSub/
ebookSubscription/bookOrder) use the ramp until their counts are wired. Poll response shape
unchanged.

## 2026-07-13 — media/resolve: HEAD-check ebook PDF exists before signing (clean 404)

> **No DB/query change — resolve-time storage guard.** `yarn typecheck` green.

`resolveMediaToken` (`client-media.service.ts`) now HEADs the object for `ebook`/`ebookDemo`
before presigning. If the stored `book_url`/`book_demo_url` key doesn't exist in the bucket
(stale/placeholder key), it returns `404 "This e-book is not available."` instead of a signed
URL that 404s (NoSuchKey) on Spaces — which the RN PDF viewer would otherwise save as
XML-as-PDF and fail to open. Transient/permission errors on the HEAD do NOT block delivery
(fail-open). Gated by `MEDIA_VERIFY_EBOOK_OBJECT` (default true; set false to skip the extra
HEAD). Pairs with `scripts/check-ebook-pdf-objects.ts` (bulk audit of broken keys).

## 2026-07-13 — purchase-history/ebooks: purchasedAt falls back to subscription start_at

> **No DB/query-shape change — one extra read + fallback.** `yarn typecheck` green.

For legacy ebook orders whose `created_at` is NULL, `/purchase-history/ebooks` now derives
`purchasedAt` from the linked subscription's `start_at` (≈ purchase moment) before falling
to `updated_at`. `start_at` lives on `ws_ebook_subscription`, so a new repo read
`ebookSubStartByOrderIds(orderIds)` hops order→subscription; earliest start_at per order is
used. Order: `o.createdAt ?? sub.start_at ?? o.updatedAt ?? null`. New rows (now stamped)
keep using `created_at`.

## 2026-07-13 — Auto-stamp timestamps on EBookOrder + EBookSubscription (created_at/updated_at were NULL)

> **Prisma-client-level change — NO DDL.** `prisma:generate` + `yarn typecheck` green.

New rows in `ws_ebook_order` and `ws_ebook_subscription` landed with NULL `created_at` /
`updated_at`: the introspected schema declared them as bare `DateTime? @map(...)` (no
`@default(now())`, no `@updatedAt`), the Prisma create paths never set them, and the MySQL
columns have no `DEFAULT CURRENT_TIMESTAMP`. Added `@default(now())` to `createdAt` and
`@updatedAt` to `updatedAt` on both models (`EBookOrder`, `EBookSubscription`) so Prisma
now stamps them on insert/update. Client-side only — no migration, existing NULL rows
unchanged (read paths already fall back). ⚠ Do NOT `yarn db:pull` — it strips these attrs.

**Belt-and-suspenders (explicit writes):** the schema `@default(now())` only takes effect
once the app runs the REGENERATED client (a live server on the old build still inserts NULL
— the likely reason new rows were still NULL). So the ebook create/update paths now ALSO set
the stamps explicitly: `ebook-order.repository.ts` (createPendingOrder, verifyEbookTx order
update + fresh-sub create + extend update) and `admin-ebook.repository.ts` (backend grant +
extend). This guarantees non-NULL stamps regardless of deploy timing.

**Backfill for historical NULL rows (optional, proxy-based):**
`docs/migration/schema-changes/2026-07-13_ebook_timestamp_backfill.sql` fills existing NULL
`created_at`/`updated_at` from the best available proxy — subscription `start_at` (≈ purchase
moment), then propagates to the order via `order_id`. Approximate (the true insert time was
never recorded); rows with NULL `start_at` or orders with no linked subscription stay NULL.
Idempotent; run STEP 1 before STEP 2. Not yet applied — run on staging first via
`npx prisma db execute --file …`.

**Systemic finding (not yet actioned):** the same bare pattern affects ~65/68 `created_at`
columns and ~62 `updated_at` columns across the introspected schema — this is why several
list/receipt readers use `createdAt ?? startAt/orderDate/paidAt` fallbacks. A schema-wide
standardization was intentionally deferred (mass `@updatedAt` would override any code that
sets `updated_at` manually); recommend a deliberate per-module rollout rather than a blanket
edit.

## 2026-07-13 — Fix client purchase-history books/ebooks: missing title + null purchasedAt

> **No DB/query change — read-shape backfill + date fallbacks.** `yarn typecheck` green.

`GET /client/purchase-history/books` and `/ebooks` under-populated two fields:

- **Books title** used only `first.name` from the `order_items` JSON; legacy rows omit
  `name` there, so the title showed the fallback / `undefined`. The list already fetches
  the first book of each order (for thumbnails) — now it reuses that `Book` row to
  backfill the name (`first.name || book.name || "Book"`), mirroring the receipt path
  (`getBookReceiptMysql`). `thumbById` map replaced by a single `bookById` map.
- **Books purchasedAt** `o.createdAt ?? null` → `o.createdAt ?? o.orderDate ?? o.paidAt ?? null`
  (legacy `ws_book_order` rows have null `created_at` / no DB default).
- **Ebooks purchasedAt** `o.createdAt ?? null` → `o.createdAt ?? o.updatedAt ?? null`
  (`ws_ebook_order` has no order_date/paid_at columns).

Ebook titles already resolve via the plan→price→ebook hop; unchanged (a still-missing
name there means `plan_id`/plan.ebook_id is absent on that order — a data gap, not code).

## 2026-07-13 — Add isPaid + isPurchased to client catalog videos (contract parity with materials)

> **No DB/query change — additive response fields.** `yarn typecheck` green.

`GET /client/catalog/:type/:id/videos` returned purchase status only implicitly
(`priceType` + `mediaToken` presence), while the sibling `/materials` endpoint already
exposed explicit `isPaid` + `isPurchased` booleans (`shapeMaterialDoc`). Added the same
two flags to each video object in `client-catalog.service.ts` (both the flat course list
and the grouped inline list), reusing the already-computed `isPaid = priceType==="paid"`
and `isPurchased = canPlay = !isPaid || courseEntitled` (identical semantics to materials:
free ⇒ accessible). Also added `videoCategoryId` (string, matching materials'
`materialCategoryId`) to each video object. Additive — existing `priceType`/`mediaToken`
unchanged. NOTE: other
video-list endpoints (client-trending / client-free / client-lecture-progress /
live-course / lecture) still lack these flags — a follow-up sweep is needed for full
cross-API consistency.

## 2026-07-13 — Fix: admin customer-details subscriptions showed paidAmount=null (wrong column)

> **No DB schema/query change — transformer column fix.** `yarn typecheck` green.

`admin-customer-details.transformer.ts` (`toCourseDto` + `toPackageDto`) sourced
`paidAmount` from `s.paidAmount` (`ws_package_course_subscription.paid_amount`), which is
a promoter-only column added later (`2026-06-19_subscription_promoter_cols.sql`) and stays
NULL for non-promoter subscriptions → paidAmount always came back null. Repointed to
`s.amount` (the canonical paid-value column written by the create path and summed by the
Subscription Report). `PkgSub` type now declares `amount` instead of `paidAmount`; the
repository `findMany` already returns the full row, so no query change. Response value
changes null → actual paid amount for these rows.

## 2026-07-13 — Fix: admin subscription create computed endAt from plan duration as MONTHS instead of DAYS

> **No DB schema/query change — date-arithmetic bugfix on the SQL create path.**

`createCourseSubscription` (admin-subscription) computes `endAt` from the plan's
`duration`. Per the platform contract, `duration` on plan/price rows is in **DAYS**.
The fallback branch (used when the request carries no explicit `durationDays`) passed
`plan.duration` to `computeEndAt` as `durationMonths` **without** `asDays: true`, so a
90-day plan produced `startAt + 90 months` (~7.5 years) — e.g. `2026-07-13` → `2034-01-13`.

- **File:** `src/modules/admin-subscription/admin-subscription.service.ts` (~L510)
- **Fix:** added `asDays: true` so `plan.duration` is treated as days (90 days →
  `startAt + 90 days`), matching the explicit-`durationDays` branch above it and the
  "duration is DAYS" rule (`utils/planDuration.ts`).
- **No** schema, index, or query-shape change. Sibling `admin-live-course` callsites use a
  genuine `durationMonths` input and were left unchanged.
- Pre-existing rows created with the wrong `endAt` (e.g. subscription `_id: 19`) are not
  auto-corrected by this change and need a manual data patch if desired.

---

## 2026-07-13 — Async report exports stream to Spaces (bounded memory for lakhs-of-rows)

> **No DB schema/query change — same keyset iterators, same column specs, byte-identical
> output.** Delivery-mechanism change only. `yarn typecheck` green.

**What changed:** the async export worker (`report-export` BullMQ queue) no longer
materializes the whole file in RAM. Output is now streamed row-by-row into a multipart
upload to Spaces, so peak memory is one 5 000-row DB batch + one ~5 MB upload part —
flat regardless of row count. Eliminates OOM risk on large (5–10 lakh row) CSV/XLSX
exports at worker concurrency 3.

- **New:** `src/utils/reportStream.ts` — `streamReportToWritable(source, format, out)`
  writes `{headers, rowBatches}` into a Writable as CSV (fast-csv) / XLSX (ExcelJS
  `stream.xlsx.WorkbookWriter`); returns row count; respects backpressure.
- **New:** `src/utils/exportStorage.ts → createExportUpload()` — multipart streaming
  upload via `@aws-sdk/lib-storage` (Body = PassThrough, 5 MB parts). `uploadExportObject`
  (single PutObject) retained for the small referral report.
- **New per-report source factories** (reuse existing keyset iterators + column specs,
  output unchanged): `admin-subscription.courseSubExportSource`,
  `admin-ebook.ebookSubExportSource`, `admin-testseries.tsSubExportSource`,
  `admin-book.orderExportSource`, `admin-live-course.liveSubExportSource`.
- **Registry** (`export-job.registry.ts`): streamed reports now expose `resolveSource`;
  referral (CSV-only, not keyset-paged) keeps the `build` buffer path.
- **Worker** (`export-job.service.ts`): prefers stream→multipart-upload; falls back to
  buffer path; persists `rowCount`.
- **Sync `/export/{csv,excel}` endpoints unchanged** (still buffer — fine for small sets).

**Also fixed "Export scheduler not initialised":** the BullMQ queue was only created
inside `initExportScheduler()`, which runs **only in worker processes** (behind
`WORKER_ENABLED`). But `enqueueExportJob()` is called from the HTTP handler
(`POST /admin/exports`), so a split deployment (API `WORKER_ENABLED=false`) — or the
boot-race window before workers start — threw "Export scheduler not initialised."
`export.scheduler.ts` now has `ensureProducer()`: `enqueueExportJob` lazily creates a
producer-only `Queue` in any process, and `initExportScheduler` reuses it before
attaching the worker. Works for both single-process and split HTTP/worker topologies.

Docs: `docs/exports/BACKEND_LARGE_EXPORTS.md`, `docs/exports/ADMIN_EXPORTS_GUIDE.md`.

---

## 2026-07-11 — Fix PUT /admin/courses/:id "courseEducatorId nan" (GET↔PUT ref asymmetry)

> **Controller coercion fix only — no schema/query change.** `yarn typecheck` green.

- **Bug:** editing a course failed with
  `{"success":false,"message":"[... courseEducatorId: Expected number, received nan ...]"}`.
- **Root cause:** the admin **detail GET** (`admin-course.service.ts` `toCourseDto`, line 48)
  returns `courseEducatorId` (and `courseSubjectCategoryId` / `videoCategoryId`) *populated*
  as `{_id,name}` / `{_id,title}` objects to match the Mongo `.populate()` shape. The admin
  edit form round-trips those objects back on **PUT `/admin/courses/:id`**, but
  `updateCourse` runs `createCourseSqlSchema.partial().required({courseEducatorId:true})`
  where the field is `z.coerce.number()`. `Number({_id,name})` → `NaN` → the error.
- **Fix:** `coerceCourseBodySql` (`src/admin/course/course.controller.ts`) now flattens these
  three scalar id refs before Zod — object → `_id`/`id` string, and empty-string/null → drop
  the key (so a genuinely-missing required educator reports a clean "Required" instead of the
  `nan` type error). Mirrors the existing category-ref array flattening in the same helper.
  Because the route is `multipart/form-data` (`uploadS3.single("image")`), nested values
  arrive as **strings**, so the helper also parses a JSON-stringified ref (`'{"_id":..}'`) and
  discards junk (`"[object Object]"`, `"null"`, `"undefined"`). A temporary `console.log` in
  `updateCourse` captures the raw/coerced value while the frontend report is being confirmed
  (to be removed once verified).
- **Contract:** unchanged. GET response shape identical; PUT now additionally accepts the
  populated object form it already emits (backward compatible with plain numeric-string ids).

## 2026-07-11 — Media tokens + entitlement gating + resolve endpoint (replaces AES obfuscation)

> **Response-contract change (client media) + new endpoint — no DB schema change.**
> `yarn typecheck` green. Supersedes the AES `{token, ciphertext}` scheme on all client media.

- **New infra:**
  - `utils/mediaToken.ts` — sign/verify short-lived (5 min) JWT media tokens. Dedicated
    secret (never the auth key ring), `audience: ws-media`, customer-bound (`cust`).
  - `modules/client-media/client-media.service.ts` + `client/media/*` — `POST
    /client/media/resolve`: verifies token, binds caller, **re-checks entitlement live**,
    then resolves the actual media — presigned short-lived URLs for S3/Spaces objects
    (audio notes, ebook PDFs), StreamOS/VideoCrypt/YouTube native-TTL URLs for video/live.
    Mounted behind the master `authenticate`.
- **Gating rule enforced everywhere:** unpurchased paid media → all media fields `null`
  (no id/url/token); free → a `free` token; purchased → a scoped token. Raw AWS keys /
  YouTube / Vimeo ids / `.m3u8`/`.mp4` / PDF / audio URLs are never emitted.
- **Live entitlement re-check wired for every scope (no blind `trusted`):** category-video
  tokens encode the resolved `course`/`package`/`liveCourse` scope; the live-session resolve
  branch re-runs `resolveLivePreviewStateSql` (full-OR-preview; rejects preview-ended); audio
  notes re-check ownership; ebook re-checks the active sub. `trusted` survives only as a
  fallback when a category scope can't be resolved (short-TTL guarded).
- **Endpoints converted (AES envelope → `mediaToken`):** `/v1/lecture`; category videos
  list + detail; live-course lecture + `/recordings`; `/live-sessions/:id`; catalog course
  inline videos (now entitlement-gated via `hasActiveCourseSub`); free videos; lecture
  audio notes; ebook catalog list/detail (`demoMediaToken` always + `bookMediaToken` only
  when purchased) + `/ebooks/subscriptions` + `/ebooks/downloads` + `POST
  /ebooks/:id/download`.
- **DTO/type changes:** `EbookDto` — dropped `demoUrl`/`bookUrl`/`token`, added
  `demoMediaToken`/`bookMediaToken`. Category/catalog/free video rows now carry `mediaToken`
  instead of encrypted ids/envelope. Live-session drops `token`/`hlsUrl`/`hlsUrls`/
  `recordings`, carries `mediaToken`.
- **Perf win:** list endpoints no longer resolve/encrypt every row up front — resolution is
  deferred to the on-tap resolve call.
- **Env (all OPTIONAL, defaults):** `MEDIA_TOKEN_SECRET`, `MEDIA_TOKEN_TTL_SECONDS`,
  `MEDIA_SIGNED_URL_TTL_SECONDS` (added to `.env.example`).
- FE contract: `docs/client/CLIENT_MEDIA_ACCESS.md` (supersedes `VIDEO_URL_DECRYPTION.md`).

---

## 2026-07-11 — Encrypt ebook PDF URLs (`bookUrl` / `demoUrl`) across client APIs

> **Response-contract change only — no DB change.** `yarn typecheck` green.

- **What:** ebook PDF + sample URLs shipped raw on the client. Now encrypted in place with
  the shared `{token, ciphertext}` scheme at every emission point:
  - `catalog-ebook.transformer.ts` `toEbookDto` — `bookUrl` + `demoUrl` encrypted, per-ebook
    `token` added (feeds ebook catalog list/detail + `GET /ebooks/subscriptions` via
    `commerce-ebook-sub`). `EbookDto` gains a `token` field.
  - `client-ebook-download.service.ts` `listDownloads` (`GET /ebooks/downloads`) — `bookUrl`
    encrypted, per-row `token`.
  - `ebook-downloads.controller.ts` `recordEbookDownload` (`POST /ebooks/:id/download`) —
    `data.bookUrl` encrypted, `data.token` added.
- Admin `toEbookDto` (admin-ebook / admin-customer) is a **different** function — untouched.
- Physical **books** (book-order/catalog-book) have no downloadable file URL — only cover
  images + streamed PDF receipts — so nothing there to encrypt.
- FE decryption documented in `docs/client/VIDEO_URL_DECRYPTION.md`.
- **No backfill / no DDL / no flag** — pure response encryption on already-SQL handlers.

---

## 2026-07-11 — Expose `liveCourseId` on lecture-notes (open correct player for live recordings)

> **Query + DTO change — no schema DDL.** `yarn typecheck` green.

- **Why:** live-course folder recordings resolved to `courseId: null` / `liveCourseIds: []`
  on the notes + audio-notes endpoints, so the FE opened VideoScreen with only a categoryId
  → playback hit the catalog category-detail API → 403 → paywall. Live recordings need the
  owning `liveCourseId` to open `getLiveLectureAPI`.
- **Fix (`client-lecture-progress.service.ts`, `buildLectureRefSql`):** now resolves the
  owning live course from `VideoCategory.liveCourseId` (recorded) / `liveSessionCourse`
  (live) and returns a new **`liveCourseId`** field on the `lecture` object (both branches).
  Added `liveCourseId` to the `LectureRef` interface.
- **Notes enrichment (`client-lecture-note.service.ts` + both list controllers):** new
  `enrichNotesWithLiveCourse()` fills each note's `liveCourseIds` with `[liveCourseId]` when
  the stored row had none — so `GET /lecture-notes` and `GET /lecture-audio-notes` carry the
  live-course scope on every note.
- Additive; no field removed. `courseId` stays null for live-course videos (complements
  the new `liveCourseId`).

---

## 2026-07-11 — Encrypt audio-note S3 URLs (`/lecture-audio-notes`)

> **Response-contract change only — no DB change.** `yarn typecheck` green.

- **What:** `audioNoteDto` (`client-lecture-note.service.ts`) shipped raw `audioUrl`
  (DigitalOcean Spaces URL) and `audioKey` (S3 object key). Both now encrypted in place with
  the shared `{token, ciphertext}` scheme; a **per-note `token`** added. Covers list +
  create + update responses (all route through this one DTO).
- **`/lecture-notes` (text) left unchanged** — `noteDto` has no file URL (`content` is
  user text). The `lecture`/`resumeNext` objects both endpoints embed carry only
  titles/ids/thumbnail images — no encrypted fields.
- FE decryption added to `docs/client/VIDEO_URL_DECRYPTION.md`.
- **No backfill / no DDL / no flag** — pure response encryption on an already-SQL handler.

---

## 2026-07-11 — Cleartext stream-type markers on live-course recordings (fix HLS→MP4 regression)

> **Additive response-contract change — no DB change.** `yarn typecheck` green.

- **Why:** after encrypting the recordings URLs, the FE (which selected HLS vs MP4 by
  string-matching `.m3u8`/`.mp4` in the URL) silently fell through to MP4 — the ciphertext
  no longer contains those markers.
- **Fix (`admin-live-course.service.ts`, `shapeLecture`):** added cleartext fields the FE
  keys off instead of sniffing the (now opaque) URL:
  - `type: "hls" | "mp4"` on every `recordings[]` / `hlsRecordings[]` / `mp4Recordings[]` entry.
  - lecture-level `preferredStream: "hls" | "mp4"` — `"hls"` whenever an HLS ladder exists
    (restores pre-encryption default), else `"mp4"`.
- FE guidance ("never decide stream type from the URL; decrypt last, only the chosen URL")
  added to `docs/client/VIDEO_URL_DECRYPTION.md`.

---

## 2026-07-11 — Reconcile customer goal selection against catalog (fix FE bottom-sheet crash)

> **Query-shape + write-normalization change. No schema DDL.** `yarn typecheck` green.

- **Bug:** when a labelless top-level goal that a customer had already selected was later
  converted (in admin/CMS) into a **label under another goal** — or when a selected label
  was renamed/removed so its id changed — the stored selection on `ws_customer.goal`
  (`[{ goalId, labelIds }]`) no longer matched the catalog. `GET /client/goals/my-goals`
  then returned a goal whose shape disagreed with `GET /client/goals`, crashing the FE
  Select-Goals bottom sheet. Worst case: a **labelled** catalog goal was emitted with
  `labels: []`, which FE reads as a *labelless* selection (conflicting with the accordion
  shape the catalog renders).
- **Root cause:** there is no admin operation that "moves a goal into another goal's label"
  with a mapping trail — the only link between an old goal and a new label is its name — so
  true remapping is impossible. Selections were previously shaped/persisted without
  validating the *shape* against the current catalog.
- **Fix (read + write, both paths use one helper):**
  - New `reconcileGoalSelection(selections, validGoals)` in `src/utils/goalSelection.ts`:
    forces every entry to a valid FE shape — labelless goal → `labelIds: []`, labelled goal
    → non-empty subset of the catalog's labels — and **drops** (a) unknown/inactive goals and
    (b) labelled goals whose chosen labels all vanished (never emits an empty-labels shape for
    an accordion goal). Matches the doc's "remap or clear if remapping is impossible".
  - `getMySelectedGoals` (`GET /client/goals/my-goals`): builds `validGoals` from the same
    `active:true` catalog read it shapes from, reconciles, then shapes. Guarantees my-goals
    and `/client/goals` always agree on ids/shape. Transitively fixes
    `GET /client/packages/goal` (FE derives its `goalIds`/`labelIds` from my-goals).
  - `updateMyGoals` (`PUT /client/goals`): catalog lookup now filters `active:true` (was
    unfiltered) and reuses `reconcileGoalSelection`, so a labelled goal sent with empty
    `labelIds` is dropped instead of persisted as a crash-inducing labelless selection.
- **Query change:** `updateMyGoals` goal lookup `where: { id: { in } }` → `where: { id: { in }, active: true }`.
- **Data:** no backfill required — stale selections self-heal on the next `PUT`, and the
  read path already returns a safe shape. Response envelopes unchanged.
- Files: `src/utils/goalSelection.ts`, `src/client/goal/goal.client.service.ts`.

---

## 2026-07-11 — Guard-scope the permission catalog (fix orphaned promoter permissions)

> **Response-contract change (additive) + seeder behavior change. No schema DDL.** `yarn typecheck` green.

- **Bug:** the "Success Partner" (promoter-guard) role's 6 permissions
  (`promoter`, `promoter.dashboard`, `promoter.customers`, `promoter.customers.read`,
  `promoter.promocodes`, `promoter.promocodes.read`) rendered as *deprecated/orphaned* in
  the RBAC "Manage Permissions" tree. Root cause: `permissions.catalog.ts` only ever
  enumerated **web-guard** admin modules, while `GET /admin/permissions/catalog` returned
  one global (guard-agnostic) tree. The promoter keys (real, guard=`promoter`, present in
  `old_db/websankul_staging.sql` ids 249–254) were never live catalog entries, so the
  endpoint dumped them into `deprecated[]`.
- **Fix (Case 1 — keys are valid, not renamed/removed):**
  - Added a `guard` field to every `CatalogModule` (defaults `web`), plus a **Promoter
    Portal** module (the 6 keys, guard `promoter`) and an **Educator Portal** module
    (`educator.dashboard`, guard `educator`), all marked live (not deprecated).
  - `GET /admin/permissions/catalog` now accepts **`?guard=web|educator|promoter`**
    (validated via `guardOnlyQuerySchema`; **defaults to `web`** → backward compatible).
    It returns only that guard's `modules` and a **guard-scoped** `deprecated[]`, and adds
    a `guard` field to the response envelope. Consistent with `/admin/roles*` which are
    already `?guard=`-scoped. **Frontend:** call the catalog with the role's guard
    (`?guard=promoter` for the Success Partner role).
  - `getStoredPermissionNames(guard?)` now filters `ws_permissions` by `guard_name`.
- **Seeder change (`permissions.seeder.ts`):** previously seeded every catalog key under
  ALL guards; now seeds each module **only under its own guard**. Deprecated logging is
  per-guard (`guard:name`). No hard-deletes — legacy rows are left in place.
- **Query-shape change:** `SELECT name FROM ws_permissions WHERE guard_name = ?`
  (was unfiltered) in the catalog read path.
- **Optional deploy cleanup:** `docs/migration/schema-changes/2026-07-11_permission_guard_cross_seed_cleanup.sql`
  removes pre-existing web-key rows cross-seeded under the promoter/educator guards (only
  rows unreferenced by any role/model assignment). Cosmetic — reduces `deprecated[]` noise;
  the bug fix does not depend on it.

## 2026-07-11 — Encrypt live-course recordings list (`GET /live-courses/:id/recordings`)

> **Response-contract change only — no DB schema/query change.** `yarn typecheck` green.

- **What:** `getRecordingsForClient` (`admin-live-course.service.ts`, `shapeLecture`) — the
  handler behind `GET /api/v1/client/live-courses/:id/recordings` — shipped, per lecture,
  raw `youtube_id/aws_id/vimeo_id` **and** resolved playback URLs (`hlsUrl`, `mp4Url`,
  `recordings[].path`, `hlsRecordings[].path`, `mp4Recordings[].path`). All now encrypted
  in place with the shared `{token, ciphertext}` scheme; a **per-lecture `token`** is added
  to each `folders[].lectures[]` entry.
- `qualities` left as-is (labels + bitrate only, no URL). `/session-recordings` confirmed
  metadata-only (streamId/subject/scheduling — no playback URL), left unchanged.
- FE decryption (per-lecture-token recordings shape) added to `docs/client/VIDEO_URL_DECRYPTION.md`.
- **No backfill / no DDL / no flag** — pure response encryption on an already-SQL handler.

---

## 2026-07-11 — Encrypt live-session playback URLs (close the last plaintext leak)

> **Response-contract change only — no DB schema/query change.** `yarn typecheck` green.

- **What:** `GET /client/live-sessions/:id` (`src/client/live/live.controller.ts`,
  `getLiveSessionForClient`) was shipping raw StreamOS URLs — `hlsUrl`, the `hlsUrls`
  quality→url map, and every `recordings[].path` — in cleartext. These are now encrypted
  in place with the shared AES-128-CBC `{token, ciphertext}` scheme (same as `/v1/lecture`),
  and a sibling `token` field was added to the response.
- **New util:** `newEncryptor()` in `src/utils/videoEncryption.ts` — mints the 16-digit
  token, derives key+IV once, returns `enc()` (empty/null → `""`). Centralizes the scheme
  the lecture/category/live-course flows each hand-rolled.
- **Contract note:** response keys are unchanged; only the string *values* became ciphertext,
  plus the added `token`. Frontend decryption is documented in
  `docs/client/VIDEO_URL_DECRYPTION.md`.
- **Follow-up audit (full client sweep) found 2 more leaks, now fixed:**
  - `client-catalog.service.ts` inlined course video list — rows shipped raw
    `youtube_id/aws_id/vimeo_id`. Now encrypted in place with a **per-row** `token`.
  - `client-free.service.ts` `shapeVideo` (free video listing) — same raw ids. Same fix.
  - Both: keys/null-ness unchanged; non-null id values become ciphertext; `token` added per row.
- **Confirmed clean:** category list/detail explicitly picks safe fields;
  lecture/category/live-course detail already encrypt. No remaining raw
  `aws_id`/`youtube_id`/`vimeo_id`/URL emission in any client response.
- **No backfill / no DDL / no flag** — pure response encryption on already-SQL handlers.
- FE decryption (incl. the per-row-token list shape) documented in
  `docs/client/VIDEO_URL_DECRYPTION.md`.

---

## 2026-07-10 — Drop Smart/Planner package flags + tighten packageTypeId + package-type validation

> **Schema DROP (staged) + query/DTO change + validation fix.** `yarn typecheck` green,
> `prisma:generate` run. DDL: `schema-changes/2026-07-10_drop_package_course_flags.sql`
> (apply at deploy — Prisma ignores the still-present columns until then).

- **#1 Removed `is_smart_course` / `is_planner_course`** from `ws_package`:
  - Dropped both columns from the Prisma `Package` model (DDL staged).
  - Removed `isSmartCourse` / `isPlannerCourse` from the admin create/update schema,
    the multipart coercion, and the admin package DTO.
  - Removed them from **client read paths** too: `catalog-package.detail.sql.ts` (DTO +
    `listPackagesPaginatedSql` filter + input type), `package-category.service.ts` DTO,
    `exam-countdown.client.ts` DTO, and the `client/package` list query filters
    (`isSmartCourse` / `isPlannerCourse` query params no longer read).
- **#2 `packageTypeId` write path tightened** (`admin-package.service.ts`):
  - New `resolvePackageTypeId(raw)` — empty/null now persists **NULL** (truly clears)
    instead of silently coercing to sentinel `1`.
  - **DB drift fixed:** `package_type_id` was `NOT NULL` in the DB despite the Prisma
    model saying `Int?`. DDL `schema-changes/2026-07-10_package_type_id_nullable.sql`
    (`MODIFY … INT NULL`) makes the null-clear actually work — **apply at deploy**.
  - A non-numeric or **non-existent** `packageTypeId` now throws **400 / 404** (was a
    silent fallback to `1`, or an FK 500). Applies to POST + PUT `/admin/packages`.
  - DTO still returns `packageTypeId` (populated `{_id,name}` when joined, else id string).
- **#3 `ws_package_type` stays name-only** — removed `order` / `active` from
  `createPackageTypeSchema` (they were accepted-but-ignored). No DDL.
- **#4 Package-type create/update now return 422** — routed `POST/PUT /admin/packages/types`
  through `validate({ body })` (was `schema.parse()` in-controller → global 500).

## 2026-07-10 — Video pre-requisites feed: server-side `search` + `limit`

> **Query-shape change only. No schema/DDL.** `yarn typecheck` green. Follow-up to the
> category-pickers work below.

`GET admin/videos/pre-requisites` (`admin-video.getPreRequisites`) now accepts `search`
(title contains-match) + `limit` (page size, clamped 1–500; omitted → all rows,
back-compat), so the Videos-list category picker can go fully server-side like Exam/
Material. `repo.listActiveCategories(opts)` applies `where.title.contains` + `take`.
`has_children` still scans ALL categories (`childParentIds()`), so it stays correct even
when the returned rows are a search/limit slice. `parentId`/`ancestors` already present.

## 2026-07-10 — Category pickers: `ancestors[{id,name}]` + hasChildren/parentId on rows

> **Query-shape change only. No schema/DDL.** All three category types already have a
> single-parent `parent` self-FK. `yarn typecheck` green. Request:
> `docs/backend-requests/category-pickers-hierarchy.md`.

Category picker list endpoints now return **`ancestors: [{id, name}]`** (ordered
root→immediate-parent) on each row, so the FE can render greyed parent rows for a
server-side-search match without holding the whole tree. New shared resolver
`src/utils/categoryAncestors.ts` (`resolveAncestors`) walks the `parent` chain by
**tree level** — one batched `categoriesByIds` query per level (2–4 total), cycle-guarded.

- **Exam** (`admin/quizzes/categories`, `modules/catalog-exam`): added `ancestors` (was
  absent) + repo `categoriesByIds`. `search`/`limit`/`hasChildren` already existed.
- **Material** (`admin/materials/categories`, `modules/admin-material`): `ancestors` was a
  hardcoded `[]`, now computed + repo `categoriesByIds`.
- **Video — Package** (`admin/video-categories`, `admin-master.fullVcList`): added
  `parentId` + `hasChildren` + `ancestors` to the row (was only `child_categories`);
  controller now accepts `limit` (aliases `per_page`). Repo `vcCategoriesByIds`.
- **Video — Course** (`admin/master/video-categories`, `admin-master.vcList`): added
  `ancestors` (already had `parent` + `hasChildren`); resolved against the in-memory full set.
- **Video — pre-requisites** (`admin/videos/pre-requisites`, `admin-video.getPreRequisites`):
  added `parentId` + `ancestors` to each category (already had `has_children`); repo
  `categoriesByIds` + `parent` added to `listActiveCategories` select. Ancestor loader is
  status-agnostic so a disabled parent still resolves (renders greyed).

All additive — no existing field renamed/removed; the tree endpoints
(`/categories/tree`, `?tree=true`) are unchanged and remain uncapped.

## 2026-07-10 — Referral codes now cover live course too (all 5 entities)

> **Scope extension, no schema/DDL.** All referral files typecheck clean (a pre-existing
> unrelated error in admin-video.service.ts `resolveAncestors` is someone else's WIP).

- `REFERRAL_COVERED_TYPES` extended to include `liveCourse` → now package/course/ebook/
  testSeries/liveCourse (all five commerce entities).
- `POST /client/payment/apply-promo/live-course` (`applyLiveCoursePromo`) gained the
  referral fallback (mirrors test series): global % across all live-course plans, material
  split preserved, `codeType:"referral"`, `_id:""`, self-referral rejected.
- `POST /client/payment/create-order/live-course` now passes `buyerId` into
  `resolvePromoForPlanSql`.
- Live-course promo success payload gained `codeType:"promocode"`.

## 2026-07-10 — Referral codes now cover test series too

> **Scope extension, no schema/DDL.** `yarn typecheck` green.

- `REFERRAL_COVERED_TYPES` in `promo-code.service.ts` extended to include `testSeries`
  (was package/course/ebook). liveCourse still excluded.
- `POST /client/payment/apply-promo/test-series` (`applyTestSeriesPromo`) gained the
  referral fallback: when `findActiveByCode` misses, it tries `resolveReferralCode` and
  applies the global % to every test-series plan (same response shape, `codeType:"referral"`,
  `_id:""`). Self-referral rejected.
- `POST /client/payment/create-order/test-series` now passes `buyerId` (customerId) into
  `resolvePromoForPlanSql` so the self-referral guard applies at checkout.
- Test-series promo success payload also gained `codeType:"promocode"` (additive).
- Ebook already supported referral (via `/promocodes/apply` + ebook create-order) — no change.

## 2026-07-10 — Referral codes redeemable through the promocode apply/checkout flow

> **New query paths, no schema/DDL.** `yarn typecheck` green. One apply endpoint now
> serves both promocodes and referral codes; referral data stays solely on
> `ws_customer.referral_code` (no duplication into `ws_promocode`).

- **New** `resolveReferralCode(code)` in `promo-code.service.ts`: looks up
  `ws_customer` by `referral_code` (`{ referralCode, isAccountDeleted:false, status:true }`)
  + the active `ws_refferal_program` named `student` (`refferalDiscount` %). Returns
  `{ referrerId, discountType:"percentage", discountValue }` or `null`.
- **`resolvePromoForPlanSql`** (checkout, used by course/ebook/package payment
  controllers) gained an optional 5th arg `buyerId` and a **referral fallback**: when
  `findActiveByCode` misses, it tries the code as a referral (`resolveReferralForPlanSql`).
  Referral scope = **package/course/ebook only** (`referralCovers`); liveCourse/testSeries
  rejected. Self-referral (buyer === code owner) rejected. Returns `promo._id:""` so the
  controllers persist **no `promocodeId`** while still charging the discounted amount.
- **Client `POST /client/promocodes/apply`** mirrors the same fallback for the preview.
  Response gains a `codeType: "promocode" | "referral"` field (additive).
- Payment controllers now pass `Number(customerId)` as `buyerId` to
  `resolvePromoForPlanSql` (course/ebook/package).

## 2026-07-10 — CSV export generation moved to `fast-csv`

> **Library swap only. No query/schema/contract change.** `yarn typecheck` green.

Replaced the hand-rolled CSV escaper (`/[",\n\r]/` quote + `.join(",")`) in all 6 report
CSV builders with the `fast-csv` package (added dep `fast-csv@5`), behind a new shared
helper `src/utils/csvExport.ts` → `buildCsvFromRowBatches(headers, asyncRowBatches)`. It
streams the keyset batches through `fast-csv`'s `format()` transform into the CSV string,
so nothing new is materialized. Verified **byte-identical** output to the old escaper
(RFC-4180 quoting, doubled `"`, `\n` rows, no trailing newline, UTF-8 unicode). Builders
updated: admin-subscription, admin-testseries, admin-live-course, admin-ebook, admin-book
(`buildOrdersCsv`), referral (`adminWithdrawalsCsv`). **XLSX is unchanged** — still
`ExcelJS` (fast-csv is CSV-only).

## 2026-07-10 — Unify export dates (IST) + createdAt filter across remaining reports

> **Query-shape + export-format change. No schema/DDL.** `yarn typecheck` green.
> Closes the two consistency gaps so ALL six reports match on date TZ + filter contract.

- **IST export timestamps** `YYYY-MM-DD HH:mm:ss` now on **Live Course, Ebook, Book Orders**
  exporters too (their `fmtExportDate` was raw UTC ISO) — matching Subscription + Test
  Series. Referral CSV's Date column likewise (+ a new `fmtExportDate` there).
- **Date filter → `createdAt` at IST day edges** for **Ebook, Book Orders, Referral**
  (all three already bound `createdAt`; the bounds were parsed at UTC/local, dropping the
  last 5.5h). Fixed the day-edge parsers to `+05:30`:
  - Ebook: `parseDateBound` (admin-ebook.service) + controller accepts `createdFrom`/`createdTo`.
  - Book: `parseDayBound` (admin-book.service) + controller `parseOrderReportQuery` accepts them.
  - Referral: new `parseIstDayBound` replacing `parseReportWindow`'s UTC/local edges; the
    admin wrapper's `WithdrawalsReportQuery`/`WithdrawalsCsvQuery` accept `createdFrom`/`createdTo`.
  All keep their legacy `dateFrom`/`dateTo` (+ `fromDate`/`toDate`) aliases.

Net: every report now (a) exports IST `YYYY-MM-DD HH:mm:ss` dates and (b) accepts
`createdFrom`/`createdTo` → `createdAt` at IST day boundaries.

## 2026-07-10 — All report exports uncapped + streamed (lakhs-safe) + book/referral async

> **Query-shape + async-registry change. No schema/DDL.** `yarn typecheck` green.
> Goal: every report export handles lakhs of rows without truncation or the gateway 504.

Applied the Subscription/Test-Series export approach (keyset id-DESC batches of 5,000 +
streaming `ExcelJS.stream.xlsx.WorkbookWriter` → memory-bounded, no cap) to the remaining
report exporters, and registered the two that weren't async-capable:

- **Live Course** (`modules/admin-live-course`): dropped `LIVE_SUB_EXPORT_MAX` (100k);
  builders resolve the bad-id/empty discriminator first, then stream via
  new repo `listSubsPageKeyset`. Removed the old `exportSubscriptionRows`.
- **Ebook** (`modules/admin-ebook`): dropped `EBOOK_SUB_EXPORT_MAX`; new repo
  `listSubscriptionsPageKeyset` (same includes), streamed builders.
- **Book Orders** (`modules/admin-book`): dropped `ORDERS_EXPORT_MAX`; new repo
  `listOrdersPageKeyset`; extracted `flattenOrdersToExportRows` (one row per book line)
  so batches flatten + stream. Exported `parseOrderReportQuery` from the controller.
- **Async registry** (`modules/export-job/export-job.registry`): added `bookOrder`
  (reuses `buildOrdersCsv`/`Xlsx` + `parseOrderReportQuery`) and `referral` (reuses the
  already-uncapped `buildWithdrawalsCsv`; CSV-only — throws on Excel, matching the FE).
  Both were previously absent (fell back to the sync endpoint → 504 on large data).

Keyset ordering is `id DESC` for all exports (≈ createdAt DESC default; a custom `sortBy`
no longer reorders the export file, only the on-screen list). Referral withdrawals are
low-volume + already uncapped, so left buffered (not keyset-streamed); async registration
removes its 504 risk. Date formats on live-course/ebook/book exports are unchanged
(only Subscription + Test Series use the IST `YYYY-MM-DD HH:mm:ss` format so far).

## 2026-07-10 — Live Course report: createdFrom/createdTo → createdAt at IST edges

> **Query-shape change only. No schema/DDL.** `admin/live-courses/.../subscriptions`
> list + `/export/csv` + `/export/excel` + async `type:"liveCourseSub"`
> (`modules/admin-live-course`, `admin/live-course/live-course.subscription.controller`).
> `yarn typecheck` green. Request: `reports-date-filter-created-at.md` (Live Course action item).

The merged FE report now sends `createdFrom`/`createdTo` for Live Course too. Controller
`buildSubReportQuery` accepts them (with `dateFrom`/`dateTo` + `fromDate`/`toDate` legacy
aliases) → the service's `fromDate`/`toDate` which already bind `createdAt`. Added
`parseDayBoundIst` so a bare `YYYY-MM-DD` is bounded at IST day edges (`+05:30`) instead
of naive UTC (was dropping the last 5.5h). `startFrom`/`endTo` (→ startAt/endAt export
bounds) are unchanged.

## 2026-07-10 — Test Series export: drop 4 more null-source columns

> **Export column change only.** `modules/admin-testseries` `TS_SUB_EXPORT_COLUMNS`.
> `/export/csv` + `/export/excel` + async `type:"testSeriesSub"`. `yarn typecheck` green.

Per FE confirmation, also removed the 4 columns with no test-series data source —
`Promoter Name`, `Educator Name`, `WS Coin`, `Activated By` — so the export matches the
trimmed Test Series screen (which hides them). Row DTO still returns those fields (null).
`Package Name` + `Alternate Phone` remain (blank).

## 2026-07-10 — Test Series export: drop non-applicable columns

> **Export column change only. No query/schema change.** `modules/admin-testseries`
> `TS_SUB_EXPORT_COLUMNS`. Applies to `/export/csv` + `/export/excel` + async
> `type:"testSeriesSub"`. `yarn typecheck` green.

Per FE request, removed 6 columns that have no meaning for a digital test series:
`Address`, `City`, `Pincode`, `Material Type`, `Course Amount`, `Material Amount`.
The row DTO still returns those fields (as `null`) for the shared list component; only
the CSV/Excel column spec was trimmed. Still-blank null-source columns (Promoter Name,
Educator Name, WS Coin, Activated By, Package Name, Alternate Phone) were left in place.

## 2026-07-10 — Test Series report: enrich rows to Subscription column set

> **Query-shape change only. No schema/DDL.** Applies to `admin/test-series/subscriptions`
> (list) + `/export/csv` + `/export/excel` **and** the async `type:"testSeriesSub"` job
> (reuses `buildSubscriptionsCsv`/`Xlsx` in `modules/admin-testseries`). `yarn typecheck` green.
> Request: `docs/backend-requests/test-series-report-enrich-columns.md`.

The Test Series report now shares `MergedSubscriptionReport` (FE), so its rows must carry
the same fields as `admin/subscriptions`. Changes to `enrichSubRows` + the export:

- **Row DTO enriched** with the order relation (`ws_test_series_order`): `orderMethod`
  (= `payment_method`, lowercased), `razorpayOrderId`, `razorpayPaymentId`,
  `bankTransactionId` (← the order's `transaction_id`, where the grant path stores it),
  plus `promocode`/`promocodeId` (direct FK on the sub row → `ws_promocode.promocode`)
  and `remarks`. `Activation Type` = the row's `paymentMethod` (online|backend).
- **No SQL source on test series → surfaced as `null` (render blank):** `promoterName`
  (no `promoter_id` on `ws_test_series_subscription`), `activatedBy` (no `created_by`),
  `educatorName` (no educator link on `ws_test_series`), `wsCoin` (no column on the TS
  order). Also N/A by design: `courseAmount`/`materialAmount`/`materialType`/`trackingId`
  and `shipping` (digital product).
- **Export column set replaced** (was 8 columns) with the **same set/order as the
  Subscription export**; the test-series name sits in `Course Name` (mirrors the FE
  `productCell` for testSeries), Package Name + the null-source columns stay blank.
- **IST timestamps** `YYYY-MM-DD HH:mm:ss` (was raw UTC ISO); **100k cap removed**
  (keyset id-DESC batches of 5,000, streaming XLSX writer) — same approach as the
  Subscription export.
- **Date filter bounds `createdAt` at IST day edges** (new local `parseDayBoundIst` +
  `istCreatedWhere`, replacing the shared UTC `dateWhere`). Controller
  `parseSubReportQuery` accepts `createdFrom`/`createdTo` (with `dateFrom`/`dateTo` +
  `fromDate`/`toDate` legacy aliases).

## 2026-07-10 — Subscription report export: IST dates, column fixes, uncapped rows

> **Query-shape change only. No schema/DDL.** Applies to `admin/subscriptions/export/csv`
> + `/export/excel` **and** the async `POST /admin/exports {type:"subscription"}` job
> (both reuse `buildCourseSubscriptionsCsv` / `Xlsx` in `modules/admin-subscription`).
> `yarn typecheck` green.

Fixes from `docs/backend-requests/subscription-report-export-csv-defects.md`:

- **No more 100k cap.** The export previously ran one `SELECT … LIMIT 100000`
  (`EXPORT_MAX`), silently truncating filters that match 300k+ rows. Replaced with
  **keyset pagination** — new repo query `listCourseSubsPageKeyset(where, beforeId, take)`
  = `ORDER BY id DESC WHERE id < :beforeId LIMIT :take` (PK-index, no deep OFFSET),
  walked in 5,000-row batches by the service until exhausted. Every matching row is now
  exported. Export order is now strictly `id DESC` (≈ the old `createdAt DESC` default;
  a custom `sortBy` no longer reorders the *export* — it still orders the on-screen list).
- **XLSX now uses `ExcelJS.stream.xlsx.WorkbookWriter`** (rows flushed per-batch to a
  `PassThrough` → Buffer) so an uncapped export doesn't hold the whole worksheet model
  in memory. CSV builds line-by-line over the same batches.
- **Timestamps now IST (Asia/Kolkata, +5:30, no DST) in `YYYY-MM-DD HH:mm:ss` 24-hour
  form**, e.g. `2026-10-06 00:01:21` (was raw UTC ISO). `fmtExportDate` shifts the
  instant by +5:30 and reads the wall-clock parts off the shifted value.
- **Column set trimmed to match the on-screen report:** dropped `Tracking ID` (removed
  from the report) and the redundant `Payment Type` (duplicated the online/backend
  value). `Activation Type` now populated from the row's `paymentMethod`
  (= `payment_type` online|backend) instead of the no-op `activationType` field —
  matching how the FE maps that column (see `subscription-report-filters.md`).
  `Promoter Name` was already present/populated (repo selects `promoter.full_name`).

### Same-day follow-ups (extend write-flow + created-at filter)

- **Extend now inserts a NEW subscription row, not an in-place `endAt` bump.**
  `createCourseSubscription` with `extend:true` used to `findActiveSubForTarget` then
  `extendSub` (UPDATE the existing `ws_package_course_subscription` row's endAt/amount).
  Per business rule it now always **INSERTs a fresh row** tied to its own new order
  (so each extension is its own report line, based on its order id). The new row
  **continues from the prior plan's end date** (floored at now if that date already
  lapsed; an explicit `startAt` still wins) for the plan duration, so coverage is
  seamless with no overlap/gap; the prior subscription row is left untouched. The
  existing-active lookup now supplies both the `extended:true` response flag AND the
  continuation start date (never mutates the old row). Removed the now-dead
  `repo.extendSub` + `extendEndAt` import.
  ⚠ Behavior change: a customer can now hold **multiple** active rows for one target
  (access = union of their windows); revenue is unchanged (each row carries its own
  order's amount instead of a cumulative sum on one row).
- **Report date-range filter bounds `createdAt` at IST day edges.** `parseDayBound` now
  parses a bare `YYYY-MM-DD` as `…T00:00:00.000+05:30` / `…T23:59:59.999+05:30` (was
  server-local, dropping the last 5.5h). Controller `reportQueryFrom` accepts
  `createdFrom`/`createdTo` (the unified cross-report name from
  `reports-date-filter-created-at.md`) as the createdAt window, with `dateFrom`/`dateTo`
  + `fromDate`/`toDate` as legacy aliases. `startFrom`/`endFrom` (→ startAt/endAt) still
  work for back-compat, but the merged report's two date boxes now map to createdAt.

## 2026-07-09 — Async report-export jobs (NEW table `ws_export_job`)

> **Schema change** (net-new feature table, not a Mongo→SQL migration). DDL:
> `docs/migration/schema-changes/2026-07-09_export_job.sql` — **apply before deploy**,
> then `prisma:generate` (schema.prisma `ExportJob` model added by hand, not db:pull).
> `yarn typecheck` green.

New generic async-export subsystem so large report exports never hit the request/LB
timeout: `POST /admin/exports` creates a job + enqueues a BullMQ worker (queue
`report-export`, modeled on the pdf-upload pipeline) that runs the SAME filtered query
as the sync export, uploads the CSV/XLSX to Spaces **private**, and marks the row ready;
`GET /admin/exports/:jobId` polls the authoritative DB row and signs a short-lived GET
URL when ready; a delayed queue job GC's the object after the retention window.

- **Table `ws_export_job`** (model `ExportJob`): `job_ref` (unique public id), `type`,
  `format`, `params` JSON (filters), `status` (pending|processing|ready|failed),
  `progress`, `row_count`, `file_key`, `file_name`, `error`, `requested_by` (owner),
  `expires_at`, timestamps. Indexes: unique(job_ref), (status), (requested_by, created_at).
- **Reuses each report's existing exporter** — the registry (`modules/export-job/
  export-job.registry.ts`) maps `type` → that report's exact param parser (now exported:
  `reportQueryFrom`, `buildSubReportQuery`, testSeries/ebook `parseSubReportQuery`) +
  `build*Csv`/`build*Xlsx`. v1 types: `subscription`, `liveCourseSub`, `testSeriesSub`,
  `ebookSubscription`. `bookOrder`/`referral` → 422 unsupported until their sync
  exporters exist. Output is byte-identical to the sync `/export` endpoints.
- **Storage**: new `utils/exportStorage.ts` — private PUT + `getSignedDownloadUrl` (GET
  presign, the codebase's first) + delete. Objects keyed `admin/exports/<type>/<ref>.<ext>`.
- **Worker boot** in `index.ts startWorkers()` (`initExportScheduler`), drain in
  `gracefulShutdown`. Rehydrate resets crashed `processing` jobs on boot (guarded so a
  not-yet-migrated table can't crash boot). Optional env `EXPORT_RETENTION_MINUTES` (45),
  `EXPORT_SIGNED_URL_TTL_SECONDS` (900). Route `/exports` UNMAPPED in RBAC like `/uploads`
  (router staff gate + per-job ownership check in the controller).
- **v1 note**: reuses the existing capped row-builders (`EXPORT_MAX`=100k) in the worker —
  generation is off-request (kills timeouts) but not yet keyset-streamed; the result
  buffer is held transiently in the worker. True keyset streaming = follow-up per report.

## 2026-07-09 — Subscription Report: new filters (promoter/promocode/orderMethod/hasMaterial=false)

> Post-migration read-only change on already-SQL `admin-subscription`; no schema/DDL,
> no wave change. `yarn typecheck` green. Applies to `GET /admin/subscriptions` list +
> `/export/csv` + `/export/excel` (all three share `reportQueryFrom` → `resolveCourseSubWhere`,
> so filters stay identical; export just drops page/limit).

- **promoterId** — direct column `ws_package_course_subscription.promoter_id` (indexed
  `idx_pcs_promoter`). `buildSubWhere`: `where.promoterId`.
- **promocodeId** — the code is a purchase-time JSON snapshot on the ORDER
  (`ws_package_course_order.promocode`, no live FK), so resolve id→code
  (`promocodeCodeById`) → matching order ids (`orderIdsByPromocode`, `$queryRaw` matching
  both JSON shapes: bare `"CODE"` and `{ promocode: "CODE" }`) → `where.orderId IN (…)`.
  Unknown code / no matching orders ⇒ empty result. Caveat: a promocode with a very large
  order set produces a large `IN` list.
- **orderMethod** (NEW, payment GATEWAY) — `ws_package_course_order.payment_method` enum
  via relation filter `where.packageCourseOrder = { is: { paymentMethod } }`. FE sends
  lowercase (`razorpay|bank|cash|free|paykun|paytm`); mapped to the canonical enum
  (`Paykun`/`Paytm` capitalized) via `GATEWAY_BY_INPUT`. **Decision (a):** `orderMethod` is
  the gateway; the pre-existing `paymentMethod` filter stays `online|backend`
  (= subscription `payment_type`, the activation channel) — the two are distinct columns.
- **hasMaterial** — now tri-state: absent = no filter, `true` = with-material (unchanged),
  `false` = without-material (`pcMaterialId` null/0 AND `materialAmount` null/0). Controller
  `reportQueryFrom` no longer coerces absent→false.
- **courseId / packageId** — confirmed already filtering the list (`buildSubWhere`); unchanged.
- **`orderMethod` row field (output)** — each report row (list DTO + CSV/Excel "Order Method"
  column) now carries the gateway, same source as the filter (`order.payment_method`),
  lowercased to the filter's value set, null when there's no order. `ordersByIds` select
  gained `paymentMethod`. `paymentMethod` (online/backend) is unchanged and now feeds the
  FE's Activation Type column.

## 2026-07-09 — Live Course Detail: paginate videos-in-folder + schedule-entries

> Post-migration read-only change on already-SQL `admin-live-course`; no schema/DDL,
> no wave change. `yarn typecheck` green.

Two flat Live-Course-Detail sub-lists moved to `page`/`limit` (standard envelope
`{ success, data, pagination }`, default 10, max 500, via `parseListQuery`/`buildPagination`).
Rows unchanged; reorder endpoints untouched (order values are global, so adjacent-swap
reorder works per-page).

- `GET /admin/live-courses/:liveCourseId/folders/:folderId/videos` — `lcListVideosInFolder`
  now takes `{ skip, take }` and returns `{ data, total }` via DB `skip`/`take` + `count`
  on `ws_video` (where `videoCategoryId=folder`, `orderBy order asc, created_at asc`).
  Was `success(res,{videos,total})` → now the standard sibling envelope.
- `GET /admin/live-courses/:id/schedule-folders/:folderId/entries` — schedule entries live
  in the live-course JSON column (not a table), so pagination is an in-memory slice of the
  order-sorted array; `total` is the full count. `listScheduleEntries` gains optional
  `{ skip, take }` and returns `{ data, total }`.
- Folder tree (`GET .../folders`) left **unpaginated** by decision — small admin-created
  recording trees; keeps returning the full `{ folders, relations }` for client tree-build.

## 2026-07-09 — Course ↔ Book relation + `GET /admin/courses/:id/books`

New Course-Detail "Material (Book)" tab — the course analogue of the Package → Books
tab (which is a deliberate empty stub because no SQL book-link existed). This adds a
**real** relation and read endpoint.

- **New table / model:** `ws_course_book` (`model CourseBook`) — `id`, `course_id`,
  `book_id`, `order` (per-course display order), `created_at`, `updated_at`. Mirrors
  `ws_exam_category_course`. Back-relations added: `Course.courseBook`, `Book.courseBook`.
  DDL: `docs/migration/schema-changes/2026-07-09_course_book_pivot.sql` (`CREATE TABLE`,
  applied to local `websankul_staging_1`; **must be applied on deploy**). Prisma client
  regenerated.
- **New endpoint:** `GET /admin/courses/:id/books?page=&limit=&search=` — auth via the
  course router's `authenticate`. `page` default 1; `limit` default 10, max 500 (via
  `parseListQuery`); optional `search` = case-insensitive `contains` on the linked
  `ws_book.name`; ordered by the pivot `order` asc. Envelope
  `{ success, data, pagination: { total, page, limit, totalPages } }` (via
  `buildPagination`).
- **Query:** `prisma.courseBook.findMany({ where: { courseId, Book?: { name: contains } },
  include: { Book: true }, orderBy: { order: "asc" }, skip, take })` + a matching
  `courseBook.count`. New repo methods `booksForPaged` / `countBooksFor` in
  `modules/admin-course/admin-course.repository.ts`; service `listCourseBooks` +
  `courseBookRowDto` in `admin-course.service.ts`; thin wrapper in
  `src/admin/course/course.service.ts`; handler `getCourseBooks` +
  route `GET /:id/books` in `src/admin/course/`.
- **Row DTO** (matches the admin book-row renderer): `{ _id, name, author, image,
  thumbnail, listPrice (list_price), discountedPrice (discounted_price), language,
  isMagazine (is_magazine), isCombo (is_combo), isTrending (is_trending),
  status (active), orderBy (pivot order) }`.

Verified end-to-end against the local DB (insert pivot row → correct DTO + search
hit/miss → cleanup).

**Write flow (link/reorder/unlink) — added same day** so the tab can be populated:
- `POST /admin/courses/:id/books` `{ bookIds: number[] }` — attach; idempotent
  (skips ids already linked), validates each id exists in `ws_book` (returns them
  under `invalid`), appends after the current max per-course `order`. Returns
  `{ added, skipped, invalid }`.
- `PUT /admin/courses/:id/books/reorder` `{ order: [{ bookId, order }] }` — sets the
  per-course display order (one `updateMany` per item scoped to `courseId+bookId`,
  in a `$transaction`).
- `DELETE /admin/courses/:id/books/:bookId` — unlink (404 `link_not_found` if the
  book isn't linked).
Repo: `existingBookIds`, `linkedBookIds`, `maxBookOrder`, `createBookLinks`,
`reorderBookLinks`, `unlinkBook`. Service: `linkCourseBooks` / `reorderCourseBooks`
/ `unlinkCourseBook`. Zod: `linkCourseBooksSchema`, `reorderCourseBooksSchema`.
Verified end-to-end (link dedupe + invalid-id reject → reorder → unlink → cleanup).

## 2026-07-09 — Package Detail: exam/material/specific-subject paginated tabs

> Post-migration read-only addition on already-SQL `admin-package`; no schema/DDL,
> no wave change. `yarn typecheck` green.

Three Package-Detail tabs previously read arrays embedded on `GET admin/packages/:id`
(`examCategories[]`/`materialCategories[]`/`specificSubjects[]`). Exposed each as its own
paginated list, mirroring the `/subscribers` contract (default 20, cap 100), standard
envelope `{ success, data, pagination:{ total, page, limit, totalPages } }`.

- New endpoints (`admin/package`): `GET /admin/packages/:id/exam-categories`,
  `/material-categories`, `/specific-subjects` (backs the "Video Category" tab →
  `specificSubjects`). RBAC-mapped to `packages` view.
- Repo (`admin-package.repository.ts`): `specificSubjectsForPaged`/`materialCategoriesForPaged`
  /`examCategoriesForPaged` (+ `count*`) over the pivots `ws_package_specific_subject`
  (`subject_id`→VideoCategory, order `order_by`, has pivot `status`), `ws_material_category_package`
  (`mcategory_id`→MaterialCategory, order `order`), `ws_exam_category_package`
  (`exam_category_id`→ExamCategory, order `order`) — DB `skip`/`take`/`count`, `orderBy`
  the pivot order asc (same include/order as the existing embedded-array loaders).
- Rows reuse the existing embedded `subjectRef`/`materialRef`/`examRef` shape
  `{ category:{_id,title,image}|idStr, order, status }` **plus** a flattened `categoryName`.
  status: real pivot status for specific-subjects; `true` for material/exam (unchanged from
  the embedded arrays). Embedded arrays on `GET admin/packages/:id` left intact.

## 2026-07-09 — Video-categories admin list: raise `per_page` cap 200 → 500

Validation-only. The three `admin/video-categories` list query schemas
(`listQuerySchema`, `categoryCoursesQuerySchema`, `categoryVideosQuerySchema` in
`src/admin/videoCategory/videoCategory.validation.ts`) capped `per_page` at 200,
which 422'd `?per_page=500`. Raised the max to 500 to match the project-wide admin
list `limit` cap. Default (20) and `min(1)` unchanged; no query/DB behavior change.

## 2026-07-09 — Course Detail: exam-category + material-category paginated tabs

> Post-migration read-only addition on already-SQL `admin-course`; no schema/DDL,
> no wave change. `yarn typecheck` green.

Two Course-Detail tabs previously read ID-ref arrays embedded on the course-detail
response (`examCategories[]`/`materialCategories[]`, resolved client-side). Exposed
each as its own paginated list with **resolved** rows, standard envelope
`{ success, data, pagination }` (`page` default 1, `limit` default 10 max 500, optional
`search` on category name), via `parseListQuery`/`buildPagination`.

- New endpoints (`admin/course`): `GET /admin/courses/:id/exam-categories`,
  `GET /admin/courses/:id/material-categories`. RBAC-mapped to `courses` view.
- Repo (`admin-course.repository.ts`): `examCategoriesForPaged`/`materialCategoriesForPaged`
  (+ `countExamCategoriesFor`/`countMaterialCategoriesFor`) over the pivot tables
  `ws_exam_category_course` / `ws_material_category_course` — DB `skip`/`take`/`count`,
  `orderBy` the course-specific pivot `order` asc, optional search on the joined
  category `name` (`{ ExamCategory|MaterialCategory: { name: { contains } } }`), include
  now also selects the category `status`.
- Service returns flattened resolved rows `{ _id, name, image, status, order }` (`_id` =
  category id; `order` = pivot order) so the admin UI drops its client-side name lookup.
  Existing `examCategoriesFor`/`materialCategoriesFor` (course-detail aggregate) untouched.

## 2026-07-09 — Admin detail-tab list endpoints: server-side pagination sweep

> Post-migration read-only change on already-SQL modules (promo-code, admin-course,
> admin-ebook, admin-package, admin-live-course, admin-testseries, admin-material);
> no schema/DDL, no wave change. `yarn typecheck` green.

Second-pass to finish server-side pagination across the admin detail pages. Each of
these list endpoints previously returned the **full result set**; they now accept
`page` (default 1) + `limit` (default 10, max 500) and return the standard sibling
envelope `{ success, data, pagination:{ total, page, limit, totalPages } }` via the
shared `parseListQuery`/`buildPagination` helpers (`src/utils/listQuery.ts`). Row
shapes are unchanged — only the wrapper + DB-level `skip`/`take`/`count` are new.

- **Plans** (all `packageCourseEbookPrice` / `liveCoursePlan` reads gain `skip`/`take`
  + a matching `count`, same `where`/`orderBy` as before):
  `GET /admin/courses/:id/plans`, `/admin/ebooks/:id/plans`, `/admin/packages/:id/plans`,
  `/admin/live-courses/:id/plans` (the last previously returned `{plans,total}` inside
  `success()` → now the standard envelope).
- **Test series** (`admin-testseries`): `GET /admin/test-series/:id/content-categories`,
  `/prices` — DB `skip`/`take`/`count`. `/papers` — adds a `search` filter; paper display
  names are hydrated (not a column), so search filters post-hydration and totals reflect
  the filtered set.
- **Material** (`admin-material`): `GET /admin/materials/categories/:id/courses` — DB
  `skip`/`take`/`count` + `search` on the joined course name.
- **Promocodes by scope** (`promo-code`): new shared `listPromocodesForScope(type, id, q)`
  narrows to `appliesToType IN [type,"mixed"]` (+ optional code search) in SQL, resolves
  the exact `appliesToIds` JSON match in-memory, then slices the page (`total` = matched
  set). Backs `GET /admin/packages/:id/promoted-codes` (was array→paginated) and the two
  NEW endpoints `GET /admin/courses/:id/promocodes` + `GET /admin/ebooks/:id/promocodes`
  (`ebook` was already a valid promocode scope). Old `listPromocodesForPackage` retained.

## 2026-07-09 — Video-category relation DAG: cleanup on delete + orphan-safe child count

Deleting a video category previously left its `ws_video_category_relation` edges behind
(the D2 cleanup was deferred). Those dangling edges — child rows pointing at categories
that no longer exist — inflated `havingChildDirectory` / `count` in the client catalog
(e.g. package 3, category 121 "Environment" reported `count: 13` for 13 non-existent
sub-folders, ids 695–707).

- **Delete now cleans edges** (`modules/admin-master`): both delete paths
  (`vcDelete` via `admin/master/videoCategory`, and `fullVcDelete` via
  `admin/videoCategory`) call the new `repo.vcDeleteRelations(id)` →
  `deleteMany({ OR: [{ parent: id }, { child: id }] })` before removing the row. The
  admin/master delete response now reports the real `deletedRelations` count (was
  hard-coded `0`).
- **Read-side hardening** (`modules/client-catalog` `catalogVideos`): the child-directory
  count now filters `childVideoCategory: { is: { status: true } }`, so edges whose child
  category is missing or inactive no longer count. This fixes existing orphaned data
  without a destructive DELETE (category 121 childCount 13 → 0). Count semantics for a
  directory node change from "raw child edges" to "active existing child categories".
- **Pre-existing orphaned edges** (child row already gone) are now harmless to the read
  path, but remain in the table. Optional one-time cleanup:
  `DELETE r FROM ws_video_category_relation r LEFT JOIN ws_video_category c ON c.id = r.child WHERE c.id IS NULL;`

## 2026-07-09 — Add Subscription: `Subscription Type = Active | Extend` on all 4 grants

Follow-up to the standardized-payment work below. The form's Subscription Type control
sends a boolean **`extend`** on all four create/grant endpoints. `extend !== true`
(Active) = current fresh-create behaviour. `extend: true` (Extend) = append the plan's
duration onto the customer's existing **active** subscription for that product (latest
row with `status=true` and `endAt >= now`) instead of inserting a new row; **falls back
to a fresh create when none exists**. A payment **order row is still written on an
extend** (an extend is a paid txn) and the subscription's `order_id` is repointed to it,
so the latest payment shows in reports.

- **Course/Package** (`modules/admin-subscription`): the pre-existing implicit
  upsert-extend (which triggered on *absent* `startAt`) is now gated on the explicit
  `extend` flag — Active always creates a fresh row even when an active sub exists.
  `extendSub` gained `orderId`; the extend branch now mints an order via the shared
  `createPaymentOrder` and links it.
- **Test Series** (`modules/admin-testseries`): `grantSubscription` now, inside its
  txn, looks up the active sub when `extend` and either UPDATEs its `endAt`/`order_id`/
  `price`/`plan_id` or creates fresh. New `GrantWrite.extend`.
- **Live Course** (`modules/admin-live-course`): the implicit extend (gated on absent
  start/end dates) is now gated on `extend`. The extend UPDATE now also persists the
  payment fields (`paid_amount`, `payment_method`, `razorpay_*`, `bank_transaction_id`,
  `paid_at`), not just `end_at`/`plan_id`.
- **EBook** (`modules/admin-ebook`): new repo `findActiveSubscription` +
  `extendBackendSubscription` (txn: fresh COMPLETE `ws_ebook_order` + push out the
  existing sub's `end_at`/`order_id`/`price`). `createSubscription` branches on
  `d.extend`.

No schema change (all reuse existing columns). Zod: `extend` added to
`createSubscriptionSchema`, `grantSubscriptionSchema` (test series, via `boolish`),
`grantSqlSchema` (live course), `createEbookSubscriptionSqlSchema`.

## 2026-07-09 — Admin Customer/Educator Detail: per-tab paginated list endpoints

> Post-migration read-only addition on already-SQL modules (admin-customer,
> educator-auth); no schema/DDL, no wave change.

The admin **Customer Detail** and **Educator Detail** pages moved each tab/table off the
single fetch-all `…/details` aggregate onto its own **server-side paginated** endpoint
(`page`/`limit`, standard `{ success, data, pagination:{ total, page, limit, totalPages } }`
envelope). The `…/details` aggregate is unchanged and still serves profile + summary.
All new queries are **read-only** over already-migrated tables — **no schema/DDL change**.

- **Customer** (`modules/admin-customer/admin-customer-details.repository.ts` +
  `…-details.service.ts`, `admin/customer/customer.controller.ts` + routes):
  - New paginated repo pairs (`count*`/`page*`) with `skip`/`take` + `orderBy` newest-first:
    - `CourseSubs` — `ws_package_course_subscription` where `courseId IS NOT NULL`
      (`{ courseId: { not: null } }`) + optional `status` filter.
    - `PackageSubs` — same table where `courseId IS NULL AND packageId IS NOT NULL`
      + optional `status` (mirrors the aggregate's course-vs-package split).
    - `LiveCourseSubs` / `TestSeriesSubs` — `ws_live_course_subscription` /
      `ws_test_series_subscription` by `customerId` + optional `status`.
    - `EbookSubs` — `ws_ebook_subscription` by `customerId` (no status filter).
    - `BookOrders` — `ws_book_order` by `userId` (one row per order).
    - `Addresses` — `ws_customer_address` by `userId`.
  - Per-page hydration reuses the existing `…ByIds` lookups (only the page's referenced
    entities are fetched); DTOs reuse the existing `admin-customer-details.transformer`,
    so row shapes are **identical** to the aggregate's `purchases`/`addresses`.
  - Endpoints: `GET /admin/customers/:id/{course-subscriptions, package-subscriptions,
    live-course-subscriptions, test-series-subscriptions, ebook-subscriptions,
    book-orders, addresses}`. `course-/ebook-subscriptions` + `addresses` **replace prior
    empty-stub handlers** with real paginated data; `addresses` now returns the
    pagination envelope (was a bare `{ data:[] }`).
- **Educator** (`modules/educator-auth/educator-details.repository.ts` +
  `…-details.service.ts`, `admin/master/educator.controller.ts` + `master.routes.ts`):
  - New `count*`/`page*` pairs by `educator_id`: courses (`ws_course`), live courses
    (`ws_live_course`), packages (`ws_package`), live sessions (`ws_live_session`), and
    **root** video categories (`ws_video_category` where `liveCourseId IS NULL` — folders
    stay on the aggregate). Subscriber counts reuse the existing `*SubCounts` `groupBy`,
    now scoped to the current page's ids. DTOs reuse `educator-details.transformer`.
  - Endpoints: `GET /admin/master/educators/:id/{courses, live-courses, video-categories,
    live-sessions, packages}`.

## 2026-07-09 — Add Subscription: standardized payment section across product types

The admin **Add Subscription** form now sends one payment section (`paymentMethod ∈
cash|bank|razorpay|free`, editable `amount`, and per-method reference ids) for all 5
product types. Each grant/create endpoint now **accepts + persists** the method + ref
ids. Persistence follows each table's existing grain — payment data lives on the
sibling **order** table where one exists (report reads from there), inline on the
subscription only for Live Course (no order table).

- **Course/Package** `POST /admin/subscriptions` → `createCourseSubscription`
  (`modules/admin-subscription`): now writes a **`ws_package_course_order`** row per
  grant carrying `payment_method` + `razorpay_order_id` + `razorpay_payment_id` +
  `bank_transaction_id` + `discount_price`/`price` (= amount, `status=complete`,
  `order_type=purchase`), and links it via the new subscription `order_id`. New repo
  method `createPaymentOrder`; `createSub` gained `orderId`. Zod
  `createSubscriptionSchema` + controller thread `bankTransactionId`,
  `razorpayOrderId`, `razorpayPaymentId`. **No schema change** (columns pre-existed).
  Note: the upsert-**extend** branch is unchanged (extends don't mint a new order).
- **Test Series** `POST /admin/test-series/:id/grant` → `tsSql.grantSubscription`
  (`modules/admin-testseries`): now writes a **`ws_test_series_order`** row
  (`payment_method`, `order_price` = price, `razorpay_order_id`, `razorpay_payment_id`,
  `transaction_id` = bankTransactionId, `status=complete`) inside a `$transaction`
  and links `order_id` on the subscription. `GrantWrite` + controller + Zod
  (`grantSubscriptionSchema`) gained `paymentMethod` + the 3 ref ids. **No schema
  change** (amount stays under `price`).
- **Live Course** `POST /admin/live-courses/:id/grant` → `grantSubscription`
  (`modules/admin-live-course`): extended from free-grant to a full **paid** grant.
  `amount` → `paid_amount` (was hardcoded 0); `razorpay_order_id`/`razorpay_payment_id`
  pre-existed inline. **Schema change** — `ws_live_course_subscription` +
  `payment_method`, `bank_transaction_id`, `remarks` (DDL
  `docs/migration/schema-changes/2026-07-09_live_course_subscription_payment_fields.sql`;
  Prisma model updated + `prisma:generate`). Inline `grantSqlSchema` (`.strict()`)
  widened to accept `amount`, `withMaterial`, `customerShippingId`, `remarks`,
  `paymentMethod`, `bankTransactionId`, `razorpayOrderId`, `razorpayPaymentId`.
- **EBook** `POST /admin/ebooks/subscriptions`: already persisted all payment fields
  to `ws_ebook_order`. Only reconciled the contract — `createEbookSubscriptionSqlSchema`
  now also accepts the form's `amount` (→ `orderPrice`), `bankTransactionId`
  (→ `transactionId`), `durationDays` (→ `durationInDays`) as aliases; existing keys
  still work. **No schema/query change.**

Deploy: apply the one Live Course DDL. All four methods (`cash|bank|razorpay|free`)
are valid `PaymentMethod` enum members; no enum change needed.

## 2026-07-09 — Books & EBooks: persist `isTrending` on create/update (was dropped)

`PUT /admin/books/:id`, `PUT /admin/ebooks/:id` (and the create paths) silently
dropped `isTrending` — the column `ws_book.is_trending` / `ws_ebook.is_trending`
(Prisma `Book.isTrending` / `EBook.isTrending`) exists and the dedicated trending
toggle wrote it, but the CRUD write paths never included it in the Prisma `data`.

- **Book** (`modules/admin-book/admin-book.service.ts`): added `isTrending` to
  `BookWriteInput`; `createBook` writes `isTrending: d.isTrending ?? false`;
  `updateBook` writes it when present (`if (d.isTrending !== undefined) …`). Also
  fixed `toBookDto`, which **hardcoded `isTrending: false`** — it now reads
  `row.isTrending`, so the value round-trips on GET (previously the toggle wrote
  the column but the DTO always reported false).
- **EBook** (`modules/admin-ebook/admin-ebook.service.ts`): `createEbook` /
  `updateEbook` now write `isTrending` (DTO already read `row.isTrending`).
- Validation was already correct: `isTrending: zBool` coerces multipart
  `"true"`/`"false"` → boolean; `updateSchema = createSchema.partial()` yields
  `undefined` when the key is absent (verified), so the guarded write never
  un-trends on unrelated edits. Stale "no SQL column"/"synthesized false" comments
  in the book repo/DTO/controller + ebook wrapper were corrected.

No schema change (columns already existed) — no DDL/backfill.

## 2026-07-09 — Client package-categories: fix `packageCount` (live vs recorded)

`GET /client/package-categories` (`package-category` module, `listClientPackageCategories`).
Bug: `packageCount` counted only active recorded `ws_package` rows on BOTH the `live=true`
and `live=false` paths, so it ignored live courses entirely. No schema change.

- **`live=false`** now returns recorded packages **+** active live courses (the full
  category contents — same two arrays the detail `{ recorded, live }` returns).
- **`live=true`** now returns the **live-course count only** (was wrongly showing the
  recorded-package count). Category filter unchanged: still only categories with ≥1
  active live course qualify.
- New `liveCourseCountFor(catIds)` groupBy on `ws_live_course` (`status:true`,
  `package_category_id in …`); replaces the old `liveCategoryIdSet` distinct-scan
  (count subsumes the "has ≥1 live" test). No new index.

---

## 2026-07-09 — Subscription report: fix Material Type ↔ Material Amount contradiction

`admin-subscription` module. Bug: the report labelled rows "Without Material" while
`materialAmount` was nonzero (e.g. sub ids 18, 7 → materialAmount 7600). No schema change.

- **Root cause — two sources of truth.** The report/detail derived material from
  `pc_material_id` only, but `createCourseSubscription` (SQL admin grant) writes
  `material_amount` and **never** `pc_material_id`. So every SQL-created with-material
  subscription (which also requires a shipping address) read back as "Without Material".
  The *amount* was correct; the *label* was wrong.
- **Fix — one predicate.** New `rowHasMaterial(r) = pcMaterialId>0 || materialAmount>0`,
  now the single source of truth for: the report `materialType` label
  (`hydrateCourseSubRows`), the single-detail `withMaterial` flag
  (`getCourseSubscriptionById`), and the `hasMaterial` **filter** in
  `buildSubWhere` (was `pcMaterialId>0`, now `OR pcMaterialId>0 / materialAmount>0`,
  AND-ed so it doesn't collide with the search OR). Label can no longer contradict the
  amount. Also fixes the "Subscription Material Report" filter silently excluding
  SQL-created with-material rows.
- Semantic chosen: **Material Type = "the subscription has a material component"**
  (derived from the same signal as the amount), not a separate flag.

---

## 2026-07-09 — Live-course subscriptions report: CSV/Excel export

`GET /api/v1/admin/live-courses/subscriptions` (`admin-live-course` module) gains two
export endpoints. No schema change (no DDL/backfill).

- **New endpoints:** `GET admin/live-courses/subscriptions/export/{csv,excel}` — full
  filtered set (no pagination, cap 100000), streamed with dated attachment filenames.
- **Repository `buildSubWhere`:** added `startFrom` (`start_at >=`) / `endTo` (`end_at <=`)
  bounds to `SubReportFilter`; distinct from the `createdAt` `fromDate`/`toDate` range.
- **Service:** extracted shared `resolveSubFilter` (reused by `listSubscriptions` + new
  `exportSubscriptionRows`/`buildSubscriptionsCsv`/`buildSubscriptionsXlsx`); added
  `activationType` param (coalesced with `paymentMethod` → razorpay-order presence). No new
  Prisma joins; list response shape unchanged.
- Columns populated: Subscription ID, Customer Name/Phone/Email, Course Name, Start/End,
  Amount, Activation Type, Order Method, Order Id, Payment Id, Status. Left blank (not
  exposed on a live-course subscription without new joins): Package/Educator/Promocode/
  Promoter names, Course/Material amounts, Ws Coin, Material Type, Bank Txn Id,
  Address/City/Pincode, Remarks, Activated By.

---

## 2026-07-09 — Book Orders report: CSV/Excel export

`GET /api/v1/admin/books/orders/list` (`admin-book` module) gains two export endpoints.
No schema change (no DDL/backfill).

- **New endpoints:** `GET admin/books/orders/export/{csv,excel}` — full filtered set, no
  pagination, **one row per book LINE** (`items[]` flattened, order-level fields repeated);
  19-column contract matching the on-screen table.
- No schema/query change: exports reuse the exact list reads
  (`repo.listOrders`/`findOrderItems`/`findBooksByIds`) via new shared `resolveOrderOpts`
  + `enrichOrders`; export runs `skip:0 take:100000`. `listOrders` refactored onto the
  same helpers (`resolveOrderOpts`/`enrichOrders`/`toOrderListDto`) — list shape unchanged.
- `search` still matches customer name/phone/email + book name; `status`/`bookId`/`state`/
  `dateFrom`/`dateTo`(createdAt) narrow list and export identically. No new index; exceljs
  already a dependency.
- Columns: Order Date, Tracking ID, Book Name, Total Weight, Phone, ALT Phone, Customer
  Name, Address, City, Pincode, State, Price, Shipping Price, Qty, Total Price, Weight,
  Order ID, Payment ID, Status.

---

## 2026-07-09 — Test Series subscriptions report: CSV/Excel export

`GET /api/v1/admin/test-series/subscriptions` (`admin-testseries` module) gains two
export endpoints. No schema change (no DDL/backfill).

- **New endpoints:** `GET admin/test-series/subscriptions/export/{csv,excel}` — full
  filtered set (no pagination), same params as the list minus `page`/`limit`.
- Refactored `admin-testseries.service.ts` `listSubscriptions` into shared
  `buildSubsWhere`/`subSortSpec`/`enrichSubRows`; added `exportSubscriptionRows`
  (Prisma `findMany` where=listWhere, `skip:0 take:100000`) + `buildSubscriptionsCsv`
  + `buildSubscriptionsXlsx` (exceljs). List response shape unchanged.
- **Query shape unchanged** — same `ws_test_series_subscription` where-clause as the
  list; `search` matches customer name/phone/email + series title; `dateFrom`/`dateTo`
  bind to `createdAt`; status computed active|expired|inactive. No new index.
- Columns: Customer, Test Series, Plan, Amount, Payment, Status, Start, End (rows also
  carry `customer._id`/`product._id` for the report detail links).

---

## 2026-07-09 — Admin ebook subscriptions report: CSV/Excel export

`GET /api/v1/admin/ebooks/subscriptions/list` (`admin-ebook` module) gains two export
endpoints. No schema change (no DDL/backfill).

- **New endpoints:** `GET /admin/ebooks/subscriptions/export/csv` (streams `text/csv`)
  and `GET /admin/ebooks/subscriptions/export/excel` (streams `.xlsx`, via `exceljs`).
- Both accept the **exact same query params as the list** (`search`, `status`,
  `paymentMethod`, `ebookId`, `customerId`, `dateFrom`/`dateTo`, `sortBy`/`sortOrder`)
  and cover the **full filtered set** — the frontend drops `page`/`limit`. Filter
  resolution is now shared (`resolveSubOpts` in `admin-ebook.service`), so list + both
  exports honor an identical contract; the report reads (`repo.listSubscriptions`) run
  once with `skip:0, take:100000` for the export path.
- **Query shape unchanged** — same `buildSubWhere` on `ws_ebook_subscription`
  (+ `ws_ebook`/`ws_customer`/`ws_ebook_order` includes) as the list. No new index.
- Columns (one row per subscription): Subscription ID, Phone, Customer Name, Email,
  Ebook Name, Razorpay Order Id, Razorpay Payment Id, Start Date, End Date, Remarks,
  Price, Status (computed active|expired|inactive, matching the list's statusFilter).

---

## 2026-07-09 — Admin subscriptions report: Start/End date filters + CSV/Excel export

`GET /api/v1/admin/subscriptions` (`admin-subscription` module) gains two independent
date-range filters and two export endpoints. No schema change (no DDL/backfill).

- **New filters** on `ws_package_course_subscription`: `startFrom`/`startTo` → `startAt`
  range, `endFrom`/`endTo` → `endAt` range (inclusive day-edge bounds via the existing
  `parseDayBound`). Added as plain `where.startAt` / `where.endAt` fragments in
  `buildSubWhere`; they AND with `createdAt` (`dateFrom`/`dateTo`), the normalized `status`
  fragment, search, and every other filter. `summary` + `pagination.total` reflect them
  (they run through the same composed `where`).
- **New endpoints:** `GET /export/csv` and `GET /export/excel` (registered before `/:id`).
  Both accept the identical filter contract as the list but **ignore `page`/`limit`** —
  they fetch the whole filtered set via `listCourseSubsByWhere(..., 0, EXPORT_MAX=100000)`
  (one bounded `findMany`, no aggregate/count) and reuse the shared `hydrateCourseSubRows`
  (same per-page hydration + `promocodesByCodes` lookup as the list). CSV is hand-rolled;
  Excel uses the new `exceljs` dependency. Column set = the client CSV columns + on-screen
  extras; `activationType` column is blank (no SQL source yet).
- **Refactor (no behavior change to the list):** extracted `resolveCourseSubWhere` +
  `hydrateCourseSubRows` from `listCourseSubscriptions` so list and export share one
  query/hydration path. `activationType` query param is now accepted (no-op filter today).

## 2026-07-09 — Admin subscriptions report: add `educatorId` / `promoterId` / `promocodeId`

`GET /api/v1/admin/subscriptions` (merged Subscription/Material Report, `admin-subscription`)
now returns the record id alongside each of Educator Name / Promoter Name / Promocode so the
report can link to the detail pages. Additive ids only — no envelope or existing-field change.

- **`educatorId`** / **`promoterId`**: taken from the already-hydrated `courseEducator` /
  `promoter` rows (`educatorsByIds` / `promotersByIds` both already select `id`) — no new
  query. `null` when the relation is absent.
- **`promocodeId`**: the order's `promocode` column is a purchase-time JSON snapshot with no
  live FK (its embedded id is a legacy Mongo ObjectId, not `ws_promocode.id`), so the current
  record id is resolved by the code string. New repo query `promocodesByCodes` does one batched
  `ws_promocode.findMany({ where: { promocode: { in: [...] } } })` per page (indexed
  `idx_ws_promocode_code`), mapped code→id. `null` when no code / no matching record.

No schema/index change (no DDL/backfill); one added batched lookup query per report page.

## 2026-07-09 — Admin subscriptions report: add `trackingId` + `shipping.alternatePhone`

`GET /api/v1/admin/subscriptions` (merged Subscription/Material Report, `admin-subscription`
module) was missing two CSV report columns. Two additive fields only — no envelope or
existing-field change.

- **`trackingId`** (courier AWB, set via the subscriptions `/tracking` PATCH): the list row
  already carried `r.trackingId` (`ws_package_course_subscription.tracking`, BigInt) since
  `listCourseSubsByWhere` selects `*`; now surfaced per row as `number | null` via a local
  `trackingToNumber` (matches the `commerce-subscription` transformer; >2^53 → null).
- **`shipping.alternatePhone`**: added `alternate_phone` to the `shippingsByIds`
  (`ws_customer_shipping`) select and to the report row's `shipping` block as
  `String(alternate_phone)` (BigInt → string; `null` when absent) — same convention as
  `book-order` / `admin-book`.

No index, filter, or aggregation change; both columns already exist (no DDL/backfill).

## 2026-07-09 — Global search: `name` columns → utf8mb4 (multilingual fix) — DDL

`GET /api/v1/client/search` crashed with MySQL error 3988
(`Conversion from collation utf8mb4_general_ci into latin1_swedish_ci impossible
for parameter`) on Gujarati/Hindi terms, because `ws_course.name` was
`latin1_swedish_ci`. Prisma sends the term as utf8mb4; ASCII coerces to latin1
(English worked) but Gujarati/Hindi characters have no latin1 representation, so
`course` searches threw. Verified collations before/after via information_schema.

- **DDL:** `docs/migration/schema-changes/2026-07-09_search_name_columns_utf8mb4.sql`
  converts the searched `name` columns to `utf8mb4 / utf8mb4_0900_ai_ci`:
  `ws_course` (was latin1), `ws_package` / `ws_book` / `ws_ebook` (were utf8mb3).
  `ws_live_course.name` was already utf8mb4 — untouched. latin1→utf8mb4 transcodes
  the bytes (Latin data, lossless); utf8mb3→utf8mb4 is a lossless superset.
- **No code / schema.prisma change:** collation isn't tracked by Prisma, so the
  client and introspection are unaffected (no prisma:generate). The search service
  (`modules/client-search`) is unchanged — it already does `name: { contains }`.
- **Verified locally:** applied the ALTERs, then ran the exact Gujarati term
  (`છેલ્લી`) contains-search on course/package/book/ebook — all execute with no
  collation error. **Apply on deploy via `yarn db:migrate`.**

---

## 2026-07-09 — Client home dashboard: populate `plans` on Recently Added packages

`GET /api/v1/client/dashboard` "Recently Added" (`type: package`) items were
missing the `plans` object that the `course` section already carried. Added a
`packageCourseEbookPrice` fetch keyed on `packageId` (status=true, ordered by
duration asc), grouped into `{ withMaterial, withoutMaterial }` — same shape as
courses and the client-search package plans. `recentlyAdded` now includes
`plans` (empty buckets when a package has no price rows). Verified locally: dev
packages return real plan buckets. No schema change.

---

## 2026-07-09 — Client home dashboard: cap every non-banner section to latest 5

`GET /api/v1/client/dashboard` (`buildHomeDashboard`) now returns at most **5**
items per section for all sections **except** `banner` (carousel keeps its full
set), for response-size / client perf. Sections are already ordered
most-recent / nearest-upcoming first, so the cap takes the head. Implementation:
- **Query-level (over-fetch fixes):** `course` findMany was **unbounded** — added
  `take: 5` (also shrinks the downstream plan + ownership joins that key off
  `courseIds`). `testimonial` findMany was **unbounded** — added `take: 5`.
- **Output-level guarantee:** final `dashboard` array is mapped so every section
  with `type !== "banner"` has its `data` sliced to 5 (covers `package`, `course`,
  `courseCategory`, `trending-book`, `trending-ebook`; `exam-countdown` (≤2) and
  `daily-test` (≤1) are unaffected).
Response shape unchanged (same sections, same fields — just fewer rows). No
schema/DDL change.

---

## 2026-07-09 — Admin video-category: empty `educatorId` no longer 422s (validation-only)

`POST`/`PUT /admin/video-categories[/:id]` are multipart, so an unselected
educator arrives as the string `""` (or `"null"`/`"undefined"`), which slipped
past `.optional().nullable()` and then failed the id regex → 422
`{ educatorId: "Invalid id" }` (blocked saving any category without an educator).
Added a `z.preprocess` in `videoCategory.validation.ts` normalizing those
empty-ish strings **before** the id check: create/update body → `null` (service
already stores falsy educatorId as `0`, i.e. clears it); list filters →
`undefined` (no filter). Valid ids and genuinely invalid ids (`"abc"`) are
unaffected. **No schema/DDL/query change** — validation coercion only.

---

## 2026-07-08 — New client App Version check endpoint (no schema change, no DDL)

Added `GET /api/v1/client/app-version/check?platform=ios|android&currentVersion=&currentVersionName=`
(new module `src/modules/app-version/` + client surface `src/client/app-version/`).
Reports whether the running app build is behind the store and whether the update
is forced. **Public route** (no Bearer) — the app must call it pre-login to honor
a forced update; documented auth exception alongside auth/refresh/webhook/health.

- **No new tables / columns / indexes.** Reuses the existing singleton reads only:
  `versionRepository.findSingleton()` (`ws_versions`) and
  `appUpdateRepository.findSingleton()` (`ws_app_update`) — no new queries against
  the DB beyond these existing ones.
- **External read (not DB):** iOS latest version is fetched **live** from Apple's
  iTunes Lookup API (`https://itunes.apple.com/lookup`) via `callOutbound`
  (timeout/retry/breaker) and cached in Redis (`app-version:appstore:ios`, TTL 30m).
  Android has no official store API → latest comes from the admin config rows above.
- **Force-update logic:** `currentVersion < ws_versions.last_supported_version_code`,
  or (`updateType === "immediate"` while an update is available).
- **New optional env:** `IOS_BUNDLE_ID`, `IOS_APP_STORE_ID`, `IOS_APP_STORE_URL`,
  `ANDROID_PACKAGE_NAME`, `ANDROID_STORE_URL`, `APP_STORE_COUNTRY` (documented in
  `.env.example`; all optional — check degrades to admin config when unset).
- Frontend integration doc: `docs/client/APP_VERSION_CHECK_FRONTEND_INTEGRATION.md`.
- **Follow-ups (same endpoint, no DB change):** (a) route made **public** — dropped
  `authenticate` so the app can run the force-update gate pre-login; (b) query is now
  parsed in the controller via `checkAppVersionQuerySchema.safeParse(req.query)` instead
  of the `validate({ query })` middleware — Express 5 makes `req.query` getter-only, so
  the middleware's `req.query = parsed` reassignment threw
  `Cannot set property query of #<IncomingMessage>`. Same 422 flat-message contract.
- **`isForceUpdate` logic simplified** — now driven purely by `updateType`:
  `isForceUpdate = isUpdateAvailable && updateType === "immediate"`. Dropped the
  `minSupportedVersion` floor as a force trigger (still returned, info-only). So
  `flexible` and `isUpdateAvailable=false` always yield `false`.
- **DB `is_update_availble` flag now honored** — previously `isUpdateAvailable` was
  computed only from version-number comparison, so the `ws_app_update.is_update_availble`
  column had no effect. Now it's the master switch: `isUpdateAvailable = adminFlag &&
  clientIsBehind`. Setting the column to `0` makes both `isUpdateAvailable` and
  `isForceUpdate` false regardless of versions/updateType.

---

## 2026-07-08 — Drop retired Pendrive Course module (7 tables)

Removed the pendrive product line end-to-end (it was already retired — excluded
from the `ws_termsandcondition.module` enum; no application code referenced it).

- **Schema:** deleted 7 Prisma models — `PendriveCourse`, `PendriveCourseStorageDevice`,
  `PendriveCourseCart`, `PendriveCourseCartItem`, `PendriveCourseTag`,
  `PendriveCourseTracking`, `PendriveCourseOrder` — and their back-relation fields
  on `Customer` (`pendriveCourseCart`, `pendriveCourseOrder`) and `CustomerShipping`
  (same two). Regenerated the Prisma client; `yarn typecheck` green (zero code
  depended on them).
- **DDL:** `docs/migration/schema-changes/2026-07-08_drop_pendrive_course.sql` drops
  all 7 `ws_pendrive_course*` tables (FK checks disabled around the drop, children
  first). **IRREVERSIBLE — back up before applying in prod.** Not yet executed
  against any DB; apply on deploy.

---

## 2026-07-08 — Subscription Material Report: `hasMaterial` filter on `GET /admin/subscriptions`

Added an optional `hasMaterial=true` query param to the merged Subscription Report
(query-shape only — no schema change). When set, restricts to with-material rows
(`pc_material_id > 0`, i.e. `materialType: "With Material"`). Applied in the base
`where` (`buildSubWhere` → `pcMaterialId: { gt: 0 }`), so it AND-composes with every
existing filter and the `summary` aggregates (total/revenue/active/expired) reflect
the filtered set — not just the page slice. Omitted/`false` → unchanged (all rows).
Row shape unchanged (same 26 fields). Files: `admin-subscription.repository.ts`
(`CourseSubFilter.hasMaterial`), `admin-subscription.service.ts`, `subscription.controller.ts`.

---

## 2026-07-08 — Merged Subscription Report: 26-column rows on `GET /admin/subscriptions`

`listCourseSubscriptions` (admin-subscription module) extended for the merged
Course+Package **Subscription Report** (query-shape / response-field only — **no
schema change, no DDL**). The shared `reportRow` DTO (used by 4 reports) is left
untouched; the extra columns are attached only on this endpoint's rows.

- **Combined list:** omitting `type` already returns both course & package rows
  (`buildSubWhere` adds no product constraint when `type` is absent);
  `type=course|package` still narrow. Each row already carries `product.type`.
- **`id`** added at row root (the real `ws_package_course_subscription.id`).
- **New per-row columns** (all null when N/A), hydrated via batched id lookups:
  - `educatorName` ← course `educator_id` → `ws_course_educator.name`
  - `promoterName` ← subscription `promoter_id` → `ws_promoter.full_name`
  - `promocode` ← linked order's `promocode` JSON snapshot (`$.promocode`)
  - `courseAmount` / `materialAmount` ← subscription `course_amount`/`material_amount`
  - `wsCoin` ← order `ws_coin`
  - `materialType` ← `"With Material"` when `pc_material_id > 0`, else `"Without Material"`
  - `razorpayOrderId` / `razorpayPaymentId` / `bankTransactionId` ← order
    `razorpay_order_id` / `razorpay_payment_id` / `bank_transaction_id` (empty → null)
  - `shipping` `{ address, address2, city, pincode }` ← subscription `shipping` → `ws_customer_shipping`
  - `remarks` ← subscription `remarks`
  - `activatedBy` ← subscription `created_by` → `ws_users` first+last name
  - `activationType` ← **null** (no SQL column exists — pending definition from FE)
- **`search`** now also matches customer **email** (`customerIdsByText` OR gained
  `emailAddress contains`), alongside name/phone + course/package name.
- **`dateFrom`/`dateTo`** now pin bare `YYYY-MM-DD` to day edges (inclusive
  `createdAt` range; previously a bare `to` bound excluded that day).
- New repo lookups: `ordersByIds`, `shippingsByIds`, `promotersByIds`,
  `educatorsByIds`, `adminUsersByIds`; `coursesByIds` select gained `courseEducatorId`.
- `summary`, envelope, pagination (per-subscription) unchanged.
- Files: `admin-subscription.repository.ts`, `admin-subscription.service.ts`.

---

## 2026-07-08 — Book Orders report: extra columns + server-side filters

`GET /admin/books/orders/list` extended for the rebuilt admin Book Orders report
(query-shape / response-field only — **no schema change, no DDL**):

- **Response (order level):** each row now includes `trackingId` (BIGINT AWB →
  string, from `ws_book_order.tracking_id`), `razorpayOrderId`
  (`gateway_order_id`; empty → `null`), `razorpayPaymentId`
  (`gateway_transaction_id`), plus two **derived** totals — `totalWeight`
  (Σ `book.weight × qty` over books with a known weight, else `null`) and
  `shippingPrice` (Σ per-line `ws_book_order_item.shipping_price`; for legacy
  JSON-snapshot orders, `shippingPrice`/`shipping_price` from the JSON; `null`
  when the order has no line items).
- **Response (item level):** each `items[]` entry gains `weight` (the book's unit
  weight from `ws_book.weight`; `null` when unknown). `findBooksByIds` select now
  includes `weight`.
- **`search`** now also matches customer **email** (`findCustomerIdsBySearch` OR
  gained `emailAddress contains`), alongside name/phone, book name, and receiptId.
- **`state`** (new) — filters on the linked shipping row's numeric state id
  (`shipping.is.state` in `buildOrderWhere`).
- **`dateFrom`/`dateTo`** (new aliases) accepted alongside legacy `fromDate`/`toDate`;
  bare `YYYY-MM-DD` bounds are now pinned to day edges so the `createdAt` range is
  inclusive (previously a bare `toDate` resolved to midnight and excluded that day).
- `status` (enum `pending|verified|shipped|delivered|cancelled|failed`), `bookId`,
  `page`/`limit`, `sortBy`/`sortOrder` unchanged (already honored). Pagination stays
  per-order.
- Files: `admin-book.repository.ts` (state filter, `weight` select, email search),
  `admin-book.service.ts` (`parseDayBound`, `OrderItemShape.shippingPrice`, item
  `weight`, derived order totals, `state`), `book.controller.ts` (param parsing).

---

## 2026-07-08 — Ebook Subscriptions report: extra columns + server-side filters

`GET /admin/ebooks/subscriptions/list` extended for the rebuilt admin report page
(all changes are query-shape / response-field only — no schema change, no DDL):

- **Response:** each row's `orderId` now also carries `razorpayOrderId` /
  `razorpayPaymentId` (from `ws_ebook_order.razorpay_order_id` /
  `razorpay_payment_id`). Empty gateway id (non-razorpay grants: `free`/`Backend`) → `null`.
- **`search`** now also matches customer **email** (`findCustomerIdsBySearch` OR gained
  `emailAddress contains`), in addition to name/phone and ebook name.
- **`status`** accepts computed values `active` | `expired` | `inactive`
  (`inactive`=`status=false`; `expired`=`status=true AND endAt<now`;
  `active`=`status=true AND endAt>=now`). Legacy `true`/`false` still honored.
  `pagination.total` reflects the filter (applied in the shared `buildSubWhere`).
- **`paymentMethod`** filters the linked order (`eBookOrder.is.paymentMethod`),
  case-insensitively coerced to the `PaymentMethod` enum
  (`Backend|razorpay|bank|cash|free|Paykun|Paytm`). Invalid value → 400.
- **`dateFrom`/`dateTo`** — inclusive range on `ws_ebook_subscription.created_at`
  (day-edge bounds computed in the service).
- `ebookId`, `page`/`limit`, `sortBy`/`sortOrder` were already honored (unchanged).
- Files: `admin-ebook.repository.ts` (shared `SubFilter`, `buildSubWhere`, select),
  `admin-ebook.service.ts` (`coercePaymentMethod`, `parseDateBound`, `listSubscriptions`),
  `ebook-subscription.controller.ts` (param parsing).

---

## 2026-07-08 — drop `description` from Exam Countdowns (column + API)

Frontend removed the Description field from the Exam Countdown admin UI (no longer
captured or displayed). Removed it from the backend end-to-end:

- **Schema:** dropped `description String? @db.Text` from model `ExamCountdown`.
  DDL `docs/migration/schema-changes/2026-07-08_exam_countdown_drop_description.sql`
  (`ALTER TABLE ws_exam_countdown DROP COLUMN description`). Applied to staging.
- **API:** `GET /admin/exam-countdowns` list item DTO no longer returns
  `description`; `POST` / `PUT /admin/exam-countdowns/:id` no longer read or
  persist it (`examCountdown.controller.ts`, `exam-countdown.service.ts`
  create/update input types + DTO). Client `countdownDto`
  (`exam-countdown.client.ts`) also drops the field.
- Non-breaking per the FE team (they no longer send/read it). Verified on staging:
  column gone, create DTO keys no longer include `description`.

---

## 2026-07-08 — bulk delete of a saved-material notes group

New endpoint `DELETE /api/v1/client/lecture-notes/saved-materials` — the trash
action on a Saved Notes row deletes ALL text + audio notes for that group. No
schema change; new query-level behavior only.

- **New deletes (both collections, one `$transaction`):**
  `client-lecture-note.service.deleteSavedMaterialNotes` runs
  `prisma.lectureNote.deleteMany({ where })` + `prisma.lectureAudioNote.deleteMany({ where })`
  where `where` is scoped to `customer_id` + the target:
  - `recorded` → `{ lectureType: "recorded", videoId }`
  - `live` → `{ lectureType: "live", liveSessionId }`
  - `course` → `{ courseId }`
  - `live_course` → `{ liveCourseIds: { array_contains: liveCourseId } }`
    (JSON array containment → MySQL `JSON_CONTAINS` on `ws_lecture_note.live_course_ids`
    / `ws_lecture_audio_note.live_course_ids`).
- **Side effect:** audio urls are read (`findMany select audioUrl`) BEFORE the
  delete so the controller can clean the S3 objects via `deleteFromS3FileUrl`
  (best-effort, same as single audio delete).
- **Idempotent:** 0 matches ⇒ `{ deletedTextNotes: 0, deletedVoiceNotes: 0 }` with
  200 (never 404), so a stale row can be cleared.
- Always customer-scoped (never touches another user's notes). Route mounted
  BEFORE `DELETE /:id` so the literal path isn't captured as a note id.
- FE contract: `docs/client/DELETE_SAVED_MATERIAL_NOTES_FRONTEND.md`.

## 2026-07-08 — RBAC: add 3 previously-unmapped admin modules to the catalog

Per `docs/backend-requests/rbac-add-three-unmapped-modules.md`. Three admin
screens were ungated (no catalog module/keys); added them so they are gated
server-side and grantable to roles.

- **Catalog** (`src/admin/permission/permissions.catalog.ts`, `CATALOG_VERSION`
  → `2026.07.08-1`): `pc-materials` (Master Data, standard 6),
  `cms.current-affairs` (CMS, standard 6), `cms.free-delivery` (CMS, view+edit
  only). Keys match the already-shipped frontend `modulePermissions.ts` strings.
- **Enforcement** (`src/middlewares/rbacRouteMap.ts`): `crud("/pc-materials",
  "pc-materials")`; added `current-affairs` to the `/cms/<seg>` crud loop
  (→ `cms.current-affairs.*`); re-pointed `GET|PUT /books/settings` from
  `books.*` to `cms.free-delivery.view|edit` (registered before `crud("/books")`
  so `:id` can't shadow it — `/books/:id` CRUD verified still intact).
- **Seed:** `syncPermissionCatalog()` (boot-time, idempotent) now emits these
  keys into `ws_permissions` across all 3 guards (web/educator/promoter) — 14
  keys × 3 = 42 rows. Ran against staging: `inserted: 0` on re-run (idempotent).
- **Decision (doc Q2):** used a new `cms.free-delivery` module (view+edit) rather
  than reusing `cms.terms.edit`, to match the shipped FE keys with zero remap.
- Effective-permissions at login are unchanged in shape — the new keys flow into
  `admin.permissions[]` automatically for any role granted them. Super-admin
  (`["*"]`) already bypasses. No schema/DDL change.

---

## 2026-07-08 — enrollment-scoped resume pointer (dashboard/resume + progress/my)

Fixes resume cards mirroring each other for a lecture shared by a course AND a
package (see docs/be-dashboard-resume-scope.md). Root cause: `ws_lecture_progress`
is `@@unique([customer_id, video_id])` — a GLOBAL per-video store — so a shared
video can hold only one `last_watched_at`, and both the course card and package
card read that one row. Watching a new video in one product moved the other
product's card too.

- **Schema (DDL):** `docs/migration/schema-changes/2026-07-08_enrollment_resume.sql`
  adds new table `ws_enrollment_resume` (Prisma model `EnrollmentResume`,
  `prisma.enrollmentResume`). Columns: `customer_id, scope_kind
  ("course"|"package"|"liveCourse"), scope_id, video_id?, live_session_id?,
  last_watched_at, created_at, updated_at`. `UNIQUE (customer_id, scope_kind,
  scope_id)` = one last-watched pointer per enrollment. `created_at`/`updated_at`
  have NO DB default (set explicitly in code, matching the ws_* convention).
- **Two layers now:** Layer-1 = `ws_lecture_progress` (global video/session
  position, UNCHANGED — red bars stay consistent across products). Layer-2 =
  `ws_enrollment_resume` (per-enrollment "last watched" pointer).
- **New writes:** `client-lecture-progress.service.upsertEnrollmentResume` — an
  `upsert` on `uniq_customer_scope` stamping `{video_id|live_session_id,
  last_watched_at}`. Called (failure-isolated) at the end of
  `reportContainerProgress` (scope kind/id) and `reportLiveSessionProgress`
  (kind="liveCourse", resolved liveCourseId + liveSessionId).
- **New reads (replaces the contaminated per-container rollup for the pointer):**
  `listMyLearningProgress` now sources the container set + last-watched pointer
  from `ws_enrollment_resume` (`resumePointers`), the pointer video/session
  position from `ws_lecture_progress` (`videoPositions`/`sessionPositions`, still
  global), and per-container completed counts via one `groupBy` each
  (`completedCounts`). Card assembly + purchased-only subscription join unchanged.
  `rollupByContainer` is retained only for `listMyCoursesForResume` (courses/my),
  which is out of scope for this doc.
- **Backfill:** `scripts/backfill-enrollment-resume.ts` seeds one pointer per
  `(customer, scope_kind, scope_id)` from the most-recent existing progress row
  carrying that container (best-effort; going-forward scoped writes self-correct).
  Run on deploy after the DDL so returning users keep their cards.
- API response shape of `/dashboard/resume` and `/learning/progress/my` is
  unchanged; only which lecture each card points to is now enrollment-correct.

## 2026-07-08 — merge ws_promo_code into ws_promocode (drop the duplicate table)

Consolidated the two overlapping promocode tables onto **`ws_promocode`** and
retired **`ws_promo_code`**:

- **`ws_promocode`** (Prisma `Promocode`) — promoter promo codes + per-plan
  promoter/customer % links (`ws_promoted_package_course_ebook`).
- **`ws_promo_code`** (Prisma `PromoCodeRule`) — admin discount rules
  (percentage/flat + appliesTo targeting); the `promo-code` module.

**Schema (`Promocode`):** added `discount_type VARCHAR(32) NOT NULL DEFAULT
'percentage'`, `discount_value DECIMAL(10,2) NOT NULL DEFAULT 0`,
`applies_to_type VARCHAR(32) NULL`, `applies_to_ids JSON NULL`; widened
`description` to `TEXT`; added indexes `idx_ws_promocode_code` and
`idx_ws_promocode_type_status`. The four new discount/appliesTo fields keep
camelCase Prisma names via `@map` so the module's code carries over unchanged.
Removed model `PromoCodeRule`. DDL:
`docs/migration/schema-changes/2026-07-08_merge_promo_code_into_promocode.sql`
(+ `2026-07-08_drop_ws_promo_code.sql`).

**Code re-point (`prisma.promoCodeRule` → `prisma.promocode`):**
`src/modules/promo-code/promo-code.service.ts` (all CRUD/apply/public-list),
`src/modules/admin-promoter/admin-promoter.service.ts` (`getPromoterPromocodes`),
`src/modules/catalog-package/catalog-package.detail.sql.ts` (`availablePromo`).
Window/timestamp fields remapped to the `Promocode` snake-case columns
(`promo_start_at` / `promo_expire_at` / `created_at` / `updated_at`); DTO output
keys unchanged, so admin/client response contracts are byte-identical. `type`
values (`public`/`private`) already match the `ws_promocode` ENUM.

**Backfill:** `scripts/backfill-merge-promo-code.ts` copies every `ws_promo_code`
row into `ws_promocode` (dedup by `promocode` string) and remaps
`ws_promoted_package_course_ebook.promocode_id` old→new via a two-phase offset
update so the plan-link %/split stays attached. Safe because
`promo-code.service` is the sole SQL writer of that table. `commerce-promocode`
SQL path is still flag-OFF, so no live read depends on the old ids.

**Deploy:** apply merge DDL → `prisma:generate` → deploy code → run backfill →
verify → apply drop DDL.

**Follow-up (same day):** `ws_promocode.promoter_id` was `INT NOT NULL` (the
promoter flow always has a promoter), which broke admin discount-rule creates
that pass `promoterId: null`. Made it nullable to match the Prisma model
(`promoterId Int?`) — DDL
`2026-07-08_promocode_promoter_id_nullable.sql`. Applied to staging; verified
`createPromocode({ promoterId: null })` now succeeds. Also applied to staging:
merge DDL + drop of `ws_promo_code` (was empty, 0 rows — backfill was a no-op).

---

## 2026-07-08 — entitlement gate on category-video playback (list + single)

Closed an entitlement leak: `GET /client/video-categories/:id/videos`
(`listVideosByCategory`) and `GET /client/video-categories/:id/videos/:videoId`
(`getVideoByCategory`) returned a decryptable playback envelope (`request.files`
token/HLS/progressive) for **paid** videos with **no subscription check**, while the
sibling lecture-detail (`GET /client/courses/lecture`) and progress heartbeat
(`POST /client/courses/lectures/:videoId/progress`) both correctly 403 without an
active subscription. All three now agree.

- **New query (helper):** `client-category-video.service.isEntitledForScope(customerId, scope)`.
  For a category's resolved owning scope (`resolveVideoScope` → `{kind,id}`) it mirrors
  the exact gates already used elsewhere:
  - `course` → `prisma.packageCourseSubscription.findFirst({ customerId, courseId, status:true, endAt:{gt:now} })`
  - `package` → `prisma.packageCourseSubscription.findFirst({ customerId, packageId, status:true, endAt:{gt:now} })`
  - `liveCourse` → `prisma.liveCourseSubscription.findFirst({ customerId, liveCourseId, status:true, paymentStatus:"verified", endAt:{gt:now} })`
- **List behavior change:** paid rows now get `request: null` (no envelope) unless
  entitled; metadata, `isPaid`, and `progress` are unchanged, so the FE renders a
  locked card. Free videos (`priceType!=="paid"`) are unaffected — envelope still built.
- **Single-video behavior change:** paid video for an unentitled caller now returns
  **403** `"Active subscription required to access this lecture"` (same message/shape as
  lecture-detail) instead of a playable envelope. Free videos unaffected.
- No schema/index change. Parity note: `ws_package_course_subscription` has no
  `payment_status` → course/package gate collapses to `status=true`; live keeps `verified`.

## 2026-07-08 — notify live-course buyers when a session starts

New side effect on `POST /admin/live-sessions/:id/start`: push a `general`
notification ("<title> is live now") to every customer with an active subscription
to any of the session's live courses.

- **Schema (DDL):** `docs/migration/schema-changes/2026-07-08_live_session_notified_stream_id.sql`
  adds `ws_live_session.notified_stream_id VARCHAR(191) NULL`. Prisma model
  `LiveSession.notifiedStreamId`. Existing rows are NULL (never notified) → backfill
  not required; the first start after deploy notifies once.
- **Idempotency claim (new query):** `prisma.liveSession.updateMany({ where: { id,
  OR: [{ notifiedStreamId: null }, { notifiedStreamId: { not: streamId } }] }, data: {
  notifiedStreamId: streamId } })`. ⚠ Prisma `{ not: x }` does NOT match NULL rows in
  MySQL (`NULL <> x` → NULL), so the explicit `notifiedStreamId: null` branch is
  required — otherwise a first-ever start (NULL column) silently no-ops (this bit us:
  the initial version omitted it and no push fired). With it: the first start of a
  stream run wins the claim; a retried /start or a stop→restart reusing the same
  StreamOS stream is a no-op; a new stream (new streamId) re-notifies.
- **Audience (new query):** `adminLiveCourseRepository.activeSubscribersForCourses(
  liveCourseIds, now)` — `liveCourseSubscription.findMany` over `liveCourseId IN (...)`,
  `status=true`, `paymentStatus="verified"`, `endAt` null/future; selects
  `{customerId, liveCourseId}`. Reverse of the existing per-customer `activeSubsForCourses`.
  Deduped per customer (first course wins) and grouped per course so each user's deep
  link (`buildNotificationRouting({kind:"content",entity:"live-course",id})`) points to
  a course they bought.
- **Delivery:** reuses `dispatchAudience` (FCM + `ws_notification` feed fan-out) with a
  `userIds` audience filter; non-blocking (fired fire-and-forget from the controller).
  FCM `data` carries `deepLink` + `sessionId`, `streamId`, `liveCourseId` (all strings)
  so the app can route straight into the running class.

## 2026-07-07 — client CMS lists search + pagination sweep, BATCH 4 (CMS reads)

Continues the standing rule (every client LIST endpoint gets `?search=` +
`?page=&limit=`). Client CMS reads in `client/cms/cms.controller.ts` now parse
`parseListQuery` + return `buildPagination`, backed by new paged service helpers:
- `modules/faq/faq.service.ts`: `listFaqsClientPaged` (type filter + search on
  question/answer, created_at asc) and `listFaqTypesClientPaged` (in-memory search/page
  over the fixed synthetic FAQ_TYPES list).
- `modules/banner-slider/banner-slider.service.ts`: `listBannersClientPaged` (key filter
  + pagination ONLY — banner rows have no natural text field, so no search).
- `modules/testimonial/testimonial.service.ts`: `listTestimonialsClientPaged` (search on
  name/title/description, rating desc).
- `modules/cms/cms-extra.service.ts`: `listSocialLinkTypesPaged` (search title),
  `listClientSocialLinksPaged` (active only, search title/link, orderBy asc),
  `listClientCurrentAffairsPaged` (active, newest first, search title), and
  `listLiveBannersClientPaged`.

Query-level: each helper is `findMany(where, orderBy, skip/take)` + `count(where)` over
the identical where (contains-match search; MySQL `_ci` collation = case-insensitive);
response gains a sibling `pagination` block. No schema/DDL change. (Logged retroactively —
these changes were already present in the working tree, authored outside this session.)

---

## 2026-07-07 — Permissions + Permission-Categories lists: house envelope + category_id filter

Fixes permissions-categories-list-server-side.md.

- **`GET /admin/permissions`**: was `{ data: { items, total } }` (no pagination block).
  Now `{ data: [...], pagination: { total, page, limit, totalPages } }` (permission.
  controller). Added the **`category_id`** filter, which was validated but IGNORED:
  `permission.service.listPermissions` now passes it through to
  `admin-rbac.service/repository.listPermissions` + `countPermissions`
  (`where.categoryId`). search (name contains) + guard (exact/optional) already worked.
- **`GET /admin/permission-categories`**: was `{ data: { items, pagination:{page,per_page,
  total} } }` (nested, no totalPages). Now `{ data: [...], pagination: { total, page,
  limit, totalPages } }` (permissionCategory.controller). search/title, status(bool),
  sort_by/sort_dir already worked.
- **`GET /admin/guards`**: unchanged — `{ data: { guards: [...] } }` already accepted.
- No DB/schema change.

---

## 2026-07-07 — Admin authz unified on catalog RBAC (legacy `requireRole` gates removed)

Fixes goals-403-despite-granted-permission.md: admin routes were gated by coarse
`requireRole(...)` role checks that ignored catalog permissions, so a role granted
`goals.view` still got 403 ("Access denied. Insufficient permissions." from
`requireRole`, `authenticate.ts:233`) because goals was `requireRole("super_admin")`-only.

- **admin.routes.ts:** added ONE coarse admin-surface gate
  `router.use(requireRole("admin","super_admin","editor"))` after `authenticate`
  (keeps customer/promoter/educator tokens out); catalog `enforceRbac` (shadow) remains
  the single granular authz below it.
- **Removed** the per-sub-router broad gate `router.use(authenticate, requireRole("admin",
  "super_admin"[, "editor"]))` from 31 domain route files (→ `router.use(authenticate)`),
  plus the per-route broad gates on `permissions/catalog` and `uploads/presign`.
- **goals:** dropped `requireRole("super_admin")` on all 4 routes → now authorized by
  catalog RBAC (`goals.view/create/edit/delete`) + the staff gate.
- **Kept** `requireRole("super_admin")` as a hard floor on the 6 RBAC/admin-management
  groups (roles, permissions[mgmt], permission-categories, guards, administrators,
  admin-register) — super-admin-only is the intended invariant there; catalog keys still
  layer on top via enforceRbac.
- Enforcement stays **shadow** (`RBAC_ENFORCE` unset): granted users now pass; enforceRbac
  logs would-be-denies. No DB/schema change; no response-shape change.

---

## 2026-07-07 — Permission catalog seeded under REAL guards (was unusable "api")

`admin/permission/permissions.seeder.ts`. The boot sync inserted every catalog key
under `guardName="api"` — but "api" is **not** a valid guard (`GUARDS = [web, educator,
promoter]`), and spatie permissions are guard-scoped, so no role (all web/educator/
promoter) could ever reference a catalog permission → `permission_ids` always resolved
empty → saves wiped roles. Fix: seed each catalog key under **all** `SEED_GUARDS`
(web/educator/promoter). Now batched per guard (findMany existing → `createMany
{skipDuplicates}`) instead of ~250×N sequential `findFirst`. Legacy/non-catalog rows
are left intact (logged as deprecated); the old "api"-guard rows are harmless orphans
(no guard uses them). Runs on every API boot (`index.ts` httpEnabled) — a restart/deploy
seeds existing envs; no manual migration needed. `name == catalog key` (unchanged).
NOT done (optional, per doc): migrating existing role→permission assignments from legacy
names to catalog keys — FE already surfaces those under "Other assigned".

---

## 2026-07-07 — `GET /admin/roles` list now embeds each role's `permissions[]`

`admin-rbac.service.listRoles` + new `admin-rbac.repository.permissionsForRoles`. The
roles list previously returned only `permission_count`, so the Edit Role modal had
nothing to preselect and could save `permission_ids: []` (wiping the role). Each list
item now also carries `permissions: [{ id, name }]` (name == catalog key,
`ws_permissions.name`), `permission_count` derived from the same set. Batched: 2 queries
(links + permission rows) regardless of page size — no N+1. `PUT /admin/roles/:id`
already applies `permission_ids` and echoes `permissions` via `toRoleDetail` (the prior
`[]` echo was the FE sending `[]`, not a backend drop). Detail (`GET /admin/roles/:id`)
already returned `permissions`. No DB/schema change.

---

## 2026-07-07 — `GET /admin/roles` list envelope aligned to house standard

`admin/role/role.controller.ts` `listRoles` was returning a non-standard envelope
(`data: { items, pagination: { page, per_page, total } }`) — pagination nested inside
`data`, no `totalPages`, `per_page` key — which broke the admin pager (FE reads
`pagination` as a SIBLING of `data` with `total`+`totalPages`). Changed to the same
shape as books/customers: `{ success, data: [...roles], pagination: { total, page,
limit, totalPages } }`. Filtering/sorting were already correct (guard exact + optional,
search = name `contains`, page/per_page, sort_by/sort_dir; each role carries
`permission_count`) — only the envelope changed. No DB/schema change.

---

## 2026-07-07 — `GET /admin/permissions` per_page cap raised 200 → 1000

`admin/permission/permission.validation.ts` `listQuerySchema.per_page` max was 200,
below the ~250-key permission catalog — so a guard-filtered "fetch all permissions"
call (e.g. `?guard=promoter&per_page=1000` for the role-assignment UI) 422'd. Raised
the cap to 1000 (permissions are a bounded, code-defined catalog). Default (20) and
min (1) unchanged. No DB/schema change. Note: the full registry grouped by module is
also available via `GET /admin/permissions/catalog`.

---

## 2026-07-07 — Resume/Progress feeds: purchased-only cards + `isPurchased`

`modules/client-lecture-progress/client-lecture-progress.service.ts` →
`listMyLearningProgress` (feeds **both** `GET /client/learning/progress/my` and, via
`buildResumeDashboard`, `GET /client/dashboard/resume`).

- **Query/logic change:** course/package/live cards are now emitted **only when an
  active subscription exists** for the container. Previously the `courseSubs` /
  `packageSubs` / `liveSubs` rows (already scoped `status=true` + `endAt>now`, plus
  `paymentStatus=verified` for live) were fetched but used only for `daysLeft`; each
  card loop now does `if (!sub) continue`. Effect: preview/free watches inside a paid
  container no longer surface a card, and an expired subscription drops the card.
- **Shape:** added `isPurchased: true` on each emitted card (always true now that
  unpurchased cards are filtered) for defensive client filtering. Additive; no existing
  field changed. `dashboard/resume` inherits both via the shared card list.
- **Not changed:** `listFreeResume` (separate `type:"free"` feed) and
  `listMyCoursesForResume` (course-only "My Courses" resume endpoint) — the latter still
  emits started-but-unpurchased courses; flag if it needs the same gate.
- No schema/DDL change.

---

## 2026-07-07 — client API search + pagination sweep, BATCH 3 (user-scoped lists)

Continues the standing rule (every client LIST endpoint gets `?search=` + `?page=&limit=`).
Batch 3 domains: wishlist, my-subscriptions, purchase-history, referral, notification,
lecture-note, lecture-audio-note, learning, folder, search-history, offline, live-reminder.

**Endpoints changed:**
- **wishlist `/`** — heterogeneous (course/package/ebook/book); resolve → filter by title →
  slice → re-group; `pagination` added (array-slice, no DB count).
- **my-subscriptions `/`** — search added to its existing Zod-schema pagination (filters cards by title before slice).
- **purchase-history:** `/books`, `/ebooks` search added (books: LIKE on `ws_book_order.order_items`
  JSON; ebooks: name→`plan_id IN` chain on `ws_ebook_order`); `/subscriptions` pagination-only
  (4-table union, titles in separate name tables — no single searchable where). All 3 moved to `parseListQuery`.
- **referral:** `/transactions` search on `ws_refferal_transaction.description`; `/bank-accounts`
  gained pagination + OR-search across holder/bank/number/ifsc.
- **notification:** `/notifications` search on title/body (unreadCount stays over full set);
  `/image-notifications` pagination-only (no text field).
- **lecture-note:** `/` search on note content; `/saved-materials` paginates the by-lecture
  group list (grouping/title contract intact). **lecture-audio-note `/`** search on title.
- **learning `/progress/my`** — search on course/package/live-course title; `resumeNext` hero
  stays page-independent.
- **folder:** `/all-items` gained search + pagination (`/` already had it).
- **search-history `/history`** — search on query text + pagination (capped 10 rows/customer on write).
- **offline:** `/centers`, `/batches` gained pagination (search pre-existed).
- **live-reminder `/`** — search on session title + pagination (in-memory slice after upcoming filter/sort).

**Contract note:** `pagination` additive; item fields unchanged; DB `count()` shares the
`findMany` where; heterogeneous/merged lists (wishlist, my-subscriptions, purchase-history
subscriptions, learning, live-reminder) slice the resolved array with `total` = full filtered length.

## 2026-07-07 — Admin RBAC: per-endpoint permission enforcement (shadow) + `isSuperAdmin` + `/auth/me`

Implements the backend half of the frontend RBAC contract (`rbac-module-visibility.md`).
No schema/DDL changes — reads use the existing spatie pivots
(`ws_role_has_permissions`, `ws_model_has_roles`, `ws_model_has_permissions`).

- **`isSuperAdmin` (bool)** added to the admin DTO (`admin-auth.transformer.ts` →
  login / refresh / `/auth/me` responses). Purely additive; existing
  `permissions:["*"]` + `role:"super_admin"` unchanged.
- **`GET /api/v1/admin/auth/me`** (new, auth-protected) returns the same admin DTO for
  session rehydration (effective permissions/roles/isSuperAdmin) without a token refresh.
- **`requirePermission` middleware** (`middlewares/requirePermission.ts`) + **central
  route→catalog-key map** (`middlewares/rbacRouteMap.ts`, 519 rules) + **`enforceRbac`**
  gate mounted once in `admin.routes.ts` after `authenticate`. Resolves each admin's
  EFFECTIVE keys via a new cached resolver (`admin-permission-resolver.ts`, Redis key
  `admin_perms:{id}`, 60s TTL). Super-admins bypass.
- **Query-level:** authorization now issues, per admin request (cache-miss only), the
  same 3 pivot reads used at login (`findRoles` + `findRolePermissions` +
  `findDirectPermissions`). Cache busted on role-permission sync
  (`invalidateAllAdminPermissions`, SCAN `admin_perms:*`) and on admin role
  reassignment / delete (`invalidateAdminPermissions`).
- **Rollout:** ships in **SHADOW MODE** — new env `RBAC_ENFORCE` (default false) logs
  would-be-403s without blocking; set `true` to enforce (403 `{success:false,"Forbidden"}`).
  Unmapped routes (e.g. `/pc-materials`, `/uploads/presign`, `streamos/webhook`,
  `cms/current-affairs`) are allowed + logged as coverage gaps. No response-contract
  change on success paths.

---

## 2026-07-07 — catalog videos/materials tabs: inlined child arrays restored for `course` ONLY

Reverted the response-shape half of the previous entry for the catalog **videos** and
**materials** tabs (`client-catalog.service.ts`), **scoped to `type=course` only** —
`package` and `live-course` keep the newer stripped shape (context-dependent `count`, no
inlined list). Pagination + search unchanged. The `catalogVideos`/`catalogMaterials`
functions now branch on `opts.type === "course"` (`inlineList` / `inlineMaterials`): the
course path fetches the inlined video/material docs, the other types skip that work.

- `catalogVideos`: per-category `list` of video docs is back (`_id,title,topic,platform,
  priceType,order,youtube_id,aws_id,vimeo_id,recordings,qualities,progress`), and `count`
  reverts to the subtree video count. Video-title `search` (`title:{contains}`) restored.
- `catalogMaterials`: per-category `materials` array is back (full shaped Material docs +
  `isPurchased`, paid-gating on `file`/`directLink` via `getPurchasedMaterialIds`), and
  `count` reverts to the subtree material count.
- **Pagination is unchanged** — `catalog.controller.ts` `paginateCategories` still windows
  the top-level category `list` and appends `pagination`; category-name search unchanged.
- `tests` tab was not affected by the original change and is untouched.

## 2026-07-07 — catalog listing pagination + search (response-shape change)

Broad pagination/search rollout across already-SQL catalog/commerce listing endpoints
(commit `daf59f6`). No schema/index changes; **query shape and response envelope changed**
— flag for regression QA. All changes are on the MySQL/Prisma path.

- **`catalog-course.service.ts` → `listCourseCategoriesWithCounts`**: signature was
  `(): Promise<CourseSubjectCategoryWithCountDto[]>` (bare array, all active categories).
  Now `(opts:{search?,skip?,limit?}) => { data, total }`. New `repo.paginateActiveCategories`
  runs `Promise.all([findMany({where,skip,take}), count({where})])` over an identical
  `where` (`status:true` + optional `title:{contains:search}`); per-page course counts
  only. Default `take=20`.
- **`client-catalog.service.ts` → `catalogVideos` / `catalogMaterials`**: per-category
  child arrays (`list` of video docs, `materials` of shaped docs) **removed** (perf). `count`
  is now context-dependent — a directory node reports its direct child-folder count; a leaf
  reports the item count across its subtree. `totals` still tracks the true item count.
- **`catalog.controller.ts`**: the `/client/catalog/:type/:id/{videos,materials,tests}`
  responses now slice the top-level category `list` via `parseListQuery`/`buildPagination`
  and add a `pagination` object; `totals` unchanged.
- Same pagination/search pattern extended to catalog-ebook, package, trending (books/ebooks),
  lecture-progress course-resume, and the admin testSeries list.

## 2026-07-07 — admin Live-Course subscriptions → shared Reports contract

`GET /api/v1/admin/live-courses/subscriptions` (+ `/:id/subscriptions` variant)
(`admin-live-course.service.ts` → `listSubscriptions`) now mirrors the Course/Package
report contract (docs/REPORTS_SUBSCRIPTIONS_ADMIN.md), using the shared `reportFilters`
helpers. `get`/`grant`/`update`/`delete` handlers and `hydrateSubs` are unchanged.

Query-level changes on `ws_live_course_subscription`:
- **status** filter changed semantics: was raw boolean (`status=true|false`); now
  normalized `active|expired|inactive` via `statusWhere` (status bool + `endAt` vs now).
- Dropped filters: `planId`, `paymentStatus` (not part of the shared contract).
- New filters: `paymentMethod` (`online` → `razorpay_order_id IS NOT NULL`, `backend` →
  `IS NULL`), `dateFrom/dateTo` (`createdAt` range), `search` (customer fullName / phone /
  **emailAddress** via `customerIdsByText` id-resolver → `OR { customerId: { in } }`),
  `sortBy` (`createdAt|startAt|endAt|amount→paidAmount`), `sortOrder`. OR-bearing fragments
  (search OR + status "active" OR) combined via `andWhere` (single AND) — never spread.
- New aggregation: `aggregate({ _count._all, _sum.paidAmount })` for `summary.totalCount` /
  `totalRevenue`; two extra `count()` calls for `activeCount` / `expiredCount` over the
  filtered where. amount/revenue = `Number(paid_amount)` (rupees, no paise). Response
  envelope changed to hand-rolled `{ success, summary, data, pagination }` (was
  `success(){ subscriptions, total, page, limit }`). Row shaped via `reportRow`
  (`product.type = "liveCourse"`, plan from `ws_live_course_plan`). No schema/index change.

## 2026-07-07 — admin Test-Series subscriptions → shared Reports contract

`GET /api/v1/admin/test-series/subscriptions` (`admin-testseries.service.ts` →
`listSubscriptions`) now mirrors the Course/Package report contract
(docs/REPORTS_SUBSCRIPTIONS_ADMIN.md), using the shared `reportFilters` helpers.

Query-level changes on `ws_test_series_subscription`:
- **status** filter changed semantics: was raw boolean (`status=true|false`); now
  normalized `active|expired|inactive` via `statusWhere` (status bool + `endAt` vs now).
- New filters: `paymentMethod` (→ `paymentType` col `online|backend`), `dateFrom/dateTo`
  (`createdAt` range), `search` (customer fullName/phone/**emailAddress** + testSeries
  `title` via id-resolvers → `OR { in }`), `sortBy` (`createdAt|startAt|endAt|amount→price`),
  `sortOrder`. All OR-bearing fragments combined via `andWhere` (single AND).
- New aggregation: `aggregate({ _count._all, _sum.price })` for `summary.totalCount` /
  `totalRevenue`; two extra `count()` calls for `activeCount` / `expiredCount` over the
  filtered where. Revenue = `Number(price)` (rupees, no paise). Response envelope changed
  to hand-rolled `{ success, summary, data, pagination }` (was `success(){data,total}`).
  Row now hydrates `plan` from `ws_test_series_price` and `product.image` from
  `ws_test_series.thumbnail`. No schema/index change.

## 2026-07-07 — client API search + pagination sweep, BATCH 2 (free / categories / content)

Continues the standing rule (every client LIST endpoint gets `?search=` + `?page=&limit=`
via `parseListQuery`/`buildPagination`). Batch 2 domains: categories, material, exam,
examCountdown (free tier was already covered in Batch 1).

**Endpoints newly given pagination (search added where noted):**
- **categories:** the 3 category-children drill-downs now emit a `pagination` envelope and
  push `skip`/`take` + `count()` into the child queries for `ws_video_category`,
  `ws_material_category`, `ws_exam_category` (`listVideoCategoryChildren`,
  `listMaterialCategoryChildren`, `listExamCategoryChildren`). The other 9 endpoints already
  had search + pagination. (This controller uses its local `parsePaging`, cap 500 — kept for
  consistency with its siblings; envelope shape identical.)
- **material:** `/categories/:id/contents` (paginates the leaf `materials` array; child
  folders/breadcrumbs/current kept intact) and `/recent` (paginates the recent list, keeps
  `?days=`). Search on material `name`. Prisma stays in the service (module has no repo file).
- **exam:** `/categories/:id/exams` (slice `exams`, keep subjects/completedTests summaries),
  `/daily` (paginate only the leaf `tests` level; aggregate year/month/week rollups stay
  whole), `/my/attempts` + `/my/past-daily` (converted to `parseListQuery`, search on
  `Exam.name`), `/:id/attempts` (pagination only — attempts have no searchable title).
  `/categories` already had it. No Zod query schema governs these GETs, so nothing was stripped.
- **examCountdown:** `/upcoming` (was limit 5, no search → now search + pagination, default 20),
  `/` standardized onto `parseListQuery` (now caps at 100). `/categories` already had it.

**Contract note:** `pagination` additive; item fields unchanged; every `count()` shares the
`findMany` where; mixed/summary structures paginate only their primary collection and leave
rollups page-independent.
**FE heads-up:** `examCountdown/upcoming` default page size 5→20 (cap 20→100); other feeds
standardized to the 20/100 convention.

## 2026-07-07 — Admin Reports: shared filter + summary contract on subscription lists (Course/Package + shared util)

New shared read contract across four admin subscription LIST endpoints — see
`docs/REPORTS_SUBSCRIPTIONS_ADMIN.md`. No schema change; adds query filters + an
aggregate summary block over already-SQL tables.

- **Shared helper (new):** `src/utils/reportFilters.ts` — `dateWhere` (createdAt range),
  `statusWhere`/`normalizeStatus` (normalized active|expired|inactive from `status` bool +
  `endAt`), `andWhere` (nests independent OR-bearing fragments under AND — needed because
  "active" and the search-id OR both emit `OR`), `reportRow` (canonical row DTO).
- **Course/Package** (`admin-subscription`): query changed — `buildSubWhere` now filters
  `payment_type` (paymentMethod) and drops the raw-boolean status (status normalized in the
  service); new `aggCourseSubs` (`_sum.amount`,`_count`) + two `countSubs` for active/expired.
  Response envelope changed to `{ success, summary:{totalCount,totalRevenue,activeCount,
  expiredCount}, data, pagination }`; rows normalized (`customer/product/plan/amount/
  paymentMethod/status/startAt/endAt/createdAt`). ⚠ BREAKING response-shape change for this
  list endpoint (was `{ success, items, pagination }`).
- **Test Series** (`admin-testseries`) + **Live Course** (`admin-live-course`): DONE — see the
  two dedicated entries above.

All four endpoints now share the contract. Full cross-module `yarn typecheck` green.

---

## 2026-07-07 — ws_material.is_paid: backfill to 1 + default 0→1

**Type:** data backfill + column-default change. Materials are now PAID by default.

- **Backfill:** `UPDATE ws_material SET is_paid = 1` — all 226 existing rows (were all 0) → 1.
- **Default:** `ALTER TABLE ws_material ALTER COLUMN is_paid SET DEFAULT 1`; hand-edited
  `prisma/schema.prisma` `Material.isPaid` → `@default(true)` + `prisma:generate`.
  New materials are paid unless explicitly created free.

DDL: `docs/migration/schema-changes/2026-07-07_material_is_paid_default.sql` (applied
via `yarn db:migrate`; idempotent). Verified: default=1, all rows is_paid=1.

---

## 2026-07-07 — backfill ws_package smart/planner flags from package_type_id

**Type:** one-time DATA backfill (no schema change — `is_smart_course` /
`is_planner_course` columns already existed and are admin-editable).

**Rule:** `package_type_id = 1` (Recorded Course) → `is_smart_course = 1`;
`package_type_id = 4` (Planner Course) → `is_planner_course = 1`. Seeds historical
rows only; flags remain a **manual admin toggle** on create/update (no write-path
change). DDL file: `docs/migration/schema-changes/2026-07-07_package_smart_planner_backfill.sql`
(applied via `yarn db:migrate`; idempotent). Verified: 4 type-1 packages → smart=1.

---

## 2026-07-07 — client API search + pagination sweep, BATCH 1 (commerce)

**Standing rule:** every client-side LIST endpoint must support `?search=` + `?page=&limit=`
(pagination envelope). Backfilling all client list endpoints in batches. Uses shared
`parseListQuery` / `buildPagination` (`src/utils/listQuery.ts`; default limit 20, cap 100).

**Batch 1 domains:** book, course, package, testSeries, live-course, free.

**Endpoints newly given pagination (and search where it was missing):**
- **book:** `/trending`, `/trending/books`, `/trending/ebooks` (search pre-existed; added
  pagination). `/` and `/orders` already had it. `/orders` has no natural text column → no
  search added.
- **course:** `/categories`, `/my` (added search + pagination). `/` and
  `/categories/:id/courses` already had it (default limit 10 kept).
- **package:** `/types`, `/type/:typeId`, `/goal` (kept goalIds grouping), `/my` (added).
  `/` already had it (cap 500 kept).
- **testSeries:** `/my/subscriptions`, `/:id/papers` (added search + pagination); `/`
  standardized onto `parseListQuery`.
- **live-course:** all 10 feeds standardized onto `parseListQuery` + `pagination`; search
  added to `/recently-added`, `/my`, `/my/upcoming-sessions`, `/upcoming-sessions`,
  `/live-now-sessions`, `/:id/sessions`, `/:id/recordings` (folders), `/:id/session-recordings`.
- **free:** `/free-videos/resume` (added search + pagination); the other 5 already had it.

**Contract note:** `pagination` is ADDITIVE — item fields unchanged; where handlers use the
`success()` envelope it's nested under `data`, where they hand-roll `res.json` it's top-level.
Every `count()` uses the identical `where` as its `findMany`. In-memory/merged feeds
(book trending, package /my, live-course /my + /:id/recordings, free resume) slice the
resolved array with `total` = full filtered length.
**FE heads-up:** default page size standardized to 20 on some feeds that previously
returned more (live-course `/recently-added` was 10; session feeds were 50) and on
carousels (`/recently-added`, `/upcoming-batches`) — pass an explicit `limit` for the full set.

## 2026-07-07 — catalog materials & tests: drop bulky list + context-aware `count`

Same optimisation as the videos tab, applied to `catalogMaterials` and `catalogTests`
in `client-catalog.service.ts` (`GET /client/catalog/:type/:id/materials` and `/tests`).

**Materials (`catalogMaterials`) — was bulky:**
- **Removed** the per-category `materials[]` array. Dropped the `prisma.material.findMany`
  fetch of every category's direct materials, the cross-category `getPurchasedMaterialIds`
  ownership resolution, and the `shapeMaterialDoc` mapping (helper now unused, left defined).
- `category.count` is now context-dependent: `havingChildDirectory === true` → direct
  child-folder count; else → material count over the subtree (`prisma.material.count`).
- `totals.items` unchanged — still the true material count (tracked via internal
  `_itemCount`, stripped from the response).

**Tests (`catalogTests`) — already had no per-exam list:**
- Only `count` semantics changed: `havingChildDirectory === true` → child-folder count;
  else → exam subtree count. `totals.items` preserved via `_itemCount`.

**Unchanged for both:** `parent`, `totals` shape, category pagination, `?search=`
(category-name filter). No schema/index change. `yarn typecheck` green.

---

## 2026-07-07 — catalog videos: drop per-category video list + context-aware `count`

**Endpoint:** `GET /api/v1/client/catalog/:type/:id/videos` (`getCatalogVideos` →
`client-catalog.service.catalogVideos`).

**Change (query-level, already-SQL module):**
1. The per-category `list` of video cards is **no longer returned**. Each entry in the
   response `data.list` is now just `{ category: {...} }` (no nested `list`). The
   `prisma.video.findMany` fetch and the `lectureProgress` progress lookup per category
   were removed; `defaultListingQualities`/`recordings`/`progress` no longer computed here.
2. `category.count` is now **context-dependent**:
   - `havingChildDirectory === false` (leaf) → `count` = video count over the category
     subtree (`prisma.video.count`, unchanged query).
   - `havingChildDirectory === true` (directory) → `count` = direct child-folder count
     (`prisma.videoCategoryRelation.count({ where: { parent } })`).
   Previously `count` was always the subtree video count.

**Unchanged:** `parent`, `availableCategories`, `totals` (`categories`/`items`),
category pagination, `?search=`/`?categoryIds=` handling. No schema/index change.
`yarn typecheck` green.

---

## 2026-07-07 — read-only session (no DB/code change)

Session answered a question about the response shape of
`GET /api/v1/client/catalog/:type/:id/videos` (`getCatalogVideos` →
`client-catalog.service.catalogVideos`). **No source, schema, query, or index changes
were made.** Entry recorded only to satisfy the migration-doc mtime gate; no backfill or
regression QA is implied. The other modified `src/` files in the working tree predate
this session and are unrelated to it.

---

## 2026-07-07 — harden remaining bare `isObjectId` client helpers (defense-in-depth)

**Context:** Full audit of all 24-hex ObjectId validators after the exam-download bug.
No further *active* rejections found, but three client controllers still defined a bare
`isObjectId` (`/^[a-fA-F0-9]{24}$/`) that was safe only because every current call site
manually added a `|| integer` fallback — the exact latent trap that produced the exam bug
when one call site omitted the fallback.

**Change:** Made the helpers themselves integer-tolerant
(`/^([a-fA-F0-9]{24}|[1-9]\d*)$/`) so future call sites can't reintroduce the 400:
- `src/client/ebook/ebook.controller.ts:21`
- `src/client/course/course.controller.ts:24`
- `src/client/promocode/promocode.controller.ts:10`

Behavior-neutral at existing call sites (broadening acceptance only). No query/schema
change. `yarn typecheck` green.

**Audit result:** ObjectId-validator family is now fully int-tolerant across admin +
client. Remaining `{24}` occurrences are either already-tolerant, integer-parser gates
(`parse*Id` → number|null, correct for SQL), or `utils/metrics.ts` path-label
normalization (non-validation, intentionally left).

---

## 2026-07-07 — exam solution download: relax ObjectId gate (post-migration bugfix)

**Symptom:** `GET /client/quizzes/:id/solution/download?attemptId=…` (a.k.a.
`/client/exams/:id/solution/download`) returned `400 { "Please select valid exam!!" }`
for a MySQL integer `examId` like `11776`.

**Cause:** `getSolutionDownloadByExam` gated `examId` through the controller-local
`isObjectId` helper (`/^[a-fA-F0-9]{24}$/`) as a hard reject — the one client `isObjectId`
gate without an integer fallback (siblings in ebook/course/promocode controllers already
pair it with an int check).

**Change:** `src/client/exam/exam.controller.ts:34` — relaxed `isObjectId` to
`/^([a-fA-F0-9]{24}|[1-9]\d*)$/` (accepts MySQL int or legacy ObjectId). Validation only;
no query/schema change. `yarn typecheck` green.

---

## 2026-07-07 — relax strict ObjectId regexes in request validation (post-migration bugfix)

**Symptom:** `PUT /admin/cms/banners/50` returned `422 { keyId must be a valid ObjectId }`.
After the Mongo→MySQL cutover all IDs are MySQL positive integers, but many Zod
validators still rejected anything not matching a 24-hex Mongo ObjectId
(`/^[0-9a-fA-F]{24}$/`), failing before the (already-SQL) controller ran.

**Change:** Relaxed request-ID validators to a migration-tolerant regex accepting a
MySQL int **or** legacy ObjectId — `/^([0-9a-fA-F]{24}|[1-9]\d*)$/` (kept `z.string()`
type; no downstream type change). No DB query/schema/index change — validation layer only.

**Files:** `src/admin/cms/cms.validation.ts` (banner keyId/liveCourseId + FAQ/social-link
typeId; added shared `refIdRegex`); admin `video`, `ebook`, `course`, `testSeries`,
`permissionCategory`, `customer-master`, `master`, `book`, `videoCategory`,
`administrator`, `live-course` (validation + folder/video controllers), `permission`,
`material`, `offline`, `customer` validations; client `course`, `exam`, `address`
validations; `src/deeplinking/deeplinking.routes.ts` (kept `i` flag).

**Left intact:** `isObjectId` branch-detection helpers in controllers, `utils/metrics.ts`
path-label normalization, and already-tolerant regexes. `yarn typecheck` green.

---

## 2026-07-07 — client/catalog tabs (videos/materials/tests): add pagination

**Files:** `src/client/catalog/catalog.controller.ts` (new `paginateCategories`
helper; all three handlers now window the returned category `list` and add
`data.pagination`).

**Change:** `GET /api/v1/client/catalog/:type/:id/{videos,materials,tests}` already
supported `?search=`; they now also accept `?page=&limit=` (via `parseListQuery`,
default 20 / cap 100) and window the top-level category `list`. `totals` is unchanged
(still the full category/item counts); `data.pagination = { total, page, limit,
totalPages }` where `total` = full category count. Service queries (`catalogVideos/
Materials/Tests`) are unchanged — the slice happens in the controller, so per-category
hydration still runs for the full set before windowing. **Response-shape change** (new
`data.pagination`), done on explicit request. `availableCategories` (videos) unchanged.

## 2026-07-07 — client/ebooks catalog listing: add pagination

**Files:** `src/modules/catalog-ebook/catalog-ebook.repository.ts` (shared `activeWhere`
helper; `listActive` gains `skip`/`take`; new `countActive`),
`catalog-ebook.service.ts` (`listEbooksWithPlans` now runs `listActive` + `countActive`
in parallel and returns `{ ebooks, total }` instead of a bare array),
`catalog-ebook.types.ts` (`ListEbooksOptions` gains `skip`/`take`),
`src/client/ebook/ebook.controller.ts` (`listEbooks` threads `skip`/`limit` and returns
a `pagination` envelope).

**Change:** `GET /api/v1/client/ebooks` previously parsed `page/limit/skip` but dropped
them — `findMany` returned ALL active rows with no `pagination` field. Now the query is
windowed with Prisma `skip`/`take` and a `count(*)` over the identical WHERE supplies the
total, so the response gains `pagination: { total, page, limit, totalPages }` — matching
the already-paginated `/ebooks/subscriptions` endpoint. **Response-shape change** (new
top-level `pagination` key + `data.ebooks` now a single page), done on explicit request.
Search + language filters unchanged. Default limit 20, capped 100 (via `parseListQuery`).

**Files:** `src/libs/core/generate.ts` (new `loadLiveCourseReceiptFromMysql` +
`buildLiveCourseReceiptHtml`, `loadTestSeriesReceiptFromMysql` + `buildTestSeriesReceiptHtml`,
extracted shared `renderReceiptHtml`), `src/client/course/course.controller.ts`
(`getOrderInvoiceHandler` prefix dispatch).

**What changed:** `GET /client/courses/orders/:id/invoice` returns a Puppeteer-rendered
**PDF** and was course/package-only — it rejected `lc_`/`ts_` ids with 400. It now accepts
the same `lc_` (live-course) / `ts_` (test-series) prefixes the purchase-history subscriptions
list emits, strips the prefix, and dispatches to a matching receipt builder (unprefixed =
course/package, unchanged). All three share the same EJS invoice template + `CourseReceiptData`
shape via the new `renderReceiptHtml` helper.

**Query-level:** live loader reads `liveCourseSubscription` (paidAmount/originalAmount,
razorpay ids inline, `paymentStatus`), + `liveCourse.name`, + `liveCoursePlan.duration` (DAYS),
+ `customer` (fetched separately — no relation). Test-series loader reads
`testSeriesSubscription` (price, planId, orderId), + `testSeries.title`, +
`testSeriesPrice.duration_days`, + razorpay ids/method via the `testSeriesOrder` hop, +
`customer`. Both re-validate ownership (`id` + `customerId`); live throws "not paid" unless
verified/has razorpay id. Additive/non-breaking. No schema/index change.

---

## 2026-07-06 — purchase-history/subscriptions: union in test-series subs (+ receipt)

**Files:** `src/modules/client-purchase-history/client-purchase-history.repository.ts`,
`.../client-purchase-history.service.ts` (`listSubscriptions`, new `getTestSeriesReceiptMysql`),
`src/client/purchase-history/receipts.controller.ts` (`getCourseReceipt` dispatch).

**What changed:** `GET /client/purchase-history/subscriptions` previously unioned only
`ws_package_course_subscription` + `ws_live_course_subscription`. It now also unions
`ws_test_series_subscription` (standalone test-series purchases). Each test-series row:
`kind:"test-series"`, `badge:"Test Series"`, title/thumbnail from `ws_test_series`,
`amount` from the subscription `price`, `_id`/`receiptUrl` carry a **`ts_` prefix** (like
live's `lc_`) so the shared `/subscriptions/:id/receipt` route disambiguates the PK space.

**Query-level:** two new reads unioned into the tab —
`testSeriesSubscription.findMany({ customerId, status:true }, take: skip+take)` +
`testSeriesSubscription.count({ customerId, status:true })` (status=true = "purchased",
same active-sub convention as the package tab). `grandTotal` and the over-fetch/merge-by-
purchasedAt/slice pagination now span all three tables, so `total`/`totalPages` are correct.
Titles via `testSeries.findMany` (id,title,thumbnail). New `getTestSeriesReceiptMysql`
resolves duration via `ws_test_series_price.duration_days` and razorpay ids/method via the
`ws_test_series_order` hop (subscription has no razorpay cols); controller routes `ts_`-prefixed
ids to it. Additive/non-breaking — existing package/live rows unchanged. No schema/index change.

---

## 2026-07-06 — admin dashboard: add Test Series + Live Course (all sections)

**Files:** `src/modules/admin-dashboard/admin-dashboard.service.ts`,
`.../admin-dashboard.transformer.ts`, `src/admin/dashboard/dashboard.controller.ts`,
`src/modules/test-series-order/test-series-order.service.ts`.

**What:** `GET /admin/dashboard` now surfaces test-series and live-course across every
section — order-report cards, summary counts, recent lists, and the totals chart.

**New reads:**
- Revenue/count per window: `ws_test_series_subscription` SUM(`price`) (no status
  filter — rows are created only on verify, so all are paid) and
  `ws_live_course_subscription` SUM(`paid_amount`) WHERE `payment_status='verified'`
  (single-table has pending + folded rows; only verified is real money). Both for
  current + previous windows (deltaPct) and the total window.
- Time-series buckets added for both tables (`seriesFor`), same HOUR()/DAYOFMONTH() IST
  grouping; live-course restricted to `payment_status='verified'`.
- Catalog counts: `ws_test_series` WHERE status=true, `ws_live_course` WHERE status=true.
- Recent lists (`recentTestSeriesSubscriptions` / `recentLiveCourseSubscriptions`),
  newest-first, `take=recentLimit`. These two subscription models carry only scalar FKs
  (NO Prisma relations), so customer + catalog refs are batch-loaded by id and populated
  in the transformer (mirrors the book-order item population). `ws_test_series` exposes
  `title`/`thumbnail` → mapped to the DTO's `name`/`image`.

**Totals decision:** `totalOrders`/`totalEarnings` (Total Order Reports chart) now FOLD
IN test-series + live-course so the aggregate stays consistent with the per-category
cards. "Course" bucket is unchanged = `ws_package_course_subscription` with
`course_id IS NOT NULL` (recorded courses only); live courses are a separate table, so
no double-counting.

**Write fix (data visibility):** `testSeriesSubscription.create` in the verify tx did
not set `created_at` (introspected legacy column, no DB default) → rows were invisible
to created_at-windowed reads. Now sets `createdAt`/`updatedAt = now` (live-course create
already did). Optional backfill for pre-fix rows:
`UPDATE ws_test_series_subscription SET created_at = start_at WHERE created_at IS NULL AND start_at IS NOT NULL;`

**Contract:** existing dashboard fields unchanged; all additions are additive. Verified
end-to-end against MySQL (live-course revenue 518/2, populated recent refs, catalog counts).

---

## 2026-07-06 — admin package validation: empty-string optional id → null (pcMaterialId)

**File:** `src/admin/package/package.validation.ts`.

**Bug — create/update package failed with `pcMaterialId: "Invalid id"`.** `createPackageSchema`/
`updatePackageSchema` validated `pcMaterialId` via `optRegexIdString`, whose preprocess only
coerced `number → string`. The admin form sends `pcMaterialId: ""` when no physical-material kit
is selected; empty string is neither null nor undefined, so it reached `z.string().regex(idRegex)`
and was rejected as "Invalid id" — even though the field means "null detaches". (Surfaced as a save
failure on the package edit screen; `GET /:id` does no validation.)

**Fix (input coercion only, no DB/query/schema change):** added a shared `toOptIdString` preprocess
that maps `""` and `null` → `null` for both optional-id helpers (`optIdString`, `optRegexIdString`).
Mirrors the pattern already in `course.validation.ts`. Behavior: `""`/`null`/absent accepted (detach /
no-op), valid numeric & 24-hex ids pass, invalid strings still rejected; on `.partial()` update an
omitted `pcMaterialId` stays absent (no accidental detach). Side benefit: the other optional ids
(`packageTypeId`, `goalId`, `goalLabelId`, `packageCategoryId`, `educatorId`) now store `null` instead
of `""` when cleared.

---

## 2026-07-06 — admin dashboard: populate recent-list refs (SQL rows → Mongo-shaped DTO)

**Files:** `src/modules/admin-dashboard/admin-dashboard.service.ts`,
`src/modules/admin-dashboard/admin-dashboard.transformer.ts` (new).

**Bug — `GET /admin/dashboard` recent lists rendered blank.** The service returned raw
Prisma rows straight through the controller, so the shapes never matched the admin UI's
expected populate() contract: relation objects came back under generated names
(`package`/`course`/`customer`/`eBook`), amounts under `amount`/`price`, ids as `id`, and
book orders exposed the raw `order_items` JSON instead of `items[]`. Result:
`targetPackageId`/`customerId` null, `paidAmount` 0, blank book titles.

**Fix (read-only reshape, no schema/DDL change):**
- New transformer maps each recent row to the stable DTO:
  `recentPackageSubscriptions[]` → `{ _id, paidAmount (=amount), createdAt, customerId{_id,firstName,lastName,phoneNumber}, targetPackageId{_id,name,image} }`;
  `recentCourseSubscriptions[]` → same with `courseId`;
  `recentEbookSubscriptions[]` → `paidAmount` from `price`, `ebookId{_id,name,image}`.
  Customer `full_name` split into firstName/lastName via shared `splitFullName`.
- `recentBookOrders[].items[]`: line items resolved child-rows-first
  (`ws_book_order_item`), falling back to the `order_items` JSON snapshot (mirrors
  admin-book `getOrder`); referenced books batch-loaded to populate
  `items[].bookId{_id,name,image}`.

**New queries:** `bookOrderItem.findMany({ where: { order_id: { in: recentReceiptIds } } })`
and `book.findMany({ where: { id: { in: bookIds } } })` — both bounded by the recent-list
limit (≤25). Added `image` to the existing `eBookSubscription` include's `eBook` select.
No index/schema change.

---

## 2026-07-06 — subscriptions: set created_at on write + PDF receipt __awaiter fix

**Files:** `src/modules/commerce-order/commerce-order.repository.ts`
(`verifyPackageTx`, `verifyCourseTx` — both fresh-grant `packageCourseSubscription.create`),
`src/modules/client-purchase-history/client-purchase-history.service.ts` (`listSubscriptions`),
`src/libs/core/generate.ts` (`renderPdfFromHtml`).

**Bug 1 — purchase-history `purchasedAt` (and dates) null.** `ws_package_course_subscription.created_at`
is an introspected legacy column with NO DB default and NO Prisma `@default(now())`,
and the two fresh-grant `create` calls never set it → every SQL-created subscription
landed with `created_at = NULL`, so the subscriptions tab showed `purchasedAt: null`.
- **Write fix:** both `create` calls now set `createdAt`/`updatedAt` = `input.now`.
- **Read fix (covers existing null rows):** `listSubscriptions` falls back
  `purchasedAt = created_at ?? start_at ?? null` (start_at is always set on a fresh grant).
- **Backfill (optional, for pre-fix rows):**
  `UPDATE ws_package_course_subscription SET created_at = start_at WHERE created_at IS NULL AND start_at IS NOT NULL;`

**Bug 2 — "__awaiter is not defined" when downloading receipts.** `renderPdfFromHtml`
passed an `async () => { await … }` callback to Puppeteer `page.evaluate`. With
tsconfig `target: es2016` (< ES2017), tsc downlevels async/await into the `__awaiter`
helper; the callback is `.toString()`-serialized and run inside Chromium, where
`__awaiter` does not exist → ReferenceError at PDF time. Fixed by making the callback
non-async and returning the Promise directly (`() => Promise.race([...])`) so no helper
is injected into the browser-side code. **No query change** — behavioral/build fix.

Same read-side `created_at ?? start_at` fallback also applied to the live-course rows
in `listSubscriptions` for parity (live-course writes already set `created_at`).

**Deploy note:** prod runs compiled `dist/` (CommonJS, `pm2 dist/index.js`). Both fixes
require a fresh `yarn build` + restart; the local `dist/` was stale (rebuilt here).

---

## 2026-07-06 — purchase-history subscriptions tab: union live-course subs + live receipt

**Files:** `src/modules/client-purchase-history/client-purchase-history.repository.ts`,
`.../client-purchase-history.service.ts` (`listSubscriptions`, new `getLiveCourseReceiptMysql`),
`src/client/purchase-history/receipts.controller.ts` (`getCourseReceipt`).

**Problem:** Live-course purchases live in `ws_live_course_subscription` (single-table
design — payment + entitlement inline), NOT `ws_package_course_subscription`. The
`GET /client/purchase-history/subscriptions` list and the `/subscriptions/:id/receipt`
endpoint only read the package table, so live courses never appeared and had no receipt.

**Query changes:**
- New reads on `ws_live_course_subscription` filtered by `payment_status = "verified"`
  (`listLiveSubscriptions` / `countLiveSubscriptions`) — the live-course "purchased"
  contract (pending rows are unpaid). Mirrors the package tab's `status=true` filter.
- `listSubscriptions` now UNIONS both tables: each over-fetched to `skip+take`, merged
  by `purchasedAt` desc, then sliced (correct pagination when top rows favor one table).
  `total` = `countSubscriptions + countLiveSubscriptions`.
- Live rows emit an `lc_`-prefixed `_id` / `receiptUrl` so `/subscriptions/:id/receipt`
  disambiguates the two integer PK spaces. Controller routes `lc_<id>` →
  `getLiveCourseReceiptMysql`, plain `<id>` → `getCourseReceiptMysql` (unchanged).
- New receipt kind `"live-course"`. Full payment parity (razorpay ids, paidAt,
  original/discount/paid split) since the single-table carries these inline.

**Contract:** existing course/package rows and receipts unchanged; live-course rows are
additive. No schema/DDL change (reads over an already-migrated table).

---

## 2026-07-06 — admin live-sessions list: server-side ?search= + tri-state upcoming split

**Files:** `src/admin/live/live.controller.ts` (`listLiveSessions`),
`src/modules/admin-live/admin-live.service.ts` (`ListInput` + `listSessions`).

**Search:** `GET /api/v1/admin/live-sessions` accepts `?search=` and filters server-side on
`title` + `streamId` (contains, case-insensitive via the MySQL column collation
utf8mb4_*_ci — Prisma's `mode:"insensitive"` is Postgres-only).

**Tri-state `upcoming` (SCHEDULED sub-tabs):** the controller no longer collapses
`upcoming` to a boolean (which merged `false` with absent). Now:
- `upcoming=true` → `status=SCHEDULED AND scheduledAt > now` ("Scheduled" / future).
- `upcoming=false` → `status=SCHEDULED AND (scheduledAt <= now OR scheduledAt IS NULL)`
  ("To start" / due / go-live-now). (Was previously unhandled → returned ALL scheduled,
  over-counting the tab.) Changed `>=` to `>` so the two subsets partition cleanly.
- `upcoming` omitted → all SCHEDULED (unchanged).

**Query composition:** multiple OR-groups (the `upcoming=false` scheduledAt-or-null group and
the search title/streamId group) are now collected into `where.AND = [...]` instead of a single
`where.OR`, so they compose without clobbering each other. `count()` uses the same `where`, so
per-tab/per-status `total` reflects the fully filtered subset (status + upcoming + search) —
`Page X of Y` is accurate on every tab. Pagination (`page`/`limit`, `skip=(page-1)*limit`,
`take=limit`, response `{ sessions, total, page, limit }`) was already present and honored for
all statuses. Additive/non-breaking. No schema/index change.

---

## 2026-07-06 — live HLS playback security: NO code change (blocked on StreamOS capability)

**Files:** none (assessment only). Logged for traceability.

**Context:** live playback `hlsURL` from StreamOS `createStream` is unsigned/openly playable.
Confirmed we have NO signing layer (no CloudFront signing, no StreamOS secure-playback call;
the `txSecret`/`txTime` token is RTMP-PUSH-side only) and the playback CDN
(`liveclasses.cloud-front.in`) is StreamOS-owned, so we cannot sign it from our backend
alone. Decision: confirm StreamOS per-viewer live token-auth capability FIRST; only then
build an authenticated `GET /client/live-sessions/:id/playback` seam that mints a short-TTL
signed manifest URL (token must cover manifest + segments). No endpoint shipped yet — a
`/playback` returning the unsigned URL would be security theater. When implemented: new
mint secret → `config/env.ts` + `.env.example`; stop returning raw `hlsUrl` from
`getLiveSessionForClient`.

---

## 2026-07-06 — live sessions: POST /:id/provision (encoder creds before Go Live); start reuses provisioned stream

**Files:** `src/admin/live/live.controller.ts` (+`provisionLiveSession`, `startScheduledLiveSession`
reuse logic), `src/admin/live/live.routes.ts` (+`POST /:id/provision`). No schema/query change.

**What changed:** admins can now get rtmpUrl/hlsUrl/streamId on a SCHEDULED session BEFORE
going live (to configure OBS). New `POST /admin/live-sessions/:id/provision` creates the
StreamOS stream and persists `streamId/rtmpUrl/hlsUrl/hlsUrls` while the session STAYS
SCHEDULED (does NOT transition to CREATED). Idempotent — if already provisioned (has a
streamId) it returns the session as-is without creating a second StreamOS stream. Returns
the full session view (same shape as start). `POST /:id/start` now REUSES an
already-provisioned stream (only flips status → CREATED, keeping the rtmpUrl the admin
configured); it still provisions on the fly when unprovisioned, preserving "go live now".
Additive/non-breaking.

---

## 2026-07-06 — live-course recordings resolved via StreamOS get-vod-stream-meta (playable URLs)

**Files:** `src/admin/live/streamos.service.ts` (+`getVodStreamMeta`),
`src/modules/admin-live-course/admin-live-course.service.ts` (cached `resolveVodMeta`
+ wired into `getRecordingsForClient`). No schema/DDL change.

**What changed:** `GET /client/live-courses/:id/recordings` lecture URLs previously came
only from the stored webhook/`streamDetails` recordings, which aren't reliably playable.
We now resolve each recording's session `streamId` through StreamOS
`GET https://streamapi.streamos.co/get-vod-stream-meta?id=<streamId>&accessKey=…` (the API
ROOT, NOT under `/streamos`) → `{ data: { hls_url, meta:[{label,url,type}] } }`, split into
per-quality `hls` (m3u8) + `mp4` lists. Result is **Redis-cached per streamId**
(`vodmeta:<streamId>`, TTL 3600s). `shapeLecture` now prefers the VOD-resolved URLs and
**falls back to the stored recordings** when resolution is empty/unavailable (failure-isolated
per session). New additive lecture field **`hlsUrl`** = master adaptive playlist. `accessKey`
stays server-side — only resolved CDN URLs reach the client. Uses existing
`STREAMOS_ACCESS_KEY` (no new env var). Additive/non-breaking.

---

## 2026-07-06 — live chat: per-session chatEnabled + privateChat settings (new table ws_live_chat_setting)

**Schema:** `docs/migration/schema-changes/2026-07-06_live_chat_setting.sql` — new table
`ws_live_chat_setting` (id, `live_class_id` UNIQUE, `chat_enabled` TINYINT default 1,
`private_chat` TINYINT default 0, timestamps). `prisma/schema.prisma` gains model
`LiveChatSetting`.

**Files:** `src/modules/admin-live-course/admin-live-course.repository.ts`
(`chatSettingFor`, `upsertChatSetting`), `.../admin-live-course.service.ts`
(`getChatSettings`, `updateChatSettings`, `DEFAULT_CHAT_SETTINGS`),
`src/admin/livechat/livechat.controller.ts` (+`getChatSettings`/`updateChatSettings`),
`src/admin/livechat/livechat.routes.ts` (+GET/PATCH `/:liveClassId/settings`),
`src/socket/livechat.socket.ts` (emit `chat_settings` on join + enforce on `send_message`).

**What changed:** admin can toggle two per-session chat controls keyed by liveClassId.
- REST: `GET /admin/live-chat/:liveClassId/settings` → `{ settings:{chatEnabled,privateChat} }`
  (defaults `{true,false}` if no row); `PATCH` same path (partial body) upserts, emits
  `chat_settings` to the room, returns the full object.
- Socket: `chat_settings` `{chatEnabled,privateChat}` emitted to the joining socket on
  `join_live_chat` (immediate hydrate) and room-wide on PATCH.
- Enforcement (server-side, in the viewer `send_message` path): `chatEnabled=false` rejects
  viewer sends with `chat_disabled` (admins unaffected — REST path); `privateChat=true`
  persists the viewer message but delivers it only to the sender + admin sockets in the
  room (`emitPrivateViewerMessage`, cross-pod via the Redis adapter) instead of the public
  `new_message` fan-out. `socket.data.isAdmin` now stamped so cross-pod admin targeting works.

Additive/non-breaking: absent row = today's behavior (chat on, public). Read cost: one
extra indexed `findUnique` per viewer message (alongside the existing ban check).

**Deploy:** apply the CREATE TABLE before deploying. No backfill.

---

## 2026-07-06 — fix: poll_updated must use the { poll } envelope (re-vote broke)

**Files:** `src/socket/livechat.socket.ts` (`submit_vote` handler). No schema/query change.

**What changed:** the vote broadcast emitted BOTH `poll_update` and `poll_updated` with the
RAW poll object. The FE's `poll_updated` handler expects a `{ poll: {...} }` ENVELOPE (the
same shape the admin `updatePoll` controller emits), so it read `payload.poll` = undefined →
`poll.pollId` undefined → client couldn't re-vote (console showed `poll_updated {pollId:
undefined}`). Fixed: `poll_update` stays RAW (`r`), `poll_updated` now emits `{ poll: r }`.
Additive/non-breaking; contract now matches the existing updatePoll emit.

---

## 2026-07-06 — live socket: poll_update now carries the full poll object on each vote

**Files:** `src/modules/admin-live-course/admin-live-course.service.ts` (`submitPollVote`),
`src/socket/livechat.socket.ts` (`submit_vote` handler). No schema/DDL, no new query.

**What changed:** `submitPollVote` now returns the FULL fresh poll DTO (`toPollDto` via
`loadPollWithOptions`: `_id`, `liveClassId`, `question`, `options[{text,votes}]`,
`totalVotes`, `isActive`, …) instead of the partial `{ liveClassId, options, totalVotes }`.
On a successful vote the socket broadcasts that complete poll object to the `liveClassId`
room under BOTH `poll_update` and `poll_updated` (same payload) so the admin poll panel
re-renders exact tallies in place without a refresh. Query shape is unchanged (same
`findPoll` + `pollOptions` reads, re-read once post-vote). Additive/non-breaking:
`poll_created` / `poll_closed` / `poll_deleted` and `viewer_count` / `viewer_stats`
untouched. Payload field note: emits `_id` (string), not the old `pollId`.

---

## 2026-07-06 — live socket: viewer_stats event + ws_live_session_attendance.stream_id index

**Schema:** `docs/migration/schema-changes/2026-07-06_live_session_attendance_stream_index.sql`
— `ALTER TABLE ws_live_session_attendance ADD INDEX idx_lsa_stream (stream_id)`.
`prisma/schema.prisma` `LiveSessionAttendance` gains `@@index([streamId], map: "idx_lsa_stream")`.

**Files:** `src/modules/admin-live/admin-live.service.ts` (+`getViewerStatsCounts`),
`src/socket/livechat.socket.ts` (+`emitViewerStats`).

**What changed:** the live chat socket now emits a `viewer_stats` event to the
`liveClassId` room alongside the existing `viewer_count`, so the admin Viewers tab
(Active/Unique/Joins) updates in real time instead of relying on the one-shot REST
attendance summary. Payload `{ active, unique, joins }`: `active` = in-room viewer count
(same as `viewer_count.count`), `unique` = `COUNT(DISTINCT customer_id)`, `joins` =
`COUNT(*)` over `ws_live_session_attendance WHERE stream_id = <liveClassId>`
(`getViewerStatsCounts` — the count-only counterpart of getAttendance's summary).
Emitted at all four spots that already emit `viewer_count` (join, room-switch, leave,
disconnect); the join-time emit populates the panel immediately. Additive/non-breaking —
`viewer_count` is unchanged. New index keeps the per-presence-change count queries off a
full table scan (also benefits the REST getAttendance path).

---

## 2026-07-06 — my-subscriptions ?type=course now includes live-course subscriptions

**Files:** `src/modules/client-my-subscriptions/client-my-subscriptions.repository.ts`
(+`activeLiveCourseSubs`, `liveCoursesByIds`, `livePlansByIds`),
`src/modules/client-my-subscriptions/client-my-subscriptions.service.ts`
(+`buildLiveCourseCards`), `src/client/my-subscriptions/my-subscriptions.controller.ts`.

**What changed:** `GET /client/my-subscriptions?type=course` previously read only
`ws_package_course_subscription` (recorded course + package). Live-course purchases live in
a separate table `ws_live_course_subscription` and were never surfaced. The `course` tab now
ALSO reads `ws_live_course_subscription` (active = `status=1 AND payment_status='verified'
AND (end_at IS NULL OR end_at > now)` — note lifetime subs with `end_at NULL` are included,
`daysLeft=null`), builds cards, and merges them with course/package cards re-sorted
soonest-expiring-first (lifetime last). New card `action.kind = "live_course"` with
`action.liveCourseId`; `emptyAction` gains a `liveCourseId` field. No schema/DDL change
(read-only over an existing table).

**FE note:** the card envelope now emits a fifth `action.kind` — `"live_course"` — carrying
`action.liveCourseId`. The FE must route that kind to the live-course detail/player.

---

## 2026-07-06 — live sessions: per-course recording folder replaces subject; no auto-start; educatorId dropped

**Schema:** `docs/migration/schema-changes/2026-07-06_live_session_course_folder.sql`
— `ALTER TABLE ws_live_session_course ADD COLUMN folder_id INT NULL` (+ `idx_lsc_folder`).
`prisma/schema.prisma` `LiveSessionCourse` gains `folderId Int? @map("folder_id")`.
`ws_live_session.subject` and `ws_live_session.educator_id` are RETAINED (nullable) but
the app no longer writes/reads them.

**Files:** `src/modules/admin-live/admin-live.service.ts`,
`src/admin/live/live.controller.ts`, `src/admin/live-course/live-course.folder.controller.ts`,
`src/modules/admin-live-course/admin-live-course.service.ts`, `src/client/live/live.controller.ts`.

**What changed (admin "New live session" contract):**
1. **educatorId dropped** — removed from create/update validation and from the session
   serializer (`toPublicView` no longer emits `educatorId`). Column kept nullable; not written.
2. **Folder search** — `GET /admin/live-courses/:id/folders?search=` filters folders by
   `title contains` (case-insensitive, table CI collation). `lcListFolders(id, search?)`.
3. **Per-course folder selection replaces `subject`** — create/update now take
   `liveCourseFolders: [{ liveCourseId, folderId }]`. Each folderId is validated to belong
   to its liveCourseId (`ws_video_category.live_course_id` match) and persisted on
   `ws_live_session_course.folder_id`. Auto-promotion (`maybeAutoPromoteRecordingSql` in
   both admin-live and admin-live-course services) now files recordings into the CHOSEN
   folder per course instead of resolving/creating a `subjectKey`-named folder. `subject`
   is no longer read on create/update.
4. **Creating never auto-starts** — `POST /admin/live-sessions` now ALWAYS persists a
   SCHEDULED session (no StreamOS `createStream`), for both "schedule for later" and "go
   live now" (scheduledAt null). Going live is only via `POST /:id/start`, which no longer
   enforces the 2-minute start window and works for a SCHEDULED session at any time (even
   with scheduledAt null).

**Serializer additions:** `toPublicView` now emits `liveCourseFolders: [{liveCourseId,
folderId}]` (string ids).

**Deploy:** apply the ALTER before deploying. No backfill needed (folder_id defaults NULL;
legacy sessions keep subject-less auto-promote = skipped until re-saved with folders).

---

## 2026-07-06 — package-categories/:id/packages: per-tab search + pagination

**Files:** `src/modules/package-category/package-category.service.ts`
(`listPackagesAndLiveByCategory`), `src/client/categories/categories.controller.ts`
(`listPackagesByCategory`).

**What changed:** `GET /client/package-categories/:id/packages` returns two FE tabs
(`recorded` = packages, `live` = live courses). It previously loaded BOTH full lists
with no search or pagination. Now it accepts `?tab=recorded|live` (default `recorded`),
`?search=`, `?page=`, `?limit=` and pages/searches the active tab independently at the
DB level:
- Package tab filters `ws_package.name` (`contains`, case-insensitive) + `skip`/`take`
  over `order_by asc`.
- Live tab filters `ws_live_course.name` (`contains`) + `skip`/`take` over `ordered asc`.
- Two `count()` queries (both tabs, under the current search) drive the new
  `data.counts: { recorded, live }` tab badges. Only the active tab's list is populated;
  the other is `[]` (keys retained for contract). Response now also carries top-level
  `pagination` + `data.tab`.

**Migration/QA note:** additive — existing callers that ignore `tab` get the `recorded`
tab, page 1. FE must pass `tab=live` to page the live tab. No schema/DDL change.

---

## 2026-07-06 — live-courses/my: cards get educatorName + session progress (%, X of Y)

**Files:** `src/modules/admin-live-course/admin-live-course.service.ts`
(`listMyLiveCoursesForClient`), `src/modules/admin-live-course/admin-live-course.repository.ts`
(`coursesSlimByIds` now selects `educatorId`).

**What changed:** `GET /client/live-courses/my` cards previously carried no educator
label and no progress data — the mobile "My Courses" card needs "By <educator>", a
progress bar %, and "X of Y sessions completed". Each card now additionally returns:
- `liveCourse.educatorId` / `liveCourse.educatorName` (resolved from `ws_course_educator`).
- `progress: { completedSessions, totalSessions, percentCompleted }`.

**Query-level:** a "session" on this card = a recorded lecture (the unit progress
heartbeats drive), so numerator and denominator share one universe (ratio always <=100%).
For each subscribed live course we now run: folders = `videoCategory.findMany({ liveCourseId, status:true })`,
then `video.count({ status:true, videoCategoryId in folderIds })` (totalSessions — same
folder->video counting as getRecordingsForClient's totalLectures) and
`lectureProgress.count({ customerId, liveCourseId, completed:true, videoId: { not:null } })`
(completedSessions — completed VIDEO lectures in the container). `percentCompleted =
round(done/total*100)` clamped to 100, 0 when total is 0. Educator names via
`courseEducator.findMany` over the distinct `educatorId`s. `completedSessions` is populated
by the existing progress heartbeats (POST /client/courses/lectures/:videoId/progress with
scope.kind="liveCourse"), which flip a row to completed at >=95%. No schema/index change.
All fields additive — existing card fields unchanged.

---

## 2026-07-06 — package-categories/:id/packages: live cards get plans + daysLeft + isPurchased

**Files:** `src/modules/package-category/package-category.service.ts`
(`listPackagesAndLiveByCategory`), `src/client/categories/categories.controller.ts`
(`listPackagesByCategory`), `src/modules/admin-live-course/admin-live-course.service.ts`
(exported `plansGrouped` / `splitPlansByMaterial`).

**What changed:** `GET /client/package-categories/:id/packages` previously built each
`live[]` row via a stripped-down local `toCategoryLiveDto` that carried **no pricing
plans, no `daysLeft`, no `isPurchased`**. Now live rows reuse the canonical
`/client/live-courses` card contract (`admin-live-course.listClient`): full
`toCourseDto` + `plans` split into `{ withMaterial, withoutMaterial }` +
per-customer `daysLeft` / `isPurchased`.

**Query-level:** for the live courses in the category we now additionally run
`getDaysLeftMap(customerId, liveIds)` (active-sub scan on `ws_live_course_subscription`),
`getOwnedCourseIds(customerId)`, and `plansGrouped(liveIds)` (active plans on
`ws_live_course_plan`). `customerId` is threaded from the bearer token; when absent
`daysLeft`→null, `isPurchased`→false, plans still populate. No schema/index change.

**Contract note:** `live[]` shape is now a superset of the old one (all prior fields
retained; adds `subtitle`, `status`, category ids, schedule JSON, `plans`, `daysLeft`,
`isPurchased`). `recorded[]` unchanged.

---

## 2026-06-16 — Admin test-series/ebook customer populate: correct field names

**Files:** `src/admin/testSeries/testSeries.controller.ts` (listSubscriptions,
listOrders), `src/admin/ebook/ebook-subscription.controller.ts`
(getEbookSubscriptionById).

**Change:** these endpoints populated `customerId` with field names that DON'T
exist on the Customer schema — test-series used `name phone email`, the ebook
detail used `full_name mobile email`. Mongoose silently returns `{ _id }` only,
so the admin table fell back to showing a bare ObjectId. Corrected the `.select`
to the real fields `firstName middleName lastName phoneNumber emailAddress`. The
two test-series listings additionally shape the populated customer into
`{ _id, name, phone, email }` (name = joined name parts) to match the FE's
`name || phone || email || id` contract without an FE change. No DB change — pure
query `.select` / response-shape fix. Course/package/live-course/book/exam
listings already used the correct fields.

---

## 2026-06-16 — Wallet ("coin") deduction in payment flow

**Files:** new `src/client/referral/wallet-debit.ts` (validateCoin +
applyWalletDebit, mirrors credit-referrer.ts); 5 create-order controllers
(course, package, ebook, live-course, test-series payment) accept+validate+apply
`coin`; `src/client/payment/verify.controller.ts` + `webhook.controller.ts`
debit at fulfillment. Models gained `coinsUsed`: PackageCourseSubscription,
LiveCourseSubscription, EbookOrder, TestSeriesOrder.

**Behaviour:** create-order accepts optional `coin` (rupees, integer). Validated:
`0 ≤ coin ≤ min(floor(planPrice/2), customer.rewardPoints)` (400 with message on
fail). Razorpay charge = `planPrice − promoDiscount − coin` (test-series:
breakdown total − coin). `coinsUsed` persisted on the pending order/sub. At
/verify (and webhook for ebook/live) success, `applyWalletDebit` atomically
`$inc rewardPoints: -debit` + writes a ReferralTransaction (type:DEBIT). Idempotent
on (orderId, customerId, debit) — safe under verify/webhook double-fire. Deduct-
what's-available: if balance dropped since create-order, debits min(coin,balance)
and logs (never blocks provisioning — buyer already paid the reduced amount).

**Query changes:** new ReferralTransaction debit rows + Customer.rewardPoints
`$inc` decrements at verify. New reads: Customer.rewardPoints at create-order
(validation) and verify (debit). No schema migration / backfill (coinsUsed
defaults null). No new index.

---

## 2026-06-16 — Referral codes for live-course & test-series (schema + query)

**Files:** `src/models/customer/LiveCourseSubscription.model.ts`,
`src/models/testSeries/TestSeriesOrder.model.ts` (new schema fields);
`src/client/live-course/promo.ts` (new query); `src/client/payment/*.controller.ts`,
`src/client/payment/verify.controller.ts`, `src/client/webhook/webhook.controller.ts`,
`src/client/testSeries/testSeries.controller.ts` (callers); `src/client/referral/credit-referrer.ts`.

**Schema additions (need NO backfill — all default null):**
- `ws_live_course_subscriptions`: `referrerId` (ObjectId→Customer, default null),
  `customerPercentage` (Number, default null).
- `ws_test_series_orders`: `referrerId` (ObjectId→Customer, default null),
  `customerPercentage` (Number, default null).

**Query change:** `resolveLivePromo()` (shared by every plan-based payment path —
live-course, test-series, course, package, ebook) now, when a code matches no
active `PromoCode`, falls back to a referral lookup:
`Customer.findOne({ referralCode: <CODE>, isAccountDeleted:false, status:true })`
+ `ReferralProgram.findOne({ name:"student", status:true })`. On a match it returns
a referral-shaped result (`promo:null`, `referrerId` set) so live-course /
test-series checkout honours referral codes (50% buyer discount + 20% referrer
reward on purchase, credited via `creditReferrer` at /verify and the live-course
webhook). course/package/ebook **payment** create-order paths explicitly reject
referral codes (those redeem through `/orders`).

**Regression QA:** referral apply-promo + purchase for live-course and test-series;
confirm `creditReferrer` is idempotent (verify + webhook fire on same order id).

---

## 2026-06-16 — Lecture progress: free parent product bypasses subscription

**Files:** `src/client/course/progress.controller.ts` (reportLectureProgress —
all 3 scope branches).

**Change:** `POST /client/courses/lectures/:videoId/progress` previously required
an active subscription for any PAID video, even if the parent course/package/
liveCourse was free (isPaid:false). Now each scope branch loads the scoped
parent (already loaded `_id`; now also `isPaid`) and skips the subscription
check when `isFree || parent.isPaid === false`. Only a paid video inside a paid
parent still requires a subscription (existing 403). Parent-not-found 404s
unchanged. No extra query (the parent doc was already fetched in the free
branch; we just also select isPaid and apply it to the paid branch). No
schema/index/migration change.

---

## 2026-06-16 — Free-videos resume: scope to free-parent products (both row kinds)

**Files:** `src/client/free/freeProgress.controller.ts` (listFreeVideoResume +
`freeProductScope` helper, formerly freeProductCategoryIds).

**Rule:** `GET /client/free-videos/resume` now shows any watched video whose
PARENT product is free (Course/Package/LiveCourse isPaid:false) — and ONLY those.
Two fixes in one:
  1. (earlier bug) a `priceType:"free"` video watched inside a PAID product no
     longer leaks in — gated by the free-product category set.
  2. a PAID video inside a FREE parent (now allowed to save progress via the
     container heartbeat) DOES show — the `priceType:"free"` video filter was
     dropped.

**Query change:** row query broadened from `{source:"free"}` to
`$or: [ source:"free", courseId ∈ freeCourses, packageId ∈ freePackages,
liveCourseId ∈ freeLiveCourses ]` (container heartbeats stamp
courseId/packageId/liveCourseId with source=null, so source:"free" alone missed
them). Helper now also returns the free product-id sets. Video query drops
`priceType:"free"`; the free-category gate is the sole parent-is-free test. New
reads of free Course/LiveCourse/Package + category trees per call (bounded;
resume capped at 20 rows). No schema/index/migration change.

---

## 2026-06-16 — Promoter dashboards span all 5 products (union 4 sub collections)

**Files:** new `src/promoter/shared/promoterSubscriptions.ts` (union helper +
scope match); `src/promoter/dashboard/overview.service.ts`;
`src/promoter/dashboard/dashboard.controller.ts`;
`src/promoter/subscription/subscription.controller.ts`;
`src/promoter/promocode/promocode.controller.ts`;
`src/promoter/customer/customer.controller.ts`.

**Problem:** commission/sales were RECORDED on ebook/test-series/live-course
subscriptions but promoter dashboards only queried PackageCourseSubscription
(some also EbookSubscription) — so those purchases never appeared.

**Change:** all promoter earnings/sales/customer queries now span the 4
subscription collections via `$unionWith` (ws_package_course_subscriptions ∪
ws_ebook_subscriptions ∪ ws_test_series_subscriptions ∪
ws_live_course_subscriptions), normalised to a common `{ amount, commission,
productType }` shape (amount = paidAmount for package/live, price for
ebook/test; commission = promoterCommission with paidAmount×% legacy fallback).
Specifics: dashboard totals/revenue/commission/recents + per-product breakdown;
overview totals/chart/recents; subscriptions report adds `byType` + byMonth
union (byCourse stays course-only); subscriptions list adds
`?type=testSeries|liveCourse`; promocode usage adds test-series + live-course;
customers list/detail union all 4 AND fix the detail 404 gate (a customer who
bought only test-series/live-course used to 404). Commission aggregation shape
changed to `$sum "$commission"` on the normalised stream.

**No schema/index/migration change** (relies on the promoterId indexes added in
the commission change). Response shape additions: new summary fields
(testSeriesSubscriptionCount, liveCourseRevenue, etc.), recents now carry
`productType` instead of a typed course ref, customer detail adds
testSeriesSubscriptions/liveCourseSubscriptions arrays.

---

## 2026-06-16 — offerApplicable/offerReason flags on all apply-promo endpoints

**Files:** `src/client/payment/live-course-payment.controller.ts`
(applyLiveCoursePromo); `src/client/payment/test-series-payment.controller.ts`
(applyTestSeriesPromo); `src/client/promocode/promocode.controller.ts`
(applyPromocode — now sets offerReason:null on applicable plans too).

**Response-only change:** the dedicated single-plan previews
(`/payment/apply-promo/live-course`, `/payment/apply-promo/test-series`) now
return `offerApplicable:true` + `offerReason:null` on success, matching the
per-plan flags `/promocodes/apply` already returns. These endpoints stay 400 +
message on out-of-scope/invalid (single-plan → reject, not flag). No request,
schema, or query change.

---

## 2026-06-16 — Promoter commission recorded on purchase (all 5 products)

**Files:** resolver `src/client/promocode/applies-to.ts` (loadPlanDiscountMap now
selects promoterPercentage; resolvePlanDiscount returns it);
`src/client/live-course/promo.ts` (resolveLivePromo returns promoterPercentage +
promoterCommission); `src/client/orders/orders.controller.ts`
(resolveFinalPrice). Models: added `promoterCommission` to
PackageCourseSubscription; `promoterPercentage`+`promoterCommission` to
EbookSubscription; `promoterId`+`promoterPercentage`+`promoterCommission` to
TestSeriesSubscription (+index) & LiveCourseSubscription (+index); same trio to
EbookOrder & TestSeriesOrder (carriers). Writes: all 5 payment controllers +
orders flow stamp commission at create; `verify.controller` & `webhook.controller`
copy order→subscription and ACCUMULATE promoterCommission on the re-purchase
merge (sum amount, not %). Aggregations:
`src/promoter/{dashboard/overview.service,dashboard/dashboard.controller,subscription/subscription.controller}.ts`
now `$sum $ifNull(promoterCommission, paidAmount×%)` — prefer the locked-in
amount, legacy fallback for old rows.

**Why:** promoterPercentage lived only on the `PromotedPackageCourseEbook` link
row and was NEVER recorded at purchase (subscriptions hardcoded
promoterPercentage:0), so promoter dashboards showed zero commission. Now each
sale locks in `promoterCommission = chargedAmount × promoterPercentage / 100`.
Storing the AMOUNT (not just %) keeps merged re-purchase rows correct.

**Query/index changes:** new indexes `{promoterId:1, createdAt:-1}` on
TestSeriesSubscription & LiveCourseSubscription. Promoter commission aggregations
changed shape (see above). New collection reads: link-row promoterPercentage at
checkout.

**Migration (required):** `src/migrations/2026-promoter-commission-backfill.ts`
backfills promoterId/promoterPercentage/promoterCommission on PAST subscriptions
(all 4 models) by matching `(promocodeId, planId)` → link row. Idempotent (skips
rows already carrying promoterCommission). Ebook joins planId via EbookOrder.
**Promoter reporting still scoped to PackageCourseSubscription** (course+package)
for now — ebook/test-series/live commission is recorded in the DB but not yet
surfaced in promoter dashboards (deferred).

---

## 2026-06-16 — Orders flow: reject invalid promo instead of silent full price

**Files:** `src/client/orders/orders.controller.ts` (`resolveFinalPrice`,
`placeCourseOrder`, `placeEbookOrder`).

**Bug:** `POST /client/orders/{course,ebook}` placed the order at FULL PRICE with
NO error when a supplied promocode was invalid / not-covered / out of per-plan
scope (`resolveFinalPrice` returned `empty` silently). User saw a successful
order, no rejection.

**Fix:** `resolveFinalPrice` now returns an optional `error` for every rejection
case (invalid/expired code, entity not covered, out-of-plan-scope, zero
discount); both order handlers return `400 { message }` when present. Behaviour
unchanged when no code is sent, or for valid codes/referrals. Messages match the
payment-controller wording ("not valid for this plan", etc.).

---

## 2026-06-16 — Promocode: per-plan-within-entity scope enforcement

**Files:** `src/client/promocode/applies-to.ts` (new `countPlanLinks`);
`src/client/live-course/promo.ts` (`resolveLivePromo`);
`src/client/promocode/promocode.controller.ts` (applyPromocode);
`src/client/orders/orders.controller.ts` (`resolveFinalPrice`).

**Rule change (was "entity-level only", now per-plan):** A code is valid for a
plan ONLY if a `(promocodeId, planId)` row exists in
`ws_promoted_package_course_ebooks` — rejected on any plan without one, EVEN when
the parent entity is in `appliesTo.ids`. Implemented via a new
`countDocuments({ promocodeId })` ("does this code have link rows?") + the
existing per-plan `$in` lookup.

**Legacy-safe:** codes with ZERO link rows keep entity-level scope + top-level
discount (unchanged) — so old codes aren't broken. Only codes that HAVE per-plan
rows are per-plan-scoped. Checkout/apply (live, test-series, course, package,
ebook + legacy orders) reject out-of-scope plans with "not valid for this plan";
the apply preview marks uncovered plans `offerAvailable: false` +
`offerApplicable: false` + `offerReason: "This promo code is not valid for this
plan."` (covered plans get `offerApplicable: true`), so the FE can show a
per-plan rejection message while still discounting the covered plans. No
schema/index change, no backfill.

---

## 2026-06-16 — Client promocode list: discountValue from per-plan model

**Files:** `src/client/promocode/promocode.controller.ts` (`listPromocodes`).

**Change:** `GET /client/promocodes` was returning the stale legacy top-level
`discountValue`/`discountType`. Now (same fields, app reads them) it returns
`discountType: "percentage"` and `discountValue` = the code's representative
(MAX) per-plan `customerPercentage`, via a new `$group`/`$max` aggregation on
`PromotedPackageCourseEbook` keyed by promocodeId. Codes with NO per-plan rows
(legacy) fall back to their stored top-level discount. No data change required
(the "old values" were a projection issue, not bad data); no schema/index change.

---

## 2026-06-16 — Promocode plans endpoint: per-entity goalId/goalName

**Files:** `src/admin/promocode/promocode.controller.ts` (`getPromocodePlans`).

**Change:** `GET /admin/promocodes/plans` now returns `goalId` + `goalName` on
each **package** entity (omitted when absent → FE "Ungrouped"). `goalId` matches
`GET /admin/goals` ids. Source: `Package.goalId` (→ `Goal._id`), falling back to
deriving the goal from `Package.goalLabelId` when goalId unset. Added optional
`goalId` query param for server-side filtering (alongside existing `examTypeId`).

**Data-model limit (not a bug):** ONLY `Package` has a goal field in the schema.
Course / LiveCourse / Ebook / TestSeries have no goal link, so they never carry
`goalId` and always fall into "Ungrouped". Legacy `examTypeId`/`examTypeName`
(= package `goalLabelId`) unchanged. No schema/index change, no backfill.

---

## 2026-06-16 — Promocode GET /:id: resolve planId for ebook & testSeries links

**Files:** `src/admin/promocode/promocode.controller.ts` (`loadPlanLinks`).

**Bug:** `GET /admin/promocodes/:id` returned `plans[].planId: null` for ebook
and test-series codes. Cause: link rows store `planKind: "price"` for
package/course **AND** ebook/testSeries, but `loadPlanLinks` only looked price
ids up in `PackageCourseEbookPrice`. Ebook plans live in `EbookPrice`,
test-series plans in `TestSeriesPrice` → not found → planId null (percentages
were always saved correctly; write path was fine).

**Fix:** price-kind links now resolved against all three collections
(PackageCourseEbookPrice → EbookPrice → TestSeriesPrice) with parent-entity name
popul. (Ebook→`name`, TestSeries→`title` normalised to `name`). Affects
package/course (unchanged), liveCourse (unchanged), ebook + testSeries (fixed).
No write change, no backfill needed — affects fresh AND legacy codes equally.

---

## 2026-06-16 — Promocode create/update: discountValue now optional

**Files:** `src/admin/promocode/promocode.validation.ts` (`promocodeBase`).

**Contract change:** `discountValue` on `POST /admin/promocodes` (create) and the
update endpoint was a REQUIRED number — admin panel moved to the per-plan model
and stopped sending it, so create/update were 400-ing with
`discountValue: Required`. Now `optional().default(0)`. `discountType` already
defaulted to `"percentage"`. Legacy columns stay on the model (defaulted) for
backward compat; reads still return them. No schema/index change.

---

## 2026-06-16 — Promocode discount: per-plan customerPercentage at checkout

**Files:** `src/client/promocode/applies-to.ts` (new `loadPlanDiscountMap`,
`resolvePlanDiscount`); `src/client/promocode/promocode.controller.ts`
(applyPromocode); `src/client/live-course/promo.ts` (`resolveLivePromo` gains
optional `planId`); `src/client/payment/{course,live-course,test-series,ebook,package}-payment.controller.ts`;
`src/client/testSeries/testSeries.controller.ts`; `src/client/orders/orders.controller.ts`
(`resolveFinalPrice` gains `planId`); `src/admin/promocode/promocode.validation.ts`.

**Query-level change:** Checkout discount no longer reads ONLY the top-level
`PromoCode.discountValue`/`discountType`. It now reads the per-plan
`customerPercentage` from the `ws_promoted_package_course_ebooks`
(`PromotedPackageCourseEbook`) link table via a new `$in` query on
`{ promocodeId, planId: { $in: [...] } }` (uses the existing
`{ promocodeId:1, planId:1 }` unique index). 

**Resolution rule (per plan):** `discount = customerPercentage off plan.price`
when a link row exists for `(promocodeId, planId)`; **else** legacy fallback to
top-level `discountValue`/`discountType`. Affects every checkout/apply path
(package, course, liveCourse, testSeries, ebook + legacy orders flow).

**Validation change:** admin create/update now rejects unless ≥1 plan has
`0 < customerPercentage <= 100` (update only enforces when `plans` is present).

**QA / regression:** Test side-by-side (a) a legacy code with top-level
`discountValue` and NO link rows → must hit the fallback branch and discount as
before; (b) a new per-plan code → must discount by each plan's
`customerPercentage`. `promoterPercentage` is intentionally still stored-but-unapplied
(commission wiring deferred). No index or schema field added; no backfill needed.

---

## 2026-06-15 — Study material: persist original upload filename

**Files:** `src/models/course/Material.model.ts`;
`src/admin/material/material.validation.ts`;
`src/admin/material/material.controller.ts` (applyUploadedFile, duplicateCategory clone).

**Schema field added:** `originalName` (string, maxlength 500, optional) on `ws_materials`.
Captured from `req.file.originalname` on create AND update; preserved when materials are
cloned via duplicate-category. The stored `file` URL ends in a server-generated key
(`<timestamp>-file.pdf`), so this is the only record of the admin's real filename
(e.g. `bhaag-1-gujarat-Constable.pdf`).

**Backfill:** NOT possible — original names were never captured for existing rows.
`originalName` will be absent on pre-change materials; FE must fall back to the URL's
last path segment when it's missing (current behaviour). No data migration required;
list/detail responses return the full doc so the field flows through automatically.

---

## 2026-06-15 — "Resume / My learning" listings gated to paid + purchased only

**Files:** `src/client/learning/progress.controller.ts` (listMyLearningProgress —
course/package/live loops); `src/client/dashboard/dashboard.controller.ts`
(getResumeDashboard — resumeLecture/recentCourse/recentPackage);
`src/client/course/progress.controller.ts` (listMyCoursesForResume).

**Query-shape / filter contract:** These listings are built from `LectureProgress`
(watch history), which OUTLIVES entitlement. Previously the subscription lookup was used
only to compute `daysLeft`, so expired/refunded/free containers leaked into the list. Now
each card is shown ONLY when the container is `isPaid: true` AND the user has an active,
verified, non-expired subscription (`PackageCourseSubscription` / `LiveCourseSubscription`
with `status: true`, `paymentStatus: "verified"`, `endAt > now` — course/package on
dashboard also allow lifetime `endAt: null`). Added `isPaid` to the container `.select()`
and an `if (!isPaid || !sub) continue` (or `&&` guard) in each loop.

**Backfill:** NONE — read-time filter against live subscription rows; no stored/derived
flag on progress docs to migrate. Old LectureProgress rows are simply ignored at read time
when no qualifying subscription backs them.

**Known gap (not yet changed):** `GET /client/packages/my` still lacks the
`paymentStatus: "verified"` check and does not gate on `isPaid`.

---

## 2026-06-15 — Exam-category exams listing returns per-user attempt data

**Files:** `src/client/categories/categories.controller.ts` (listExamsByCategory).

**Query added:** `GET /client/exam-categories/:id/exams` now queries `ExamResult`
(`status: true`, latest per exam) for the authenticated customer and decorates each exam
with `isCompleted` + `lastResult`, mirroring the existing exam.controller listing contract.
No-op for anonymous callers.

---

## 2026-06-15 — Offline batch enquiry module (new collection + endpoints)

**Files:** new `src/models/offline/OfflineBatchEnquiry.model.ts`;
`src/client/offline/offline.controller.ts` (submitBatchEnquiry);
`src/client/offline/offline.routes.ts`;
`src/admin/offline/offline.controller.ts` (listBatchEnquiries, deleteBatchEnquiry);
`src/admin/offline/offline.routes.ts`.

**New collection:** `ws_offline_batch_enquiry`. Fields: `customerId` (ref Customer, nullable),
`name`, `email`, `mobile`, `qualification` (enum `post_graduate|graduate|10_plus_2|other`),
`otherQualification` (string|null, only set when qualification=`other`), `batchId` (ref OfflineBatch),
timestamps.

**Indexes:** `{ batchId: 1, createdAt: -1 }`, `{ customerId: 1 }` — both need creating on cutover.

**Queries added:**
- Client `POST /client/offline/batch-enquiry` — `OfflineBatch.exists({_id})` guard + `create`. Auth REQUIRED (customer Bearer token).
- Admin `GET /admin/offline/batch-enquiries` — filter on `batchId` + `buildSearchFilter(search, [name,mobile,email])` + `createdAt` range; populates `batchId` and `customerId`; paginated; sort `createdAt: -1`.
- Admin `DELETE /admin/offline/batch-enquiries/:id`.

**Note:** Parallel to the existing `OfflineEnquiry` (`ws_offline_enquiry`) module — NOT a replacement. Distinct collection, distinct routes.

**Docs:** `docs/OFFLINE_BATCH_ENQUIRY_CLIENT.md`, `docs/OFFLINE_BATCH_ENQUIRY_ADMIN.md`.

---

## 2026-06-13 — Standard search/page/limit added to remaining client list endpoints

**Files:** new `src/utils/listQuery.ts`; `src/client/address/address.controller.ts`
(getMyAddresses, getStates, listCities, listCentersByCity, getEducations);
`src/client/book/book.controller.ts` (listBooks);
`src/client/course/course.controller.ts` (listCourseCategoriesHandler);
`src/client/exam/exam.controller.ts` (listCategories);
`src/client/examCountdown/examCountdown.controller.ts` (listCategories);
`src/client/ebook/ebook.controller.ts` (listEbooks, listMySubscriptions);
`src/client/folder/folder.controller.ts` (folder list);
`src/client/offline/offline.controller.ts` (listCities).

**Query-shape:** 13 flat-list client endpoints that lacked search and/or
pagination now accept the project-standard `search`, `page`, `limit` via a new
shared `parseListQuery` helper (page default 1; limit default 20, cap 100; search
trimmed → regex on the entity's name/title via buildRegexCondition). Each now
runs a `countDocuments(filter)` alongside the paged `find` and returns a
**backward-compatible** `pagination: { total, page, limit, totalPages }` sibling —
the existing `data` shape is unchanged (e.g. `data:{ebooks:[]}`, `data:{cartId,
books:[]}`), so current FE reads keep working; `pagination` is additive.

Grouped/drill-down/hierarchical list endpoints (catalog videos/materials/tests,
category-children, live-course recordings, lecture-notes saved-materials, etc.)
were deliberately LEFT ALONE to avoid breaking their response contracts.

**QA:** confirm each endpoint still returns its original `data` shape when called
with no params; confirm `?search=&page=&limit=` filter/paginate correctly. No
schema/index change.

---

## 2026-06-13 — TestSeries added to the promo appliesTo model (admin picker + checkout)

**Files:** `src/models/course/PromoCode.model.ts`,
`src/admin/promocode/promocode.validation.ts`,
`src/admin/promocode/promocode.controller.ts`,
`src/client/payment/test-series-payment.controller.ts`,
`src/client/testSeries/testSeries.controller.ts`.

**`appliesTo.type` enum gains `testSeries`** (now full set:
package|course|liveCourse|ebook|testSeries). Updated every site: PromoCode type +
schema enum; admin `APPLIES_TO_TYPES`; `APPLIES_TO_MODEL` (+TestSeries);
`PLAN_KIND_BY_TYPE`; `getPromocodePlans` requested-list (now derived from one
ALL_TYPES list).

**Admin picker** `GET /admin/promocodes/plans?type=testSeries`:
`loadPlansForEntities` testSeries branch loads `TestSeriesPrice`
(`ws_test_series_prices`) by `testSeriesId`, mapping `durationDays → duration`.
TestSeries' display field is `title` (not `name`) — search/select/output
normalise `title → name` so the grouped shape is uniform. Same for the detail
echo `populateAppliesTo` (selects `title thumbnail`, returns `{_id,name,image}`).

**Checkout — removed the `liveCourse` hack:** test-series promo resolution
(create-order, the preview endpoint, and testSeries previewCheckout) previously
passed `resolveLivePromo({type:"liveCourse", id:testSeriesId})`. All three now use
`type:"testSeries"`. **Safe:** 0 existing test-series promos in DB (verified), so
no migration. **Live check:** picker returns 3 test-series entities with plans in
the exact `{examTypes,entities[{id,name,type,plans[]}]}` shape, durationDays→duration.

---

## 2026-06-13 — Ebook added to the promo appliesTo model + ebook create-order redemption

**Files:** `src/models/course/PromoCode.model.ts`,
`src/admin/promocode/promocode.validation.ts`,
`src/admin/promocode/promocode.controller.ts`,
`src/client/promocode/promocode.controller.ts`,
`src/client/payment/ebook-payment.controller.ts`,
`src/models/ebook/EbookOrder.model.ts`.

**Cross-cutting change — `appliesTo.type` enum gains `ebook`** (was
`package|course|liveCourse`). Updated EVERY definition site: PromoCode type +
schema enum; admin `APPLIES_TO_TYPES`; admin `APPLIES_TO_MODEL` (+Ebook) and
`PLAN_KIND_BY_TYPE`; admin `getPromocodePlans` requested-list;
`loadPlansForEntities` ebook branch loads from **`ws_ebook_prices` (EbookPrice)**,
NOT `ws_package_course_ebook_prices` (which holds ZERO ebook rows — verified).

**Apply preview** (`/client/promocodes/apply`): ebook now runs the promocode path
(previously referral-only). Ebook plans loaded from `EbookPrice`; `cartType`
"ebook" drives `promoCovers`.

**Create-order** (`/payment/create-order/ebook`): accepts optional `promocode`,
re-validates via `resolveLivePromo({type:'ebook', id:ebookId})`, charges the
discounted amount. `EbookOrder` gains `promocodeId` + `originalAmount` +
`discountAmount` (default null; `orderPrice` = charged amount). Response gains
`promo`.

**QA:** admin can now create a promo with `appliesTo.type:"ebook"`; 0 such promos
exist yet, so create one to test end-to-end. Confirm package/course/liveCourse
promo creation + apply still work (enum widened, not changed).

---

## 2026-06-13 — Promo redemption added to course + package create-order

**Files:** `src/client/payment/package-payment.controller.ts`,
`src/client/payment/course-payment.controller.ts`,
`src/models/customer/PackageCourseSubscription.model.ts`.

**Bug:** `/payment/create-order/package` and `/course` IGNORED promo codes —
they always charged `plan.price`, so an applied promo never reduced the Razorpay
amount. (`/promocodes/apply` is preview-only; the order must re-apply.) live-course
+ test-series already did this; package/course/ebook did not.

**Fix:** package + course create-order now accept an optional `promocode`,
re-validate it server-side via `resolveLivePromo({type:'package'|'course', id})`
(the preview is never trusted), and build the Razorpay order + subscription
`paidAmount` from the discounted amount. Sub-₹1 results are rejected (Razorpay
minimum).

**Schema:** `PackageCourseSubscription` gains `originalAmount` + `discountAmount`
(Number, default null) for the promo money-trail (it already had `promocodeId` +
`paidAmount`). No backfill — nulls cover existing rows. Response gains a `promo`
object when a code is applied; `amountInRupees` is now the CHARGED (post-discount)
amount, `plan.price` is the pre-discount MRP.

**Ebook — now DONE too (separate entry below).** test-series already applied promos.

**Live check:** plan `…7fbe` (₹1500) + `WEBSANKUL70` → Razorpay ₹1500 → ₹450.

---

## 2026-06-13 — Promocode apply: unified { targetType, targetId } contract + auto-detect

**Files:** `src/client/promocode/promocode.controller.ts`,
`src/client/promocode/promocode.validation.ts`.

**Contract:** `POST /client/promocodes/apply` now accepts a unified, self-describing
pair `{ targetType: package|course|ebook|liveCourse|testSeries, targetId }` —
the FE sends the same shape for every entity. Legacy per-type fields
(`package`/`course`/`ebook`) still accepted as a deprecated fallback. `targetType`
`liveCourse`/`testSeries` return a 400 redirecting to the dedicated
`/payment/apply-promo/*` endpoints (those use a different plan-based model).

**Behaviour/query-shape:** `POST /client/promocodes/apply` no longer trusts which
request field (`package` / `course` / `ebook`) the id arrived in. A new
`detectEntity(id)` resolves the id's REAL type via `Package.exists` /
`Course.exists` / `Ebook.exists` (parallel), then drives the plan lookup
(`PackageCourseEbookPrice` by packageId/courseId/ebookId) and the `appliesTo`
coverage check. Previously a correct id sent under the wrong field (e.g. a
package id in `course`) produced `find({courseId: <packageId>})` → 0 plans →
misleading "This promocode is not applicable for this item." Now the field name
is irrelevant. New 404 message when the id matches no package/course/ebook. New
reads: `ws_packages`, `ws_courses`, `ws_ebooks` (existence checks) per apply
call. liveCourse + test-series promos are unchanged (separate planId-based
`/payment/apply-promo/*` endpoints). **Live check:** the reported failing payload
(`course: <a package id>`) now resolves to the package and applies 70%.

---

## 2026-06-13 — Profile dashboard subscription count now matches My Subscriptions

**Files:** `src/client/profile/dashboard.controller.ts`.

**Query-shape:** `getProfileDashboardCounts` (`GET /client/profile/dashboard`)
previously computed `activePlans` as a raw
`PackageCourseSubscription.countDocuments({ status, paymentStatus:'verified' })`
— **course/package only, no `endAt` filter, no dedup**. It disagreed with the
My Subscriptions screen (which is active-only + deduped + spans three types).

Now a new `countActiveSubscriptions(cid, now)` helper applies the SAME rules as
my-subscriptions.controller.ts:
- course+package: `paymentStatus:'verified'` + `status:true` + `endAt>now`,
  deduped by `courseId`/`targetPackageId` → the `course` bucket.
- test_series (`ws_test_series_subscriptions`): `status:true` + `endAt>now`,
  dedup by `testSeriesId`.
- ebook (`ws_ebook_subscriptions`): `status:true` + `endAt>now`, dedup by
  `ebookId`.

`activePlans` is now the correct deduped active TOTAL across all three types
(headline number kept for backward-compat). Response gains
`subscriptionsByType: { course, test_series, ebook }` for per-tab badges. New
reads hit `ws_test_series_subscriptions` + `ws_ebook_subscriptions`. No schema
change. **Live check:** a sample customer went from old `4` → correct `5`
(old count missed an active ebook sub). Keep in lockstep with my-subscriptions.

---

## 2026-06-13 — Clearable image/PDF fields on exam, exam-category, goal

**Files:** `src/admin/exam/exam.validation.ts`, `src/admin/exam/exam.controller.ts`,
`src/admin/goal/goal.admin.controller.ts`, `src/admin/goal/goal.admin.service.ts`.

**Validation/write-shape (no schema/index change):**
- `updateExam` (`PUT /admin/exams/:id`): `solutionPdfUrl` now accepts
  `null`/`""` → translated to `$unset` (was: string/file only, null rejected).
  Old S3 file deleted best-effort. `current` select now also reads
  `solutionPdfUrl`.
- `updateCategory` (`PUT /admin/exams/categories/:id`): `image` now accepts
  `null`/`""` (JSON or empty multipart) → `$unset` + S3 cleanup.
- `updateGoal` (`PUT /admin/goals/:id`): empty multipart `image` field now
  clears the icon (stored `null`, old S3 deleted); previously only a file upload
  was honoured, so clearing was impossible.

Stored documents unchanged in shape — `solutionPdfUrl` / `image` simply become
absent/null when cleared. No backfill. **QA:** confirm a normal update WITHOUT
these fields still leaves them untouched (regression risk: an over-eager unset).
Items "filter exams by status" and "clear ebook demoUrl/bookUrl" needed NO change
— already supported. See `docs/BE_CLEAR_FIELDS_CHECKLIST.md`.

---

## 2026-06-13 — my-subscriptions gains `type` param (course | test_series | ebook)

**Files:** `src/client/my-subscriptions/my-subscriptions.controller.ts`.

**Query-shape:** `GET /client/my-subscriptions` now takes an optional `type`
(default `course`). It selects the data source:
- `course` → `ws_package_course_subscriptions` (course + package, verified +
  active + dedup — unchanged from before; this is the default so old no-`type`
  callers are unaffected).
- `test_series` → `ws_test_series_subscriptions` (active = `status:true` +
  `endAt > now`; **no** paymentStatus column).
- `ebook` → `ws_ebook_subscriptions` (same active rule; no paymentStatus column).

All three dedup to the furthest-out `endAt` per target and return one shared card
envelope; the `action` object gained `testSeriesId` + `ebookId` keys (always
present, null when not applicable). New reads hit `ws_test_series_subscriptions`
and `ws_ebook_subscriptions` (+ `ws_test_series`, `ws_ebooks` for display
fields). No schema/index change — these collections already exist and are
indexed on `{customerId, status, endAt}` / `{customerId}` + `{endAt}`.

**QA:** regress the no-`type` call (must equal old course+package output);
verify `type=test_series` and `type=ebook` return active rows; verify an invalid
`type` returns 400.

---

## 2026-06-13 — Optional delivery address on create-order (With Materials)

**Files:** `src/models/customer/LiveCourseSubscription.model.ts` (new fields);
`src/client/payment/course-payment.controller.ts`,
`src/client/payment/package-payment.controller.ts`,
`src/client/payment/live-course-payment.controller.ts`.

**Schema:** `LiveCourseSubscription` gains two **optional** fields —
`withMaterial: Boolean (default false)` and `customerShippingId: ObjectId
(ref CustomerShipping, default null, stores a CustomerAddress._id)`. Mirrors the
fields already present on `PackageCourseSubscription`. No backfill needed —
defaults cover existing rows. Schema is `strict:"throw"`, so the fields had to be
declared before the controllers could write them.

**Query-shape:** all three client create-order endpoints
(`/create-order/course|package|live-course`) now accept an **optional**
`customerShippingId`. When present they run an ownership check —
`CustomerAddress.findOne({ _id: customerShippingId, customerId })` — and reject
with 400 if not owned. The address + `withMaterial` are persisted on the created
subscription. course/package derive `withMaterial` from the chosen plan
(`PackageCourseEbookPrice.withMaterial`); live-course takes it from the request
(LiveCoursePlan has no material flag). Fully backward-compatible: callers that
omit `customerShippingId` are unaffected.

**QA:** verify existing create-order calls (no `customerShippingId`) still
succeed; verify a foreign address id is rejected; confirm the new live-course
fields persist. Behaviour mirrors `src/admin/subscription/subscription.controller.ts`.

---

## 2026-06-13 — Lecture-progress reachability now uses catalog tree model (fixes false "not part of scoped <product>")

**Files:** `src/client/course/scopeReachableCategories.ts` (new);
`src/client/course/progress.controller.ts` (`reportLectureProgress`).

**Problem:** A video linked to **more than one** course/package/live-course was
listed by the catalog yet rejected by the heartbeat with
`"Video is not part of the scoped <product>."` (HTTP 400). Two code paths
answered "is this video in this product?" using **different tree
representations** that aren't always in sync:
- Catalog (`free.controller`, `catalog.controller`): walks **downward** off each
  linked root via `VideoCategory.childCategoryIds` (`collectCategoryTreeIds`).
- Progress controller: walked **upward** from the video's leaf via
  `VideoCategoryRelation` (`child→parent`) rows. The second product's linkage,
  typically expressed only through nested `childCategoryIds`, was invisible.

**Change (query-shape):** `reportLectureProgress` no longer builds `ancestorIds`
from `VideoCategoryRelation`. It now calls the new
`resolveScopedReachableVideoCategoryIds(scope.kind, scopeOid)`, which gathers the
product's linked roots (course/liveCourse: `videoCategoryId` + categories tagged
with `courseId`/`liveCourseId`; package: `specificSubjects[].category` + both
endpoints of each `PackageVideoCategoryRelation`→`VideoCategoryRelation`) and
expands each downward via `collectCategoryTreeIds`. Reachability is now a single
leaf-membership test: `reachableSet.has(video.videoCategoryId)`. Free videos
remain exempt. Invariant restored: **if a video is listed under a product, its
progress is accepted there.** Applies to all three scope kinds.

**QA:** regress lecture-progress POST for videos shared across multiple
products, and for videos linked only via `childCategoryIds` (no relation row at
the leaf's direct parent). No schema/index change.

---

## 2026-06-12 — OfflineCity gains `stateId`; cities filterable by state

**Files:** `src/models/offline/OfflineCity.model.ts`;
`src/client/address/address.controller.ts` (`listCities`);
`src/admin/offline/offline.controller.ts` (`listCities`, city create/update via schema);
`src/admin/offline/offline.validation.ts` (`cityCreateSchema`);
`src/migrations/2026-offlinecity-add-state-id.ts` (new).

**Schema:** Added `stateId` (ref `CustomerState`, default `null`) to `ws_offline_city`
+ index `{ stateId: 1, status: 1, order: 1 }`. Previously cities had NO link to states.

**Query-shape changes:**
- Client `GET /address/cities` now accepts optional `?stateId=<id>` →
  `filter.stateId`; invalid id → 400. Result populates `stateId` to `{_id,name,stateCode}`.
  Omitting stateId returns all cities (backward-compatible).
- Admin `GET /admin/address/cities` (impl in offline.controller) accepts `?stateId=` and
  populates stateId. Admin city create/update now accept + persist `stateId`.

**Migration (required to populate the field):**
`src/migrations/2026-offlinecity-add-state-id.ts` sets `stateId: null` where absent
(idempotent) and LISTS cities still missing a state — there is no DB source of truth for
city→state, so each must be assigned by an admin (PUT /admin/address/cities/:id) or via
the optional `CITY_STATE_MAP` env. Until assigned, a city won't appear under any
`?stateId=` filter. FE doc: `docs/STATES_CITIES_CLIENT.md`.

## 2026-06-12 — Admin test-series: defaultPlan on list, thumbnail-clear, paid-requires-plan

**File:** `src/admin/testSeries/testSeries.controller.ts` (`listTestSeries`,
`createTestSeries`, `updateTestSeries`).

- **List `defaultPlan`:** `GET /admin/test-series` now runs one extra batched query —
  `TestSeriesPrice.find({ testSeriesId: { $in }, status: true }).sort({ isDefault:-1, price:1 })`
  — and attaches a `defaultPlan` (default, else cheapest active, else null) to each row.
  One query for the whole page, not per-row.
- **Thumbnail clear:** update now treats `thumbnail === ""` as `$unset: { thumbnail }`
  (was: stored as `""`); missing field still = no change. Create drops an empty-string
  thumbnail before insert.
- **Paid-requires-plan guard (update only):** when the resulting `isFree === false`,
  `updateTestSeries` runs `TestSeriesPrice.exists({ testSeriesId, status: true })` and
  rejects with 422 if none. Not enforced on create (plans are added post-create). Update
  also now reads the existing doc's `isFree` first (extra findById) to evaluate the guard
  when the field isn't in the payload. **Data note:** any pre-existing paid series with no
  active plan (found 1 in staging: "Reprehenderit moles") will be blocked from edits until
  a plan is added or it's set free — escape path always exists.

## 2026-06-12 — Video-playback BE bug fixes (progress upsert key, free-video reachability, lecture-note course-optional)

**Files:** `src/client/course/progress.controller.ts` (`reportLectureProgress`);
`src/client/lecture-note/lecture-note.controller.ts` (`authorizeRecorded`).

**Bug 2 — progress upsert keyed on removed fields (CRITICAL):** Commit `bcfad2d`
reverted `LectureProgress` to global-per-(customer,video) (unique partial index
`uniq_customer_video`, no `containerType`/`containerId`/`scopeKind`), but
`reportLectureProgress` still upserted on `{customerId, videoId, containerType,
containerId}`. Mongoose strict mode threw "Path containerId is not in schema" on EVERY
paid course/package/liveCourse heartbeat. **Query-shape change:** upsert filter +
`$setOnInsert` now key on `{customerId, videoId}` only; container pointers
(courseId/packageId/liveCourseId) are stamped via `$set` and only ADDED (never cleared),
so multi-product watches accumulate pointers on the one row. Verified live
`ws_lecture_progress`: 0 legacy-containerId rows, 0 duplicate (customer,video) groups —
global upsert is safe.

**Bug 3 — free videos rejected by scope reachability:** The `scope.kind` reachability
check (all 3 branches) ran before the free/paid branch, returning 400 "Video is not part
of the scoped X" for free videos whose package/course linkage lives in the free catalog
rather than specificSubjects/relation rows. Now a free video (`priceType==='free'`)
bypasses the strict reachability check (still confirms the scoped container exists);
paid videos are unchanged.

**Bug 1 — lecture note required a resolvable course:** `authorizeRecorded` 400'd
"This lecture is not attached to a course." whenever no owning Course resolved. `courseId`
is optional metadata on `LectureNote`. Now: free video → save with `courseId` (or null);
paid video with resolvable course → still gated on active subscription; paid video with no
resolvable course → saved scoped to videoId (`courseId:null`) instead of rejected.

**Bug 1b — same bug in `lecture-audio-note.controller.ts` (added 2026-06-12):** the
audio-note module has its own copy of `authorizeRecorded` (deliberate copy-paste), so
`POST` and `GET /client/lecture-audio-notes` 400'd identically for no-course videos —
including the LIST path, so free/current-affairs videos couldn't even display their audio
notes. Same fix applied (course optional; free + no-course-paid allowed). Verified against
free video `6a1ec3110c49baf08ac51a30`.

**No index/schema change in code.** ⚠️ Separate cleanup needed (not done here): drop the
orphaned per-container indexes still present on `ws_lecture_progress`
(`uniq_customer_video_course/_package/_liveCourse/_legacy`, partial on the defunct
`scopeKind`).

## 2026-06-12 — Client test-series detail stops returning deprecated `examCategoryId`

**File:** `src/client/testSeries/testSeries.controller.ts` — `getTestSeriesDetail`.

**Change:** Response-shape only. The detail endpoint was spreading the full lean
series doc, which leaked BOTH the deprecated single `examCategoryId` and the new
populated `examCategoryIds`. Now destructures `examCategoryId` out before building the
response, so only `examCategoryIds` (`[{ _id, name }]`) is returned. No DB/query change
— `examCategoryId` is still stored and kept in sync on write during the migration
window; it is just hidden from this client read. The list endpoint already omitted it
(fixed `.select`).

## 2026-06-12 — Live-course `endAt` computed as DAYS (was wrongly MONTHS)

**Files:** `src/client/payment/verify.controller.ts` (live-course branch);
`src/client/webhook/webhook.controller.ts` (live-course branch);
`src/admin/live-course/live-course.subscription.controller.ts` (grant + extend);
`src/models/course/LiveCoursePlan.model.ts`;
`src/admin/live-course/live-course.plan.controller.ts` (validation label);
`src/migrations/2026-livecourse-fix-endat-days.ts` (new).

**Bug:** All 3 live-course fulfillment paths fed `LiveCoursePlan.duration` into
`computeEndAt` WITHOUT `asDays:true`, so `duration` (DAYS) was applied via `setMonth`.
A 180-day plan produced `startAt + 180 months` (~15 yrs) → `/client/live-courses`
showed `daysLeft: 5479`. `asDays` is NOT a no-op in the helper — it switches
`setDate` vs `setMonth`; only the live-course paths had missed it (ebook/course/
test-series already passed it).

**Code change:** All live-course callsites now pass `asDays: true`. Model + admin
plan validation relabeled months → DAYS. Admin grant gains a `durationDays` override
(preferred); legacy `durationMonths` override still honoured (months) for back-compat.
No query-shape/index change.

**Migration (required):** `src/migrations/2026-livecourse-fix-endat-days.ts` recomputes
`endAt = startAt + plan.duration days` for verified, time-boxed live-course
subscriptions whose stored span is clearly the months-bug result (span ≥ 2× and ≥31d
over the day expectation). Idempotent; skips lifetime/unbounded rows and rows without a
usable plan duration; logs every change. Supports `DRY_RUN=1`.
Run: `MONGODB_URI="<uri>" npx tsx src/migrations/2026-livecourse-fix-endat-days.ts`
(do a `DRY_RUN=1` pass first). The earlier `2026-subscription-enddate-days.ts` did NOT
cover `ws_live_course_subscriptions`.

## 2026-06-12 — TestSeries `examCategoryId` → `examCategoryIds` (array)

**Files:** `src/models/testSeries/TestSeries.model.ts`;
`src/admin/testSeries/testSeries.validation.ts`;
`src/admin/testSeries/testSeries.controller.ts` (`listTestSeries`, `createTestSeries`,
`updateTestSeries`);
`src/migrations/2026-testseries-backfill-exam-category-ids.ts` (new).

**Schema:** Added `examCategoryIds: [ObjectId]` (ref `ExamCategory`, default `[]`) to
`ws_test_series`. The legacy single `examCategoryId` is **retained for the migration
window** (controllers keep it in sync = first array entry; drop later). New index
`{ examCategoryIds: 1, status: 1 }` added; the old `{ examCategoryId: 1, status: 1 }`
index is kept until the field is dropped.

**Migration (required):** `src/migrations/2026-testseries-backfill-exam-category-ids.ts`
backfills `examCategoryIds = [examCategoryId]` for docs with a legacy single value, and
sets `[]` where absent. Idempotent, forward-only.
Run: `MONGODB_URI="<uri>" npx tsx src/migrations/2026-testseries-backfill-exam-category-ids.ts`.

**Query-shape changes:**
- `GET /admin/test-series` category filter: was `filter.examCategoryId = <id>`
  (single equality). Now accepts `examCategoryIds` (repeated) or legacy
  `examCategoryId`, and matches with
  `$or: [{ examCategoryIds: { $in } }, { examCategoryId: { $in } }]` so both migrated
  and un-migrated docs match. **Note:** introduces a top-level `$or` on this list —
  watch for interaction if other `$or` filters are ever added here.
- Create/Update now persist `examCategoryIds` (array) plus the synced legacy
  `examCategoryId`. Validation accepts array / repeated multipart / `examCategoryIds[]`
  bracket key / JSON-encoded string / single value.

**Reads (admin):** List + detail return the raw lean doc, so `examCategoryIds` flows
through automatically once backfilled; `examCategoryId` still returned during the window.

**Reads (client):** `src/client/testSeries/testSeries.controller.ts` —
`listTestSeries` projection (`.select`) widened to include `examCategoryIds`, and both
`listTestSeries` + `getTestSeriesDetail` now `.populate("examCategoryIds", select
"_id name")` so the client gets `[{ _id, name }]` instead of bare ids (no FE id→name
lookup needed; deleted refs surface as `null` and should be filtered). FE doc:
`docs/TEST_SERIES_CATEGORY_MIGRATION_CLIENT.md`.

## 2026-06-12 — Offline city `image` added to populated projections

**Files:** `src/client/offline/offline.controller.ts` — `getOfflineDashboard`,
`listCenters`, `listBatches`.

**Change:** Projection-only. The `OfflineCity` populate selects were widened from
`"name"` / `"_id name"` to include `image` (cities have a required `image` field that
was being stripped). Affects: dashboard upcoming-batches → center → city; centers list →
city; batches list → center → city. No filter/index change; same documents, one more
projected field. `getCenterDetail`/`getBatchDetail` already returned the full city.

## 2026-06-12 — Offline client lists paginated + auth; test-series papers `isPaid` flags

**Files:** `src/client/offline/offline.controller.ts` — `listCenters`, `listBatches`;
`src/client/offline/offline.routes.ts`;
`src/client/testSeries/testSeries.controller.ts` — `listSeriesPapers`.

**Changes:**

- `GET /client/offline/centers` & `GET /client/offline/batches`: were
  `find(filter).sort(...).lean()` returning the full active collection. Now apply
  `skip/limit` pagination with `page`/`limit` query params (`limit` clamped 1–100,
  default 20) and run a parallel `countDocuments(filter)`. Response gains a
  `pagination: { total, page, limit, totalPages }` object alongside `data`. Filter
  contracts unchanged (`status:true` + cityId/centerId/search/upcoming as before).
- Both offline list/detail routes (`/centers`, `/centers/:id`, `/batches`,
  `/batches/:id`) now require `authenticate` + `requireRole("customer")` — previously
  public. `POST /enquiry` keeps best-effort auth.
- `GET /client/test-series/:id/papers` (`listSeriesPapers`): the populated `examId`
  select now also pulls `isPaid` (no schema change — field already exists on `Exam`).
  Response adds top-level `isPaid` (= `!series.isFree`) and, per paper, `isPaid`
  (from `Exam.isPaid`) and `isLocked` (= paper.isPaid && !hasAccess). No new query or
  index — same documents, additional projected field.

## 2026-06-11 — Server-side pagination/search/status on educators & departments lists

**Files:** `src/admin/master/educator.controller.ts` — `getEducators`;
`src/admin/inquiry/inquiry.controller.ts` — `listDepartments`.

**Change:** Both list endpoints now filter + paginate server-side instead of returning
the full collection.

- `GET /admin/master/educators`: was `find({ deleted: false }).sort(createdAt:-1)` with
  no limit. Now applies `buildSearchFilter(search, ["name","email"])`, a `status` filter
  (`active`/`true` → `status:true`, `inactive`/`false` → `status:false`) on the boolean
  `status` field, `skip/limit` pagination, and `sortBy`/`sortOrder` (whitelist:
  createdAt/updatedAt/name/email; default createdAt desc). Added `countDocuments(filters)`
  for `total`. Filter still always includes `deleted: false`.
- `GET /admin/departments`: was `find().sort(order:1)` with no limit. Now applies
  `buildSearchFilter(search, ["name","description"])`, a `status` filter on the boolean
  `active` field (same label/boolean mapping), `skip/limit`, default sort still `order:1`,
  plus `countDocuments(filter)` for `total`.

Both responses gained the standard `pagination: { total, page, limit, totalPages }` block
(matching `getCustomers`). No schema/index change — `total` reflects the filtered count.
Regression note: these endpoints now return a single page (default limit 20) rather than
the whole collection — any caller that expected all rows must paginate.

---

## 2026-06-11 — `GET /administrators` status filter accepts label form + response reshape

**File:** `src/admin/administrator/administrator.controller.ts` — `getAdministrators`.

**Change:** The `status` query param now matches `active`/`inactive` in addition to the
existing `true`/`false` (both map to the boolean `filters.status`). No new index — same
`{ deleted: false, ... }` filter and `countDocuments` as before, so the filtered `total`
semantics are unchanged. Response shape changed: rows + pagination are now nested under
`data` as `data.items` and `data.pagination` (was `data` array + sibling `pagination`),
matching the `data: { items, pagination }` convention used by video/exam list endpoints.
No DB/schema change — listing behavior and filtered count are identical.

---

## 2026-06-11 — Exclude daily tests from `GET /client/exam-categories/:id/exams`

**File:** `src/client/categories/categories.controller.ts` — `listExamsByCategory`.

**Change:** Filter gained `type: { $ne: ExamType.DAILY }` (was
`{ categoryId, status: PUBLISHED }`). Daily-type exams are now excluded from the client
category exam listing; SUBJECT/MOCK/WEEKLY still appear. Consistent with the free-test
listing which already restricts to `type: SUBJECT` (`free.controller.ts`).

**Query semantics:** Both `list` and the `total`/`totalPages` count shrink by the number of
daily exams in each category. Pagination/search otherwise unchanged. Daily tests are
surfaced through their own dedicated flow.

---

## 2026-06-11 — Paginate `GET /admin/materials/categories` flat listing

**File:** `src/admin/material/material.controller.ts` — `listCategories`.

**Change:** The non-`tree` flat listing previously ignored `page`/`limit` and returned the
full matching set via `MaterialCategory.find(filter).sort({ order, title })`. It now honors
`page`/`limit` (`skip = (page-1)*limit`, `take = limit`), supports `sortBy`(`order`|`title`|
`createdAt`)/`sortOrder`, and runs `find().skip().limit()` + `countDocuments(filter)` in
parallel. Response is now the standard flat envelope `{ success, data: [...], pagination:
{ total, page, limit, totalPages } }` — matching `listMaterials` and siblings.

**Query semantics:** `total` is now a true count across all matching records (was implicitly
the returned-page length). Search (`buildRegexCondition` on `title`) and `parent`/`status`
filters unchanged. The `?tree=true` branch is **unchanged** — still returns the full nested
tree unpaginated (the intended unbounded source for dropdowns/breadcrumbs).

**QA:** `?page=1&limit=2` vs `?page=2&limit=2` return different pages; `?limit=2` vs
`?limit=500` return different counts; `?search=` filters across all pages.

---

## 2026-06-11 — Escape user input in all `$regex` text-search filters

**New util:** `src/utils/searchFilter.ts` — shared helpers `escapeRegex`,
`buildRegexCondition(search)` (trims + escapes → `{ $regex, $options:"i" }` or
null), `buildSearchFilter(search, fields[])` (single field or `$or`), and
`buildSearchRegExp(search)` (escaped `RegExp` for in-memory `.test()`).

**What changed (query shape — escaping only, no result-set change for normal
input):** Every list/search endpoint that built a MongoDB `$regex` (or
`new RegExp`) directly from the raw `?search=` / `?q=` value now escapes the
input first. Previously a search term containing regex metacharacters
(`( ) [ ] { } . * + ? ^ $ | \`) — e.g. `January(2025)`, `(GSSSB)`, `C++`, `2025)`
— produced `Regular expression is invalid` 500s, and crafted input (`(a+)+$`) was
a ReDoS vector. After the fix those terms match **literally**.

**Files touched (36):** admin — video, ebook.service, role, inquiry, plan,
course.service, permissionCategory, testSeries, promocode (preserves
`.toUpperCase()`), book, videoCategory, administrator, permission.service,
material, package.service, examCountdown, customer, offline, exam, goal,
promoter, live-course.service. client — ebook, course, free (incl. in-memory
`new RegExp` → `buildSearchRegExp`), testSeries, catalog, address,
material/entitlement, book, categories (13 call sites), package, examCountdown,
offline, live-course. promoter — customer.

**Not changed (already safe, left as-is):** the copy-title generator regexes in
`material.controller.ts` / `videoCategory.controller.ts` (local `escape()` on a
non-user base string); `notification.controller.ts` (escapes inline); and
ebook-subscription / subscription / book(admin) / referral.service which already
escape via `new RegExp(... .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))`.

**Migration/QA note:** No index or schema change. Behavior change is limited to
search terms that contain regex metacharacters: they now match literally instead
of throwing. Regression-check that normal alphanumeric searches return the same
results as before.

---

## 2026-06-11 — Dashboard "Recently Added" is PAID packages only

**File:** `src/client/dashboard/dashboard.controller.ts` — the `recentPackages`
query feeding the home-screen "Recently Added" carousel.

**What changed (filter gate):** Query was `Package.find({ active: true })`
(top 5 by `createdAt` desc); now `Package.find({ active: true, isPaid: true })`.
Free packages no longer appear in Recently Added (they surface via the free
sections). Still packages-only (NOT courses), still `RECENTLY_ADDED_LIMIT = 5`.

**Why:** Recently Added is a paid-product carousel; a free package
(`GSRTC Conductor`) was leaking in. With the gate the freed slot is filled by the
next paid package, so the section still shows up to 5.

**Regression QA:** Confirm no `isPaid:false` package appears in the section; confirm
it still returns up to 5. Reuses existing `active`/`createdAt` selectivity.

---

## 2026-06-11 — Category listings now inline each category's OWN direct materials

**Files:**
- `src/client/material/entitlement.ts` — new `listDirectMaterialsForCategory(categoryId, customerId, search?)`
  helper: fetches the materials attached DIRECTLY to one category (not its
  subtree), shaped via `shapeMaterialForClient` + `getPurchasedMaterialIds`
  (isPaid/isPurchased + gated file/directLink). Sort `{order:1, createdAt:-1}`.
- `src/client/catalog/catalog.controller.ts` — `getCatalogMaterials`
  (`GET /client/catalog/:type/:id/materials`): each `list[]` entry now also
  carries `materials: []` (the category's own direct materials).
- `src/client/categories/categories.controller.ts` — `listMaterialCategoryChildren`
  (`GET /client/material-categories/:id/children`): each child `list[]` entry now
  carries `materials: []`, and the response adds `parentMaterials: []` for the
  queried parent category's own direct materials.

**What changed (response shape, not count semantics):** A material category can
have BOTH child folders AND its own directly-attached materials (e.g. root
"Current Affairs - Prasant Sir" has 2 child folders + 1 direct material). These
endpoints previously returned only category meta + subtree `count`; they now also
inline the direct materials so the FE doesn't need a follow-up call to discover
them. `GET /client/material-categories/:id/materials` already returned the direct
set as `data.list` — unchanged.

**Note on `search`:** In both endpoints `search` continues to filter the
CATEGORIES by title only — the inlined `materials` are each surviving category's
full direct set (NOT re-filtered by the category search term).

**Why:** FE needs to render a folder's own files alongside its sub-folders in one
response. No count/badge change — `count` still rolls up the subtree.

**Regression QA:** Verify a category with both children and own materials returns
non-empty `materials`; verify gating (paid + unpurchased → `file`/`directLink`
empty). Reuses existing `materialCategoryId/status` index.

---

## 2026-06-11 — REVERTED: free-only count gating on free products

**Status:** This change was made and then **reverted in the same session** — it is
NOT in the codebase. Recorded for history.

**What it was:** Catalog tab counts (`getCatalogVideos/Materials/Tests`) and
package-detail counts (`buildVideoCategoryGroup` / `buildMaterialCategoryGroup` /
`buildExamCategoryEntry`) were briefly gated so that when the parent product is
free (`isPaid === false`) only free content counted (videos `priceType:"free"`,
materials/exams `isPaid:false`).

**Why reverted:** Product decision — counts on a free course/package should count
ALL assigned content (paid + free), not just the free subset. `loadParent` no
longer returns `isFree`; the `isFree` param on the package builders was removed.

The PUBLISHED + non-ended exam filter (next entry) was kept — only the
paid/free gating was reverted.

---

## 2026-06-11 — Exam count/listing now hides ENDED scheduled exams

**Files:**
- `src/client/catalog/catalog.controller.ts` — `getCatalogTests`
  (`GET /api/v1/client/catalog/:type/:id/tests`) per-category badge + `totals.items`.
- `src/client/exam/exam.controller.ts` — `listExamsByCategory`
  (`GET /api/v1/client/exams/categories/:categoryId/exams`) exam list.
- `src/client/package/package.controller.ts` — `buildExamCategoryEntry`
  (package detail tests count).

**What changed (count/filter semantics):** Client-visible exam queries previously
filtered only `{ status: PUBLISHED }`. They now additionally drop scheduled exams
whose attempt window has **ended**, by adding:

```js
$or: [
  { type: ExamType.SUBJECT },        // always-available, no window → always counts
  { endAt: { $exists: false } },
  { endAt: null },
  { endAt: { $gte: now } },          // window still open
]
```

So a `daily`/scheduled exam with `endAt` in the past is excluded; `subject` exams
always count regardless of any stray date fields.

**Why:** Ended quizzes were inflating the package `/tests` badge (observed: badge 5
for `GSRTC Conductor` / `Gujarat Police` category, where 2 of the 5 published exams
were ended `daily` tests → correct count is 3). Badge, drill-in listing, and package
detail are kept consistent.

**Regression QA:** Verify the `/tests` badge equals the drill-in exam list length for
categories that mix `subject` and expired `daily` exams. No index change required, but
queries now also touch `endAt` — existing `categoryId`/`status` indexes still cover the
primary selectivity.

---

## 2026-06-10 — Free-materials & free-videos now also scan PAID products

**File:** `src/client/free/free.controller.ts` — `listFreeMaterials`
(`GET /api/v1/client/free-materials`) and `listFreeVideos`
(`GET /api/v1/client/free-videos`).

**What changed (query gate):** The product query in both handlers previously
filtered `isPaid:false`, so free content (free materials / `priceType:"free"`
videos) living inside a PAID course/package/live-course never surfaced. The
product `isPaid` gate is **dropped** — both endpoints now scan ALL active
products (`Package {active:true}`, `Course/LiveCourse {status:true}`), free and
paid alike. The per-item free gate is unchanged and still decides inclusion:
`Material {isPaid:false}` / `Video {priceType:"free"}`. Empty-branch pruning is
unchanged, so a paid product with zero free items still doesn't appear.

**Behavioural impact / QA:** A paid product that contains ≥1 free material/video
now shows as a top-level entry (with only its free items nested). Counts grow
accordingly. No schema/index change; same indexes as the prior tree entries.

---

## 2026-06-10 — Free-videos restructured to product-rooted recursive tree

**File:** `src/client/free/free.controller.ts` — `listFreeVideos`
(`GET /api/v1/client/free-videos`).

**What changed (response + query shape):** Was a flat paginated `Video.find`
list (videos whose category was in the assigned set, `priceType:"free"`). Now it
mirrors the `/free-materials` product-rooted recursive tree:
- **Top level is the free PRODUCT only** (course / package / live-course).
- Video roots per product: Course/LiveCourse via scalar `videoCategoryId`;
  Package via `PackageVideoCategoryRelation` (active) → `VideoCategoryRelation`
  (parent + child are roots).
- Each root is expanded to its full subtree via `VideoCategory.childCategoryIds`
  (BFS, `status:true`, sorted `order_by`). Free videos (`status:true,
  priceType:"free"`) are hung on whichever folder owns them; **every node carries
  `videos[]` and `children[]`** recursed to the bottom. Empty branches pruned;
  products with no free video anywhere dropped.

**No longer uses** `resolveAssignedCategoryIds()` for this endpoint (gated on
paid-OR-free assignment). Videos are returned as raw listing docs (same fields as
before) — playback URLs are NOT included; the FE still fetches the encrypted
stream from `/v1/lecture`, so the video-URL response contract is unchanged.

**Queries:** `Package/Course/LiveCourse.find({free})`;
`PackageVideoCategoryRelation.find({packageId:$in, active:true})` +
`VideoCategoryRelation.find({_id:$in})`; iterative
`VideoCategory.find({_id:$in, status:true})` to walk the tree; one
`Video.find({videoCategoryId:$in, status:true, priceType:"free"})`. Existing
indexes cover these (`VideoCategory.childCategoryIds`, `Video {videoCategoryId,
status, order}`, `PackageVideoCategoryRelation {packageId, active}`).

**FE must update:** response is no longer a flat video array — top entries expose
`type`, `categories[]`, and recursive `children[]`/`videos[]` per node, with
`videoCount` rolled up per node. A root assigned to multiple free products
appears under each (intentional).

---

## 2026-06-10 — Non-admin video-categories list now carries child_categories / hasChildren

**File:** `src/admin/master/videoCategory.controller.ts` — `getVideoCategories`
(`GET /api/v1/admin/master/video-categories`).

**What changed (query + response shape):** Was a bare
`VideoCategory.find().sort({ order_by: 1 })` returning raw docs with
`childCategoryIds` as unpopulated ObjectIds — the non-admin VideoCategory shape
had no usable parent/child info, so clients (Course / Live Course modal) couldn't
distinguish a parent category from a child. Now the query `.populate("childCategoryIds", "_id title slug status order_by").lean()`,
and each row is augmented with:
- `child_categories` — populated child docs (mirrors the admin
  `/video-categories` list's `child_categories`).
- `hasChildren` — boolean (`childCategoryIds.length > 0`); a parent is any
  category with ≥1 child.

**Backward-compat:** Purely additive — every pre-existing field is preserved
(`...c` spread). No schema/index change; `childCategoryIds` already exists on the
`VideoCategory` model. No backfill required. Clients filter parents via
`hasChildren === true`.

---

## 2026-06-10 — Free-materials restructured to product-rooted recursive tree

**File:** `src/client/free/free.controller.ts` — `listFreeMaterials`
(`GET /api/v1/client/free-materials`).

**What changed (response + query shape):** Was a 2-level "leaf categories grouped
by root ancestor" list whose product `parent` was resolved per-leaf (buggy: a
free material on a descendant of an assigned root had no direct product link, so
it leaked as a `type:null` standalone top-level). Now:
- **Top level is the free PRODUCT only** (course / package / live-course). A
  category is never a top-level card.
- Products are filtered to free (`isPaid:false`); each contributes its assigned
  material-category roots (`materialCategories[].category`, skipping
  `status:false` refs).
- Each assigned root is **expanded to its full subtree** via `childCategoryIds`
  (BFS, `status:true` only) — previously material roots were NOT expanded
  (unlike video roots), which is why descendant materials were mis-attributed.
- Free materials (`status:true,isPaid:false`) across the whole expanded set are
  fetched once and hung on whichever node owns them; **every node carries both
  `materials[]` and `children[]`**, recursed to the bottom. Empty branches
  (no free material anywhere in the subtree) are pruned; products with zero
  non-empty roots are dropped.

**No longer uses** `resolveAssignedCategoryIds()` for this endpoint (that gated
on paid-OR-free assignment); the free gate is now "material under a *free*
product's assigned category subtree". Materials are shaped with
`shapeMaterialForClient` to match `GET /materials/categories/:id/contents`.

**Queries:** `Package/Course/LiveCourse.find({free})`; iterative
`MaterialCategory.find({_id:$in, status:true})` to walk the tree; one
`Material.find({materialCategoryId:$in, status:true, isPaid:false})`. Existing
indexes cover these (`materialCategorySchema {parent,status,order}`, Material on
`materialCategoryId`). Response keys changed — **FE must update**: top entries
now expose `type` (`course|package|live-course`), `categories[]`, and recursive
`children[]`/`materials[]` per node; the old per-child `parent`/`lessonCount`
flat shape is gone (`materialCount` rolls up per node instead).

**QA:** A root category assigned to multiple free products appears under each
(intentional). Verify products without an `image` return `image:null` rather
than erroring.

---

## 2026-06-10 — Free-tests drill-down now buckets on `startAt` instead of `createdAt`

**File:** `src/client/free/free.controller.ts` — `listFreeTests`
(`GET /api/v1/client/free-tests`).

**Bug:** The year/month/week drill-down and the leaf list all bucketed and
filtered on `createdAt`, while the sibling `GET /api/v1/client/quizzes/daily`
(`exam.controller.ts`) buckets on the exam's scheduled `startAt`. A free test
created in one month but scheduled (`startAt`) in another landed in the wrong
bucket and was inconsistent between the two endpoints. The misleading code
comment claimed "free tests have no scheduled `startAt`", but `Exam` does carry
`startAt` (`models/exam/Exam.model.ts:49`, index at `:70`).

**Query-level change:**
- `baseMatch` gains `startAt: { $lte: endOfDay }` (was absent). This both bases
  the rollup on the scheduled date and **excludes tests with a null `startAt`**
  (and future-dated ones), matching quizzes/daily.
- Level 1 years: `$group _id` `$year:"$createdAt"` → `$year:"$startAt"`.
- Level 2 months: `$match` window + `$group` switched `createdAt` → `startAt`.
- Level 3 weeks: `find`/`select`/bucket switched `createdAt` → `startAt`.
- Level 4 list: window `createdAt` → `startAt`; sort `{orderBy:1, createdAt:-1}`
  → `{orderBy:1, startAt:-1}`.

**Behavioural impact / QA:** Counts and membership at every level shift from
creation date to scheduled date. **Free tests with no `startAt` set will no
longer appear** in this endpoint at all — confirm published free tests have
`startAt` populated, or they vanish from the free-tests listing. Index
`{ type:1, status:1, startAt:1 }` already exists and supports the new filter
(query also constrains `categoryId`/`isPaid`/`status`).

---

## 2026-06-09 — Package plan listing now excludes soft-detached (status:false) plans

**File:** `src/admin/package/package.service.ts` — `listPackagePlans`
(`GET /admin/packages/:id/plans`).

**Bug:** `DELETE /admin/packages/:id/plans/:planId` (`detachPlan`) soft-detaches by
setting the plan row's `status:false`, but `listPackagePlans` queried
`{ packageId }` with **no status filter**, so the detached plan kept coming back
(with `status:false`) in the package's plan list / Edit modal.

**Fix:** `listPackagePlans` now filters `{ packageId, status: true }`.

**Why soft-detach (not hard-delete):** a plan row is owned 1:1 by its package
(scalar `packageId`; the model's `pre("validate")` enforces exactly one owner — no
shared/many-to-many plans exist, verified: 0 rows with >1 owner across 37). More
importantly, `PackageCourseSubscription.packageId` **references the plan row**
(`ref: "PackageCourseEbookPrice"`), so hard-deleting would orphan a buyer's
subscription. Soft-detach preserves that reference. `detachPlan`'s update is scoped
`{ _id, packageId }`, so it only ever touches this package's own plan.

**Siblings:** `DELETE /admin/courses/:id/plans/:planId` (`deleteCoursePlan`) and
`DELETE /admin/live-courses/:id/plans/:planId` (`deleteLiveCoursePlan`) already
**hard-delete** the row (live-course additionally refuses when verified
subscriptions reference it), so they never exhibited the reappear bug — left as-is.

**No schema/index change.** Read-only filter addition. Pre-existing `status:false`
rows from the buggy period (3 observed) simply stop appearing; no backfill needed.

---

## 2026-06-09 — Course detail video/material counts now roll up the subtree

**File:** `src/client/course/course.service.ts` — `buildCourseDetails`
(`GET /api/v1/client/courses/:id`).

**What changed (count semantics):** the per-folder `count` badge for the **Videos**
and **Materials** tabs was counting **direct items only**
(`{ videoCategoryId: cat._id }` / `{ materialCategoryId: cat._id }`). It now rolls
up the whole subtree via `collectCategoryTreeIds` →
`{ <field>: { $in: ids }, status: true }`, matching the **Tests** count (already
subtree) and the unified catalog tabs (`src/client/catalog/catalog.controller.ts`).
The inlined `videos[].list` is unchanged — still the folder's DIRECT videos only;
only the `count` field changed.

**Why:** course/package folders can nest child folders, and content attaches to
leaves. Direct-only counts undercounted any parent folder (observed: a materials
folder showing 1 instead of 3, a video folder 1 instead of 6). The catalog tabs
and package detail (`buildPackageDetail`) already rolled up; this aligns course
detail to the same rule so every surface agrees.

**Migration/QA impact:** Read-only, no schema/index change. Course-detail
video/material badges **increase** for any folder with populated child folders
(unchanged for flat/leaf folders). Relies on `childCategoryIds` (already used by
`collectCategoryTreeIds`). No backfill.

---

## 2026-06-09 — Uniform `isPaid`/`isPurchased`/`daysLeft` flags on ExamCountdown listing rows

**File:** `src/client/categories/categories.controller.ts` — `listProductsByExamCountdown`
(`/exam-countdown/:id/packages`), `listBooksAndEbooksByExamCountdown`
(`/exam-countdown/:id/books-ebooks`), and `listBooksAndEbooksByExamCountdownCategory`
(`/exam-countdown-categories/:id/books-ebooks`).

**What changed:** every row in these listings now carries `isPaid`, `isPurchased`,
`daysLeft` (in addition to existing fields). Reuses the canonical ownership helpers
so the contract matches the primary listings:
- **Package** rows — `purchasedPackageEndAtMap` (now **exported** from
  `src/client/package/package.controller.ts`) + `computeDaysLeft`. Replaced the
  previous bespoke `ownedLiveSubs` query.
- **Live-course** rows — `getDaysLeftMapForLiveCourses` (from
  `src/client/live-course/entitlement.ts`); map membership = `isPurchased`, map
  value = `daysLeft` (null = lifetime).
- **Ebook** rows — unchanged (already had the flags via `EbookSubscription`).
- **Book** rows — new: `isPaid: true` (physical, no free-book concept),
  `daysLeft: null` (one-time purchase, no expiry), `isPurchased` from a fulfilled
  `BookOrder` (`verified`/`shipped`/`delivered`, `items.bookId` match — mirrors
  `getBookDetail`).

**New query:** batched `BookOrder.find({ customerId, "items.bookId": {$in}, status: {$in:[verified,shipped,delivered]} })`
in the shared `shapeBooksAndEbooks` helper (the two books-ebooks handlers were
de-duplicated into it).

**No schema/index changes.** Read-only response-shape addition (new fields on
existing rows). `isPaid`/`isPurchased`/`daysLeft` are always present; `daysLeft`
is `null` when not owned / lifetime / a book.

---

## 2026-06-09 — Legacy `examCountdownCategoryId` now derived; category endpoint reads the array

**Context:** Admin panel dropped the single "Exam Countdown Category" dropdown for
Book & Ebook; only `examCountdownCategoryIds[]` / `examCountdownIds[]` are
meaningful now. The single `examCountdownCategoryId` is NOT dropped yet (kept for
back-compat), but is now a **derived mirror** of `examCountdownCategoryIds[0]`.

**Write-path change (sync):**
- `src/admin/book/book.controller.ts` (`createBook`/`updateBook`) and
  `src/admin/ebook/ebook.service.ts` (`createEbook`/`updateEbook`) now set
  `examCountdownCategoryId = examCountdownCategoryIds[0] ?? null` whenever the array
  is present in the payload, and **ignore** any single value the admin still sends.
  On update, when the array is absent the single field is left untouched (delete
  from the `$set` payload) so a partial update can't wipe it.

**Read-path change (query shape):**
- `src/client/categories/categories.controller.ts`
  `listBooksAndEbooksByExamCountdownCategory`
  (`GET /client/exam-countdown-categories/:id/books-ebooks`) filter changed from
  `{ examCountdownCategoryId: id }` to `{ examCountdownCategoryIds: id }` (array
  membership). This was the **only** remaining reader of the legacy single field.
  ⚠️ After this change, legacy rows with the single field set but an empty array
  would vanish from this screen → **run the backfill below before/at deploy.**

**Backfill (required):** `scripts/backfill-book-ebook-exam-countdown-arrays.ts`
copies `examCountdownCategoryId` → `examCountdownCategoryIds: [<id>]` for every
Book/Ebook that has the single field set but an empty/missing array. Idempotent.
Run with **tsx** (not ts-node — project is ESM with a commonjs tsconfig):
`npx tsx scripts/backfill-book-ebook-exam-countdown-arrays.ts`.
(`examCountdownIds[]` has no single-field source — nothing to backfill.)

**Safe-to-drop status of `examCountdownCategoryId`:** After this deploy + backfill,
the legacy field has **zero readers** in this codebase. It can be dropped from the
Book/Ebook schemas (and its compound indexes) in a later cleanup once the admin
stops sending it and no external consumer reads it. Until then it stays, auto-synced.

---

## 2026-06-09 — New client endpoint: books + ebooks by ExamCountdown

**File:** `src/client/categories/categories.controller.ts` — new handler
`listBooksAndEbooksByExamCountdown`; route
`GET /api/v1/client/exam-countdown/:id/books-ebooks` in
`src/client/categories/categories.routes.ts` (authenticated).

**What `:id` is:** an `ExamCountdown` _id (a single exam event), NOT an
`ExamCountdownCategory`. Sibling to `GET /exam-countdown/:id/packages`; distinct
from the category-keyed `GET /exam-countdown-categories/:id/books-ebooks`.

**New queries / query-shape:**
- `Book.find({ examCountdownIds: <id>, status: true })` and
  `Ebook.find({ examCountdownIds: <id>, status: true })` — match on the new
  `examCountdownIds` arrays (indexed: `{ examCountdownIds: 1, status: 1, orderBy/order: 1 }`).
- Ebook pricing/ownership joins reused as-is: `EbookPrice.find({ ebookId: {$in}, status:true })`
  and `EbookSubscription.find({ customerId, ebookId: {$in}, status:true, endAt:{$gt:now} })`.

**Response shape:** `data: { examCountdown, list }`, paginated (`page`/`limit`/`search`).
Each `list` row tagged `type: "book"` or `type: "ebook"`; ebook rows carry
`plans`, `isPaid`, `isPurchased`, `subscriptionEndAt`, `daysLeft` (mirrors the
category books-ebooks endpoint exactly).

**No schema/index changes** — relies on the `examCountdownIds` fields/indexes added
in the Book/Ebook schema-fields entry below.

---

## 2026-06-09 — New Book & Ebook schema fields: `examCountdownCategoryIds[]` / `examCountdownIds[]`

**Files:** `src/models/book/Book.model.ts`, `src/models/ebook/Ebook.model.ts` — two
new array-of-ObjectId fields on **each** model:
- `examCountdownCategoryIds: [{ ref: "ExamCountdownCategory" }]` (default `[]`)
- `examCountdownIds: [{ ref: "ExamCountdown" }]` (default `[]`)

The legacy single `examCountdownCategoryId` stays — NOT removed. These are the
many-to-many successors (a book/ebook can link to multiple countdown categories and
to specific exam events).

**New indexes** (mirror the existing `examCountdownCategoryId` compound index):
- Book: `{ examCountdownCategoryIds: 1, status: 1, orderBy: 1 }`, `{ examCountdownIds: 1, status: 1, orderBy: 1 }`
- Ebook: `{ examCountdownCategoryIds: 1, status: 1, order: 1 }`, `{ examCountdownIds: 1, status: 1, order: 1 }`

**Write path:**
- Book — `src/admin/book/book.validation.ts` adds both fields via the existing
  `zObjectIdArray` preprocessor (accepts JSON array, single string, or
  multipart-flattened). `src/admin/book/book.controller.ts` renamed
  `coercePackageIds` → `coerceArrayFields`, now reassembling the bracketed
  multipart keys (`packageIds[]`, `examCountdownCategoryIds[]`, `examCountdownIds[]`)
  for both create & update. Empty array = "cleared"; omitted = untouched.
- Ebook — `src/admin/ebook/ebook.validation.ts` adds both fields via a new
  `zObjectIdArray` preprocessor. `src/admin/ebook/ebook.controller.ts`
  `applyEbookUploads` now calls a new `coerceArrayFields` for the same bracketed
  keys. Service `create`/`update` pass `validated` straight through, so persistence
  is automatic.

**Read path:** `GET /admin/books/:id` (`getBookById`) and `GET /admin/ebooks/:id`
(`getEbookById` service) now `.populate()` both new fields
(`examCountdownCategoryIds` → `_id,name,colorHex`; `examCountdownIds` →
`_id,title,examDate`). List endpoints spread the full doc, so raw ids flow through
there automatically.

**No backfill required** — fields default to `[]`; existing books/ebooks simply have
empty arrays until edited. New indexes build on deploy.

---

## 2026-06-09 — New Book schema fields: `demoFileName` / `bookFileName` (original PDF names)

**File:** `src/models/book/Book.model.ts` — two new optional `String` fields
(`demoFileName`, `bookFileName`, maxlength 500, default `null`) on the `Book`
schema (collection `ws_books`). Mirrors the existing `Ebook` model's
`demoFileName`/`bookFileName`.

**Why:** The multer-S3 storage renames every uploaded file to a timestamp-prefixed
key (`admin/profiles/{ts}-{fieldname}.ext`), so `demoUrl`/`bookUrl` only carry
`1781000928537-demoUrl.pdf` — the original human-readable name was discarded.
These fields persist `file.originalname` so the API can surface
`"GPL Technical Book.pdf"` like the Ebook detail does with `bookFileName`.

**Write path:** `src/admin/book/book.controller.ts` `mergeUploadedFiles` now reads
`file.originalname` for the `demoUrl` → `demoFileName` and `bookUrl` → `bookFileName`
PDF fields (in addition to existing `f.location` → URL mapping). Allowed through
validation via `src/admin/book/book.validation.ts` (`createBookSchema`, and thus
`updateBookSchema` by `.partial()`).

**Read path:** No query change. Admin `getBookById`/`getBooks` and client
`listBooks`/`getBookDetail` already spread the full doc, so the new fields flow
through automatically. (The trending endpoints build explicit field lists and do
NOT include them — by design, trending cards don't show a filename.)

**No index change. No required backfill** — fields are optional and default to
`null`; existing books simply have `demoFileName: null` until re-uploaded. To
backfill historical names, derive from the S3 key (strip the `{ts}-` prefix), but
there is no stored source for the true original name of already-uploaded files.

---

## 2026-06-09 — New client endpoint: products (packages + live courses) by ExamCountdown

**File:** `src/client/categories/categories.controller.ts` — new handler
`listProductsByExamCountdown`; route `GET /api/v1/client/exam-countdown/:id/packages`
in `src/client/categories/categories.routes.ts` (authenticated).

**What `:id` is:** an `ExamCountdown` _id (a single exam event), NOT an
`ExamCountdownCategory`. Distinct from the existing
`GET /exam-countdown-categories/:id/packages` (category-keyed, packages only).

**New queries / query-shape:**
- `Package.find({ examCountdownIds: <id>, active: true })` — matches on the
  `examCountdownIds` array (already indexed: `{ examCountdownIds: 1, active: 1 }`).
- `LiveCourse.find({ examCountdownIds: <id>, status: true })` — matches on
  `LiveCourse.examCountdownIds`.
- `PackageCourseEbookPrice.find({ packageId: { $in }, status: true })` and
  `LiveCoursePlan.find({ liveCourseId: { $in }, status: true })` — batched plan joins.
- `PackageCourseSubscription` aggregation `{$match: status:true}` → `$group` count.
- `LiveCourseSubscription` aggregation `{$match: status:true, paymentStatus:"verified"}`
  → `$group` count; plus an ownership lookup
  `{ customerId, liveCourseId: {$in}, status:true, paymentStatus:"verified", endAt:{$gt:now} }`.

**Response shape:** `data: { examCountdown, list }` where each `list` row is tagged
`type: "package"` or `type: "live-course"`, paginated (`page`/`limit`/`search`).
Package rows carry `plans.{withMaterial,withoutMaterial}` + `subscriberCount`; live-course
rows carry `plans[]` (+ `originalPrice`/`discountPercent`), `subscriberCount`, `isPurchased`.

**No schema/index changes** — reuses existing fields and indexes.

---

## 2026-06-09 — Free listings now gated on category ASSIGNMENT (any parent) + item-free

**File:** `src/client/free/free.controller.ts` — `GET /api/v1/client/free-materials`, `/free-videos`, `/free-tests`

**New shared helper:** `resolveAssignedCategoryIds()` — returns material/exam/video
category ids assigned to **ANY** active `Package`/`Course`/`LiveCourse` (paid OR free),
NOT just free parents (contrast with the existing `resolveFreeCategoryIds()`, which is
free-parent-only and is still used elsewhere). Video roots are expanded to their full
subtree via `collectCategoryTreeIds` (videos attach to leaf folders; parents assign the
root). Adds `LiveCourse` and `VideoCategory` as new query sources for this module.

**Two-gate rule now applied to all three free listings:**
1. **Assignment gate** — the item's category must be assigned to some product
   (course/package/live-course), paid or free. Orphan/unassigned categories never show.
2. **Free gate** — the item itself must be free.

**Query-shape changes:**
- **free-tests** — dropped the `$or: [{categoryId ∈ free}, {isPaid:false, categoryId≠null}]`
  contract. Now `{ status: PUBLISHED, isPaid:false, categoryId: { $in: <assigned exam cats> } }`.
  ⚠️ The old `isPaid:false` OR-branch let *any* free exam with a category surface even if
  unassigned — that no longer happens. Expect fewer tests post-deploy if free exams exist
  in unassigned categories.
- **free-videos** — added `videoCategoryId: { $in: <assigned video cats, subtree-expanded> }`
  to the prior `{ status:true, priceType:"free" }` filter.
- **free-materials** — the grouped free-material aggregation `$match` changed from
  `materialCategoryId: { $ne: null }` to `materialCategoryId: { $in: <assigned material cats> }`.

**Migration/QA impact:** Read-only (no schema/index change), but **result sets shrink**:
materials/videos/tests in categories not attached to any product disappear. Relies on the
existing `{ "materialCategories.category": 1 }` / `{ "examCategories.category": 1 }` package
indexes and `VideoCategory.childCategoryIds`. Regression-check each listing on the target DB,
especially free-tests (was previously surfacing via the now-removed OR-branch).

---

## 2026-06-09 — Dashboard daily-test now carries `isAttempt` + `lastResult`

**File:** `src/client/dashboard/dashboard.controller.ts` — `GET /api/v1/client/dashboard`

**What changed (new query / response shape):**
- The `daily-test` dashboard section's `data` now includes `isAttempt: boolean` and
  `lastResult: { _id, attemptNumber, score, timing, submittedAt } | null` alongside the
  raw Exam document.
- Added a new per-request query: `ExamResult.findOne({ customerId, examId: <dailyTest._id>, status: true })`
  sorted by `{ submittedAt: -1, attemptNumber: -1 }` (latest attempt wins).
  `isAttempt = false` / `lastResult = null` for logged-out users or when no submitted
  result exists; flips to `true` with the latest result once the customer has at least
  one `status:true` ExamResult for that test.
- Mirrors the `isAttempted` / `lastResult` semantics already used by
  `GET /client/quizzes/daily` (same `ExamResult` + `status:true` signal and shape).

**Migration/QA impact:** Read-only — no schema/index change. Relies on existing
`ExamResult` index `{ customerId, examId, attemptNumber }` for the lookup. Regression-check
the dashboard daily-test section for logged-in (attempted/unattempted) and logged-out cases.

---

## 2026-06-09 — `listFreeMaterials` response now groups leaves under top-most ancestor

**File:** `src/client/free/free.controller.ts` — `GET /api/v1/client/free-materials`

**What changed (query/response shape):**
- Previously returned a **flat** list of leaf category cards: `{ _id, title, image, lessonCount, parent }`.
- Now returns **groups keyed by the top-most ancestor** (`ancestors[0]`, or the
  category itself when it has no ancestors): `{ _id, title, image, children: [...] }`,
  where each child is the prior card shape (`{ _id, title, image, lessonCount, parent }`).
- A free leaf with **no ancestors** becomes its own top-level group with `children: []`
  (it IS the card — not self-nested).
- **New query:** a second `MaterialCategory.find({ _id: { $in: rootIds } })` fetches
  root titles/images for group headers (only for roots that aren't themselves free leaves).
- **Leaf query** now also selects `ancestors` (was `_id title image`).
- `search` now matches the **group (top) title** in app code (regex), not the leaf title.
- **Pagination** (`skip`/`limit`/`total`) is now over the **top-level group set**, not leaves.

**Regression QA:** FE drill-down still uses each child's `_id` via
`/materials/categories/:id/contents` — leaf ids are preserved inside `children`.
Verify deep trees (Root → Sub → Leaf) all roll up to the single root, and that
`search` still filters the visible cards (now by group title).

---

## 2026-06-08 21:05:18 +0530 — `ed1fa51`

**Commit:** `ed1fa513a1fdc3138109e9131797c0226b050f52`
**Author:** Dhruv
**Title:** feat: add presigned upload functionality for ebooks with DigitalOcean Spaces

### 🆕 New collection

- **`ws_pdf_upload_jobs`** — [src/models/system/PdfUploadJob.model.ts](../src/models/system/PdfUploadJob.model.ts)
  - One row per uploaded PDF; lifecycle is the source of truth the admin UI renders (BullMQ is just the runner).
  - **Indexes to ensure on target DB:**
    - `{ batchId: 1 }`
    - `{ status: 1 }`
    - `{ batchId: 1, index: 1 }` (compound, deterministic batch listing order)
  - ⚠️ Indexes are created by Mongoose on app boot — confirm they exist after cutover, or create manually.

### 🔧 Schema field additions — `ws_ebooks`

[src/models/ebook/Ebook.model.ts](../src/models/ebook/Ebook.model.ts) — 4 new fields:

| Field | Type | Default |
|---|---|---|
| `bookUploadStatus` | enum `none\|queued\|processing\|completed\|failed` | `none` |
| `bookUploadProgress` | Number (0–100) | `0` |
| `demoUploadStatus` | enum `none\|queued\|processing\|completed\|failed` | `none` |
| `demoUploadProgress` | Number (0–100) | `0` |

### 🗄️ Backfill migration (MUST RUN on target DB)

[src/migrations/2026-ebook-backfill-upload-status.ts](../src/migrations/2026-ebook-backfill-upload-status.ts)

- Backfills the 4 new ebook fields on pre-existing documents.
- Rule per slot: URL present → `completed` / progress `100`; else → `none` / progress `0`.
- Idempotent (only touches docs missing the status field), forward-only (no down migration).
- Also flushes admin ebook **list** + **detail** caches so stale cached payloads aren't served post-deploy.

```bash
MONGODB_URI="<target-db-uri>" npx tsx src/migrations/2026-ebook-backfill-upload-status.ts
```

### 🔍 Query-level logic changes (regression QA)

**1. Nested-subtree count rollup** — new shared helper [src/utils/categoryTree.ts](../src/utils/categoryTree.ts) (`collectCategoryTreeIds`).
Category badge counts changed from counting only the folder's **direct** items to rolling up the **entire nested subtree**.

- Query shape changed: `{ categoryId: cat._id }` → `{ categoryId: { $in: [...root + all descendant ids] } }`.
- Helper does a BFS traversal (multiple `find` calls per count) — more DB round-trips per count than before.

Applied in:
- [src/client/catalog/catalog.controller.ts](../src/client/catalog/catalog.controller.ts) — Videos, Materials, Tests badge counts
- [src/client/categories/categories.controller.ts](../src/client/categories/categories.controller.ts) — `listExamCategoryChildren`
- [src/client/course/course.service.ts](../src/client/course/course.service.ts) — `buildCourseDetails` exam counts
- [src/client/package/package.controller.ts](../src/client/package/package.controller.ts) — video / material / exam group counts

**2. New filter contract — exam counts are now PUBLISHED-only.**
All exam count queries above added `status: ExamStatus.PUBLISHED`. Drafts no longer inflate client-facing badges. (Previously `Exam.countDocuments({ categoryId })` counted all statuses.)

**3. New query — dashboard "Daily Test" section** — [src/client/dashboard/dashboard.controller.ts](../src/client/dashboard/dashboard.controller.ts)
```js
Exam.findOne({
  type: ExamType.DAILY,
  status: ExamStatus.PUBLISHED,
  startAt: { $lte: now },
  endAt:   { $gte: now },
}).sort({ startAt: -1 })
```
Returns the single currently-live daily test (within its `[startAt, endAt]` window). Section omitted when none is live. Relies on `Exam.type`, `Exam.startAt`, `Exam.endAt` being populated.
