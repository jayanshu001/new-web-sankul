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
