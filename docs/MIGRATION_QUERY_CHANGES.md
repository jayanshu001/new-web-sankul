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
