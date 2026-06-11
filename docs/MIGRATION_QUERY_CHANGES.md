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
