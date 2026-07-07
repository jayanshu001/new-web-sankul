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
