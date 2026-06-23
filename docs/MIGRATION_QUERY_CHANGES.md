# Migration Query / Schema / Index Changes

> Append-only log of query, schema, index, and migration changes. **Newest first.**

---

## 2026-06-23 — admin educator-details (MySQL): implement associations aggregate (was a stub)

**Bug:** `/admin/master/educators/:id/details` runs on the MySQL branch (`educator-auth` flagged) but only returned the SQL profile and **hardcoded empty `associations`/`summary`** — so an educator's courses/packages/sessions never showed (e.g. educator 20 has a `ws_course` row with 4 subscribers).

**Fix:** new read-aggregation module `src/modules/educator-auth/educator-details.{repository,transformer,service}.ts`, called from the controller's MySQL branch. Queries by `educator_id` (no new tables): `ws_course`, `ws_live_course`, `ws_package`, `ws_video_category` (split into recording **folders** = rows with `live_course_id` vs root **videoCategories**, mirroring the Mongo `liveCourseId` split), `ws_live_session`. Subscriber counts via `groupBy` on `ws_package_course_subscription` (by `course_id` / `package_id`) and `ws_live_course_subscription` (by `live_course_id`), `status=true`. Course `purchase`/`is_featured` (CourseFlag01 enum, '1'=yes) → `isPaid`/`isPopular` booleans. `totalSessionsConducted` = sessions with `status='ENDED'`. Output shape verified identical to the Mongo handler against live data (educator 20: 1 course, 4 subscribers). `yarn typecheck` ✅. Mongo branch untouched.

## 2026-06-23 — admin customer-details (MySQL): implement purchase aggregate (was a stub)

**Bug:** `/admin/customers/:id/details` runs on the MySQL branch (`customer-auth` flagged), but that branch only returned the SQL profile and **hardcoded empty `purchases`/`summary`** ("models not yet migrated") — so bought subscriptions never showed even though the rows exist (e.g. customer 472369 has a `ws_package_course_subscription` row).

**Fix:** new read-aggregation module `src/modules/admin-customer/admin-customer-details.{repository,transformer,service}.ts`, called from the controller's MySQL branch. Queries (no new tables): `ws_package_course_subscription` (split into **courses** = rows with `course_id`, **packages** = `package_id` & no `course_id`, mirroring Mongo `courseId`/`targetPackageId`), `ws_live_course_subscription`, `ws_test_series_subscription`, `ws_ebook_subscription`, `ws_book_order` (+`ws_book_order_item` joined by `order_id`), `ws_customer_address`. References hydrated by id (course/package/plan=`ws_package_course_ebook_price`, live course/`ws_live_course_plan`, test series/`ws_test_series_price`, ebook/`ws_ebook_order`, book, `ws_states`) and emitted as Mongo-style populated `{ _id, name, … }` sub-objects; Decimals→numbers; `isActive = status && endAt>now`.

⚠ Column inversion vs Mongo: SQL `package_id` = the package (Mongo `targetPackageId`); SQL `pcb_id`/`planId` = the price/plan (Mongo `packageId`). `ws_package_course_subscription` has no `payment_status` → `paymentStatus` derived from `status` (verified/pending). Response shape verified identical to the Mongo handler against live data (customer 472369: 1 package, 1 address). `yarn typecheck` ✅. Mongo branch untouched.

## 2026-06-23 — educator soft-delete column (MySQL): deleted educators leave the list

**Schema change (additive DDL) + repository wiring.** Deleting an educator on the `educator-auth` MySQL branch only set `status=false`; the admin list didn't filter that, so "deleted" educators kept showing. Hard delete is unsafe here — `ws_course.educator_id` has a real FK to `ws_course_educator`, and the Mongo model intentionally soft-deletes to keep course/package/session educator names resolvable.

**DDL** (`docs/migration/schema-changes/2026-06-23_course_educator_soft_delete.sql`, applied to staging):
```sql
ALTER TABLE ws_course_educator ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ws_course_educator ADD KEY idx_course_educator_deleted (deleted);
```
`schema.prisma` `CourseEducator` got `deleted Boolean @default(false)` + the index (added **surgically by hand**, NOT via `db:pull` — a full introspection against staging reverts the hand-curated enums/relations/comments and breaks unrelated files; `prisma:generate` only).

**Repository** (`educator-auth.repository.ts`): admin list/count `where` now defaults to `{ deleted: false }`; `disableAdmin` sets `deleted:true` (+ `status:false`, revokes tokens) retaining the row; `emailInUse` excludes `deleted` rows so a deleted educator's email frees up for reuse (Mongo partial-unique-index parity). Login lookups already gate on `status:true`, so deleted educators can't authenticate. Mongo path unchanged. `yarn typecheck` ✅.

## 2026-06-23 — educator admin list (MySQL): coalesce null timestamps (UI dropped rows)

**Transformer fix — restores Mongo parity.** `/admin/master/educators` on the `educator-auth` MySQL branch returned `updatedAt: null` for legacy `ws_course_educator` rows (only ever-edited rows have `updated_at`). Mongo (`timestamps:true`) always populated both dates, and the admin UI assumes a non-null `updatedAt` per row (formats it, silently drops rows it can't) — so only the 2 rows with a real `updatedAt` rendered out of 10. `toEducatorListDto` now coalesces each timestamp to the other (`createdAt ?? updatedAt`, `updatedAt ?? createdAt`), so any row with either date reports both. No query/schema change; Mongo path unaffected. `yarn typecheck` ✅.

## 2026-06-23 — administrator delete (MySQL): hard delete instead of disable

**Behavior change on the `admin-auth` MySQL branch.** Deleting an administrator previously only set `ws_users.status = inactive` (`disableAdministrator`), because `ws_users` has no soft-delete column. But the list query (`buildAdminListWhere`) does not exclude inactive rows by default, so a "deleted" admin kept appearing in the list — unlike the Mongo path (sets `deleted: true`, list filters `deleted: false`).

Fixed by physically deleting the row for Mongo parity. New `admin-auth.repository.deleteAdmin(id, modelType)` runs one `$transaction`: delete `ws_admin_access_tokens` (FK on `admin_user_id`), `ws_model_has_roles` + `ws_model_has_permissions` pivots (by `model_id` + `model_type`), then the `ws_users` row. Service `disableAdministrator` → replaced by `deleteAdministrator`; controller delete path calls it. No schema/DDL change (uses existing tables). Mongo branch unchanged (still soft-deletes). `yarn typecheck` ✅.

## 2026-06-23 — admin video + administrator validation: accept MySQL numeric ids; role compulsory on create

**Validation-layer only — no query/schema/index/DB-behavior change.** Two fixes surfaced by the migrated backends:

1. **`videoCategoryId` "Invalid id" on `/api/v1/admin/videos`** (`src/admin/video/video.validation.ts`). The `admin-video` module runs on MySQL (numeric ids via `parseVideoId`), and the FE sends those category ids as JSON **numbers** (e.g. `12`). The prior `objectIdSchema` was a union of two `z.string().regex(...)` branches, which still rejected a numeric (non-string) value → `"Invalid id"`. Fixed by switching to `z.coerce.string().refine(...)`: the value is coerced to a string first, then accepted if it matches **either** a Mongo ObjectId **or** a MySQL numeric id (`^[1-9]\d*$`). Covers `videoCategoryId` (list/create/update) and reorder `id`; works on both backends and for both string and numeric input.

2. **Role compulsory on Add Administrator** (`src/admin/administrator/administrator.validation.ts`). Split the role union into `roleValue` (built-in enum | Mongo ObjectId | MySQL numeric) and wired `createAdministratorSchema.role` to a required variant (`requiredRoleField`); update still uses the optional `roleField`. Missing/empty role → 422 `"Role is required"`. Controller already handled role defensively.

`yarn typecheck` ✅. No transformer/repository/Prisma changes; Mongo fallback paths untouched.

## 2026-06-22 — `/admin/quizzes/categories` pagination + the 121-vs-111 explanation

**Why the UI shows 111 of "121":** `ws_exam_category` has 121 rows but **10 are soft-deleted (`deleted=1`)**. The Mongo `ExamCategory` model has NO `deleted` field (Mongo hard-deletes), so the live data Mongo always served was **111**. The SQL list correctly excludes `deleted=1` (Mongo parity) → 111. NOT a bug; the 10 are legacy soft-deletes that should not appear.

**Pagination added (additive, non-breaking):** `getCategories` (`admin/exam/exam.controller.ts`) now honors `page` + `limit`/`per_page` (skip/take via `catalog-exam.listCategories` + `countCategories`) and returns a `pagination: {page, limit, total, totalPages}` sibling. `data` STAYS the array (back-compat) — when no `limit` is passed it still returns all matching rows. Verified: `?limit=500`→111 items/total 111; `?page=1&limit=10`→10 items/total 111/12 pages. `yarn typecheck` ✅.

## 2026-06-22 — swept + closed ALL remaining Mongo-only list endpoints (MySQL-only, no fallback)

With Mongo disconnected, residual unmigrated handlers buffer-timed-out. Resolved systematically:
1. `mongoose.set("bufferCommands", false)` in `config/db.ts` → stray Mongo calls fail **instantly** with a clear error, not a 10s hang.
2. **Empirically swept all 194 admin+client list-GET endpoints** with Mongo off → found **10 Mongo-only** (6 handler groups), then migrated each to SQL (Mongo fallback retained): exam-categories (admin+client, via `catalog-exam`), client books-trending ×3 (`client-trending`), client promocodes list (`promo-code.listPublicPromocodes`), client address characteristic (`goal.listActiveGoalsSql`), client offline dashboard (`offline-batch`+`offline-city`), and admin book-settings → **net-new `ws_book_setting` table** (`2026-06-22_book_setting.sql`) + Prisma `BookSetting` + `admin-book.getBookSettings/updateBookSettings`.
3. **Re-swept: admin 100/100 + client 94/94 list-GETs Mongo-clean (0 broken)**; all 10 originally-failing endpoints now `success:true`. `yarn typecheck` ✅.

Scope note: the sweep covered list-GETs. `:id` GETs and write endpoints (e.g. exam-category create/update/delete) weren't exhaustively exercised — they serve SQL where their module is migrated; any residual Mongo-only write now fast-fails visibly (see #1) rather than hanging. (Per-handler detail in the dated entries below.)

## 2026-06-22 — feat: exam-category admin+client read handlers gain SQL branches (Mongo fallback intact)

Migrated the exam-category READ handlers off Mongo onto `ws_exam_category` (Prisma
`examCategory`) via the existing `catalog-exam` module (flag `catalog-exam`,
`isExamMysql()`). All keep the Mongo `else` fallback; response shapes unchanged.

Handlers gated:
1. **Admin** (`src/admin/exam/exam.controller.ts`): `getCategories`, `getCategoryTree`,
   `getCategoryById`, `getCategoryPackages`, `getCategoryCourses`.
2. **Client** (`src/client/exam/exam.controller.ts`): `listCategories`
   (GET /api/v1/client/quizzes/categories).

New service helpers (`src/modules/catalog-exam/catalog-exam.service.ts`):
`listCategories`, `countCategories`, `listClientCategories`, `countClientCategories`,
`getCategoryTree`, `getCategoryByIdWithParent`, `categoryExists`, `getCategoryPackages`,
`getCategoryCourses`. New repo methods (`catalog-exam.repository.ts`): `listCategories`,
`countCategories`, `categoryWhere`, `listAllActive`, `listCategoryPackages`,
`countCategoryPackages`, `categoryPackageWhere`, `listPackagePrices`,
`listCategoryCourses`, `countCategoryCourses`, `categoryCourseWhere`.

Query notes:
- Root filter: SQL sentinel `parent_id = 0` (Mongo `parentId: null`); roots map 0 → null
  on output. All queries exclude soft-deleted (`deleted = false`) for Mongo parity.
- Category→package/course links resolved via `ws_exam_category_package` /
  `ws_exam_category_course` (`examCategoryPackage/Course { some: { examCategoryId } }`).
- Package representative price: default plan wins, else lowest active price
  (`ws_package_course_ebook_price`, status=true) — mirrors the Mongo logic.
- Admin docs preserve Mongo key names (`_id, name, image, parentId, orderBy, status,
  createdAt, updatedAt`); package/course item shapes preserve `{ id, name, price,
  shareableLink, status }` / `{ id, name, status, orderBy }`.

---

## 2026-06-22 — feat: 4 client read handlers gain SQL branches (Mongo fallback intact)

Added flag-gated SQL branches to four client handlers so they stop hitting Mongo. All
keep the Mongo `else` path. Response shapes verified identical.

1. **Client book trending** (`src/client/book/book.controller.ts`) — `listTrendingBooks`
   (combined), `listTrendingBooksOnly`, `listTrendingEbooksOnly` now branch on
   `isClientTrendingMysql()` and call `client-trending.service`'s `fetchTrendingBooksOnly`
   / `fetchTrendingEbooksOnly`. Combined handler merges both by `createdAt` desc, slices
   to `limitNum`, attaches `shareableLink` — same as Mongo.
2. **Client promocode list** (`src/client/promocode/promocode.controller.ts`
   `listPromocodes`) — branches on `pcSql.isPromoCodeMysql()`. New SQL fn
   `listPublicPromocodes({skip,limitNum,pageNum})` in `modules/promo-code/promo-code.service.ts`:
   queries `prisma.promoCodeRule` with `status:true, type:"public"`, active window
   (`promoStartAt<now`, `promoExpireAt>now`), `orderBy promoExpireAt asc`, projecting the
   same fields the Mongo `.select(...)` exposed (`_id, promocode, title, description,
   discountType, discountValue, promo_start_at, promo_expire_at`). Returns `{data,pagination}`.
3. **Client address characteristic** (`src/client/address/address.controller.ts`
   `getCharacteristic`) — goals now branch on `isGoalMysql()`. New SQL fn
   `listActiveGoalsSql()` in `modules/goal/goal.service.ts`: `prisma.goal.findMany({where:{isActive:true},
   orderBy:{createdAt:"asc"}})` → `{_id,title,image,labels}` matching Mongo
   `.select("title image labels")`.
4. **Client offline banner** (`src/client/offline/offline.controller.ts`
   `getOfflineDashboard`) — banners now branch on `isOfflineBatchMysql()` calling existing
   `offline-batch.service.listBanners()` (repo sorts `orderBy asc`, same as Mongo
   `sort({orderBy:1})`). Cities/upcoming-batches stay Mongo (out of scope).

`yarn typecheck` green.

---

## 2026-06-22 — fix: `/admin/videos` `video_category` inconsistent shape (UI dropped rows)

`GET /admin/videos` returned `video_category` as a populated object `{id,name,slug}` when the category resolved,
but a **bare string id** when it didn't — a mixed-type array the admin table couldn't render uniformly (rows with
the unexpected shape were dropped → "only 7 of 10 showing"). Root cause is two-fold: (1) the transformer
(`admin-video.service.ts` + the Mongo `toItem` in `admin/video/video.controller.ts`) emitted object-or-string; and
(2) a **staging data gap** — 156 of 159 `ws_video` rows are orphans whose `vcategory_id` has no matching
`ws_video_category` row (only 3 resolve), so most fell to the string branch. (In prod every category resolves, so
it never surfaced.)

**Fix:** both transformers now emit a **uniform object** — `{ id: String(videoCategoryId), name: <title|null>, slug: <slug|null> }`,
or `null` when there's no category id. Never a bare string. Verified: `/admin/videos` returns `video_category` as an
object for all 10 rows (resolved → name/slug; orphans → name/slug null). `yarn typecheck` ✅.

Note: orphan rows show `name: null` in staging (the category rows simply aren't in the SQL subset); in production
those categories exist and populate normally.

**Follow-up (the actual UI row-drop):** the 3 hidden rows were the live-recording promoted videos (33259–61) — they
had **empty `slug`** (`recording.promote` creates videos with no slug → Mongoose default `""`, and
`backfill-live-recordings.ts` used `v.slug ?? slugify(...)` which doesn't replace `""`). The admin table drops
empty-slug rows. Fixed: backfill now uses `(v.slug && trim) || slugify(...)`; and patched the 3 existing rows
`UPDATE ws_video SET slug=CONCAT('video-',id) WHERE slug IS NULL OR slug=''`. Verified `/admin/videos` → 10 rows,
**0 empty slugs**, `video_category` uniform objects. (Duplicate slugs are fine — the list already renders
two identical "Direct - Indirect Speech" rows; only empty slugs were dropped.)

---

## 2026-06-22 — fix: global BigInt JSON serializer (`/admin/dashboard` 500 "Do not know how to serialize a BigInt")

`GET /admin/dashboard` 500'd with `Do not know how to serialize a BigInt`. Cause: the SQL dashboard's recent
subscription lists (`admin-dashboard.service.ts` `recentPackageSubs`/`recentCourseSubs`) use Prisma `include`
(full row), so `PackageCourseSubscription.trackingId` (`BigInt? @map("tracking")`, the AWB) reached `res.json()`,
which `JSON.stringify` cannot serialize. (BigInt columns also exist on `BookOrder.tracking_id` + the unsigned-bigint
RBAC ids, so this is a class of bug.)

**Fix:** added a global `BigInt.prototype.toJSON = () => this.toString()` at boot (`src/index.ts`, top) — any BigInt
reaching a JSON response now serializes as a string. One line, fixes every raw-row endpoint. Verified:
`/admin/dashboard?orderRange=today&totalRange=today&recentLimit=7` → 200; `trackingId` now `"119400280393"` (string).
`yarn typecheck` ✅.

---

## 2026-06-22 — Phase B COMPLETE (operational): MongoDB connection removed; app runs MySQL-only

The app now boots and serves with **no MongoDB connection** — Mongo is an opt-in fallback, OFF by default.
- **`config/migration.ts`**: new `isMongoFallbackEnabled()` (reads `MONGO_FALLBACK_ENABLED`, default false).
- **`index.ts`**: `connectDB()` (Mongo) now gated on `isMongoFallbackEnabled()` — skipped by default. Boot logs
  `MongoDB fallback DISABLED — running MySQL-only`.
- **`config/env.ts`**: `MONGODB_URI` moved out of always-`REQUIRED`; required only when the fallback is enabled.
- **`.env` / `.env.example`**: `MONGO_FALLBACK_ENABLED=false` documented.
- **`admin/notification/scheduler.ts`**: the empirical no-Mongo boot surfaced one real ungated Mongo call — the
  cutover "straggler" rehydrate `Notification.find()` (+ the fail-path `Notification.updateOne`). Both now gated on
  `isMongoFallbackEnabled()` (SQL rehydrate via `admin-notification` is canonical).

**Verified:** boots clean with 0 Mongo calls/errors; **22 endpoints across all admin+client modules return 200 with
MongoDB disconnected** (empirical proof of SQL-only runtime). `yarn typecheck` ✅. Reversible — set
`MONGO_FALLBACK_ENABLED=true` to restore the legacy connection.

**Remaining (optional, now low-risk dead-code cleanup):** physically deleting `src/models/**`, the dormant `else`
branches, and the `mongoose` dependency. Safe to do anytime since nothing connects to Mongo, but NOT required for
"off MongoDB" — and best done incrementally (relocate shared enums first) with typecheck between steps.

---

## 2026-06-22 — Phase B reachability audit + boot permission seeder → SQL

**Audit finding (important):** a full classification of the 153 non-model files importing `src/models` (5 parallel
agents) proved **statically unreliable** — it repeatedly flagged verified-SQL modules (catalog-package, client-search,
admin-material/promoter/promocode/exam/dashboard, client-free) as "Mongo-only" because it didn't trace
controller→service delegation. Reachability checks then showed **most "Mongo-only" files are dead `else`-branches** in
SQL mode: admin realtime/recording is already dual-path and already calls `maybeAutoPromoteRecordingSql`
(`admin/live/live.controller` L540/L1490); client reminder writes already branch on `client-live-reminder`
(`live-reminder.service` L116); promoter `overview.service` + the `client/course` resolver helpers are Mongo
else-branch implementations. **At runtime (all flags on) the app is effectively SQL-only on reads + writes.**

**Genuine live Mongo write eliminated — boot permission seeder → SQL.** `syncPermissionCatalog` (run at boot,
`index.ts:57`) wrote Mongo `Permission`/`PermissionCategory` unconditionally. Added `syncPermissionCatalogSql`
(upsert `ws_permission_category` by slug + `ws_permissions` by name/guard, gated on `isMysqlModule("admin-rbac")`,
Mongo fallback retained). Verified at boot: `catalog sync complete (sql)`, `ws_permissions`=648 / `ws_permission_category`=23.
`yarn typecheck` ✅.

**Remaining genuine live Mongo path:** the admin permission-management CRUD (`permission.controller` →
`permission.service`, Mongo `Permission`) — SQL equivalents already exist in the `admin-rbac` module
(`listPermissions/createPermission/...`); wiring needs response-shape matching to the admin dashboard. Everything
else Mongo-touching is dead `else`-branch fallback (only removed in the irreversible strip).

---

## 2026-06-22 — live-recording subsystem → SQL (recordings, lecture, session-recordings, session-detail)

The realtime/video-playback tier. Schema: `ALTER ws_video_category ADD live_course_id` (folders→course link;
`2026-06-22_video_category_live_course.sql`); Prisma `VideoCategory.liveCourseId` added. Backfill
`scripts/backfill-live-recordings.ts`: 8 folders + 3 promoted videos Mongo→SQL (live courses map by name).

Handlers wired (client/live-course + client/live controllers), Mongo fallback retained, video-URL contract honored:
- **`listLiveCourseRecordings`** → `getRecordingsForClient` (folders via ws_video_category.live_course_id, lectures via
  ws_video, per-quality from ws_live_session.recordings, progress from ws_lecture_progress, qualities helper reused).
- **`getLiveCourseLecture`** → `clientLectureVideoInCourse` + the SAME local `encryptLecture` util → identical
  AES `/v1/lecture` envelope by construction. (Verified: 403 entitlement gate fires correctly for non-subscribers.)
- **`listLiveCourseSessionRecordings`** → `listSessionRecordingsForClient` (SCHEDULED/CREATED via ws_live_session_course).
- **`getLiveSessionForClient`** → SQL session (`adminLive.findSessionByAnyId`) + SQL write-back
  (`adminLive.updateSession`) of hls/recordings/status; **StreamOS runtime + Socket.IO `recordings_ready` kept**;
  per-viewer trial ported to SQL (`resolveLivePreviewStateSql` over ws_live_session_preview); recording auto-promote
  ported to SQL (`maybeAutoPromoteRecordingSql` → ws_video_category/ws_video).

**Verified live (integer ids, previously 422/404 on SQL ids):** recordings 200 (2 folders), lecture 403 (entitlement),
session-recordings 200 (3), session-detail 200 (id=2, accessLevel=preview). Regression: live list/detail/recordings 200.
`yarn typecheck` ✅. New service fns in `admin-live-course.service.ts`; new repo methods + `coursesSlimByIds`.

---

## 2026-06-22 — client live-course detail + my-courses → SQL (safe metadata tier)

Migrated the two data-only client live-course reads (the realtime/video-playback handlers stay on Mongo by
decision — see finding below):
- **`getLiveCourseForClient`** (`GET /client/live-courses/:id`) and **`listMyLiveCourses`** (`/my`) now branch on
  `liveSql.isLiveCourseMysql()`. New `admin-live-course.service.ts` fns `getLiveCourseDetailForClient` +
  `listMyLiveCoursesForClient`; new repo methods `findEducator`, `findPackageCategory`, `coursesSlimByIds`,
  `myLiveCourseSubs` (reuses existing `plansByIds`, `listPlans`, `hasAccessToAnyLiveCourse`, `getDaysLeftMap`).
  Educator/packageCategory are now populated (those tables exist — the old "no SQL table" comment was stale).
  `subjectsCount` = schedule-folders length; `materialsCount` = 0 (no SQL home — documented drift). Mongo fallback retained.
- **Verified:** `/live-courses/3` → SQL (int `_id`, no `__v`, stats/plans), `/live-courses/my` → 200. typecheck ✅.

### ⚠️ FINDING — pre-existing id-space breakage in the live realtime handlers
`listLiveCourseRecordings`, `getLiveCourseLecture`, session-recordings, and `getLiveSessionForClient` are Mongo-only
and guard with `mongoose.Types.ObjectId.isValid(id)`. Because the live-course **list/sessions were already SQL**
(flag long-standing), the client already receives **integer** ids, so these handlers already return **422/404** on
them — they are effectively non-functional in SQL mode, INDEPENDENT of this change. "Keeping them on Mongo" does not
gracefully degrade; to make live recordings/lecture/session playback actually work in SQL mode they must accept the
integer id-space (i.e. be migrated to SQL incl. the `/v1/lecture` video-URL contract).

---

## 2026-06-22 — access-token layer: closed the last Mongo gap (educator/promoter logout-all)

Investigated the auth token layer end-to-end. Finding: it was **already ~95% on SQL** —
`customer/educator/promoter-auth` repos all persist/validate/rotate tokens in SQL
(`ws_customer_access_token` / `ws_educator_access_tokens` / `ws_promoter_access_tokens`; methods
`createToken` / `findActiveTokenByRefresh` / `deactivateToken` / `deactivateAllTokens`), the services branch on
`isMysqlModule`, and the authoritative **revocation is Redis** (`libs/tokenRevocation.ts` cutoff; `authenticate`
calls `isRevoked()`, never a Mongo lookup). The earlier "tokens are Mongo" reading was the `else` fallback branches.

**Only gap:** the educator + promoter `logout-all-devices` `extraTeardown` callbacks wrote Mongo
(`EducatorAccessToken/PromoterAccessToken.updateMany`) with no SQL branch (customer already had one). Fixed to
mirror customer — branch on `isMysqlModule("educator-auth"|"promoter-auth")` → `deactivateAllTokens(id)`, Mongo
fallback retained. Files: `src/educator/auth/educator.auth.routes.ts`, `src/promoter/auth/promoter.auth.routes.ts`.
(This is bookkeeping cleanup; real logout-all revocation is the Redis cutoff, unchanged.)

**Verified:** `ws_customer_access_token`=349 rows + `ws_promoter_access_tokens`=2 (logins write SQL);
`yarn migration:api:customer-auth` 9/9 (OTP→validate→token→refresh-rotation→logout all on SQL). `yarn typecheck` ✅.

---

## 2026-06-22 — catalog-package MIGRATED to SQL (package detail/list/by-type/by-goal/my)

The last content module. `ws_package` was a structural subset; closed the gap and wired all 5 handlers.

**Schema** (`docs/migration/schema-changes/2026-06-22_catalog_package_links.sql`): the package→category
link tables already existed with data (`ws_package_specific_subject`=1620, `ws_material_category_package`=13,
`ws_exam_category_package`=66). Added only the missing columns: `goal_label_id`, `goal_id`, `is_paid`,
`is_smart_course`, `is_planner_course` on `ws_package`. Prisma `Package` model extended (`@default`s on the
booleans so `create` is unaffected); regenerated.

**Composition** — new `src/modules/catalog-package/catalog-package.detail.sql.ts`:
`buildPackageDetailSql` + `enrichPackagesSql` + list queries. Reuses category-tree (`descendantsOf` + recursive
CTEs), `commerce-price` (plans split by withMaterial), `commerce-subscription` (active → isPurchased/daysLeft),
`promo-code` (public+active appliesTo=package), and populates packageType/goal. Field map: `withMaterialText`←
`with_material`, `subtitle`→"" and examCountdown arrays→[] (absent in real docs).

**Wiring** — `client/package/package.controller.ts`: `isPackageMysql()` branch added to `getPackageDetail`,
`listPackages`, `listPackagesByType`, `listPackagesByGoal` (label ids = the goal module's synthetic ints),
`listMyPackages`. Mongo fallback retained.

**Backfill** — `scripts/backfill-catalog-package-fields.ts` (goal_id/goal_label_id/is_paid/smart/planner). Resolves
0 in staging (Mongo packages are disjoint from the real SQL packages — same subset situation as ws_exam/customer).
The SQL packages carry their own links + defaults, so the composition reads fully from SQL.

**Verified live** (flag `catalog-package` ON): `GET /client/packages/3` → detail, pkg._id=3, 20 video/2 material/10
test groups, plans 2/3, integer ids, no `__v`; `/packages` + `/packages/type/1` → SQL lists (int ids, no `__v`);
`/packages/my` → 200. Regression: types/courses/wishlist/books still 200. `yarn typecheck` ✅.
**Documented drift:** incidental Mongo-only fields not stored in SQL (e.g. `__v`, `isMagazine`, `notificationTopic`,
per-category slug/parent spread) are not reproduced — functional parity on all consumer fields.

---

## 2026-06-22 — flipped the 5 receipt/PDF-generator flags ON (now SQL); catalog-package found unwired

Final flip pass after the rows 29–42 work. Added to `MIGRATION_MYSQL_MODULES`:
`book-receipt, course-receipt, ebook-receipt, exam-solution, pdf-course-receipt`. Each is wired
(`isMysqlModule(MODULE)` gates the DB-load step in `src/libs/core/generate.ts` + `src/utils/pdfCourseReceipt.ts`),
so the flip switches the data read to SQL. `yarn typecheck` ✅; server reboots clean with the flags active.

**Verified (tsx, real SQL ids → PDF buffer from the SQL branch):**
- `book-receipt` — order 148647 (paid) → PDF 52 KB ✅
- `course-receipt` — subscription 11 (parent order paid) → PDF 54 KB ✅
- `pdf-course-receipt` — subscription 19 → PDF 1.4 KB ✅
- `exam-solution` — exam 300001 / attempt 17 → PDF 67 KB ✅
- `ebook-receipt` — SQL branch **proven** (reads `ws_ebook_order`, applies the paid-check) but no fully-paid
  ebook order exists in staging (`razorpay_payment_id` empty), so a full PDF couldn't be rendered here. Staging-data
  limitation, not a code issue — renders in prod against a paid order.

**`catalog-package` NOT flipped — it's built dual-path but the controller is unwired.** `client/package/package.controller.ts`
imports only `isPackageTypeMysql`; the package detail/list handlers (`getPackageDetail`, `listPackages`,
`listPackagesByType`, `listPackagesByGoal`) still guard on `mongoose.Types.ObjectId.isValid()` with no
`isPackageMysql()` branch. The SQL service fns (`findPackageById`, `listActivePackages`) exist but aren't called.
Flipping the flag would be a no-op. Wiring it is real build work (full package DTO has Mongo-only fields +
goal/exam/material/video/plan/promo/chat joins) — tracked separately, NOT a flag flip.

`backfill-c4-testseries.ts` reported `test_series_exam: inserted=0 skipped=2`. Root cause (proven, not a code
bug): the 2 Mongo `TestSeriesExam` links reference exams titled **"Exam One" / "Exam Twos"**, but staging
`ws_exam` holds only 1 unrelated row (`"test"`). `ws_exam` is **introspected legacy/production source** (no
script writes to it — confirmed: no `prisma.exam.create` anywhere), so in this subset DB the referenced exams
simply don't exist. The natural-key join (Mongo `Exam.title` → SQL `Exam.name`, which maps to `ws_exam.title`)
is correct; in production `ws_exam` already holds the real exams, so the links resolve there.

- **End-to-end proof (seed → verify → revert):** temporarily inserted `ws_exam` rows titled "Exam One"/"Exam Twos",
  re-ran the backfill → `test_series_exam: inserted=2`, and `GET /admin/test-series/1/papers` returned **2 papers
  from SQL** (integer `_id`, populated `examId {_id,title,durationMinutes,questionCount}` + `contentCategoryId`,
  no `__v`). Then deleted the temp exams and re-ran → links back to 0. Staging restored exactly
  (`ws_exam`=1, `ws_test_series_exam`=0, `ws_test_series_content_category`=2 retained).
- **`scripts/backfill-c4-testseries.ts`** — now logs WHICH natural key failed per skipped link
  (`↳ exams not found in ws_exam (by name): …` / series / content-category), so a prod run surfaces exactly
  what's missing instead of a bare skip count. No behavioural change to the insert path.

---

## 2026-06-22 — backfills for the two residual pending-module data gaps (promo-code + live-reminder customer_id)

Follow-up to the rows 29–42 verification. Two `scripts/` backfills added (both idempotent, natural-key
bridged, skip-what-can't-map — same contract as `backfill-c4-wishlist`):

- **`scripts/backfill-promo-code.ts`** — Mongo `ws_promo_codes` (`PromoCode`, C5 appliesTo schema) → SQL
  `ws_promo_code` (`PromoCodeRule`). Maps `promo_start_at`/`promo_expire_at`→`promoStartAt`/`promoExpireAt`,
  resolves `promoterId` via ws_promoter email→phone, and `appliesTo.ids` via ws_<entity> name/title
  (all-or-nothing per code). Keyed on unique `promocode` (upper-cased). **Run result (staging): inserted=1
  (FIRST50), promoterRefDropped=1** (the Mongo "WebSankul" promoter is not in the SQL promoter subset →
  null, ref is optional). `GET /admin/promocodes` now serves it from SQL (`_id:"1"`, no `__v`, flat ₹50).

- **`scripts/backfill-live-reminder-customer-id.ts`** — repair pass that UPDATEs
  `ws_live_session_reminder.customer_id` where NULL, correlating each Mongo `livesessionreminders` doc to its
  SQL row by `live_session_id` (session natural key: title+scheduledAt) + `remind_at`, then filling the
  customer via the phone bridge. Idempotent (only touches `customer_id IS NULL`). **Run result (staging):
  updated=0, sessionUnresolved=0 (9/9 sessions correlated), customerUnresolved=9** — the 9 reminders belong
  to 2 Mongo-only test customers (phones 9106929076 / 8888888888) absent from `ws_customer` (27 rows). The
  script logic is correct (session side proven 9/9); it resolves the customers once they exist in SQL (prod
  full-customer set). NULLs left as-is in staging — customers are never fabricated.

---

## 2026-06-22 — client `/referral/terms` + `/referral/faqs` gain a MySQL branch (were Mongo-only despite referral-content ON)

Found during pending-module SQL verification: the **admin** referral content endpoints
(`/admin/referrals/terms|faqs`) already branched on `referral-content` (SQL ✅), but the **client**
read endpoints (`/client/referral/terms`, `/client/referral/faqs`) went straight to the Mongoose
`ReferralTerm`/`ReferralFaq` models with **no `isMysqlModule` branch** — so they kept serving Mongo
even with the flag on. Same class of gap as `toggleBookTrending` (sibling missing the SQL branch).

- **`modules/referral-content/referral-content.service.ts`** — new client read helpers:
  - `listActiveTermsForClient()` → `prisma.refferalTerm.findMany({ where: { status: true }, orderBy: [{orderBy:asc},{createdAt:asc}], select: {id,text,orderBy} })` → `{ _id, text, order }`.
  - `listActiveFaqsForClient()` → `prisma.refferalFaq.findMany({ where: { status: true }, orderBy: [...], select: {id,question,answer,orderBy} })` → `{ _id, question, answer, order }`.
  - Slim, status-filtered projections that match the legacy client contract exactly (admin `listTerms()`/`listFaqs()` return all rows + extra fields, so they could not be reused as-is).
- **`client/referral/content.controller.ts`** — `getTerms`/`getFaqs` now branch on `rcService.isReferralContentMysql()` first; Mongo fallback retained.

Verified live: both client endpoints return `_id` as integer-string (`"1"`), no `__v`, status-filtered,
matching `ws_refferal_term`/`ws_refferal_faq` (1 active each). `yarn typecheck` ✅. Contract unchanged.

## 2026-06-19 — `toggleBookTrending` gains a MySQL branch (was Mongo-only despite admin-book ON)

Found during live admin write-path verification: `PATCH admin/books/:id/trending` 400'd for MySQL integer ids because
the handler was Mongo-only (`mongoose.Types.ObjectId.isValid` → `Book.findById`) with **no `isMysqlModule` branch** — a
stale "ws_book has no is_trending column" decision. The column now exists (`ws_book.is_trending tinyint(1)`) and the
Prisma `Book.isTrending` field maps it (`@map("is_trending")`), so the deferral was obsolete.

- **`modules/admin-book/admin-book.repository.ts`** — new `setTrending(id, isTrending)` → `prisma.book.update({ data: { isTrending, updated_at } })`.
- **`modules/admin-book/admin-book.service.ts`** — new `toggleBookTrending(id)` (read row → flip `!row.isTrending` → persist).
- **`admin/book/book.controller.ts`** — `toggleBookTrending` now branches on `isAdminBookMysql()` (mirrors `toggleBookStatus`); Mongo fallback retained.

Verified live: `is_trending` 0→1→revert 0 against `websankul_staging`. `yarn typecheck` ✅. No schema/DDL change (column +
Prisma field already present). **Note (not changed):** the read DTO still synthesizes `isTrending=false`
(`admin-book.service.ts` comment) — admin book listings won't surface the real column value until that DTO is updated; left
as-is to preserve the response contract.

---

## 2026-06-19 — 🏁 Handler-level Mongo→SQL migration COMPLETE (every API handler now has a SQL branch)

The last two schema-decision items are done; no handler reads/writes Mongo only anymore.

- **admin-promoter subs/dashboard** — `ws_package_course_subscription` ALTER (`schema-changes/2026-06-19_subscription_promoter_cols.sql`):
  +`promoter_id`/`promoter_percentage`/`paid_amount` (+ index). Ported all 4 remaining handlers in `modules/admin-promoter`:
  `getPromoterSubscriptions` (literal promoter fields), `getPromoterPromocodes` (via `ws_promo_code`/PromoCodeRule), and
  `getPromoter{,All}Dashboard` (earnings=SUM(paid_amount), commission=SUM(paid_amount*pct/100), time-bucketed). Drift:
  ws_package_course_subscription has no `promocode_id` → the promocode scope filter is ignored + recent rows' promocode=null.
- **generate.ts receipts** — book (`book-receipt`), ebook (`ebook-receipt`), exam-solution (`exam-solution`) flags. Book items
  from `ws_book_order_item` (string-joined by order_id=receiptId); ebook via plan→price→ebook hop; exam rank via Prisma
  groupBy. Drift: exam result has no submittedAt/attemptNumber (→created_at/1).

`yarn typecheck` ✅. **Remaining for zero-Mongo is now purely structural (no more handler ports):** apply ~13 DDL files +
run all backfills + flip ~20 flags (verify live) → STRIP the Mongo fallback branches + `models/` imports across ~167 files
→ delete `src/models/**` → drop `connectMongo` + remove mongoose.

---

## 2026-06-19 — Remaining handler list cleared (client/free, C5 plan-links, C7 final wiring, sockets, utils, cms, course-video)

Continued the zero-Mongo push; all branches gated, Mongo fallback intact, `yarn typecheck` ✅ throughout.

- **client/free** → `modules/client-free` (flag `client-free`) — all 5 free-* listings on SQL (drift: ws_package no is_paid → free packages empty; LiveCourse no material/exam pivots).
- **C5 plan-links** → `modules/promo-code` `loadPlansForEntitiesSql`/`syncPlanLinksSql`/`loadPlanLinksSql`/`getPromocodePlansSql`; commission table got `plan_kind` ALTER (`schema-changes/2026-06-19_promoted_pce_plan_kind.sql`) to hold livePlan/testSeries plan ids. Drift: picker exam-type grouping empty (ws_package has no goalLabelId).
- **C7 recording→video promotion** wired on SQL (uses the new `ws_video.live_session_id` + `ws_video_category.subject_key`); **C7 ebook PDF-upload status** wired on SQL (uses the new ws_ebook upload columns). Both `🟡`s from the prior entry are now closed.
- **Sockets** — `livechat.socket` chat/ban/poll/attendance + `camera-ingest` session lookup on SQL (reuse `live-course`/`admin-live` flags; `ws_live_chat_message`/`_ban`/`ws_live_poll*`/`ws_live_session_attendance`). `pdf-progress.socket` has no DB ops. Socket.io/Redis transport unchanged.
- **utils** — `crm.ts` is a no-DB stub (n/a); `pdfCourseReceipt.ts` → SQL (flag `pdf-course-receipt`); `libs/core/generate.ts` course-receipt → SQL (flag `course-receipt`). 🟡 generate book/ebook receipts + exam-solution PDF stay Mongo (ws_book_order items in a separate table; ws_ebook_order has no ebook_id + EbookPrice has no SQL table; exam analytics not migrated).
- **client/cms** social-link/current-affair/live-banner reads → SQL (reuse `cms-extra` flag).
- **admin/course video CRUD** → `modules/admin-course-video` (flag `admin-course-video`) — 6 handlers on ws_video.
- **educator course/package** — confirmed ALREADY migrated (`educator-portal` flag, 8 handlers).

**Remaining genuinely-Mongo-only (need ALTER/decision):** admin-promoter subscriptions/dashboard (ws_package_course_subscription
lacks promoter_id/%/paid_amount); generate book/ebook/exam receipts (table/data-model gaps above). **Then** the structural
final step: flip all flags + STRIP the Mongo fallbacks across ~167 files + delete `src/models/**` → drop `connectMongo`.

## 2026-06-19 — C7 realtime PERSISTENCE migrated to SQL + permission-catalog + roadmap correction

**Roadmap correction:** the prior "C7 transport stays Mongo by design" note was WRONG and removed. Goal = full Mongo
removal. Transport (Socket.IO/Redis, StreamOS, BullMQ) is non-Mongo and needs no migration; the DATA those handlers
persisted IS Mongo and MUST migrate — and most of its SQL tables already existed.

**C7 — DATA ported (most tables already existed):**
- **admin live** (`modules/admin-live`, flag `admin-live`) — live.controller + live.guards: create/list/status/start/
  update/delete/end/attendance/recording-webhook on `ws_live_session`(+`_course`,`_attendance`). StreamOS + socket emits
  unchanged. 🟡 recording→video promotion + `promotedVideos` stayed Mongo (needed `ws_video.live_session_id` +
  `ws_video_category.subject_key` — now added below; final wiring pending).
- **admin live-course** (`modules/admin-live-course`, flag `admin-live-course`) — all 4 folder + 7 video handlers on
  `ws_video`/`ws_video_category`(+relation)/`ws_live_course`. Folder-tree via `catalog-category-tree` DAG.
- **client live-reminder** (`modules/client-live-reminder`, flag `client-live-reminder`) — `ws_live_session_reminder` +
  `ws_notification`; BullMQ scheduling unchanged.
- **pdf-upload** (`modules/pdf-upload`, flag `pdf-upload`) — net-new `ws_pdf_upload_job`
  (`schema-changes/2026-06-19_create_pdf_upload_job.sql`); job lifecycle on SQL, BullMQ/Socket.io unchanged. 🟡 ebook-side
  URL/status write stayed Mongo (ws_ebook lacked upload cols — now added below).

**Closing ALTERs** `schema-changes/2026-06-19_c7_closing_alters.sql` (+ Prisma): `ws_video.live_session_id`,
`ws_video_category.subject_key`, `ws_ebook` +book_file_name/demo_file_name/book_upload_status/demo_upload_status/
book_upload_progress/demo_upload_progress. Gives the two 🟡 flows a SQL home; wiring those handlers onto the columns is the
last step. `yarn typecheck` ✅.

**Also:** `admin/permission/catalog.controller.ts` → `modules/permission-catalog` (flag `permission-catalog`);
`admin/notification/audience.ts` confirmed already SQL-routed via `admin-notification`.

## 2026-06-19 — Admin test-series reads/CRUD ported to MySQL

**Module** `modules/admin-testseries/admin-testseries.service.ts` (flag `admin-testseries`, `isAdminTestSeriesMysql()`,
`parseAtsId`). Every admin handler in `admin/testSeries/testSeries.controller.ts` branched on the flag BEFORE its 24-hex
ObjectId guard; Mongo path kept intact as fallback. **Handlers migrated (20):** listTestSeries, getTestSeriesById,
createTestSeries, updateTestSeries (paid-needs-plan guard via `hasActivePlan`), deleteTestSeries (active-sub guard +
cascade delete of exam/content-category/price children), listContentCategories, createContentCategory,
updateContentCategory, deleteContentCategory (linked-papers guard), listPapers, linkPaper (UNIQUE(test_series_id,exam_id)
pre-check → 409 dup), updatePaperLink, unlinkPaper, listPrices, createPrice (`$transaction` clears existing default),
updatePrice (`$transaction` clears sibling defaults), deletePrice (active-sub-for-plan guard), listSubscriptions
(testSeries/customer populate), grantSubscription (planId→durationDays/price derive; `paymentType="backend"`),
updateSubscription, deleteSubscription, listOrders.

**Columns used (all pre-existing — no ALTER):** `ws_test_series.exam_category_ids` (Json int[], populated to
`[{_id,name}]` on read; legacy `exam_category_id` Int kept in sync to first id on write), content-category →
`ws_test_series_content_category`, exam links → `ws_test_series_exam`, prices → `ws_test_series_price`, subs →
`ws_test_series_subscription` (`payment_type` String col = "backend"). Customer populate maps `full_name/phone/email_address`.

**Drift / left on Mongo:** none of the listed handlers stay on Mongo — full parity. `examCategoryIds` array-membership
filter in listTestSeries is done in-memory (JSON column isn't portably queryable); `total` reflects that filter when a
catId is supplied (matches Mongo countDocuments). `Exam` has no language column, so paper `exam.language` is `null`
(same as already-migrated client side). Validation `admin/testSeries/testSeries.validation.ts` `objectId` widened to
accept 24-hex OR positive-int string (or int), so SQL int ids pass — Mongo path unaffected. `yarn tsc --noEmit` ✅ (0 errors).

## 2026-06-19 — C8 permission-category + admin-promoter (partial) ported

**Permission category** — DDL `schema-changes/2026-06-19_permission_category.sql`: net-new `ws_permission_category` +
`ws_permissions ADD category_id` (the Mongo Permission added categoryId atop the Laravel spatie row). Prisma:
`PermissionCategoryRow` + `categoryId` on `AdminPermissionRow`. Module `modules/permission-category` (flag
`permission-category`), all 5 handlers branched (per-category `permission_count` via groupBy). Backfill
`scripts/backfill-c8-permission-category.ts` (categories clear-then-insert; `ws_permissions.category_id` set by
(name,guard_name) natural key).

**Admin promoter (partial)** — module `modules/admin-promoter` (flag `admin-promoter`). Ported the pure `ws_promoter`
CRUD: list/get/create/update/delete/toggle (getPromoter stats reuse the order-JSON attribution count). **Left on Mongo
(missing SQL columns):** `getPromoterSubscriptions` (ws_package_course_subscription has no promoter_id/percentage/paid_amount),
`getPromoterDashboard`/`getAllPromotersDashboard` (Mongo-only overview.service). `getPromoterPromocodes` could later move to
`PromoCodeRule` (has promoterId+appliesTo) — left Mongo for now. `yarn typecheck` ✅.

### Migration end-state (2026-06-19)
**Code-complete clusters:** C1, C2, C3, C4, C6, C5 (core), C8 (referral-content + permission-category + admin-promoter CRUD).
**Genuinely remaining (need ALTER/decision or Mongo-by-design — NOT rushed):**
- C5 plan-link % picker — needs `ws_promoted_package_course_ebook` ALTER (`plan_kind` + loosen `planId` FK) to represent
  livePlan/testSeries plans; payment-commission, so gated on that decision.
- C8 residual: admin-promoter subscription/dashboard (need promoter_id/% columns), notification-audience residual, utils
  (crm/pdfCourseReceipt/generate).
- C7 realtime — transport (StreamOS/sockets/BullMQ) stays Mongo BY DESIGN; persistence-only ports are a separate effort.

**Accumulated deploy batch (apply + verify before further building):** DDL — C4 tables, C6 catalog ALTERs, C5 ws_promo_code,
C8 referral-content + permission-category. Backfills — backfill-c4-*, backfill-c6-examcountdown-cols,
backfill-c8-referral-content, backfill-c8-permission-category. Flags to flip after verify: client-wishlist, client-testseries,
promo-code, referral-content, permission-category, admin-promoter.

---

## 2026-06-19 — C5 promo-code core ported + C8 referral content ported

**C5 promo-code (core)** — new module `modules/promo-code/promo-code.service.ts` (flag `promo-code`), wired into
`admin/promocode/promocode.controller.ts` (list/get/create/update/delete/toggle/bulk) + `client/promocode/promocode.controller.ts`
(applyPromocode). appliesTo resolved across the 5 SQL entity tables (`{_id,name,image}`, testSeries title→name); discount via
the DB-agnostic `computePromoDiscount`. Validation widened to accept int ids. **Left on Mongo (documented):** the per-plan
promoter/customer % links (`getPromocodePlans` + `syncPlanLinks`) — overlap the un-migrated `ws_promoted_package_course_ebook`
commission table; SQL `getById` returns `plans:[]`. Client referral-code fall-through also stays Mongo.

**C8 referral content** — DDL `schema-changes/2026-06-19_create_referral_content.sql` (net-new `ws_refferal_term` +
`ws_refferal_faq`); Prisma `RefferalTerm`/`RefferalFaq`. New module `modules/referral-content/` (flag `referral-content`)
wired into all 10 `admin/referral/content.controller.ts` handlers (Mongo `order` key kept ← SQL `order_by`). Backfill
`scripts/backfill-c8-referral-content.ts` (clear-then-insert, net-new). `yarn typecheck` ✅.

**C8 DEFERRED (need decisions/tables):** permission-category needs `ws_permission_category` AND a SQL home for the Mongo
`Permission` (categoryId) catalog — which is SEPARATE from the Laravel `ws_permissions`/`ws_roles` already on SQL; admin
promoter mgmt, notification audience residual, and utils (crm/pdfCourseReceipt/generate) not ported.
**C7 (realtime):** transport stays Mongo by design (StreamOS/sockets/BullMQ); persistence-only ports are a separate effort.

---

## 2026-06-19 — C5 foundation: net-new ws_promo_code table (full port pending)

**Decision + DDL** `schema-changes/2026-06-19_create_promo_code.sql` (NOT applied): net-new `ws_promo_code` for the admin-UI
PromoCode system (Mongo `ws_promo_codes`, `appliesTo`+`discountType/Value`) — distinct from legacy `ws_promocode`. appliesTo
stored as `applies_to_type` + `applies_to_ids` JSON. **Prisma** model `PromoCodeRule` added; generate + `yarn typecheck` ✅.

**Full module port NOT yet built** (large, payment-adjacent — 5 entity types × 4 plan tables + plan-link % + client apply
discount). Plan in `docs/migration/C4_BLOCKERS_DECISIONS.md`. Recommend applying the accumulated C4+C6+C5 DDL/backfills +
verifying before building the discount logic on top.

---

## 2026-06-19 — C6 embedded examCountdown populates on SQL (book/course/ebook)

**DDL** `schema-changes/2026-06-19_add_examcountdown_cols_catalog.sql` (additive, NOT yet applied): `ws_book` / `ws_course`
/ `ws_ebook` each `ADD exam_countdown_ids JSON, exam_countdown_category_ids JSON` — mirrors the existing `ws_live_course`
columns. **Prisma:** added both `Json?` fields to `Book`/`Course`/`EBook`; `prisma generate` run.

**Resolver** (`modules/exam-countdown/exam-countdown.service.ts`): `parseIdArray`, `resolveCountdownDtos`
(→`{_id,title,examDate}`), `resolveCountdownCategoryDtos` (→`{_id,name,colorHex}`), `populateExamCountdowns(row)` —
order-preserving, matches the Mongo `.populate()` shapes.

**Wiring (SQL branches; Mongo fallback intact):**
- **Store on admin write** — `admin-book`/`admin-course`/`admin-ebook` services now persist
  `examCountdownIds`+`examCountdownCategoryIds` (via `parseIdArray`) on create/update (previously dropped on SQL).
  Admin validation widened to accept int ids (was strict 24-hex ObjectId) for these array fields.
- **Populate on admin detail** — `getBook`/`getCourseById`/`getEbookById` populate both arrays + legacy single
  `examCountdownCategoryId = categories[0] ?? null`.
- **Populate on client detail** — course only (`modules/catalog-course/course-detail.sql.ts`). Client book + ebook detail
  do **not** surface examCountdown fields (their DTO contract never did — confirmed against the Mongo paths), so unchanged.

**Backfill** `scripts/backfill-c6-examcountdown-cols.ts` (written, tsc-clean): copies Mongo Book/Course/Ebook
examCountdownIds/categoryIds → the SQL JSON columns, translating each ObjectId via natural key (countdown by title,
category by name; catalog row by name), skip-on-no-match, idempotent. `yarn typecheck` ✅.

**Note:** package + live-course detail were already handled (ws_live_course already had the columns); package examCountdown
populate not in this pass. No flag flip needed — the populate rides each catalog module's existing flag once DDL+backfill land.

---

## 2026-06-19 — C4 COMPLETE (code): listSeriesPapers + book/course receipts + credit-referrer + goals

All remaining C4 handlers now have SQL branches (Mongo fallback intact, `yarn typecheck` ✅). No new tables beyond the prior pass.

- **`listSeriesPapers`** (TestSeries 4/4 reads) — `listSeriesPapersMysql` in `client-testseries`. Reads new
  `ws_test_series_exam` + `ws_test_series_content_category` + `ws_exam` + `ws_exam_result`. **Drift:** `ws_exam` has no
  language/difficulty (→null), `durationMinutes`→`time`, `questionCount`→`numberOfQuestions`; `ws_exam_result` has no
  `attemptNumber`/`updatedAt` (→`attempt`/`created_at`).
- **Book + course receipts** (receipts 3/3) — `getBookReceiptMysql` + `getCourseReceiptMysql` in
  `client-purchase-history`. **Drift:** book totals collapse to `amount` (no discount/shipping/list columns on
  `ws_book_order`); course `paidAt`=null (no column), razorpay ids hopped from `ws_package_course_order`, `paymentStatus:verified`→`status=true`.
- **credit-referrer** (`client/referral/credit-referrer.ts`) — payment-verify reward write branched on `isReferralMysql()`
  (`referral` flag ON). New repo `creditReferralReward` (atomic: `rewardPoints += coin` + successful CREDIT ledger row) +
  `findCreditByOrder` idempotency on `(orderId, referrerId)`. Reward % from `ws_refferal_program.refferal_reward`.
- **Goals** (`client/goal/goal.client.service.ts`) — all 4 handlers branched on `isGoalMysql()`. Reads `ws_goal`;
  per-customer selection stored on `ws_customer.goal` (Json) as selected LABEL ids. `modules/goal` now assigns stable
  numeric **label ids** in `ws_goal.labels` on create/update (`withLabelIds`, preserves existing ids by name).
  **Activation needs** a one-time backfill assigning ids to existing `ws_goal.labels` + remapping existing
  `ws_customer.goal` selections (else historical selections won't resolve). SQL branch bypasses the goals redis cache.

**C4 status:** all handlers ported. Remaining is **deploy-only** (not code):
1. apply `schema-changes/2026-06-19_create_c4_tables.sql` → `yarn prisma:generate`
2. backfills (natural-key, idempotent, skip-on-no-match — disjoint staging yields few matches, mechanism for prod):
   `scripts/backfill-c4-wishlist.ts`, `scripts/backfill-c4-testseries.ts`, `scripts/backfill-c4-goal-label-ids.ts`
3. `yarn migration:api`, then flip flags `client-wishlist`, `client-testseries` (`goal`/`tracking`/`referral`/`client-purchase-history` already ON).

**Backfill scripts written 2026-06-19** — join Mongo→SQL by natural key (TestSeries/Exam by title, Customer by phone,
wishlist items + goal labels by name). They SKIP unmappable rows (never guess) and are idempotent (UNIQUE constraints +
net-new-table clear). Tsc-clean (scripts/ is outside the main `src/**` build, checked standalone).

---

## 2026-06-19 — C4 schema pass: 3 net-new tables + Wishlist (full) + TestSeries detail on SQL

**DDL** `docs/migration/schema-changes/2026-06-19_create_c4_tables.sql` (idempotent; **NOT yet applied** — apply to staging, then `yarn prisma:generate`):
- `ws_test_series_content_category` (TestSeriesContentCategory) — series "Test Content" rows.
- `ws_test_series_exam` (TestSeriesExam) — series→exam link; UNIQUE `(test_series_id, exam_id)`.
- `ws_wishlist` (Wishlist) — per-customer saved items; UNIQUE `(customer_id, item_type, item_id)`; `item_type` ENUM(course/package/ebook/book).

**Prisma:** added `TestSeriesContentCategory`, `TestSeriesExam`, `Wishlist` models; `prisma generate` run (carets preserved). `yarn typecheck` ✅.

**Wishlist — full port (new module `modules/client-wishlist`, gated `client-wishlist`):**
- All 4 handlers branched in `client/wishlist/wishlist.controller.ts` (Mongo fallback intact): list (grouped+populated), add (idempotent via UNIQUE / P2002), remove, check.
- **SQL branches run BEFORE the 24-hex `isObjectId`/`addSchema` guards** (SQL itemIds are ints). Drift: populated `item` is a compact `{_id,title,thumbnail}` DTO (SQL catalog rows ≠ Mongo lean docs).

**TestSeries detail — ported (`getTestSeriesDetailMysql`):** `getTestSeriesDetail` branched (before ObjectId guard). Reads `ws_test_series` + the new `ws_test_series_content_category` + `ws_test_series_price` + `ws_test_series_subscription`; `examCategoryIds` JSON populated to `[{_id,name}]`. Response shape held identical.

**Still pending (specced in `docs/migration/C4_BLOCKERS_DECISIONS.md`):**
- **Backfills NOT written** — `ws_wishlist` / `ws_test_series_content_category` / `ws_test_series_exam` need Mongo→SQL id maps (TestSeries/Exam/catalog) whose natural-key join I can't verify headless. Specced, not shipped (a wrong id map corrupts data).
- **`listSeriesPapers`** still Mongo — needs Exam + ExamResult SQL field mapping (`ws_exam.title`, result columns).
- **Goals** still Mongo — label-id decision.
- **Flags** `client-wishlist` + `client-testseries` NOT in `.env` — flip after DDL apply + backfill + `yarn migration:api` verify.

---

## 2026-06-19 — C4 eBook receipt on SQL (1/3 receipts) + book/course receipt + credit-referrer deferred

**eBook receipt ported (no new table; `client-purchase-history` flag already ON):**
- `getEbookReceiptMysql` + 3 thin repo reads (`ebookOrderForReceipt`, `planForReceipt`, `ebookById`) in
  `modules/client-purchase-history`. Branched `client/purchase-history/receipts.controller.ts` `getEbookReceipt`.
- **SQL branch runs BEFORE the `isObjectId` guard** (SQL order ids are ints, not 24-hex). Mongo fallback intact.
- Resolves ebook via `plan_id → ws_package_course_ebook_price.ebook_id → ws_ebook`. Response/`ReceiptResponse` shape held identical.
- `yarn typecheck` ✅.

**Book + course receipts NOT ported (column gaps — would drift a money-facing receipt):**
- `ws_book_order` has only `order_price` — no `total_discounted_price`/`total_shipping_price`/`total_list_price`, so the
  receipt's `subTotal`/`shipping`/`discount` breakdown can't be reproduced.
- `ws_package_course_subscription` has no `paid_at` and no razorpay order/payment columns (live on `ws_package_course_order`
  via `order_id` — a hop). Deferred to the batched schema/drift decision (`docs/migration/C4_BLOCKERS_DECISIONS.md`).

**credit-referrer (`client/referral/credit-referrer.ts`) deferred:** it's an idempotent WRITE on the payment-verify path
(referral reward → `Customer.rewardPoints` + `ws_refferal_transaction`). SQL tables exist, but per the "ask before payment
flows" rule it's left Mongo pending explicit go-ahead.

---

## 2026-06-19 — C4 client tracking WRITE on SQL (closes admin/client split) + goals blocker found

**Tracking — client write ported (no new table; `ws_activity_log` already exists, flag `tracking` already ON):**
- Added `createActivity` to `src/modules/tracking/tracking.service.ts` (was admin-reads only).
- Branched `client/tracking/tracking.controller.ts` `trackEvent` (POST /client/tracking) on `isTrackingMysql()`,
  Mongo fallback intact. **Fixes a live split:** admin reads were already SQL (`ws_activity_log`) but the client
  write still hit Mongo `ActivityLog`, so client-tracked events never reached the SQL admin reads. Now consistent.
- **Drift:** `customerId`/`entityId` parsed to SQL int (null when absent/non-numeric — a 24-hex Mongo ObjectId
  `entityId` won't parse → stored null, matching how the SQL admin reads treat `entity_id` as numeric).
- `yarn typecheck` ✅.

**Goals — NOT ported (data-model decision needed, not a clean port):**
- Roadmap said "map to `ws_customer_target_goal`" — but that table is a flat `{name,image,active}` master, NOT the
  client goal/labels model. The real read maps to `ws_goal` (already wrapped by `modules/goal` for admin).
- Per-customer selection has a home (`Customer.goal` JSON column exists), BUT SQL `ws_goal` stores `labels` as
  `[{name}]` **without ids**, while the client feature selects by **label id** (`Customer.goals` = array of label
  `_id`s; `getMySelectedGoals` filters `labels._id in ids`). No label ids in SQL → per-label selection can't be
  replicated faithfully. **Deferred pending a decision** (add label ids to `ws_goal.labels`, or change selection to
  select-by-name / select-whole-goal). Left fully on Mongo.

---

## 2026-06-19 — C1 DAG-walkers verified DONE + C4 TestSeries reads (partial) on SQL

**C1 closure (no code change):** the three Mongo DAG walkers
(`client/course/resolveVideoScope.ts`, `resolveVideoCourse.ts`, `scopeReachableCategories.ts`)
are confirmed to run **only on the Mongo fallback** — every SQL-active caller already routes to the
`catalog-category-tree` SQL resolvers via `buildLectureRefSql` / `buildResumeNextCardSql`
(`client-lecture-progress.service`), `reportContainerProgress` (SQL heartbeat), and `scopeForCategory`
(`client-category-video.service`). Call sites verified past the early-return SQL branch:
`lectureRef.ts:77`, `resumeCard.ts:163/170`, `progress.controller.ts:126`. The walkers stay as the intact
Mongo fallback. Roadmap C1 marked ✅ DONE.

**C4 TestSeries reads — partial (no new tables, no DDL, no backfill):**
- New module `src/modules/client-testseries/client-testseries.service.ts`, gated `isMysqlModule("client-testseries")`.
- Migrated **2 of 4** read endpoints, branched in `client/testSeries/testSeries.controller.ts` (Mongo fallback intact):
  - `GET /client/test-series` (`listTestSeries`) — `ws_test_series` + default-price preview (`ws_test_series_price`,
    isDefault desc/price asc) + active-sub daysLeft (`ws_test_series_subscription`) + `examCategoryIds` JSON resolved
    against `ws_exam_category` to the populated `[{_id,name}]` shape. Response/DTO held identical (`_id` = int string).
  - `GET /client/test-series/my/subscriptions` (`listMySubscriptions`) — subscriptions + series basics.
- **STAYS Mongo (blocked on net-new tables):** `getTestSeriesDetail` needs `ws_test_series_content_category`;
  `listSeriesPapers` needs `ws_test_series_content_category` + `ws_test_series_exam` (series→exam link). Neither table
  exists in SQL yet — deferred (schema decision).
- **Drift:** title search uses SQL `contains` vs Mongo `buildRegexCondition`; `examCategoryIds` JSON assumed to hold SQL
  int ids (dangling ids dropped, mirroring Mongo populate).
- **Flag NOT yet flipped** in `.env` — pending `yarn migration:api` smoke test against real MySQL.
- `yarn typecheck` ✅.

---

## 2026-06-19 — ✅ Mongo-only DATA tail on SQL (ImageNotification / PackageCategory / ExamCountdown) + customer-address flip + container lecture-progress heartbeat (gated)

**DDL** `docs/migration/schema-changes/2026-06-19_create_mongo_only_tail_tables.sql` (applied to staging, idempotent):
- **4 new tables:** `ws_exam_countdown_category`, `ws_exam_countdown`, `ws_package_category`, `ws_image_notification`
  (the last was already in Prisma from Wave 8 — only the table + consumers were missing).
- **1 ALTER:** `ws_package` ADD `package_category_id INT NULL` (+ index) — ws_package had NO category linkage;
  needed for the PackageCategory listing's per-category package count. Additive, prod-safe.
- Prisma: added `ExamCountdownCategory`, `ExamCountdown`, `PackageCategory` models + `Package.packageCategoryId`
  field; removed a duplicate `ImageNotification` model; `prisma generate` run (carets preserved).

**Backfills (Mongo → SQL):**
- `scripts/backfill-mongo-only-tail.ts` — 2 exam-countdown-categories, 2 exam-countdowns (categoryId remapped via
  Mongo→SQL id map), 3 package-categories, 3 image-notifications. Idempotent (truncate-then-insert; small ref data).
- `scripts/backfill-package-category-link.ts` — links `ws_package.package_category_id` by matching package NAME +
  category SLUG. Staging: 0 linked (Mongo & SQL package sets are disjoint — Mongo packages never existed in the
  legacy MySQL dump); mechanism is in place for prod overlap.

**Modules + flips (flags ON: `package-category`, `exam-countdown`, `customer-address`; ImageNotification rides `client-notification`):**
- **ImageNotification** — admin CRUD was already SQL (`admin-notification.service`, `client-notification` flag).
  Added `listActiveImageNotifications` (active-only, id desc) + wired the client `GET /client/notifications/images`
  read to it. DTO `{_id, image, redirectUrl, active}`. Verified active=3/all=3.
- **PackageCategory** — new `src/modules/package-category/package-category.service.ts`. Admin CRUD (`/admin/master/
  package-categories`) + client `listPackageCategories` (listing + per-category active-package count via Prisma
  groupBy on the new column + ?live filter via LiveCourse.packageCategoryId). `listPackagesByCategory` STAYS Mongo
  (needs Package fields ws_package lacks — isSmartCourse/isPlannerCourse/… documented catalog drift). Verified 11/11.
- **ExamCountdown(+Category)** — new `src/modules/exam-countdown/exam-countdown.service.ts`. Full admin CRUD
  (categories + countdowns) preserving the guards: dup-name → 409, category-in-use delete → 400, disabled-category
  → reject, examDate ±range validation (kept in controller, DB-agnostic). Client feed: list categories, list
  countdowns (daysLeft + includePast filter), upcoming. Manual category join (flat models, no Prisma relation).
  Embedded `examCountdownIds[]` populates in Book/Course/Ebook/Package detail STAY Mongo (no SQL columns). Verified 13/13.
- **customer-address** — flag ON (branch was already built; the offline-city id-space blocker is resolved since
  offline-city is ON, and cart cityId resolution already branches on isOfflineCityMysql). Verified 9/9.

**Container lecture-progress heartbeat (built, GATED OFF):**
- Added `reportContainerProgress` + `toProgressDto` to `client-lecture-progress.service.ts`. Uses the
  `catalog-category-tree` SQL DAG resolver (`reachableCategoryIds`) for reachability + SQL subscription tables for
  entitlement. Drift: ws_package_course_subscription has no payment_status → gate = status=true; live sub keeps
  paymentStatus="verified". Wired `src/client/course/progress.controller.ts` reportLectureProgress SQL branch
  (int id-space, runs before the Mongo ObjectId parse).
- **GATED behind a NEW dedicated sub-flag `lecture-progress-container` (OFF)** — separate from the base
  `client-lecture-progress` free-slice flag, because the heartbeat WRITE and the resume/learning READ hub MUST flip
  together (enabling one alone splits progress data across SQL/Mongo). Verified 8/8 (free-reachable accept,
  completion sticky after rewind, single-row upsert, 404/400/403 rejects). `tsc` clean.
- **Next:** flip the resume/learning READ hub (~7 files) + the live-session heartbeat, then turn ON
  `lecture-progress-container`. After that: profile-dashboard subscriptions/pastExams counts + drop guarded ObjectId.

### 2026-06-19 — ZERO-MONGO push started (C1): /lecture video-URL endpoint on SQL

User goal escalated to **full zero-MongoDB**. Audited the whole tree: **54 real handler/service files** still on
Mongo, grouped into 8 clusters — see [`migration/ZERO_MONGO_PLAN.md`](./migration/ZERO_MONGO_PLAN.md) (the resume
doc for this push). Decisions: migrate all DATA but keep realtime socket/stream TRANSPORT on Mongo (C7); create
net-new tables as needed (wishlist/FAQ-terms/permissionCategory/examCountdown joins); deliver cluster-by-cluster.

**C1 first slice — `GET /client/courses/lecture` (video-URL contract) on SQL.** New module
`src/modules/client-lecture/client-lecture.service.ts` (flag `client-lecture` ON): findVideo + videoBelongsToCourse
(via `catalog-category-tree.reachableCategoryIds("course")` — SQL ws_video_category has NO course_id col) +
hasActiveCourse/PackageSub (status=true; no payment_status col). Controller `src/client/course/lecture.controller.ts`
SQL-branched before the Mongo Video.findById; encryptVideoSource stays controller-owned (DB-agnostic, identical
shape). Verified 5/5 (find/404/membership-via-DAG/no-sub). `tsc` clean. **71 flags now ON.**
**▶ C1 resume:** DAG walkers (route to existing SQL resolver) → buildCourseDetails → catalog/material/search/live detail.

**C1 second slice — category-video reads on SQL.** `GET /client/video-categories/:id/videos` (listVideosByCategory) +
`/videos/:videoId` (getVideoByCategory). New module `src/modules/client-category-video/`, flag `client-category-video`
ON. Reads ws_video + ws_video_category + ws_lecture_progress (per-row badge); scope via
`catalog-category-tree.resolveVideoScope` ({kind,id}); encryptVideoEnvelope/resolveVideoSource stay controller-owned
(DB-agnostic). Drift: ws_video has NO live-session back-link col → per-row multi-quality recordings always empty (FE
falls back to defaultListingQualities). Verified 8/8 (list/price-filter/progress-badge/detail/wrong-cat-404/scope→course
via DAG). `tsc` clean. **72 flags ON.** Proves the resolveVideoScope SQL walker end-to-end.
**▶ next:** lecture-note cluster — needs NEW tables ws_lecture_note + ws_lecture_audio_note (Mongo 4+2 rows) +
resumeCard/lectureRef flip + resolveVideoCourseId→SQL.

**C1 third slice — lecture-note cluster on SQL (text + audio notes).** New tables `ws_lecture_note` +
`ws_lecture_audio_note` (DDL `schema-changes/2026-06-19_create_lecture_note_tables.sql`) + Prisma models +
backfill `scripts/backfill-lecture-notes.ts` (staging: 0 bridged — Mongo notes' customer ObjectIds aren't in the
SQL dump; runtime path is the real one). New module `src/modules/client-lecture-note/` (flag `client-lecture-note`
ON): auth gates (recorded→resolveVideoCourseId DAG + course-sub status=true; live→ws_live_session_course +
LiveCourseSubscription verified), CRUD for both note types, saved-materials grouping (by video/session, titles from
ws_video/ws_live_session). Wired `client/lecture-note/lecture-note.controller.ts` (6 handlers) +
`client/lecture-audio-note/lecture-audio-note.controller.ts` (S3/multer stays controller-owned). Added SQL builders
`buildLectureRefSql` + `buildResumeNextCardSql` to the lecture-progress service; branched `learning/lectureRef.ts` +
`learning/resumeCard.ts` (gate: `client-lecture-note` OR `lecture-progress-container`). Verified 13/13 (auth via DAG,
CRUD both types, saved-materials counts+titles, owned-guard). `tsc` clean. **74 flags ON.**
**▶ next:** `buildCourseDetails` → catalog.controller → material → search → live detail → enable `lecture-progress-container` (C2).

**C1 fourth slice — buildCourseDetails (course detail page) on SQL.** New `src/modules/catalog-course/course-detail.sql.ts`
`buildCourseDetailsSql` — branched in `client/course/course.controller.getCourseByIdHandler` on `isCourseMysql()`
(catalog-course flag already ON; detail was the last course handler still on Mongo). Composes: course + subject +
educator (Prisma relations) · videos[] (root folder, subtree count via catalog-category-tree reachableCategoryIds,
direct list + per-video progress badge from ws_lecture_progress) · materials[]/tests[] (ws_material_category_course /
ws_exam_category_course pivots + recursive-CTE subtree counts — ⚠ parent col differs: ws_material_category=`parent`,
ws_exam_category=`parent_id`) · plans (PackageCourseEbookPrice split by withMaterial) · subscription (active course-or-plan
→ isPurchased + longest-endAt/lifetime daysLeft) · availablePromoCode=[] (PromoCode.appliesTo no SQL model, C5).
Drift: Exam.status is Boolean → Mongo status:PUBLISHED collapses to status=true; Mongo Course embeds
materialCategories[]/examCategories[]/examCountdownCategoryId dropped/sourced-from-pivots. Verified 14/14. `tsc` clean.
**The per-video progress badge here was a key blocker for the `lecture-progress-container` flag (C2).**
**▶ next:** catalog.controller (free catalog) → material → search → live detail → then enable `lecture-progress-container`.

**C1 fifth slice — catalog tabs (videos/materials/tests) on SQL.** New `src/modules/client-catalog/` (flag
`client-catalog` ON, 75 flags total). Branches `client/catalog/catalog.controller.ts` 3 handlers
(getCatalogVideos/Materials/Tests) for **type=course|package only**; **type=live-course STAYS Mongo** (ws_video_category
has no live_course_id col + LiveCourse has no material/exam category pivots in SQL — Wave-6 drift). Roots: course→
videoCategoryId, package→ws_package_specific_subject; materials/tests via ws_material_category_(course|package) /
ws_exam_category_(course|package) pivots. Subtree counts: video via catalog-category-tree descendantsOf; material/exam
via recursive CTE (parent col material=`parent`, exam=`parent_id`). Per-video progress badge ← ws_lecture_progress.
Exam.status Boolean → status=true. Verified 11/11. `tsc` clean.
**▶ next:** material.controller + search.controller + client/live detail → then enable `lecture-progress-container` (C2).

**C1 sixth slice — client material reads + entitlement on SQL.** **ALTER ws_material** (DDL
`schema-changes/2026-06-19_extend_ws_material.sql`): +description/thumbnail/file_size/file_mime/language/is_preview/
is_paid/download_count (additive; 226 existing rows defaulted is_paid=0/download_count=0). Prisma Material extended +
generated. New `src/modules/client-material/` (flag `client-material` ON, 76 flags). Branches all 4
`client/material/material.controller.ts` handlers (getCategoryContents drill-down+breadcrumbs, getMaterialDetail,
trackDownload [downloadCount++ write], getRecentMaterials). Entitlement (SQL mirror of material/entitlement.ts):
paid material owned if active verified course/package sub attaches the material's category OR any ancestor — via
ws_material_category_(course|package) pivots + recursive-CTE ancestor walk on ws_material_category(parent).
⚠ LiveCourse has NO material pivot in SQL → live-course material unlock not represented (drift, same as catalog).
Subtree leaf-counts + newly-added via recursive CTE. shapeMaterial gates file/directLink for unpurchased paid.
Verified 13/13 (drill-down, paid withheld→unlocked-via-ancestor-sub, free always, download++, recent). `tsc` clean.
**▶ next:** search.controller + client/live detail → then enable `lecture-progress-container` (C2).

**C1 seventh slice — globalSearch on SQL.** New `src/modules/client-search/` (flag `client-search` ON, 77 flags).
Branches `client/search/search.controller.globalSearch` (all-types + single-type). Searches 5 entity types by
name + enabled flag (Package uses `active`; others `status`/`active`), attaches isPaid (course=purchase≠'0',
package=true, live=is_paid, book=discounted_price>0, ebook=price>0 via ws_package_course_ebook_price.ebookId),
plans (course/package split, live/ebook flat, book inline []), isNew, and per-type purchase state (book→
ws_book_order(userId)+ws_book_order_item(order_id string); ebook→ws_ebook_subscription; live→ws_live_course_subscription
verified; course/package→ws_package_course_subscription via direct id OR plan, status=true [no payment_status col]).
⚠ No separate EbookPrice model — ebook prices live in ws_package_course_ebook_price (ebook_id col). Verified 18/18.
`tsc` clean. **▶ next: client/live detail (last C1 slice) → enable `lecture-progress-container` (C2).**

**C1 COMPLETE (catalog reads) + C2 LIVE — lecture-progress-container ON (78 flags, 2026-06-19).**
Finding: `client/live` detail (getLiveSessionForClient) + `listLiveCourseRecordings` are NOT catalog-detail — they're
**realtime/streaming** (StreamOS getStreamDetails, Socket.IO emit, maybeAutoPromoteRecording, LiveSession doc
mutation/save, LiveSessionPreview trial tracking). Per the C7 decision they STAY Mongo. So C1's catalog/content reads
are DONE (lecture/category-video/notes/course-detail/catalog-tabs/material/search). The live-recordings progress badge
reads Mongo videos + Mongo progress (internally consistent — live-replay videos are Mongo-only, no SQL liveSessionId
link, so SQL heartbeats never cover them → no split). **Enabled `lecture-progress-container`:** container heartbeats
(video+live-session) + listMyLearningProgress + listMyCoursesForResume + lectureRef/resumeCard SQL builders now LIVE.
Re-verified 4/4 (heartbeat accept → both resume feeds reflect it). Added reusable `progressBadgesByVideo` helper (for
C3 dashboard). `tsc` clean. **▶ next: C3 dashboards** (client/admin/educator/promoter + profile counts).

**C3 first slice — profile-dashboard counts on SQL.** New `src/modules/customer-profile/profile-dashboard.sql.ts`
(rides `customer-profile` flag, already ON — no new flag). Branched `client/profile/dashboard.controller.ts`
getProfileDashboardCounts: savedAddresses (ws_customer_address), countActiveSubscriptions (deduped course+package /
test_series / ebook, status=true [no payment_status col]), pastDailyExamsCount (ws_exam_result joined to daily exams).
folder/ebook/notification counts were already SQL-branched. Drift: ws_exam_result has NO inProgress/submittedAt cols
(a result row = a completed attempt) → pastExams = daily-exam result rows status=true; ExamType enum lowercase daily/subject.
Verified 5/5 (dedup proven: 3 same-course rows → +0). `tsc` clean.
**▶ next C3:** admin/dashboard (revenue aggregates), educator/promoter dashboards, then the big client/dashboard
(getDashboard/getResumeDashboard/getFreeDashboard — needs the Mongo trending helpers fetchTrendingBooksOnly/
EbooksOnly + resolveFreeCategoryIds migrated first).

**C3 second slice — admin dashboard on SQL.** New `src/modules/admin-dashboard/admin-dashboard.service.ts` (flag
`admin-dashboard` ON, 79 flags). Branched `admin/dashboard/dashboard.controller.getDashboard` after window/bucket
resolution (the date helpers stay DB-agnostic). Revenue cards (current+prev windows) + total-order widget +
time-series + recent lists (newCustomers/package-subs/course-subs/book-orders/ebook-subs with populated relations) +
all summary counters. Drift: Mongo PackageCourseSubscription.paidAmount → SQL `amount`, targetPackageId → packageId;
EBookOrder.order_price + status "complete"; BookOrder.order_price + status "verified"; Customer single `fullName`;
IST time-series via raw SQL CONVERT_TZ + HOUR()/DAYOFMONTH(). Verified 12/12 vs live (₹16,205/7 orders, 27 customers,
populated recent lists). `tsc` clean. **▶ next: educator + promoter dashboards, then client/dashboard.**

**C3 third slice — educator dashboard on SQL + promoter confirmed.** New
`src/modules/educator-dashboard/educator-dashboard.service.ts` (flag `educator-dashboard` ON, 80 flags). Branched
`educator/dashboard/dashboard.controller.getDashboard`: educator's courses (Course.courseEducatorId) + packages
(Package.educator_id) → total/active sub counts + top-5 (groupBy) + recent subs (populated customer/course). ⚠ Drift:
SQL ws_package_course_subscription.packageId IS the package directly (Mongo used packageId=plan id) → package subs
match by packageId ∈ educator package ids, no plan-id hop. Verified 10/10 (educator 20: 1 course, 4 subs).
**Promoter dashboard: ALREADY on SQL** — both getDashboard + getDashboardOverview branch on isPromoterDataMysql()
(buildPromoterOverviewSql); overview.service.ts is just the Mongo fallback. ⏭️ educator course/package controllers
(8 handlers: listings/detail/per-item dashboards/subscribers) still Mongo — own sub-slice. `tsc` clean.
**▶ next: educator course/package controllers, then the big client/dashboard.**

**C3 fourth slice — educator portal (course + package controllers) on SQL.** New
`src/modules/educator-portal/educator-portal.service.ts` (flag `educator-portal` ON, 81 flags). Branched all 8
handlers: educator/course (listMyCourses/getMyCourseDetail/getCourseDashboard/getCourseSubscribers) +
educator/package (parallel 4). Ownership via Course.courseEducatorId / Package.educator_id. Plans by course/package
id; subs counted by courseId / packageId (⚠ on SQL packageId IS the package, no plan-id hop the Mongo code used);
recent/subscriber lists populate customer (fullName/phone). Verified 9/9 vs live (educator 20 / course 75: list+detail+
ownership-guards+dashboard+subscribers; package paths mirror course, no educator-owned package in staging to exercise).
`tsc` clean. **C3 dashboards: profile ✅ admin ✅ educator(dashboard+portal) ✅ promoter ✅ (already). ▶ remaining: the
big client/dashboard** — getDashboard/getResumeDashboard/getFreeDashboard; needs Mongo trending helpers
(fetchTrendingBooksOnly/EbooksOnly in book.controller, resolveFreeCategoryIds in free.controller) migrated first.

**C3 client-dashboard — prerequisite infra (is_trending) done; dashboard build pending.** ALTER ws_book + ws_ebook
ADD is_trending TINYINT DEFAULT 0 (DDL `schema-changes/2026-06-19_add_is_trending.sql`, applied — the new-app trending
flag was never in legacy SQL; admin toggleTrending was documented Mongo-only). Prisma Book.isTrending + EBook.isTrending
added + generated. Backfill `scripts/backfill-is-trending.ts` (staging name-disjoint → 0 set; mechanism ready for prod).
`tsc` clean (columns inert until consumed). **▶ RESUME:** build SQL trending helpers + resolveFreeCategoryIds +
admin toggleTrending, then the 3 client/dashboard handlers (getDashboard/getResumeDashboard/getFreeDashboard) — the
resume-dashboard reuses the now-LIVE lecture-progress hub. ⚠ ws_package has no isPaid → no free packages on SQL
(resolveFreeCategoryIds free-package branch yields none; Course free = purchase='0').

**C3 client-dashboard — trending helpers + free-category resolver on SQL (prereq done).** New
`src/modules/client-trending/client-trending.service.ts`: fetchTrendingBooksOnly (ws_book is_trending + price split),
fetchTrendingEbooksOnly (ws_ebook is_trending + plans via ws_package_course_ebook_price.ebookId, min-price free check),
resolveFreeCategoryIds (free courses purchase='no'[CourseFlag01 no@map"0"=free] → material/exam/video cat ids via
pivots; free packages none — ws_package no isPaid). Verified 7/7 (paid/free book filters, ebook plans, resolver
m=1/e=1/v=1). `tsc` clean. ⚠ CourseFlag01 enum TS values are `no`/`yes` (not "0"/"1"). **▶ next: wire the 3
client/dashboard handlers** (getDashboard/getResumeDashboard/getFreeDashboard) composing these + banners/testimonials/
subscriptions/ExamCountdown/Notification[all SQL] + the lecture-progress resume hub; flag `client-dashboard`.

**🎉 C3 COMPLETE — client/dashboard (all 3 handlers) on SQL (83 flags).** New `src/modules/client-dashboard/`
(flag `client-dashboard`) + `client-trending` (flag `client-trending`). getDashboard (buildHomeDashboard: banners/
exam-countdown/daily-test/recently-added-packages/courses+plans/course-categories/trending books+ebooks + unread
notifications + testimonials; per-item isPurchased/daysLeft via resolveOwnedEndAt), getResumeDashboard
(buildResumeDashboard reuses the LIVE lecture-progress hub listMyLearningProgress → top card per type +minutesLeft),
getFreeDashboard (buildFreeDashboard: trending-free + free-ebooks[min-price 0] + free-videos[free cat OR priceType=free]).
Verified 8/8 (home 5 sections + guest variant, free, resume). ⚠ Drift: ws_package no isPaid→recently-added=all active;
Course isPaid=purchase≠'no'; ExamResult has no submittedAt→daily-test lastResult ordered by id. `tsc` clean.
**ALL DASHBOARDS NOW SQL: profile ✅ admin ✅ educator(dashboard+portal) ✅ promoter ✅ client ✅.**
**▶ next: C4** — testSeries reads + wishlist (NEW table ws_wishlist) + goal/tracking/receipts.

---

### 2026-06-19 (same day, follow-up) — lecture-progress READ hub built on SQL; container flag stays OFF (coupled flip)

Built the SQL read surface + the live-session heartbeat, all gated behind `lecture-progress-container` (still OFF):
- `client-lecture-progress.service.ts`: added `reportLiveSessionProgress` (session→ws_live_session_course→
  LiveCourseSubscription entitlement), `listMyLearningProgress` (unified course+package+live cards: rollupByContainer
  ×3 + Course/Package/LiveCourse meta + educators + subs + per-container totals [course/package via the
  catalog-category-tree DAG `reachableCategoryIds` → videos-under-cats; live via session count] + lecture/chapter
  resolution), `listMyCoursesForResume` (course-only feed + hero resumeNext). DTOs match the Mongo card shapes.
- Wired `src/client/learning/progress.controller.ts` (reportLiveSessionProgress + listMyLearningProgress) and
  `src/client/course/progress.controller.ts` (listMyCoursesForResume) SQL branches under the container flag.
- Verified 8/8 via synthetic rows (ws_lecture_progress is EMPTY in staging): course card, percent, resumeNext
  video+percent, unified learning feed, lecture resolution.

**DECISION — container flag stays OFF (the one remaining COUPLED flip).** lecture-progress is read in two contexts:
(A) standalone Resume/Learning screens — now fully on SQL; (B) inline "Continue watching" per-video badges inside
`course.service.buildCourseDetails`, `catalog.controller`, and `live-course.controller.listLiveCourseRecordings` —
these host handlers are STILL fully Mongo (catalog-detail was deferred — Mongo-only fields), so their progress
sub-query MUST stay Mongo (videoId space). Turning the flag ON would make heartbeats+resume use SQL while the inline
badges read Mongo → empty badges. Per "don't break anything", the flag stays OFF until catalog-detail migrates;
then flip heartbeats + resume + badges together. All SQL code is built+verified+inert. `tsc` clean.

---

## 2026-06-18 — ✅ Wave 8 COMPLETE: DDL batch — 5 new tables + 2 ALTERs + 7 modules migrated to SQL

Closed out Wave 8 with the table-creating modules. **DDL** `docs/migration/schema-changes/2026-06-18_create_wave8_misc_tables.sql`
(applied to staging, idempotent):
- **5 new tables:** `ws_activity_log`, `ws_goal`, `ws_social_link_type`, `ws_social_link`, `ws_current_affair`,
  `ws_live_banner_slider` (6 incl. the type table).
- **2 ALTERs:** `ws_website_inquiry` +customer_id/description/message/source (+ existing name/mobile/email/city →
  nullable; note its timestamp cols are camelCase `createdAt`/`updatedAt`); `ws_offline_banner_slider` +order_by.
- 8 Prisma models added/extended (ActivityLog, Goal, SocialLinkType, SocialLink, CurrentAffair, LiveBannerSlider +
  Inquiry/OfflineBannerSlider edits); `prisma generate` run.

**Modules + branches (flags ON: `tracking`, `goal`, `cms-extra`, `inquiry`; Banner on existing `offline-batch`):**
- **tracking** — `src/modules/tracking/tracking.service.ts`; 2 admin handlers (list + summary). Summary uses Prisma
  groupBy (byEvent) + raw SQL for dailyCount (Y/M/D) + distinct customerId count.
- **goal** — `src/modules/goal/goal.service.ts`; branched INSIDE `goal.admin.service.ts` (keeps shared Redis cache +
  S3 cleanup). labels stored as JSON [{name}] (Mongo label _ids dropped). SQL search = title only (labels are JSON).
- **cms-extra** — `src/modules/cms/cms-extra.service.ts`; SocialLinkType/SocialLink/CurrentAffair/LiveBannerSlider.
  16 cms.controller handlers converted from genericX factories to dual-path. SocialLink hydrates typeId manually
  (scalar FK, no Prisma relation); SocialLinkType delete keeps the in-use→409 guard; LiveBanner reorder works
  (order_by). liveCourseId exposed as a string id (full live-course populate NOT reproduced — admin list only needs id).
- **inquiry** — `src/modules/inquiry/inquiry.service.ts`; admin list/get/delete + client submit. customer-populate
  hydrates from ws_customer (full_name split → first/last + phoneNumber + emailAddress).
- **offline Banner** — added to `offline-batch` module (list/create/update/delete/reorder); order_by now sortable.

**Verified** `scripts/verify-wave8-ddl-sql.ts` → **34/34 PASS** (all CRUDs, tracking summary aggregation, goal labels
JSON, SocialLinkType in-use 409, LiveBanner+offline-Banner orderBy sort & reorder, inquiry customer-populate, FK 404s,
no residue). `tsc` clean. **🏁 WAVE 8 DONE — all misc/low-value modules on SQL.**

---

## 2026-06-18 — ✅ VideoCategory DAG resolver built on SQL (recursive CTE) — the prerequisite that unblocks the 6 DAG consumers

Built the SQL equivalent of the Mongo category-tree walk — the long-flagged prerequisite for the container
lecture-progress heartbeats + resume/learning reads + catalog/free/material/dashboard category rollups.

**KEY FINDING (corrected a prior assumption):** the SQL DAG data is ALREADY PRESENT — `ws_video_category` (157
rows, all with `parent`) + `ws_video_category_relation` (2456 parent/child edge rows). **No backfill needed** (the
edges came with the catalog migration / staging dump). Earlier notes that said "ws_video_category empty, needs
backfill" were wrong.

**New module** `src/modules/catalog-category-tree/category-tree.service.ts` (flag `catalog-category-tree`):
- `descendantsOf(rootIds)` — DOWN-walk via `WITH RECURSIVE` over ws_video_category_relation (parent→child), depth
  cap 20 (cycle-safe), deduped. SQL mirror of Mongo `collectCategoryTreeIds` BFS.
- `ancestorsOf(leafIds)` — UP-walk (child→parent). Mirrors the bounded ancestorChain in resolveVideoCourse/Scope.
- `reachableCategoryIds(kind, scopeId)` — course/liveCourse/package → linked roots → full subtree. SQL mirror of
  `resolveScopedReachableVideoCategoryIds`. Package roots = PackageSpecificSubject.subjectId + both endpoints of
  each linked VideoCategoryRelation (via ws_video_category_package_relation).
- `resolveVideoScope(catId)` / `resolveVideoCourseId(catId)` — owning container/course by leaf+ancestors.
- ⚠ **CTE seed fix:** seed the recursion from the root ids as literal `SELECT n` UNIONs, NOT
  `WHERE id IN (...) FROM ws_video_category` — staging has relation edges whose endpoints aren't in the 157-row
  category table, and gating the seed on table membership made the recursion never start.
- ⚠ **drift:** ws_video_category has no `live_course_id` tag column (Mongo-only), so liveCourse reachability uses
  only the LiveCourse.videoCategoryId downward pointer (no tagged-category roots).

**Verified against real SQL data** `scripts/verify-category-tree-sql.ts` → **13/13 PASS**: descendantsOf (root +
all children + dedup + multi-level), ancestorsOf (leaf + parent), reachableCategoryIds(course) [⊇ descendantsOf(root)]
+ (package) [specific-subject root], resolveVideoScope→course, resolveVideoCourseId→course id, null/empty guards.
`tsc` clean. **Flag `catalog-category-tree` NOT yet in `.env`** — turn on only when the first consumer flips (the
resolver is inert until a consumer calls it).

**⏭️ NEXT — consumers flip ONE SLICE AT A TIME (not all at once):** the 6 DAG consumers (catalog, course.service,
progress heartbeat ×2, dashboard, free) are each a FULL Mongo→SQL consumer migration — they operate in Mongo
ObjectId space today, so the tree-walk can't be swapped in isolation; the whole handler must flip so the resolver
receives SQL int ids. The resolver is the unblocker; flipping is now per-consumer work. Cleanest first flip =
the container progress heartbeat (pairs with the already-ON `client-lecture-progress` free-video slice).

---

## 2026-06-18 — ✅ Wave 8 cont.: offline CITY admin CRUD migrated to SQL, no DDL (+ inquiry & Banner reclassified to DDL-needed)

Continued the offline pass with the **City** admin CRUD (5 handlers) — the last clean no-DDL offline slice.

**`offline-city` module** (flag `offline-city` already ON for cart/address) — added admin CRUD to the existing
read module: repo `listAll`/`create`/`update`/`remove`/`countCenters`; service `listCitiesAdmin` (incl. inactive,
status filter), `getCityAdmin`, `createCityAdmin`, `updateCityAdmin`, `deleteCityAdmin` (Envelope: 404 missing,
409 city-with-centers). **Drift:** `ws_offline_city` has NO `stateId` column (Mongo field optional/default null),
so the admin state filter + `.populate("stateId")` are dropped — consistent with this module's read precedent.

**Controller** — 5 City handlers in `offline.controller.ts` branched on `isOfflineCityMysql()`. SQL body schema
omits stateId; numeric id/order. Verified `scripts/verify-offline-city-admin-sql.ts` → **14/14 PASS** (CRUD, status
filter active/inactive, center-FK 409 guard, 404s, no residue). `tsc` clean.

**Two siblings RECLASSIFIED to DDL-needed (investigated, NOT migrated):**
- **inquiry** — SQL `ws_website_inquiry` is a LEGACY schema: Prisma `Inquiry` has only name/mobile/email/city/
  course/mode. MISSING `customer_id`, `description`, `message`, `source` that the Mongo model + admin reads use
  (`.populate("customerId")` + search on `description`). Flipping as-is drops the customer link + description →
  breaks the admin view. Needs ALTER TABLE first.
- **offline Banner** — `ws_offline_banner_slider` has image/key/key_id but NO `order_by`; the Mongo banner sorts by
  `orderBy` + has a `reorderBanners` endpoint (both no SQL home → reorder would silently no-op). Needs ALTER TABLE
  (add `order_by`) first.

**Net:** all genuinely no-DDL Wave 8 slices are now done. Everything remaining needs a table create or ALTER —
deferred to a sign-off batch.

---

## 2026-06-18 — ✅ Wave 8 cont.: offline admin CRUD (Center / Batch / Enquiry) migrated to SQL, no DDL

Completed the offline admin pass — the Prisma models already existed (no DDL); the existing `offline-batch` +
`offline-enquiry` modules had only client READS, so I added the admin WRITE surface and branched the 12 admin
handlers in `src/admin/offline/offline.controller.ts`.

**`offline-batch` module** (flag `offline-batch` ON) — consolidated Center + Batch admin CRUD here (transformers
`toOfflineCenterDto`/`toOfflineBatchDto` already lived in this module):
- Repo: `createCenter`/`updateCenter`/`deleteCenter`/`countBatchesInCenter`/`cityExists`,
  `createBatch`/`updateBatch`/`deleteBatch`/`deleteEnquiriesInBatch`.
- Service: `createCenter`/`updateCenter`/`deleteCenter` + `createBatch`/`updateBatch`/`deleteBatch` (Envelope
  pattern: FK-missing→404, center-with-batches→409). Drifts handled: `images[]`↔JSON `image` col, `phone`↔BigInt,
  `description`↔`discription` col [sic], NO `status` col → dropped on write + synthesized true on read.
  deleteBatch cascades `ws_offline_enquiry` (mirrors Mongo).

**`offline-enquiry` module** (flag `offline-enquiry` ON) — added admin `listEnquiriesAdmin` (paginated, batch-
populated, name/email search + date range) + `deleteEnquiryAdmin`. `mobile` BigInt→string in DTO.

**Controller** — 12 handlers branched on `isOfflineBatchMysql()` / `isOfflineEnquiryMysql()` (Center 5, Batch 5,
Enquiry 2). SQL-path body schemas accept numeric cityId/centerId (Mongo path keeps 24-hex). Banner/City admin
handlers untouched (City already had its own module; Banner = OfflineBannerSlider, separate).

**Verified** `scripts/verify-offline-admin-sql.ts` (full City→Center→Batch→Enquiry chain, self-cleans) →
**23/23 PASS**: images[] JSON round-trip, BigInt phone/mobile as string, status-synth, city/center populate,
FK-missing 404s, center-with-batches 409 block, batch-delete→enquiry cascade, enquiry search. No residue.
`tsc` clean. **Flags `offline-batch` + `offline-enquiry` ON.**

---

## 2026-06-18 — ✅ Wave 8 STARTED: `customer-master` (4 lookup tables) + `ImageNotification` CRUD migrated to SQL, no DDL

Audited all 7 Wave 8 ("misc / low-value") clusters; migrated the two ZERO-DDL slices (Prisma models already exist).
No blocker exists to starting Wave 8 — it's independent of the VideoCategory-DAG prerequisite (that gates only the
container lecture-progress paths, NOT Wave 8).

**`customer-master`** (new flag) — `src/admin/customer-master/customer-master.controller.ts` (all 16 handlers)
branches on `isCustomerMasterMysql()` → new `src/modules/customer-master/customer-master.service.ts`. Four flat
lookup tables, no new DDL:
- State (`ws_customer_state`, field `state_code`←`stateCode`), District (`ws_customer_distict` [sic],
  FK `stateId`@map("state"), populated state DTO mirrors Mongo `.populate("stateId","_id name stateCode")`),
  Education (`ws_customer_education`, `status` not `active`), TargetGoal (`ws_customer_target_goal`, required
  `image` defaulted to ""). DTOs emit `_id` string + Mongo-shaped keys. District `stateId` body is numeric on SQL
  (numeric-tolerant zod variant in the controller; Mongo path keeps the 24-hex schema). FK existence → 404.

**`ImageNotification`** (same `client-notification` flag — same cluster) — the 4 ImageNotification handlers in
`notification.controller.ts` now branch to new SQL fns in `admin-notification.service.ts`
(`listImageNotifications`/`create`/`update`/`delete`; `ws_image_notification`, `redirect_url`←`redirectUrl`,
no timestamps so list sorts `id desc`). Completes the notification cluster (the 3 ImageNotification handlers were
the last Mongo holdouts there).

**Verified** `scripts/verify-wave8-sql.ts` (creates/mutates/deletes own rows, self-cleans) → **24/24 PASS**:
all 4 lookup CRUDs incl. District→State FK validation + populated DTO, ImageNotification CRUD, 404/null on missing,
no residue. `tsc` clean. **Flags `customer-master` + `client-notification` (for images) ON.**

⏸️ **Wave 8 remaining = the 6 DDL-needing modules (reported for decision, NOT yet built):** ActivityLog (tracking),
Goal, SocialLink(+Type), CurrentAffair, LiveBannerSlider — each needs a net-new table. Offline center/batch/enquiry
admin CRUD: models EXIST but need their own module pass. Inquiry: model exists but drifts (no customerId/description).

---

## 2026-06-18 — ✅ `client-lecture-progress` FREE-VIDEO slice migrated to SQL + flag ON (cleanest slice; container/DAG paths stay Mongo)

Took the **cleanest independently-shippable slice** of the 14-file lecture-progress hub: the standalone free-video
vertical. It needs NO content-graph — `reportFreeVideoProgress` validates only `Video.status`+`priceType=free`
(free identity = entitlement, no scope/DAG); `listFreeVideoResume` joins only `ws_video` + `ws_video_category`
(title/image), both already SQL. The container-scoped heartbeat + resume/learning reads STAY Mongo (they need the
`VideoCategory.childCategoryIds` DAG migrated first — separate effort, untouched).

**No schema change** — reused existing `ws_lecture_progress` (Prisma `LectureProgress`).

**SQL module** `src/modules/client-lecture-progress/client-lecture-progress.service.ts` — added:
- `listFreeResume(customerId, limit)` — free cards (source=free rows → join live+free `ws_video` + category
  title/image), mirrors the Mongo card shape exactly. Drops videos flipped to paid/disabled.
- `findLiveVideo(videoId)` — returns `{id, priceType}` for the controller's 404-vs-403 split.
- (`upsertVideoProgress` with `source:"free"` already existed — reused for the heartbeat write.)

**Controller branched** `src/client/free/freeProgress.controller.ts` on `isLectureProgressMysql()`:
- `reportFreeVideoProgress` — SQL path parses int id, `findLiveVideo` (missing→404, paid→403), `upsertVideoProgress`.
- `listFreeVideoResume` — SQL path delegates to `listFreeResume`. Envelope unchanged.

**Verified end-to-end** `scripts/verify-free-progress-sql.ts` (real live customer + free video, self-cleans) →
**20/20 PASS**: heartbeat create/update/completion-at-95%/sticky-after-rewind/single-row-upsert, guards
(live→ok, unknown→404, paid→403), resume card shape + daysLeft=null + resumeNext, paid-video excluded from feed,
AND join correctness proven both ways (graceful null on the staging dangling vcategory_id FK; real category
hydrates when present). No DB residue. `tsc` clean. **Flag `client-lecture-progress` ENABLED in `.env`.**

⚠ **What's still Mongo under this flag** (documented, NOT yet migrated — needs the VideoCategory DAG SQL layer):
the 2 container heartbeats (`course/progress.controller.ts` reportLectureProgress via `scopeReachableCategories`,
`learning/progress.controller.ts` reportLiveSessionProgress), and all resume/learning READS
(`learning/progress.controller.ts` listMyLearningProgress, `course/progress.controller.ts` listMyCoursesForResume,
`learning/resumeCard.ts`, `dashboard.controller.ts` getResumeDashboard). The free-video heartbeat shares the SAME
`ws_lecture_progress` table, so when those flip later they read consistently — no data split (free rows carry
`source=free`, container rows carry pointers; disjoint).

---

## 2026-06-18 — ✅ `client-notification` prerequisite (b): admin notification WRITE subsystem migrated to SQL (dual-read cutover)

Resolved the SECOND `client-notification` blocker — the admin write subsystem (audience + dispatcher + scheduler +
controller), which was the real work behind the "BullMQ job identity" note. The BullMQ jobId is just `String(id)`
(works for int or hex); the actual coupling was Mongo reads/writes throughout the write path.

**New SQL module** `src/modules/admin-notification/admin-notification.service.ts`:
- `resolveAudience` — platforms/courses/users → SQL customer ids. Course-targeting via
  `ws_package_course_subscription` with **`status: true` + endAt null/future** (NO payment_status column — documented
  drift). Token-owning gate uses `ws_customer_device_token` (the part-(a) table), not `Customer.firebaseTokens`.
- `dispatchAudience` — collect tokens (broadcast = all live accounts' tokens), `sendPush`, then for targeted sends
  fan out per-recipient rows via `prisma.notification.createMany`.
- `dispatchScheduledById` — atomic claim "scheduled"→"sent" via conditional `updateMany` count (no double-send),
  dispatch, persist; rollback to "scheduled" on throw (BullMQ retries).
- `existsSql` / `markFailed` / `listScheduledForRehydrate` — worker dual-read routing + boot rehydrate.
- Controller persistence: `createScheduled` (returns int id = jobId), `createImmediateLog`, `cancelScheduled`,
  `listAdminLog`, `bulkDelete`, `deleteOne`.

**Legacy files branched on `isAdminNotificationMysql()`:**
- `src/admin/notification/dispatcher.ts` — `dispatchAudience` + `dispatchScheduledById` delegate to SQL when on.
  `DispatchResult.targetCustomerIds` widened to `(ObjectId | number)[]` (callers only read `.length`).
- `src/admin/notification/scheduler.ts` — `rehydrate` reads SQL scheduled rows PLUS leftover Mongo scheduled rows
  (drain window); worker failed-listener dual-reads (`existsSql` → SQL `markFailed`, else Mongo `$set failed`).
- `src/admin/notification/notification.controller.ts` — all 6 handlers branched (broadcast scheduled+immediate,
  cancel, list, bulk-delete, delete). Id-validation switches hex→numeric on the SQL path (`isValidId`). The 3
  ImageNotification handlers STAY Mongo (no `ws_image_notification` consumer + no SQL table).

**CUTOVER STRATEGY — dual-read worker fallback (user-recommended):** the BullMQ worker routes each job by id —
a numeric id resolving to a SQL row dispatches via SQL; a non-numeric id (legacy Mongo `_id` hex) or one with no SQL
row falls through to the Mongo path. So scheduled jobs queued BEFORE the flip still fire correctly; the fallback
self-retires once Redis drains pre-cutover jobs. No ops timing window, zero lost notifications.

`tsc` clean. **Flag `client-notification` ENABLED in `.env`. VERIFIED END-TO-END:**
`scripts/verify-notification-sql.ts` (reuses a live customer + throwaway device token, self-cleans, FCM disabled
for the run) → **23/23 PASS**: audience (broadcast/targeted/token-gated), immediate send + per-recipient fanout,
schedule→claim→fire (claim-lock proven — double-fire is a no-op), dual-read routing (existsSql: SQL int vs Mongo
hex vs unknown), cancel, list (parent-rows-only), delete, bulk-delete. No residue left in DB. **`client-notification`
is DONE** — only `client-lecture-progress` (Mongo content-graph blocked) remains of the two OFF consumers.

---

## 2026-06-18 — ✅ `client-notification` prerequisite (a): multi-device FCM token table `ws_customer_device_token` CREATED + backfilled + rewired

Resolved the FIRST of the two `client-notification` blockers (the FCM multi-device token store). The second
blocker (BullMQ scheduled-job identity) is untouched — flag stays OFF until that lands too.

**New table** (`docs/migration/schema-changes/2026-06-18_create_customer_device_token.sql`):
- `ws_customer_device_token` (INT PK) — one row per `(customer_id, token)`. `token` is **globally UNIQUE**
  (`uniq_device_token`) so a handset re-registering MOVES the row to the new owner — mirrors Mongo's token-keyed
  two-step `$pull`-then-`$push` upsert into `Customer.firebaseTokens[]`. `platform` VARCHAR(16), nullable
  timestamps. Index `idx_dt_customer (customer_id, updated_at)`. No hard FK (0/null-sentinel tolerance).
- Prisma model `CustomerDeviceToken` added to `schema.prisma` (after `FolderItem`); `prisma generate` run.

**Backfill** (`scripts/backfill-customer-device-tokens.ts`): idempotent (CREATE IF NOT EXISTS + DELETE-then-insert).
Bridge = Mongo customer `_id` → `ws_customers.phoneNumber` → `ws_customer.id` (same as Wave 7). De-dups by token,
newest `updatedAt` wins. Staging run: 4 docs with `firebaseTokens`, all 4 missed the phone bridge / had 0 tokens
(`{docsIn:4, tokensIn:0, custMiss:4, out:0}`) — same staging-vs-prod bridge gap noted across this migration; table
created + queryable (row count 0).

**Rewire** (`src/modules/customer-profile/customer-profile.repository.ts`): `setDeviceToken` /
`setDeviceTokenByPhone` now upsert into the child table (token-keyed, via `upsertDeviceToken` helper) instead of
overwriting the single `device` column; `clearDeviceToken` deletes the matching row. The legacy single `device`
column is kept in sync (newest wins) so the Mongo-mirrored read still works. Added `listDeviceTokens` (FCM fan-out)
and `pruneDeviceTokens` (dead-token cleanup). `setDeviceToken` returns `{count:0}` for a missing customer (404
preserved). Service envelope unchanged.

**FCM prune** (`src/utils/fcm.ts`): invalid-token cleanup now branches — when `isMysqlModule("customer-profile")`,
prune `ws_customer_device_token`; else keep the Mongo `$pull`. `tsc` clean. **`client-notification` flag still OFF**
(BullMQ job-identity cutover remains).

---

## 2026-06-18 — 🔎 Wave 7 follow-up: investigated flipping the 2 OFF consumers — both confirmed BLOCKED (code-backed), flags stay OFF

Attempted to finish `client-notification` + `client-lecture-progress` (the RESUME POINTER next-step) under a strict
**"nothing breaks"** mandate. Deep investigation found both have **structural** blockers (not effort) — flipping
either would break live behavior or split data. No code changed; flags remain OFF. Documented so the next session
doesn't re-investigate.

**`client-notification` — BLOCKED on FCM token store + BullMQ job identity:**
- The write path's FCM delivery reads Mongo Customer `firebaseTokens[]` (a multi-device ARRAY, with invalid-token
  `$pull` pruning in `utils/fcm.ts`). SQL `ws_customer` has only a SINGLE legacy token: `firebaseToken @map("device")`
  — **no multi-device array, no token table**. Migrating delivery to SQL = lossy (push to one device only) → breaks
  multi-device users. A faithful flip needs a NEW `ws_customer_device_token` child table + backfill + rewiring
  `registerDeviceToken`/fcm pruning first.
- The SCHEDULED path (controller → BullMQ `scheduleNotificationJob` → `dispatchScheduledById`) keys jobs by the Mongo
  `_id`. Moving scheduled rows to SQL int ids would orphan in-flight BullMQ jobs unless drained/migrated.
- Audience course-targeting (`PackageCourseSubscription.distinct`) IS SQL-ready; the claim-lock (`findOneAndUpdate`
  status scheduled→sent) maps to a conditional `updateMany`+count. Those aren't the blocker — tokens + job identity are.

**`client-lecture-progress` — BLOCKED on the Mongo content graph (no SQL equivalent):**
- All 3 heartbeat writers (`course/progress.controller.ts`, `learning/progress.controller.ts`,
  `free/freeProgress.controller.ts`) validate the route id with `objectId.parse()` (24-hex) — rejects numeric SQL ids.
- The recorded-video heartbeat is GATED by `scopeReachableCategories.ts::resolveScopedReachableVideoCategoryIds`,
  which walks the Mongo `VideoCategory.childCategoryIds` DAG tree. **No SQL equivalent** (`ws_video_category` has no
  recursive hierarchy nav). Skipping it = breaks the reachability entitlement check.
- The resume/learning READS (resumeCard.ts, learning/progress.controller.ts, course.service.ts, catalog +
  categories controllers) join LectureProgress to Mongo-only content: Course, Package, LiveCourse, LiveSession,
  VideoCategory, CourseEducator (none have SQL tables/usable hierarchy). Progress-in-SQL + content-in-Mongo → joins
  can't resolve → empty/broken resume feed.
- Entitlement subs (ws_package_course_subscription, ws_live_course_subscription) + ws_video DO exist; the blocker is
  the VideoCategory tree + the Course/LiveCourse/LiveSession content layer, which must migrate first.

**Conclusion:** both remaining OFF consumers depend on prerequisite migrations (FCM device-token table + BullMQ
job-id cutover; the VideoCategory-tree + content-graph SQL layer) that are their own efforts and carry live-system
break risk that can't be verified on staging. Left flag-OFF per the nothing-breaks mandate. Their SQL modules remain
code-complete + ready for when those prerequisites land.

---

## 2026-06-18 — 🔌 Wave 7: wired the new-table consumers — ebook-download + folder ON; notification + lecture-progress code-complete (flag OFF)

Follow-up to creating the 8 tables: built the consumer modules so the previously-blocked surfaces run on SQL.

**Key finding that unblocked this:** at runtime every relevant id IS already a SQL int — `customer-auth` makes
`req.user.id` the SQL customer id, and `catalog-*` makes content ids (ebook/video/material) SQL ints in the request.
So the "Mongo content ≠ SQL" worry only affected the *backfill* (which stored refId 0), NOT the live path — proven
by folder addItem hydrating a real ws_video id to its title.

**✅ FLIPPED + verified (flags ON):**
- **client-ebook-download** — recordDownload (idempotent) / list / countActiveDownloads / removeDownload +
  the profile-dashboard count. Verified end-to-end (record→list 'Super Six'→count 1→idempotent→remove→0).
- **client-folder** — all 8 handlers ×2 types (list/create/detail/update/remove/addItem/removeItem/allItems) +
  ensureDefaultFolders + countSavedItems. Verified incl. content hydration (refId→ws_video title) + dup-reject + dedup.

**⏸️ Code-complete, FLAG OFF (write subsystem / consumer breadth still Mongo):**
- **client-notification** — client reads (visibility customer OR broadcast; unread same filter) + markRead/markAll,
  verified in isolation. OFF because the WRITE path is a Mongo subsystem (admin dispatcher + scheduler/BullMQ + FCM
  fan-out + per-recipient insertMany keyed by Mongo Customer ObjectIds). Flip reads alone = stale feed.
- **client-lecture-progress** — heartbeat upserts (per (customer,video)/(customer,liveSession), additive pointers,
  sticky completed) + rollups + completedLectureCount built. OFF because it's a 14-file content-join hub: the
  heartbeat is gated by Mongo entitlement/reachability reads, and resume/learning reads join content across many
  files — heartbeat + reads must flip together.

**profile getProfileDashboardCounts:** the folder/ebook/notification counts are now flag-aware (use SQL when their
module is on). Guarded the `new ObjectId(userId)` construction (it would throw on the numeric SQL id under
customer-auth — a pre-existing latent bug). The subscription + pastExams counts still read Mongo and need their own
flip (they don't function under SQL-auth today).

`tsc` clean. Enabled `client-ebook-download` + `client-folder`; `client-notification` + `client-lecture-progress`
stay OFF.

---

## 2026-06-18 — 🆕 Wave 7: created the 8 previously-blocked SQL tables + test-series vertical + webhook book/ebook

**DDL (live staging, `docs/migration/schema-changes/2026-06-18_create_wave7_blocked_tables.sql`):** created
`ws_lecture_progress`, `ws_notification`, `ws_folder`, `ws_folder_item`, `ws_ebook_download`, `ws_test_series`,
`ws_test_series_price`, `ws_test_series_order`, `ws_test_series_subscription` + added `ws_book_order.paid_at`.
INT PKs throughout (matches existing tables); scalar-only FK columns (no hard constraints, 0/null sentinel-tolerant);
polymorphic `folder_item.ref_id` single-column; `test_series.exam_category_ids`/`notification.audience`/`.data` JSON.
9 Prisma models appended + `BookOrder.paidAt`. `prisma generate` OK. All 9 round-trip-verified via tsx.

**Backfill (`scripts/backfill-wave7-blocked-to-sql.ts`):** customer phone-bridge (Mongo ObjectId →
ws_customers.phoneNumber → ws_customer.id), test-series family self-contained (intra-family id maps). Staging result:
notification 22/24, test_series 2/2, test_series_price 3/3; customer-keyed rows (lecture-progress 15, folders 8,
folder-items 7, downloads 2, ts subs/orders) mostly **skipped — staging test users aren't in the SQL customer dump**
(same documented artifact as Wave 6; production bridges far better). Other content refs (video/ebook/course/refId)
have no Mongo→SQL bridge → stored 0/null.

**✅ FLIPPED + verified (flag ON):**
- **test-series** (`test-series-order`) — FIRST net-new-table vertical, fully self-contained: apply-promo preview +
  create-order + /verify (fold-or-fresh) + my-subscriptions test_series tab + webhook. Verified end-to-end vs live DB
  (plan 60d/₹399 → verify +60d → 2026-08-17 → idempotent → my-subs card → webhook fold +60d → 952). **Unblocks
  test-series payment AND the my-subs test_series tab** (was empty for SQL-auth customers).
- **webhook book + ebook fulfillment** (`book-order`/`ebook-order`, already ON) — `fulfillBookWebhookMysql` (AWB
  allocated SQL-side in-txn, no Mongo Counter) + `fulfillEbookWebhookMysql`, branched in webhook.controller.ts.

**⏸️ Tables created + backfilled (production-ready) but consumers STAY Mongo — flipping reads alone would
split-brain against a Mongo write-path/content-graph:**
- **lecture-progress** — a content-join hub: heartbeat + resume/learning rollups join to Video/Course/Package/
  LiveSession content whose Mongo→SQL id bridge doesn't exist. Needs the video/lecture content graph bridged first.
- **notification** — reads are clean, but the write path is a Mongo subsystem (admin dispatcher + scheduler + FCM
  push fan-out + BullMQ) + reminder job-carrier rows → flipping reads alone = stale feed.
- **folder/folder-item** — polymorphic refId (material/video/ebook) with no SQL bridge (backfilled 0).
- **ebook-download** — ebookId unbridged + the download-register write.

`tsc` clean. Enabled `test-series-order`.

---

## 2026-06-18 — 💳 Wave 7: package payment write path + webhook ebook fulfillment on SQL (payment surface closed)

**What:** Two payment-write pieces, closing the migratable payment surface.

**(1) Package payment** — added to the EXISTING `src/modules/commerce-order/` (same tables/repo/transformer as
course; no new module): `findPackagePlanForOrder` / `createPackageOrderMysql` / `findPackageOrderForVerify` /
`verifyPackageOrderMysql` (service) + `findActivePackageSub` / `verifyPackageTx` (repo). Toggled by a SEPARATE
`package-order` flag (independent of course's `commerce-order`). Branched `package-payment.controller.ts`
createPackageOrderPayment + `verify.controller.ts`. 3-table pattern (pending order → sub+tracking at verify, one tx).
⚠ plan must be a PACKAGE plan (packageId set, courseId null); fulfilled sub sets package_id with course_id NULL.
DAYS duration. PackageCourseOrder.customer_id is `userId Int` (the earlier agent spec's "VARCHAR" was wrong).

**(2) Webhook ebook fulfillment** — added `fulfillEbookWebhookMysql` to `ebook-order` (keyed by razorpayOrderId
ALONE — webhook payload has no customer) + repo `findOrderByRazorpayOnly`; branched `webhook.controller.ts`
paymentWebhook ebook section (SQL-first, dual-read fallback). Reuses `verifyEbookOrderMysql` (idempotent).

**Verified end-to-end vs live DB (flags ON):**
- package: plan 102 (pkg 4, ₹6500, 180d) → create pending order → verify (fresh grant, package_id 4, course_id null,
  +180d → 2026-12-15) → idempotent → 2nd purchase folded (sub.amount accumulated 6500→13000).
- webhook ebook: pending order → fulfill (order complete, sub +180d → 2026-12-15) → idempotent (1 sub) → unknown
  id → null.

`commerce-order` + `ebook-order` flags were already ON (verify used them); enabled `package-order`. `tsc` clean.

**⏸️ STILL DEFERRED (documented blocks):** test-series payment (no ws_test_series* table), webhook book branch
(needs paidAt column + tracking flatten + Counter), recordingWebhook (Json recordings + socket), profile
getProfileDashboardCounts (5/7 counts have no SQL table), client/dashboard (no clean slice). The orders 3 writes
(placeCourseOrder/placeEbookOrder via /client/orders) remain Mongo — the canonical create-order/verify path is
`/payment/*` (now on SQL for course/ebook/book/package/live-course).

---

## 2026-06-18 — 💳 Wave 7: live-course payment write path on SQL (create + verify + webhook) + remaining-surface analysis

**What:** New `src/modules/live-course-order/` branching the live-course payment vertical on the new
`live-course-order` flag — the FIRST payment-WRITE path fully on SQL end-to-end:
- `createLiveCourseOrderPayment` (src/client/payment/live-course-payment.controller.ts) — SQL branch writes a
  pending `ws_live_course_subscription` row + Razorpay order; numeric planId schema.
- `verifyPayment` (verify.controller.ts) — live-course branch, dual-read fallback (SQL first, Mongo on miss).
- `paymentWebhook` (webhook.controller.ts) — live-course fulfillment branch, same dual-read.

**Single-table design:** unlike course/package (3-table order/sub/tracking), `ws_live_course_subscription` carries
BOTH payment (razorpay ids, payment_status) AND entitlement (start/end, status). createPending → pending row;
verify/webhook → flip to verified (fresh grant) OR fold onto an existing active sub (extend endAt, sum paid) and
retire the pending row.

**⚠ Duration is DAYS** (`computeEndAt asDays:true`) — matches the shipped admin-live-course grant + Mongo
controllers. The prisma schema comment saying "MONTHS" is STALE; DAYS is the precedent ([[project_plan_duration_unit]]).
withMaterial/customerShippingId are Mongo-only (no SQL column); promocodeId coerced to int; LiveCourse title still
read from Mongo.

**Verified vs live DB end-to-end (flag ON):** plan 1 (₹1999, 3 days) → create pending → verify (fresh grant,
start 2026-06-18 → end 2026-06-21 = +3 DAYS, payment id set) → idempotent re-verify (no change) → webhook 2nd
purchase folded onto the active sub (end → 2026-06-24, paid 1999→3998, 2nd row retired). `tsc` clean. Enabled
`live-course-order`.

**⏸️ DEFERRED this run (analyzed + documented for next session):**
- **package-payment** create-order — doable next (3-table commerce-order pattern, all SQL tables exist; the spec's
  customer_id-as-VARCHAR was wrong — it's `userId Int`).
- **test-series payment** — BLOCKED (no ws_test_series* table).
- **webhook book branch** — needs schema work (paidAt column, tracking flatten, Counter); **ebook branch** doable,
  deferred to batch with package.
- **profile getProfileDashboardCounts** — 5/7 counts BLOCKED (Notification, FolderItem×2, EbookDownload have no SQL
  table; PackageCourseSub has no payment_status/targetPackageId; ExamResult lacks inProgress/submittedAt). Not worth
  a mixed half-count. profile READS already on customer-profile.
- **recordingWebhook** — Json recordings + socket.io, Mongo-only.
- **client/dashboard** — no clean slice (prior analysis).

---

## 2026-06-18 — 🧾 Wave 7: client orders — listMyOrders on SQL (+ client/dashboard analyzed & deferred)

**What:** New `src/modules/client-orders/` (repo + service) branching `listMyOrders` in
`src/client/orders/orders.controller.ts` on the new `client-orders` flag. Read-aggregation over already-migrated
tables (course/package subs + ebook subs + book orders for a customer, newest-first); no new tables. Matches the
Mongo `{ courseSubscriptions, ebookSubscriptions, bookOrders }` shape.

**⚠ Drift (same family as client-purchase-history, distinct contract):** Mongo populates courseId→{name,thumbnail}
and packageId→the price/plan doc; SQL maps Course.image→thumbnail, resolves package_id directly, hydrates the plan
via planId (packageId field = the plan DTO). ws_book_order: items from the order_items JSON, AWB from tracking_id
(BIGINT), customer keyed by user_id (→customer_id). withMaterial from pc_material_id.

**⚠ STAY Mongo (no SQL branch):** placeCourseOrder / placeEbookOrder / verifyPayment — the payment-write path
(Razorpay order+verify + subscription grant + PromoCode.appliesTo + ReferralProgram crediting) → payment wave.

**Verified vs live DB (flag ON):** cust 472341 → 1 package sub (plan 88/90d/₹7500) + 4 book orders (items parsed,
AWB resolved, verified/pending), 472335 → 1 course sub + 1 ebook + 1 book order. `tsc` clean. Enabled `client-orders`
in `.env`.

**⏸️ client/dashboard analyzed & DEFERRED (no clean slice):** getResumeDashboard = 10× LectureProgress (no SQL
table); getDashboard = atomic Promise.all bundling ExamCountdown + Notification (no SQL tables) + the Mongo-only
trending helpers + banners/testimonials in one payload (no per-section flag boundary); getFreeDashboard = clean
tables BUT its 3 data helpers (fetchTrendingBooksOnly/fetchTrendingEbooksOnly in book.controller,
resolveFreeCategoryIds in free.controller) are raw Mongo. banner-slider + testimonial SQL modules exist;
ws_notification/ws_exam_countdown/ws_lecture_progress do NOT. To unblock free-dashboard, migrate those 3 helpers first.

---

## 2026-06-18 — 🗂️ Wave 7: client categories — listVideoCategoryChildren on SQL (children-nav trio complete)

**What:** Wired `listVideoCategoryChildren` in `src/client/categories/categories.controller.ts` onto the
already-on `catalog-video` flag — completing the children-nav trio (material + exam children were already migrated).
Added to `src/modules/catalog-video/`:
- repo: `findCategoryByIdAny` (parent lookup, no status gate — matches Mongo `findById`), `listActiveChildren`
  (children via the `parent` self-FK + optional title `contains`), `parentsWithChildren` (distinct-parent probe
  for `havingChildDirectory`).
- service: `getVideoCategoryChildren(parentId, search?)` → `{ parent, list[].category{ ...dto, count,
  havingChildDirectory } }`, and `parseVideoCategoryId`.

Mirrors the existing catalog-material/catalog-exam `getCategoryChildren` pattern exactly; no new flag (catalog-video
already ON), no new tables.

**⚠ Divergence (documented):** Mongo gates children via the `childCategoryIds[]` DAG embed; SQL derives them from
the single `parent` FK (same as admin-master). Root-level categories use `parent=0` (sentinel) — not a real row, so
a `parent=0` lookup correctly returns null/404.

**⚠ Rest of categories.controller STAYS Mongo (no SQL tables exist):** the 4 `examCountdown*` handlers
(ExamCountdown / ExamCountdownCategory — no SQL table), `listPackageCategories` / `listPackagesByCategory`
(PackageCategory — no SQL table), and `listVideosByCategory` / `getVideoByCategory` (LectureProgress + video
encryption — Mongo-only progress). `listMaterialsByCategory` stays Mongo (paid-material entitlement gating).

**Verified vs live DB (flag ON):** cat 295 "Old courses" → 18 children (matches raw active count), cat 8 "Clerk" →
3 children, order-sorted, with video counts + havingChildDirectory; missing parent → null/404; search filters.
`tsc` clean.

---

## 2026-06-18 — 📚 Wave 7: client my-subscriptions library (course + ebook tabs) on SQL

**What:** New `src/modules/client-my-subscriptions/` (repo + service) branching the `type=course` (course+package)
and `type=ebook` tabs of `src/client/my-subscriptions/my-subscriptions.controller.ts` on the new
`client-my-subscriptions` flag. Read-aggregation over already-migrated tables; no new tables.

**Behavior preserved:** active-only cards (`status=true && endAt>now`), deduped to the furthest-out endAt per
target, soonest-expiring first — same `Card` envelope (title/author/thumbnail/badge/daysLeft/action.kind/meta).

**⚠ `type=test_series` STAYS Mongo** — `ws_test_series*` has no SQL table. NOTE a pre-existing cross-store gap
(not introduced here): `customer-auth` is on SQL so the client token carries a numeric id, but
`TestSeriesSubscription` is keyed by the Mongo customer ObjectId — the test_series tab returns empty for SQL-auth
customers regardless. Documented in the controller.

**⚠ Drift:** `ws_package_course_subscription` has no `payment_status` → the Mongo `paymentStatus:"verified"`
filter maps to `status=true`. SQL `package_id`=the package (`pcb_id`=plan) — the Mongo handler inverts
packageId/targetPackageId, resolved directly. `course.author` is Mongo-only → null.

**Verified vs live DB (flag ON):** the real `endAt>now` filter returns 0 for the past-dated staging subs (correct);
seeded a future-dated package + ebook sub to prove composition — package card "CCE"/badge "Recorded Course"/30d,
ebook card "Super Six"/30d, dedup + hydration + card shape all correct; seed cleaned up. `tsc` clean. Enabled
`client-my-subscriptions` in `.env`.

---

## 2026-06-18 — 📊 Wave 7: admin subscription reads + reports (aggregation) on SQL

**What:** New `src/modules/admin-subscription/` (repo + service) branching the read/report handlers of
`src/admin/subscription/subscription.controller.ts` on the new `admin-subscription` flag. Read + report
aggregation over already-migrated tables — no new tables, no DDL.

**Wired (8 handlers):** `listCourseSubscriptions` (customer/course/package/status/date filters + cross-table
search), `getCourseSubscriptionById`, `listPlansForTarget`, `listEbookSubscriptions`, and the 4 reports —
`reportSummary`, `reportByCourse`, `reportByEbook`, `reportBookOrders` (via Prisma `groupBy`/`aggregate`).

**⚠ Drift handled:** `ws_package_course_subscription` has **no `payment_status` / `paid_amount` / `razorpay` /
`target_package_id`** columns — SQL `package_id` = the real package (`pcb_id` = the plan), `amount` = paidAmount,
`remarks` = remark, `payment_type` ≈ paymentMethod, withMaterial inferred from `pc_material_id`. The Mongo
handler's `packageId`/`targetPackageId` are **inverted** vs SQL → the DTO resolves `package_id` directly.

**STAY Mongo (no SQL branch):** the 3 subscription **writes** (`create`/`update`/`delete` — they set Mongo-only
fields with grant-extend logic; will revisit with the payment wave) + the 2 **address** handlers
(`listCustomerAddresses`/`adminCreateCustomerAddress` — CustomerAddress is held OFF, offline-city dep).

**Verified vs live DB (flag ON):** 2 course/pkg subs hydrated (Piyush/CCE, Kishan/DySO + withMaterial), plans for
package (5), ebook subs (1), reportSummary (book revenue ₹905 / 6 orders / 4 verified), reportByEbook + book-orders
groupBy. `tsc` clean. Enabled `admin-subscription` in `.env`.

---

## 2026-06-18 — 📜 Wave 7 START: client purchase-history (aggregation) on SQL

**What:** First Wave 7 (aggregation/finalizers) module. New `src/modules/client-purchase-history/` (repo +
service) branching `src/client/purchase-history/purchase-history.controller.ts` on the new
`client-purchase-history` flag. **Read-only cross-collection aggregator** — composes only ALREADY-MIGRATED
tables, no new tables, no DDL.

**Wired — 3 tabs:** `/subscriptions` (package/course subs + type badge via package_id→packageType),
`/books` (BookOrder + order_items JSON thumbnails + AWB), `/ebooks` (EBookOrder via plan→ebook hop).

**⚠ Drift handled:**
- `ws_package_course_subscription` has **no `payment_status` column** → the Mongo `paymentStatus:"verified"`
  filter maps to `status=true` (active subscription). `course.author` + razorpay ids on the subscription are
  Mongo-only → null.
- SQL `package_id` = the real package, `pcb_id` = the plan — the Mongo handler's `packageId`/`targetPackageId`
  are **inverted**; the SQL DTO resolves `package_id` directly (no plan→package hop needed).
- `ws_ebook_order` has **no `ebook_id`** → ebook title/thumbnail resolved via `plan_id → price.ebook_id → ebook`.
- `ws_book_order` items live in the `order_items` JSON (no embedded array); tracking surfaces the **AWB only**
  (`ws_book_tracking` is a flat status row — no courier column).

**STAY Mongo (this module):** the per-order receipt (`receipts.controller.ts`) — receipt-generation path,
lower-traffic, deferred.

**Verified vs live DB (flag ON):** subscriptions tab (package "DySO I STI I GPSC", badge "Recorded Course",
amount 7500), books tab (order + AWB 119400693001), ebooks tab ("E-Book: test" resolved via the plan hop).
`tsc` clean. Enabled `client-purchase-history` in `.env`.

---

## 2026-06-18 — 🎥 Wave 6: client live-course reads (Groups A+B) on SQL

**What:** Ported the live-course **entitlement** helper to SQL inside `src/modules/admin-live-course/` and branched
the high-traffic client live-course reads on the `live-course` flag. No new tables.

**Entitlement (ported from `src/client/live-course/entitlement.ts`; all on migrated subscription/plan/course
tables):** `hasAccessToAnyLiveCourse`, `getDaysLeftMap`, `getOwnedCourseIds`, `getPurchaseCounts`. Verified with a
real seeded subscription: access=true, owned set, daysLeft=30, my-courses, purchase counts all correct.

**Wired client reads:**
- `listLiveCoursesForClient` — courses + batched plans (originalPrice/discountPercent) + daysLeft + isPurchased +
  purchaseCount + hero card-variant ranking + shareableLink.
- `listUpcomingLiveBatches` — upcoming (startTime≥now) + category tab counts. ⚠ the category tab bar emits
  `{_id,count}` only — `PackageCategory` has no SQL table, so title/slug/image are null.
- `listSessionsForCourseClient`, `listAllUpcomingSessions`, `listLiveNowSessions` — session feeds via the
  `ws_live_session_course` join; each session carries `liveCourseIds[]` + a per-row `subscribed` flag.
  ("live now" = status `CREATED`, mirroring Mongo.)
- `getMyScheduleFolder` — entitlement-gated read of one schedule folder from the `ws_live_course.scheduleFolders`
  JSON (folderId is the synthetic/backfilled string id, not ObjectId-validated).

**⚠ STAY Mongo (documented; revisit in Wave 7):**
- `getLiveCourseForClient` (detail) — needs the subjects/folders count (Mongo-only VideoCategory layer) +
  packageCategory populate.
- `listLiveCourseRecordings` / `getLiveCourseLecture` / `listLiveCourseSessionRecordings` — folder/video layer +
  `LectureProgress` (no SQL table) + AES lecture encryption.
- `getLiveCourseSchedule` / `listMyScheduleByCategory` — blend a session-derived timetable with an educator
  populate (`ws_course_educators` is Mongo); only the pure schedule-folder read migrated.
- `listMyLiveCourses` / `listMyUpcomingSessions` — subscription-shaped "my" lists with status=active|expired
  filtering — natural Wave 7 my-subscriptions work.

Verified vs live DB (flag ON): listClient (4 courses + plans + hero ranking), upcoming-batches, session feeds,
schedule folder (backfilled "Maths TimeTable", 2 entries), and full entitlement with a seeded real subscription.
`tsc` clean.

---

## 2026-06-18 — 🎥 Wave 6: live-reminder / livechat / livepoll on SQL (admin + client)

**What:** Extended `src/modules/admin-live-course/` (repo + service) with reminder/chat/poll operations and
branched the chat/poll/reminder controllers on the existing `live-course` flag. No new tables (reuses the Wave 6
`ws_live_*` tables created earlier today).

**Wired:**
- **live-reminder (client):** `listMyLiveSessionReminders` + `getMyReminderForSession` → SQL (`ws_live_session_reminder`,
  with the session hydrated). ⚠ **set/remove STAY Mongo** — they provision/cancel a scheduled `Notification` row +
  BullMQ job (the notification pipeline isn't migrated), so the write path can't move without splitting that.
- **livechat (client):** `getChatHistory` + `getChatBanStatus` → SQL. **(admin):** `sendAdminMessage`,
  `getChatHistory`, `deleteChatMessage` (soft-delete), `banCustomerFromChat`, `unbanCustomerFromChat`, `listChatBans`
  → SQL. The **socket side-effects are preserved** (the controllers still `io.emit(...)` / disconnect sockets after
  the SQL write). Admin ban is global → stored with a `""` `live_class_id` sentinel. `includeDeleted` history not
  supported on SQL (documented).
- **livepoll (client):** `getActivePoll` (+ myVote) → SQL. **(admin):** `createPoll` (closes the existing active
  poll first, both socket-broadcast), `getPollsByClass`, `getPollResults`, `closePoll`, `deletePoll` → SQL; poll
  options live in the `ws_live_poll_option` child table. ⚠ **`updatePoll` STAYS Mongo** — the option-replacement-
  with-0-votes guard rewrites the embedded options[] (intricate, low-value edge path). **Poll vote casting** is in
  the socket layer → stays Mongo.

**Verified vs live DB (flag ON):** chat history (5 msgs, chrono order) + ban status; polls-by-class with options +
vote counts (Mars:1) + results; reminder read; full poll create→close→delete + admin chat send→soft-delete
lifecycles. Customer-scoped reads return empty for the backfilled `customer_id=0` staging rows (expected).
`tsc` clean.

**Still pending (next pass):** the **client live-course reads** (14 handlers, ~1,500 lines in
`src/client/live-course/`) — list/my/detail/sessions/schedule/recordings/lecture. These compose entitlement logic
+ the Mongo-only folder/video layer (recordings/lecture) + `LectureProgress` (no SQL table), so each needs its own
scope pass (like a Wave 5 module). The `src/admin/live/` realtime stack (StreamOS/recording-promote/socket) stays
Mongo.

---

## 2026-06-18 — 🎥 Wave 6: admin live-course module (CRUD + plans + subs + schedule) on SQL

**What:** New `src/modules/admin-live-course/` (repository + service) on the freshly-created Wave 6 tables.
Branches `src/admin/live-course/live-course.service.ts` (core, thin-controller delegation) + the fat
`live-course.plan.controller.ts` + `live-course.subscription.controller.ts` on the new `live-course` flag
(enabled in `.env`). No DDL beyond the tables already created earlier today.

**Wired (admin surface):** live-courses list/get/create/update/delete/popular-toggle + sessions-list (via the
`ws_live_session_course` many-to-many join); plans list/get/create/update/delete (single-default-per-course);
subscriptions list/get/update/delete + grant (with extend-existing-active behavior); schedule folders + entries
full CRUD + reorder.

**Schedule folders/entries** live in JSON columns on `ws_live_course`. The Mongo API addresses sub-folders/
entries by their subdocument `_id`, so the service **mints synthetic string ids** (`f-…`/`e-…`) on create;
backfilled folders keep their original Mongo `_id` (verified addressable). `plan.duration` is treated as **DAYS**
(`computeEndAt({asDays:true})`) per the live-course controllers — this overrides the design doc's earlier MONTHS
guess (the code is authoritative).

**⚠ STAY Mongo (no SQL branch — documented gaps):**
- The **folder + video-in-folder** controllers (`live-course.folder.controller` / `live-course.video.controller`)
  and `createLiveCourse`'s **Root-folder automation** — `ws_video_category` has no `live_course_id` column (same
  blocker as the Wave 5 course Root folder). `createLiveCourse` returns `folder=null`; `deleteCourse` reports
  `deletedFolders/Videos/Relations=0`.
- The `src/admin/live/` realtime stack (StreamOS / recording-promote / socket) — orchestration, not DB CRUD.

**Validation / refs:** SQL-side numeric-id schemas for create/update course + grant (the Mongo zod enforces
ObjectId). External refs (educator/subject/package-category, subscription customer) backfilled `0`/null on
staging where the Mongo ObjectId had no SQL bridge — the DTOs tolerate `0`/null. Verified vs live DB through the
**branched service with the flag ON**: list 4 courses / detail + the backfilled "Maths TimeTable" schedule folder
(2 entries) / 15 sessions via the join / plan single-default / grant (+90 days) / full CRUD lifecycle / invalid
id → 422. `tsc` clean. Enabled `live-course`.

**Pending (next pass):** the client live-course reads + livechat/livepoll + live-reminder. These are entangled
with the Mongo-only folder/video layer (recordings/lecture) and `LectureProgress` (no SQL table), so they need
their own scoping pass.

---

## 2026-06-18 — 🎥 Wave 6: CREATE LiveCourse SQL tables + backfill from Mongo

**What:** Wave 6 (LiveCourse/LiveSession) — the first wave that **creates net-new SQL tables** (every prior wave
migrated into pre-existing tables). Design signed off (`schema-changes/LIVE_COURSE_DESIGN.md`); **14 tables
created** + Prisma models added + **existing Mongo rows backfilled**.

**DDL** → `schema-changes/2026-06-18_create_ws_live_course_tables.sql` (additive, `CREATE TABLE IF NOT EXISTS`):
`ws_live_course`, `ws_live_course_plan`, `ws_live_course_subscription`, `ws_live_session`,
`ws_live_session_course` (many-to-many join — a session's `liveCourseIds[]`), `ws_live_course_category`,
`ws_live_chat_message`, `ws_live_chat_ban`, `ws_live_poll`, `ws_live_poll_option` (embedded `options[]` → child),
`ws_live_poll_vote`, `ws_live_session_attendance`, `ws_live_session_reminder`, `ws_live_session_preview`.

**Mapping rules (mirror the live Mongo collections):** ObjectId → INT AUTO_INCREMENT PK; embedded arrays
(`scheduleEntries`/`scheduleFolders`/`timetableFiles`/`recordings`/`hlsUrls`/`examCountdown*`) → **JSON columns**;
poll `options[]` → the `ws_live_poll_option` child table; chat/polls keyed by the **string** `live_class_id` (the
realtime room key — NOT FK'd to a session). ⚠ `ws_live_course_plan.duration` is in **MONTHS** (not DAYS like the
package/course/ebook price table) — flagged so the subscription endAt uses `setMonth`, not the DAYS helper.

**Prisma:** 14 new standalone models appended (`LiveCourse`, `LiveCoursePlan`, `LiveCourseSubscription`,
`LiveSession`, `LiveSessionCourse`, `LiveCourseCategory`, `LiveChatMessage`, `LiveChatBan`, `LivePoll`,
`LivePollOption`, `LivePollVote`, `LiveSessionAttendance`, `LiveSessionReminder`, `LiveSessionPreview`); no
cross-relations (additive, low-risk); ids surfaced as strings by the future modules. `tsc` clean.

**Backfill** → `scripts/backfill-live-course-to-sql.ts` (inserts in dependency order, building an ObjectId→new-int
id map so intra-family refs resolve; customer ObjectId → `ws_customers.phoneNumber` → `ws_customer.id` phone
bridge; unbridgeable external refs (educator/subject/video/package category) stored 0/null). **Verified row
counts match Mongo:** 4 courses / 4 plans / 10 subs / 51 sessions / 53 session-course links / 9 polls + 33 options
/ 11 votes / 52 chat / 195 attendance / 9 reminders / 4 previews. JSON embeds round-trip; the many-to-many join
shows multi-course sessions. ⚠ customer phone-bridge resolved 14/267 on **staging** (seeded test users aren't in
the SQL customer dump; the 5 dropped poll votes were duplicate `(poll, customer=0)` rows the unique constraint
correctly rejected) — production data bridges far better.

**Next:** build `src/modules/admin-live-course/` + the client live modules (repo/service/transformer), branch the
live-course controllers on `isLiveCourseMysql()` — exactly like Wave 5. **No client-facing behavior changes yet**
(flag OFF until the modules are wired + verified).

---

## 2026-06-18 — 🗂 Wave 5: admin `material` categories + leaf materials on SQL (Wave 5 catalog CRUD COMPLETE)

**What:** New `src/modules/admin-material/` (repository + service) branching `src/admin/material/material.controller.ts`
(fat controllers → branched in the controller) on the new `admin-material` flag. Reuses `ws_material_category` and
`ws_material` (+ `ws_material_category_course` for the category→courses sub-resource). **No DDL, no Prisma change.**
This is the **last admin CRUD module** — it completes the Wave 5 catalog CRUD set.

**Wired — both surfaces (~19 handlers):**
- **Categories:** list (parent filter + search + pagination), tree (`?tree=true`, built from the single parent FK),
  getById, create, update, delete (blocked if it has sub-categories or materials), toggle status, reorder, courses
  (via the `ws_material_category_course` pivot), materials.
- **Leaf materials:** list (search + category/status filters), getById, create, update, delete, toggle status,
  reorder, bulk-status, bulk-delete.

**⚠ USER-APPROVED divergence — `ws_material_category` is single-parent only:** SQL has just a `parent` int
(NOT NULL → `0` = root) — **no `ancestors[]` or `childCategoryIds[]`** (the Mongo multi-parent DAG fields). So on
SQL: create/update write single-parent only; the `attachChildrenToParent` reparenting + ancestors rewriting are
Mongo-only; the DTO synthesizes `ancestors=[]` / `childCategoryIds=[]`. **`duplicateCategory` STAYS Mongo** — its
BFS subtree+materials clone depends on `ancestors[]` (same call as the videoCategory `duplicate` that stayed Mongo).

**⚠ `ws_material` is minimal** — `title` / `direct_link` / `file` / `order_by` / `status` only. NO `description`,
`thumbnail`, `fileSize`, `fileMime`, `language`, `isPreview`, `isPaid`, `downloadCount` — those Mongo fields are
dropped on write and synthesized on read (isPreview/isPaid=false, downloadCount=0, the rest null). The list
`language`/`isPreview` filters become no-ops on SQL.

**Validation:** numeric ids throughout (the Mongo controller's `ObjectId.isValid` guards are replaced by
`parseMaterialId` in the SQL branch); the zod schemas already accept numeric strings (`z.string().min(1)`). The
category schema's `childCategoryIds` (ObjectId-strict) is simply ignored on SQL.

**Verified vs live DB (staging):** 5 categories (list + tree = 4 roots with nesting + getById with parent→string/
root→null), category CRUD lifecycle (create root + child, update, toggle, reorder, delete blocked when has-children
then succeeds), category→courses + →materials sub-resources, 226 materials (list with category populated, getById
with Mongo-only fields synthesized), material CRUD + toggle + reorder + bulk-status/bulk-delete. `tsc` clean.
Enabled `admin-material` in `.env`.

**🏁 Wave 5 catalog CRUD COMPLETE:** plan · master · video · videoCategory · book · ebook · course · package ·
material — all admin catalog CRUD modules are now on SQL (with their documented Mongo-only gaps). The only Wave 5
items intentionally left on Mongo: client material/search (LiveCourse-blocked) and the 21 no-SQL-table features
(wishlist/folder/notes/free-progress).

---

## 2026-06-18 — 📦 Wave 5: admin `package` CRUD + types + plans + relations on SQL

**What:** New `src/modules/admin-package/` (repository + service) branching `src/admin/package/package.service.ts`
(thin-controller delegation → branched inside the service) on the new `admin-package` flag. Reuses `ws_package`,
`ws_package_type`, the embedded-array pivots `ws_package_specific_subject` / `ws_material_category_package` /
`ws_exam_category_package`, `ws_package_course_ebook_price` (package-owned), `ws_package_course_subscription`, and
`ws_video_category_package_relation`. **Schema:** added a nullable `educator_id` to the `Package` Prisma model
(the DB column existed but was unmapped) — additive, no DDL.

**Wired — the full admin package surface (~22 handlers):** package types (list/create/update/delete);
packages list (search + active/packageType filters + pagination + per-row plan buckets), getById (+ all three
embedded category arrays populated), create, update, delete, toggle status, reorder; embedded reorders
(specificSubjects / materialCategories / examCategories); plans (list/attach/detach — soft-detach via status=false);
subscribers; video-category relations (list/set/BFS-expand-from-subjects).

**Embedded arrays → SQL pivot tables:** the Mongo `Package.specificSubjects[]` / `materialCategories[]` /
`examCategories[]` embeds map to `ws_package_specific_subject` (subject_id → VideoCategory) /
`ws_material_category_package` (mcategory_id → MaterialCategory) / `ws_exam_category_package` (exam_category_id →
ExamCategory). create writes them in the same `$transaction`; update **replaces** a set when its array is present.
getPackageById populates `subject → {_id, title, image}`, `material → {_id, title(=name), image}`,
`exam → {_id, title(=name), image}` (matching the Mongo `.populate()` shapes).

**⚠ Schema-drift — `ws_package` is MISSING columns** for: `isPaid`, `isSmartCourse`, `isPlannerCourse`,
`subtitle`, `notificationTopic`, `packageCategoryId`, `goalId`/`goalLabelId`, and the `examCountdown*` arrays. The
DTO synthesizes these (isPaid=true Mongo default; smart/planner=false; examCountdown*=[]; the rest null/""); writes
drop them. `with_material`/`without_material` are the descriptive `*Text` fields. `package_type_id` is NOT NULL →
`1` sentinel; `exam_id` NOT NULL → `0` sentinel. The Mongo goalLabel/examCountdown validations are Mongo-only and
skipped on SQL.

**⚠ STAY Mongo (no SQL branch — documented gaps):**
- `listPromotedCodes` — `PromoCode.appliesTo` (type + ids) has no SQL representation; `ws_promocode` has no
  appliesTo/package-linkage column (same gap as commerce-promocode's empty appliesTo).
- `listBooks` — `Book.packageIds` (the m2m link) has no SQL column (confirmed by admin-book).
- Chat (`/:id/chat`) is already on SQL via the existing **package-chat** module — unchanged.

**Subscribers / plans:** `listSubscribers` filters `ws_package_course_subscription.package_id` (the real package
column — ⚠ note the Mongo `PackageCourseSubscription.packageId` refs the PLAN, but the SQL `package_id` holds the
package id, so the SQL filter is the natural "this package's subscribers"). `attachPlans` points the shared price
row at this package (course/ebook owner → 0). `PackageType` has only id/name (+timestamps) — order/active dropped.

**Verified vs live DB (staging):** 6 types, 5 packages (list w/ plan buckets, getById with all 3 embeds populated
— e.g. CCE: 55 subjects / 2 material / 35 exam), type CRUD, package create-with-embeds → update replace-embeds →
toggle → reorder → delete cascade, plan attach/list/detach, 1 subscriber, setVideoRelations + BFS expand (94
relations). `tsc` clean. Enabled `admin-package` in `.env`.

---

## 2026-06-18 — 🎓 Wave 5: admin `course` CRUD + plans + masters on SQL

**What:** New `src/modules/admin-course/` (repository + service) branching `src/admin/course/course.service.ts`
(thin-controller delegation → branched inside the service) + `course.controller.ts` (createCourse/updateCourse,
which need numeric-id coercion) on the new `admin-course` flag. Reuses `ws_course`,
`ws_package_course_ebook_price` (course-owned, shared with admin-plan), the pivot tables
`ws_material_category_course` / `ws_exam_category_course`, `ws_video_category` (+ `_relation`), and
`ws_package_course_material`. **No DDL, no Prisma change.**

**Wired — the full admin course surface (~24 handlers):** getPreRequisites, getCourses (search + status/isPaid/
isPopular filters + pagination, educator/subject/videoCategory refs populated), getCourseById (+ plans + the
material/exam category pivots), createCourse, updateCourse, deleteCourse, toggleCoursePopular; course plans
(list/create/get/update/delete, single-default-per-course invariant); course video-categories (list/create/
update/delete); video-category-relations (list/create/update/delete); course materials (pc-material, title-only).

**Embedded arrays → SQL pivot tables:** the Mongo `Course.materialCategories[]` / `examCategories[]` embeds map
to `ws_material_category_course` / `ws_exam_category_course`. createCourse writes them in the same `$transaction`;
updateCourse **replaces** a pivot set when its array is present in the payload. getCourseById populates
`material → {_id, title, image}` and `exam → {_id, name, image}` (matching the Mongo `.populate()` shapes).

**SQL enums / drift:** `is_featured` enum('0','1') → `isPopular`; `purchase` enum → `isPaid` (Mongo `isPaid`
defaults TRUE, so only an explicit '0' is unpaid). `with_material`/`without_material`/`level` are **VARCHAR** in
SQL (not bool — passed through as strings). `course_category_id`/`educator_id` are **NOT NULL** → `0` sentinel on
create when unset.

**⚠ USER-APPROVED divergence — `ws_video_category` has NO `course_id` column:**
- `createCourse`'s "Root folder" automation (a `VideoCategory{courseId}` per course) is **skipped** on SQL —
  the response `folder` field is `null` (documented Mongo-only side-effect).
- The course **video-category** create/update/delete operate on the **global** `ws_video_category` (same table as
  admin-master); the `courseId` scope is dropped (surfaced `null`).
- `deleteCourse` cascades the plans + both category-pivot sets, but NOT courseId-scoped folders/relations
  (`deletedCourseVideoCategories` / `deletedVideoRelations` are always `0`).

**Validation:** createCourse/updateCourse branch to `createCourseSqlSchema` + a numeric category-ref parser in the
controller, since the Mongo zod enforces ObjectId on the FK ids (`courseEducatorId`/`courseSubjectCategoryId`/
`videoCategoryId`) and the category refs. All other handlers take URL-param ids (numeric-validated in the service
branch). The Mongo cache-aside layer is bypassed on SQL (reads hit Prisma directly).

**Verified vs live DB (staging):** 1 course (list + get with both pivots populated + 5 plans), create-with-pivots,
update replace-pivots-to-empty, popular toggle, plan single-default invariant (2 isDefault:true → 1 default),
delete cascade (4 plans), video-categories (152) / relations (2456) / materials lists. `tsc` clean. Enabled
`admin-course` in `.env`.

---

## 2026-06-18 — 📖 Wave 5: admin `ebook` CRUD + plans + subscriptions on SQL

**What:** New `src/modules/admin-ebook/` (repository + service) branching `src/admin/ebook/ebook.service.ts`
(thin-controller delegation → branched inside the service) and `ebook-subscription.controller.ts` (fat
controllers → branched in the controller) on the new `admin-ebook` flag. Reuses `ws_ebook` /
`ws_package_course_ebook_price` (shared with admin-plan) / `ws_ebook_subscription` / `ws_ebook_order`. **No DDL,
no Prisma change.**

**Wired — 3 surfaces:**
- **Ebooks:** `getEbooks` (search on name/author + author/publisher/language/status filters + pagination),
  `getEbookById` (+ active plans), `createEbook`, `updateEbook`, `deleteEbook` (cascades the ebook's plans in
  one txn), `reorderEbooks`.
- **Plans** (ebook-owned `ws_package_course_ebook_price` rows): `listEbookPlans`, `createEbookPlan`,
  `getEbookPlanById`, `updateEbookPlan`, `deleteEbookPlan`, `getEbookPricesForSubscription` (active-only).
  Ebook-owned = `ebook_id` set, `course_id`/`package_id` = 0 sentinel (same convention as admin-plan).
- **Subscriptions:** `getEbookSubscriptions` (customerId/ebookId/status filters + customer-name/phone & ebook-
  name search), `getEbookSubscriptionById`, `createEbookSubscription` (backend grant), `updateEbookSubscription`
  (verify-pending-order OR toggle status/remarks), `deleteEbookSubscription`.

**⚠ Schema-drift — `ws_ebook` is MISSING columns** for: `isTrending`, the PDF-upload status fields
(`book/demoUploadStatus` + `…Progress`), and the Mongo-only `examCountdown*` relations. The DTO synthesizes
`isTrending=false` + `examCountdown*`=[]/null; PDF-status omitted; `demoFileName`/`bookFileName`=null. NOT-NULL
no-default columns (`thumbnail`/`image`/`terms_and_conditions`/`demo_url`/`book_url`/`link`) get write-time `""`
sentinels.

**⚠ STAY Mongo (no SQL branch — documented gaps):**
- `toggleEbookTrending` — no `is_trending` column.
- The **BullMQ single-PDF upload pipeline** (`POST /:id/pdf` + `GET /pdf-jobs/:batchId`, see
  [`pdf_upload_pipeline`]) writes the Mongo `*UploadStatus`/`*UploadProgress` fields — those have no SQL columns,
  so the pipeline is unaffected and stays Mongo.
- `updateEbook`'s best-effort S3 orphan-cleanup of replaced files is skipped on SQL (not part of the API
  contract).

**Subscription backend grant** = one `$transaction`: insert `ws_ebook_order` (status COMPLETE) + the
`ws_ebook_subscription` row. `endAt` is computed via the planDuration helper `computeEndAt({asDays:true})` —
**`duration` is in DAYS** (NOT raw ms math). ⚠ `ws_ebook_order.plan_id` is **NOT NULL** → write `0` when the
`durationInDays` path is used (no plan); `order.planId` / sub `planId` surface `null` for the 0 sentinel.
`ws_ebook_order.customer_id` is `varchar(255)` in the DB while Prisma maps it `Int` — MySQL casts transparently
on read/write (verified). `order_price` is `double(10,2)` (Prisma `Int`; integer writes are exact).

**Validation:** the Mongo zod schemas enforce ObjectId on `id`/`customerId`/`ebookId`/`planId`. On SQL these are
numeric, so the reorder + subscription-create handlers branch to numeric-id schemas (`reorderEbooksSqlSchema` /
`createEbookSubscriptionSqlSchema`) — same pattern as client-exam `saveAnswers`. Customer name from `full_name`
via `splitFullName`.

**Verified vs live DB (staging):** 2 ebooks (list/get + create→update→reorder→delete cascade), plans
(create/list/update/get/delete + active-only prices filter), 1 subscription (list w/ customer+ebook+plan+order,
get-by-id), backend-grant create (durationInDays=30 → endAt +30d; planId=90 → endAt +90d) + toggle + delete.
`tsc` clean. Enabled `admin-ebook` in `.env`.

---

## 2026-06-18 — 📚 Wave 5: admin `book` CRUD + order reads on SQL

**What:** New `src/modules/admin-book/` (repository + service) branching `src/admin/book/book.controller.ts` on
the new `admin-book` flag. Reuses existing `ws_book` / `ws_book_order` / `ws_book_order_item` /
`ws_customer_shipping` tables — **no DDL**, no Prisma change.

**Wired (9 handlers on SQL):** books `getBooks` (search on name/author + language/isMagazine/isCombo/status
filters + pagination), `getBookById`, `createBook`, `updateBook`, `deleteBook`, `toggleBookStatus`,
`reorderBooks`; orders `getOrders` (customerId/status/date filters + cross-table search) and `getOrderById`.

**⚠ Schema-drift — `ws_book` is MISSING columns** for: `isTrending`, `publication`, `deliveryEta`,
`termsAndConditions`, `demoFileName`/`bookFileName`, `bookUrl` (only `demo_url` exists), and the Mongo-only
relations `examCountdownCategoryId(s)` / `examCountdownIds` / `packageIds`. The DTO **synthesizes** these
(isTrending=false, publication="WebSankul Publication", deliveryEta="5-7 days", the rest null/[]; mirrors
`catalog-book.transformer`). On **write** those fields are silently DROPPED. NOT-NULL no-default columns
(`name`, `pages`, `dynamic_link`, `thumbnail`) get write-time sentinels.

**⚠ STAY Mongo (no SQL branch — documented gaps):**
- `toggleBookTrending` — no `is_trending` column.
- `getBookById` exam-countdown `.populate()`s — ExamCountdown(Category) has no SQL table (same Mongo-only
  blocker as elsewhere); the SQL branch returns the core book with `examCountdown*`=[].
- `updateOrderStatus` / `setOrderTracking` / `addOrderTrackingEvent` — these write the embedded
  `tracking.history[]` array + `paidAt/shippedAt/deliveredAt/cancelledAt`. `ws_book_tracking` is one flat row
  per AWB (`status` varchar(10); no history/location/note/courier columns) and only `pending`/`verified`
  statuses exist — the full SHIPPED→DELIVERED→CANCELLED lifecycle + event history is not representable.
- `getSettings` / `updateSettings` — there is **NO `ws_book_setting(s)` table** in MySQL at all.

**Order line items:** legacy book orders keep their items in the `ws_book_order.order_items` **JSON column**
(the `ws_book_order_item` child table is near-empty — only orders created by the migrated `book-order` WRITE
path have child rows). So item hydration **prefers child rows, falls back to the JSON snapshot** (the
authoritative source for legacy orders), matching the Mongo embedded `items[]`. Book-name search scans BOTH
the child table (book→bookId→item rows) AND a raw `order_items LIKE` (mirroring Mongo's `{"items.name": rx}`).
Customer name comes from `full_name` via `splitFullName` (firstName/lastName, like `customer-profile`); shipping
phones BigInt→string; order amount Decimal→Number.

**Verified vs live DB (staging):** 10 books (list/search/filter/get + create→update→toggle→reorder→delete
lifecycle), 6 orders (list w/ customer+shipping+items hydrated from JSON, get-by-id, status filter, customer-
name + book-name search). `tsc` clean. Enabled `admin-book` in `.env`.

---

## 2026-06-17 — 🎞 Wave 5: admin `videoCategory` (full) CRUD on SQL

**What:** The full admin videoCategory controller (`src/admin/videoCategory/`, distinct from the simpler master
one) on SQL — implemented by extending `src/modules/admin-master/` (repo + service); branches on the existing
`isAdminMasterMysql()` flag. No DDL (the parent/educator_id fields were added with the earlier admin-master work).

**Wired (9 of 10 handlers):** list (search/status/educator filters, paginated, child_categories + educator
populated), pre-requisites (categories + active educators), get, create, update, toggle, delete (blocked if
videos or child categories reference it), listVideoCategoryCourses, listVideoCategoryVideos.

**⚠ Architectural divergence (user-approved):** Mongo `VideoCategory.childCategoryIds[]` is a DAG (a category
can have many children AND be a child of multiple parents) + a `courseId/liveCourseId` field; SQL
`ws_video_category` has only a SINGLE `parent` self-FK and no course/liveCourse columns. So on the SQL branch:
children are DERIVED from each child's `parent`; **childCategoryIds is NOT a writable field** (single-parent
model — create/update ignore it). The **`duplicate` handler (BFS DAG clone) STAYS on Mongo** — it can't be
reproduced from a single-parent schema.

**Verified (tsx vs live DB):** list 157 categories, prereqs (157 cats + 55 educators), relation lists
(category 2926 → 6 videos), create/slug-dupe-reject/update(educator attach)/toggle/delete. `fullVcGet` correctly
returns null for an orphaned parent ref. Cleanup clean. `tsc` clean.

**Next:** admin book, ebook, course, package, material.

---

## 2026-06-17 — 🎬 Wave 5: admin `video` CRUD on SQL

**What:** Admin video management via new module `src/modules/admin-video/` (repo + service); branches on
`isMysqlModule("admin-video")`; enabled in `.env`. No DDL (the Video model is clean).

**Wired (all 8 handlers):** listVideos (search/status/type/platform/category filters, paginated, populated
category, toItem shape), getVideoPreRequisites (active categories + has_children + types + platforms), getVideo,
createVideo, updateVideo, deleteVideo, toggleVideoStatus, reorderVideos.

**Logic mirrored:** platform = youtube|vimeo|aws with only the matching `*_id` column populated (the other two
nulled on create / platform-switch); **slug auto-uniquify** (append -2/-3/… until free, never 409); video-category
existence validated on create + re-link; prereqs `has_children` derived from the VideoCategory `parent` self-FK;
the `toItem` response shape (id/name/slug/order/topic/type/status/video_category/platform/{youtube,vimeo,aws}+ids)
matches the Mongo branch exactly. SQL-side numeric category ids.

**Verified (tsx vs live DB, rolled back):** list 156 videos + prereqs (152 cats); create (aws, awsId set); a 2nd
video with the same slug → uniquified to `zz-vid-2`; update switching aws→youtube (youtubeId set, awsId cleared);
toggle; reorder (order→99); delete. Cleanup clean. `tsc` clean.

**Next:** admin videoCategory (full), book, ebook, course, package, material.

---

## 2026-06-17 — 🗂 Wave 5: admin master sub-catalog CRUD on SQL

**What:** Second admin catalog CRUD increment — the small "master" lookup CRUDs via new module
`src/modules/admin-master/` (repo + service); branches on `isMysqlModule("admin-master")`; enabled in `.env`.

**Wired:** `src/admin/pc-material/` (5 handlers) + `src/admin/master/material.controller.ts` +
`src/admin/master/subjectCategory.controller.ts` + `src/admin/master/videoCategory.controller.ts`.
- **PackageCourseMaterial** (ws_package_course_material) — pc-material AND master/material share this table;
  it's TITLE-ONLY in SQL (id/title), so master/material's `image`/`isActive` fields are dropped on the SQL branch.
- **CourseSubjectCategory** (ws_course_subject_category) — title/slug/image/parent/order/status CRUD.
- **VideoCategory** (ws_video_category) — list resolves `child_categories` + `hasChildren` from the `parent`
  self-FK (Mongo populated `childCategoryIds`); CRUD.

**Schema (Prisma only):** added `parent`/`educatorId`(@map educator_id)/`pdf` to the VideoCategory model (were
absent/commented). All three are **NOT NULL with default 0/'' in the DB** → the service coerces to 0/"" on write
(never sends null) to avoid constraint violations. Regenerated client. The existing catalog-video reads are
unaffected (additive nullable fields).

**⚠ Mongo-only (no SQL table):** `master/packageCategory` — `ws_package_category` does not exist; stays Mongo
(documented, like the other table-less features). VideoCategory delete's `ws_video_category_relation` (D2)
cleanup is deferred (relations not migrated).

**Verified (tsx vs live DB):** pc-material create/update/delete; subjectCategory create(order)/update/delete;
videoCategory list (157, 5 parents w/ children) + create (educator_id/parent default 0) /update/delete. Cleanup
clean. `tsc` clean.

**Next:** admin video, videoCategory (full), book, ebook, course, package, material.

---

## 2026-06-17 — 💲 Wave 5: admin `plan` CRUD on SQL (first admin catalog module)

**What:** First admin catalog CRUD module — plan management (`ws_package_course_ebook_price`) via new module
`src/modules/admin-plan/` (repo + service); branches on `isMysqlModule("admin-plan")`; enabled in `.env`. No DDL.

**Wired (all 10 handlers):** listPlans (filters: entityType/owner/status/isDefault/withMaterial/search, paginated,
populated owner refs), getPlanById (+promotedCount/subscriberCount), createPlan, updatePlan (re-link),
deletePlan, togglePlanStatus, markAsDefault, bulkStatus, bulkDelete, clonePlan.

**Drift handled:** a plan is owned by exactly ONE of course/package/ebook; unused owner ids are stored as
**EITHER NULL or 0** (legacy mix — verified 330 null + 542 zero on course_id) → treat NULL-or-0 as "not owned",
and on write set the chosen owner + **0** the other two. The **single-default-per-entity** invariant is enforced
by `clearSiblingDefaults` (flip all other plans of the same owner to isDefault=false) after any create/update/
markAsDefault that sets default. delete is blocked when the plan has subscribers + cascades the
`ws_promoted_package_course_ebook` rows (planId = pcb_price_id).

**Verified (tsx vs live DB):** 1353 plans listed; create two ebook plans both isDefault → the **first flips to
false** when the second is created (invariant holds); update price/withMaterial; markAsDefault flips the sibling;
toggle; clone (isDefault forced false); bulkDelete 3 + cleanup clean. `tsc` clean.

**Next:** continue admin catalog CRUD — pc-material, master sub-categories, video, videoCategory, book, ebook,
course, package, material.

---

## 2026-06-17 — 🧑‍🏫 Wave 5: client educator on SQL (+ material/search found Mongo-only)

**What:** Migrated the client educator-detail endpoint via new module `src/modules/client-educator/`; branches on
`isMysqlModule("client-educator")`; enabled in `.env`. Composes already-migrated tables — no new tables/DDL.

**Wired:** `getEducatorWithCoursesHandler` (GET /client/educators/:id) — educator profile (ws_course_educator) +
their active courses (ws_course) + per-course plans split with/withoutMaterial (ws_package_course_ebook_price) +
per-course daysLeft from active subscriptions (ws_package_course_subscription, lifetime-aware: null endAt beats
dated, latest wins) + fire-and-forget view-counter bump. Course relation fields: `educator`/`subject`
(CourseSubjectCategory uses `title`, not name).

**Found BLOCKED (documented Mongo-only, NOT migrated):**
- client **material** (getCategoryContents/getMaterialDetail/trackDownload/getRecentMaterials) — the entitlement
  helper joins LiveCourse (no SQL table) + Mongo-only embedded `materialCategories[].category`; `ws_material` has
  no `isPaid`/`ancestors`. Same blocker catalog-material flagged for item listing.
- client **search** (globalSearch) — searches across LiveCourse (no SQL table) among others.

So the Wave-5 client-read slice is effectively complete (cart ✅, educator ✅; material/search/wishlist/folder/
notes blocked). Remaining Wave 5 = the **admin catalog CRUD** (~136 handlers), to be built module-by-module
starting with `plan`.

**Verified (tsx vs live DB):** educator 20 (Priyanka Soni) → 1 course ("test") with 5 plans, correct share link.
`tsc` clean.

---

## 2026-06-17 — 📝 Wave 4 COMPLETE: admin exam reads on SQL

**What:** Closed out Wave 4 by migrating the admin exam READ surface via new module `src/modules/admin-exam/`
(repo + service); branches on `isMysqlModule("admin-exam")`; enabled in `.env`. No DDL (reuses the ws_exam*
tables + Exam.description→nullable fix from the client-exam slice).

**Wired (admin exam controller):** getExams (filters: search/category/type/status/isPaid, paginated, populated
category), getExamById (+actualQuestionCount), getQuestions (+options — admin SEES the `answer`, unlike the
client attempt view), getQuestionById, getExamSubmissions (populated customer, score-ranked), getExamAnalytics
(raw SQL: overall avg/max/min/accuracy + per-question correct/wrong/skip/accuracy aggregates over the qresult_*
columns), getResultById (+details), getCustomerAnalytics, and invalidateResult (status=false, score=0).

**Verified (tsx vs live DB):** 1 exam listed w/ category; question with answer + 5 options; submission (Sanjay,
score 1); analytics overall (1 candidate, accuracy 100%) + per-question; customer analytics null when no row.
`tsc` clean.

**Deferred (low-value, stay Mongo):** admin exam/question **CRUD writes** + `getSolutionDownloadByExam` (PDF via
generateExamSolutionPdf). Test Series + ExamCountdown remain Mongo-only (no SQL tables).

**Wave 4 is now fully complete** (client reads + scoring write + admin reads). Back to Wave 5.

---

## 2026-06-17 — 🛒 Wave 5 START: client book-cart on SQL

**What:** First slice of Wave 5 (catalog admin CRUD + remaining client reads). Migrated the client book-cart via
new module `src/modules/client-cart/` (repo + service); branches on `isMysqlModule("client-cart")`; enabled in
`.env`. Inventory: **156 migratable handlers** (10 admin CRUD + 5 client read modules) + **21 BLOCKED** on missing
SQL tables (wishlist/folder/lecture-note/lecture-audio-note/free-progress — Mongo-only, no tables; deferred).

**Wired (all 5 cart handlers, behind isClientCartMysql):** addToCart, updateCartItemQty, removeCartItem,
attachShippingToCart, getCart (with totals summary).

**Shape translation:** Mongo `BookCart` embeds `items[]`; SQL splits into `ws_book_cart` (one active row per
customer, `active`=status column) + `ws_book_cart_item` (cartId→cart.id, bookId→`item_id`). `cart_id` is a
NOT-NULL VARCHAR business key → generated `cart-<base36>` (matches existing rows). attach-shipping find-or-creates
a `ws_customer_shipping` row (userId, phone BigInt, state Int, pincode Int, address_2/email/city NOT NULL) and
resolves the city via the offline-city module. Reuses the BookCart/BookCartItem Prisma models the book-order
module already uses (no schema change).

**Verified (tsx vs live DB, rolled back):** add (new line) → add 2nd book → add same book again (increments, not
duplicated) → getCart (items, itemCount, totals) → updateCartItemQty → removeCartItem. Test cart cleaned up.
`tsc` clean.

**Next:** client material/educator/search reads, then the admin catalog CRUD modules.

---

## 2026-06-17 — 📝 Wave 4 (Exam) CLIENT complete: reads + the saveAnswers scoring WRITE

**What:** Finished the client exam surface on SQL (`src/modules/client-exam/`, behind `isClientExamMysql()`).
Builds on the earlier reads slice; this adds the solution reads, the daily drill-down, and — the important one —
the **`saveAnswers` quiz-submission scoring write**.

**Wired:** client reads `listExamsByCategory`, `getExamQuestions`, `listMyResults`, `getSolutionByExam`,
`getSolutionAnalyticsByExam`, `getDailyExams` (year→month→week→tests drill-down, raw SQL grouping); and the
WRITE `saveAnswers`.

**saveAnswers scoring (the delicate part — verified exact):** for each answer, resolve question+option, compare
`norm(option.name) === norm(question.answer)` → true/false, `"skip"` → skip; point = +positive_marks / −|negative_marks| / 0.
Aggregate total/attempt/skip/success/failed/score → insert `ws_exam_result` + `ws_exam_result_detail` rows in one
`$transaction`, recompute `ws_exam_result_detail_analytics` (upsert), compute rank by best-score-per-customer.
SQL-side numeric-id payload validation (the Mongo zod schema enforces 24-hex ObjectId, which would reject SQL ids).

**Drift / scope:** result tables use the legacy `qresult_*` columns; Mongo-only `attemptNumber`/`inProgress`/
`startedAt`/`submittedAt` are dropped (no SQL columns; `qresult_attempt` = attempt COUNT). `getSolutionDownloadByExam`
(PDF) stays Mongo (composes Mongo docs via generateExamSolutionPdf). The `answer` field is never surfaced to the
client during an attempt.

**Verified (tsx vs live DB, then rolled back):** correct answer → score +1 (success 1/1, rank 1/2); wrong → −1
(failed 1/1); 2 result + 2 detail rows; analytics rollup exams=1/success=1/score=0; solution marks the correct
option. Test rows deleted, customer restored. `tsc` clean.

**Wave 4 remainder:** admin exam reads (`src/admin/exam`) + admin exam/question CRUD — admin-only, deferred.
Test Series + ExamCountdown remain Mongo-only (no SQL tables).

---

## 2026-06-17 — 📝 Wave 4 (Exam) client READS on SQL

**Drift check first (per protocol):** ✅ exam tables exist (ws_exam, ws_exam_category, ws_exam_question,
ws_exam_question_option, ws_exam_result, ws_exam_result_detail, ws_exam_result_detail_analytics). ❌ **Test
Series (all ws_test_series*) and ExamCountdown (ws_exam_countdown*) have NO SQL tables → MONGO-ONLY, excluded
from this wave** (like LiveCourse). Result tables use the legacy `qresult_*` column prefix.

**What:** Migrated the client exam READ surface via new module `src/modules/client-exam/` (repo + service,
read-only). Branches on `isMysqlModule("client-exam")`; enabled in `.env`. Wave 4 of
[`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md).

**Schema fix:** `Exam.description` String → String? (1 NULL row in ws_exam would throw on read). No DDL.

**Wired (behind isClientExamMysql):** `listExamsByCategory` (subjects + published exams w/ window filter +
per-customer isCompleted/lastResult), `getExamQuestions` (questions + options; the `answer` field is NEVER
surfaced during an attempt), `listMyResults` (paginated, w/ exam title). Built but NOT yet wired: solution
reads + `getDailyExams` drill-down (raw SQL YEAR/MONTH grouping + JS week bucketing).

**Verified (tsx vs live DB):** 1 exam ("test") / 1 question / 5 options; answer-not-leaked confirmed;
isCompleted decoration true; listMyResults 2 results w/ score 1/1; daily years drill-down. `tsc` clean.

**Next (Wave 4 cont.):** wire client solution + daily endpoints, admin exam reads, then the `saveAnswers`
scoring WRITE (qresult_* tables + analytics recompute) + admin exam/question CRUD.

---

## 2026-06-17 — 🔐 Wave 3 (RBAC management) on SQL (spatie tables)

**What:** Migrated admin role + permission management off MongoDB onto the spatie SQL tables (`ws_roles`,
`ws_permissions`, `ws_role_has_permissions`) that admin-auth already reads. New module `src/modules/admin-rbac/`
(repo + service); branches on `isMysqlModule("admin-rbac")`. Enabled in `.env`. Wave 3 of
[`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md).

**Schema (Prisma only — no DDL; tables already existed):**
- `AdminRoleRow` / `AdminPermissionRow`: added `created_at` / `updated_at` (the role API returns them).
- New `AdminRoleHasPermission` model → `@@map("ws_role_has_permissions")` (composite PK permission_id+role_id).
- Regenerated client.

**Wired:**
- `src/admin/role/role.controller.ts` — all 7 handlers (list/get/create/update/delete/getRolePermissions/
  syncRolePermissions). Role mutations **write the pivot directly** (delete-all + insert in a `$transaction`,
  validating permission ids belong to the role's guard). `deleteRole` **cascades** the pivot + ws_model_has_roles
  (no DB FK cascade in the legacy schema). roleInUse checks ws_model_has_roles.
- `src/admin/permission/permission.service.ts` — list/get/create/update/delete/getRolesForPermission/tree
  (thin controller → branched in the service). `category` is **derived from the permission name prefix**
  (`bannerslider.create` → `bannerslider`); the tree groups by it.

**Mongo-only gaps (documented):** `ws_permission_categories` has NO SQL table → the **permissionCategory CRUD
controller stays Mongo**, and the Mongo permission `category` object shape (`{id,title,slug}`) becomes a plain
derived string on SQL. Permission create/update ignore `category_id` on SQL (nothing to write).

**Verified (tsx vs live DB):** 29 web roles, role 8 (Super Admin, 16 perms), 108 permissions w/ derived
categories, tree (30 categories), assigned/unassigned split, and a create→sync→delete role lifecycle incl.
**pivot cascade on delete**. Orphan test rows cleaned. `tsc` clean.

**Next:** Wave 4 — Exam / Test Series.

---

## 2026-06-17 — 🎁 Wave 2 (Referral) COMPLETE: admin referral on SQL

**What:** Finished Wave 2 by branching the **admin referral service** (`src/admin/referral/referral.service.ts`)
on `isReferralMysql()`, reusing the `src/modules/referral/` repo (extended with admin ops). No new tables/DDL.

**Branched admin functions:** `listPrograms`/`getProgramById`/`createProgram`/`updateProgram`/`deleteProgram`
(ws_refferal_program CRUD, name-uniqueness), `listTransactions` (w/ customer join), `updateWithdrawalStatus`
(debit-only), `rejectWithdrawal` (atomic refund + delete), `getWithdrawalsReport` + `buildWithdrawalsCsv` (raw
SQL JSON_EXTRACT over `bank_account` + customer search), `adjustCustomerRewards` (atomic inc/dec + successful
txn), `listReferrers` (raw SQL per-customer GROUP BY rollup: totalEarned/Withdrawn/pending/failed/successful).

**Drift / notes:** The admin **content controller is entirely FAQ/Term CRUD → stays Mongo** (ws_referral_faq/
ws_referral_term have no SQL tables). `listReferrers` pagination `total` is approximated (exact count over a
GROUP BY/HAVING is a follow-up if needed). Program write maps Mongo-style body (referralDiscount/referralReward)
→ SQL cols (refferal_discount/refferal_reward).

**Verified (tsx vs live DB):** program create/update/delete + name-exists; adjustRewards credit → successful txn,
points 0→50; admin txn list w/ customer populated; referrers rollup (ran clean, empty in staging);
withdrawals report + CSV header. Test rows cleaned + customer restored. `tsc` clean.

**Wave 2 fully done** (client + webhook + admin). Next: Wave 3 — RBAC management (role/permission CRUD onto the
spatie tables admin-auth already reads).

---

## 2026-06-17 — 🎁 Wave 2 (Referral) client + webhook on SQL

**What:** Migrated the client referral surface + the RazorpayX payout webhook off MongoDB onto SQL via new
module `src/modules/referral/` (repo + service). Branches on `isMysqlModule("referral")`; enabled in `.env`.
Wave 2 of [`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md) (admin referral
service still pending).

**Schema (DDL on `ws_refferal_transaction`, additive, prod-safe):**
- `+ provider_ref VARCHAR(255) NULL`, `+ failure_reason VARCHAR(500) NULL`
  ([schema-changes/2026-06-17_extend_ws_refferal_transaction.sql](./migration/schema-changes/2026-06-17_extend_ws_refferal_transaction.sql))
- widened `status` enum `('pending','successful')` → add `'failed'`
  ([schema-changes/2026-06-17_add_failed_to_refferal_status.sql](./migration/schema-changes/2026-06-17_add_failed_to_refferal_status.sql))
- Prisma `RefferalTransaction` (+ `providerRef`/`failureReason`) and `RefferalTransactionStatus` enum (+ `failed`) updated; regenerated.

**Wired (all behind isReferralMysql):**
- client `referral.controller.ts`: getRewardsOverview (ws_customer + ws_refferal_program), getMyTransactions /
  getTransactionById (ws_refferal_transaction), generateReferralCode (sets ws_customer.referral_code + zeroes
  reward_points), requestWithdrawal (atomic `$transaction`: decrement reward_points + create pending DEBIT txn →
  RazorpayX payout → refund + mark `failed` on payout error).
- content `getReferralStatus` (ws_refferal_program). **getTerms/getFaqs STAY Mongo** — `ws_referral_faq`/`_term`
  don't exist in SQL (Mongo-only content, like Goal/social-link).
- `webhooks/razorpay-payout.controller.ts`: flips a pending withdrawal by `provider_ref` → successful, or refunds
  points (DEBIT) + marks `failed`; idempotent (skips non-pending).

**Drift:** Mongo-only `utr`/`providerPayload` webhook audit fields are NOT persisted on SQL (not in the response
contract; only provider_ref + failure_reason added). Mixed-backend risk eliminated — customer + bank account +
txn are all SQL now, so the debit+create is one Prisma transaction.

**Verified (tsx vs live DB):** referralStatus; rewards overview; withdrawal debit (points 1000→400); webhook
success → `successful` + idempotent replay (`already`); 2nd withdrawal → fail webhook → refund (points→400) +
`failed`+reason; transaction list. Test rows cleaned up, customer restored. `tsc` clean.

**Next:** Wave 2 cont. — admin referral service (program CRUD, withdrawals report, listReferrers rollup) +
admin FAQ/Term CRUD (Mongo-only).

---

## 2026-06-17 — 📣 Wave 1 (Promoter) COMPLETE: `promoter-data` reads on SQL

**What:** Migrated the 4 promoter read controllers off MongoDB (`src/promoter/{dashboard,customer,promocode,subscription}/`)
onto SQL via a new shared module `src/modules/promoter-data/` (repository + service). Branches on
`isMysqlModule("promoter-data")` (a separate flag from `promoter-auth`). Enabled `promoter-data` in `.env`.
Completes Wave 1 of [`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md).

**🔑 Attribution model (the crux — differs from Mongo):** SQL subscription tables have **no `promoter_id`,
`promoter_percentage`, or `paid_amount`** columns (Mongo denormalizes them per-subscription). Instead,
`ws_package_course_order.promocode` / `ws_ebook_order.promocode` is a **JSON snapshot** of the whole promocode
at purchase, embedding `promoterId`, `promocode`, and `promotedPackageCourseEbook[0].promoterPercentage`. So:
- **attribution:** `JSON_EXTRACT(order.promocode,'$.promoterId') = :promoterId`
- **order→subscription join:** `order.id = subscription.order_id` (NOT `unique_id` — that's a nullable string key)
- **revenue:** `subscription.amount` (course) / `subscription.price` (ebook)
- **commission:** `amount * JSON_EXTRACT(...promoterPercentage) / 100`
- **time series:** `DATE_FORMAT(created_at, fmt)` grouping (today→hour, week/month→day, year/all→month, custom→derived)

All implemented as **raw SQL** (`prisma.$queryRawUnsafe` with bound params) because Prisma can't express the
JSON-path filter or DATE_FORMAT grouping. No new tables, no schema change.

**Surfaces wired:** promoter customers (list + detail), subscriptions (course/ebook list + byCourse/byMonth
report w/ commission), dashboard (summary + date-range overview), promocodes (list/detail + derived usage).
**Limitation (documented):** promocode `appliesTo` is not representable from SQL (same as commerce-promocode) →
returned empty; dashboard overview's `promocodeId` scope param is ignored on SQL.

**Verified (tsx vs live DB):** promoter 130 → 2 course subs, ₹15,300 revenue, **commission ₹765** (5% of each),
2 unique customers; report byCourse/byMonth; overview totals + chart buckets; promocode PIYUSH50 usage=2/₹15,300.
`tsc` clean.

**Next:** Wave 2 — Referral system (`ws_refferal_program` + `ws_refferal_transaction`; client + admin + webhook).

---

## 2026-06-17 — 📣 Wave 1 (Promoter) START: `promoter-auth` on SQL (`ws_promoter`)

**Context:** First wave of the FINAL Mongo-only→SQL push, tracked in
[`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md) (the resumable plan — read
its RESUME POINTER to continue). ~90 Mongo-only files remain (39 admin / 42 client / 9 other); migrated by
dependency cluster. Wave 1 = promoter side (self-contained).

**What:** Promoter login flow (`src/promoter/auth/promoter.auth.service.ts`) migrated off MongoDB onto SQL,
mirroring educator-auth. All 6 functions branch on `isMysqlModule("promoter-auth")` (login, refresh, logout,
change-password, update-profile, get-profile). Mongo retained as fallback. Enabled `promoter-auth` in `.env`.

**Schema:**
- DDL ADD: `ws_promoter_access_tokens` (mirrors admin/educator token tables) →
  [`migration/schema-changes/2026-06-17_create_ws_promoter_access_tokens.sql`](./migration/schema-changes/2026-06-17_create_ws_promoter_access_tokens.sql)
  (additive, prod-safe, run once).
- Extended Prisma `Promoter`: added `password` + `lastSeenAt` (`@map("last_seen_at")`) + `accessTokens`
  relation; new `PromoterAccessToken` model. Regenerated client. (commerce-promoter READ transformer explicitly
  excludes password — safe.)

**Drift handled:** ws_promoter has **no `last_login_date`/`last_login_ip`** columns (the Mongo model wrote them)
→ `touchLogin` updates `last_seen_at` instead. Password verify = `verifyPromoterPassword` (bcrypt then 32-hex
MD5, like educator) — though only **1 of 114** promoters has a password (the rest are admin-created, no login).
JWT `{id,email,role:"promoter",type:"promoter"}` + Redis `promoter_session:{id}` unchanged; numeric id stringified.

**Verified (tsx against live DB):** dual-hash verify (bcrypt/MD5/empty); login lookup + DTO (promoter 2 GPSC
ONLINE); token create/refresh-lookup/deactivate; profile update; touchLogin. Data restored. `tsc` clean.

**Next (Wave 1 cont.):** promoter dashboard/customers/promocode/subscription reads (aggregations over
already-migrated tables — no new SQL).

---

## 2026-06-17 — 🎓 admin educator MASTER CRUD migrated to MySQL (ws_course_educator)

**What:** Migrated the admin educator master endpoints (`src/admin/master/educator.controller.ts`,
mounted at `/api/v1/admin/master/educators`) off MongoDB onto SQL. This is the listing/CRUD admins see — separate
from the educator login flow migrated earlier today. Gated by the existing `educator-auth` flag (already ON).
No schema/DDL change.

**Branched handlers (Mongo retained as fallback):** `getEducators` (list w/ search + status + sortBy
[createdAt/updatedAt/name/email] + sortOrder, paginated), `createEducator`, `updateEducator`,
`getEducatorDetails`, `deleteEducator`.

**Schema realities handled:**
- `ws_course_educator` has **no `deleted` column** → "delete" = `status=false` + revoke tokens (row retained, so
  course/live-course `courseEducatorId` refs still resolve). List shows all rows; callers filter by status.
- `password` is **NOT NULL** but the create validation makes it optional → store `""` when absent (no-login
  educator, matching the existing empty-MD5 rows); hash with bcrypt when provided.
- `id` is numeric (not ObjectId); DTO returns `_id` as the stringified int + status + timestamps; password omitted.
- `getEducatorDetails` associations (courses/live-courses/packages/sessions/subscriptions) return empty on SQL —
  those models aren't migrated yet.

**Reused:** extended `src/modules/educator-auth/educator-auth.{repository,transformer}.ts` with admin
list/CRUD ops + `toEducatorListDto`.

**Verified (tsx against live DB):** the exact failing query (page=1, limit=10, sortBy=updatedAt, sortOrder=desc)
→ 56 educators, sorted correctly; search+status filter; create (password→""), email-uniqueness excl. self,
update, disable (row retained). Throwaway row cleaned up. `tsc --noEmit` clean.

---

## 2026-06-17 — 🎓 educator-auth migrated to MySQL (ws_course_educator) + MD5/bcrypt password support

**What:** Migrated the educator auth flow (`src/educator/auth/educator.auth.service.ts`) off MongoDB onto MySQL,
following the admin-auth pattern. Added `educator-auth` to `.env` `MIGRATION_MYSQL_MODULES`. Mongo retained as
fallback.

**Schema (`prisma/schema.prisma`):**
- Extended `CourseEducator` (`@@map("ws_course_educator")`): made `image` nullable (matches DB), added
  `last_seen_at`/`email_verified_at` (Date) and the `accessTokens` relation.
- Added `EducatorAccessToken` → `@@map("ws_educator_access_tokens")` (new table) mirroring the admin/customer
  token tables.

**DDL (applied to `websankul_staging`):** created `ws_educator_access_tokens`
`(id INT PK AI, educator_id BIGINT UNSIGNED, token TEXT, refresh_token TEXT NULL, active TINYINT(1),
deleted TINYINT(1), created_at DATETIME, expires_at DATETIME, updated_at TIMESTAMP, INDEX educator_id,
INDEX (active,deleted))`.

**⚠️ Password formats (key finding):** `ws_course_educator.password` is MIXED — 40 rows are legacy 32-char
**MD5** hashes, 16 are **bcrypt** (`$2`). The Mongo branch only did `bcrypt.compare` (would fail the MD5 rows).
New `verifyEducatorPassword` (in the transformer) tries bcrypt first, then falls back to `md5(input)===stored`
for 32-char-hex hashes. Empty-string MD5 (`d41d8cd9…`, = "no password") never matches a non-empty input.
Password **changes** always write bcrypt (legacy MD5 upgrades on next change). No bulk re-hash performed.

**New module:** `src/modules/educator-auth/{educator-auth.repository.ts, educator-auth.transformer.ts}`.
Service branches added to login, refresh, logout, change-password, update-profile, get-profile. JWT payload
unchanged (`{id, email, role:"educator", type:"educator"}`); Redis `educator_session:{id}` and the
middleware 1-device rule unchanged. DTO matches the Mongo `buildProfile` shape (id as stringified int).

**Verified (tsx against live DB, 56 educators):** verifyEducatorPassword for MD5/bcrypt/$2y/empty-md5; login
lookup + verify (educator 20); DTO shape; token create/refresh-lookup/deactivate; profile update. Original
data restored, none left modified. `tsc --noEmit` clean.

**NOT migrated yet (still Mongo):** educator dashboard/course/package controllers (read Course/Package/
PackageCourseSubscription/Customer — depend on subscription models not yet on SQL). Tracked in
`docs/MIGRATION_MONGO_REMAINING.md`.

---

## 2026-06-17 — 🔀 enabled customer-profile + customer-bank-account on MySQL (config flip)

**What:** Added `customer-profile` and `customer-bank-account` to `.env` `MIGRATION_MYSQL_MODULES`. Both modules'
SQL branches were already fully built (repository + transformer + service, no TODOs/fallthrough) — this is a
config flip only, no code/schema change.

**Verified (tsx against live DB):** `customer-profile.getProfile` returns a complete DTO with hydrated goals
(`ws_customer` + `ws_customer_target_goal`); `customer-bank-account` service loads and lists from
`ws_customer_bank_account`. `tsc --noEmit` clean.

**Held back:** `customer-address` NOT enabled — its SQL branch is complete but depends on the `offline-city`
id-space (cityId ↔ OfflineCity), and offline-city is not yet enabled. Enable together once offline-city lands.

**Note on "SQL-only" goal:** the app is still hybrid. See `docs/MIGRATION_MONGO_REMAINING.md` for the full
inventory of endpoints/files that still read MongoDB with **no SQL branch** (client referral/cart/goals/orders,
admin dashboard/notifications/livechat, educator + promoter modules, FCM/sockets/webhooks). Those require new
SQL branches, not just a flag flip.

---

## 2026-06-17 — 🧑‍🤝‍🧑 admin customer CRUD/list migrated to MySQL (ws_customer)

**What:** Migrated the admin-side customer management endpoints
(`src/admin/customer/customer.controller.ts`) off MongoDB onto MySQL `ws_customer`. Gated by the existing
`customer-auth` flag (already ON in `.env`) — so admin customer management flips together with customer auth.
No schema/DDL change (all tables already introspected).

**Branched handlers (Mongo retained as fallback):** `getCustomers` (list w/ search + status + state/district +
date-range filters, paginated), `getCustomerById`, `getCustomerPreRequisites` (states + educations from
ws_customer_state/_education), `getDistrictsByState` (ws_customer_distict), `createCustomer`, `updateCustomer`,
`deleteCustomer` (soft delete), `toggleCustomerStatus`. The subscription/order/address aggregate handlers
(`getCustomerCourseSubscriptions`, `getCustomerEbookSubscriptions`, `getCustomerAddresses`,
`getCustomerDetails`) return empty/zeroed payloads on the SQL branch — their underlying models
(PackageCourseSubscription/EbookSubscription/CustomerAddress/orders) are not yet on SQL.

**New files:** `src/modules/admin-customer/{admin-customer.repository.ts, admin-customer.service.ts,
admin-customer.transformer.ts}`.

**Schema realities handled:**
- `ws_customer` stores a **single `full_name`** — the API contract exposes firstName/middleName/lastName.
  Compose on write (`composeFullName`), best-effort split on read (`splitFullName`: 1 token→first; 2→first+last;
  3+→first + middle(joined) + last).
- **`state` and `district` are NOT NULL** in MySQL (no default) → cleared/absent values write **0** (the legacy
  dump sentinel, matching customer-auth `createStub`), never NULL. `education_id` is nullable. Create uses the
  Prisma **unchecked** input to set raw FK columns.
- FK ids are **Int** (not ObjectId) → list filters + create/update accept numeric ids; lookups returned with
  `_id` as the stringified int. Column maps: `dob`→birthDate, `profile_picture`, `phone_2`→phone2,
  `goal` (JSON) ← goals[].
- Changing phone resets `is_phone_verified` (matches Mongo).

**Validation (`customer.validation.ts`):** state/district/education id fields + `goals[]` now accept a numeric
MySQL id alongside the 24-hex Mongo ObjectId.

**Verified (tsx against live `websankul_staging`, 27 customers):** list, filters, get, prereqs (states/educations),
districts-by-state (Gujarat→33), full create (full_name composed, state/district/education connected, goals JSON),
phone/email uniqueness excl. self, update (name recomposed, education→NULL, phone-verify reset), toggle, soft
delete (row retained, hidden from reads). Throwaway row cleaned up. `tsc --noEmit` clean project-wide.

---

## 2026-06-17 — 👥 administrator CRUD/list migrated to MySQL (ws_users) — completes admin-auth flip

**What:** Migrated all administrator CRUD/list endpoints
(`src/admin/administrator/administrator.controller.ts`) off MongoDB onto MySQL `ws_users`, gated by the same
`isMysqlModule("admin-auth")` flag added earlier today. Every handler — list, get-by-id, pre-requisites
(roles dropdown), create, update, delete, toggle-status — now has a MySQL branch (Mongo path retained as
fallback).

**New files:**
- `src/modules/admin-auth/administrator.service.ts` — SQL CRUD service (list w/ search+status+role filter,
  get, create, update, disable, toggle, assignable-roles, role-exists). `ADMIN_MODEL_TYPE = "App\\Models\\User"`
  (verified against existing `ws_model_has_roles` rows).
- Extended `admin-auth.repository.ts` with admin CRUD + spatie role-pivot writes, and `admin-auth.transformer.ts`
  with `toAdminListDto` (mirrors the Mongo `PUBLIC_FIELDS` projection: `_id`, status, timestamps).

**Schema realities handled (no DDL this entry):**
- `ws_users` has **no `deleted` column** → "delete" = set `status='0'` (inactive) + revoke tokens; the row is
  retained. List/detail show all rows; callers filter by `status`.
- `image` is **NOT NULL** → create defaults to `""`.
- **No `role` column** → built-in enum roles (super_admin/admin/editor) are not persistable on SQL; a numeric
  spatie role id (ws_roles.id) is written to the `ws_model_has_roles` pivot and `role` is derived on read from
  role names (super→super_admin, editor→editor, else admin).
- Pagination/search via Prisma (`firstName/lastName/email contains`, `orderBy createdAt desc`).

**Validation (`administrator.validation.ts`):** `roleField` now also accepts a numeric string id (MySQL spatie
role id) alongside the 24-hex Mongo ObjectId form.

**Verified (tsx against live `websankul_staging`):** full lifecycle — list (3 admins, derived role+status),
role-filter, get, 31-row roles dropdown, create (+spatie pivot write `role=1 type=App\\Models\\User`),
email-uniqueness (excludes self), update (incl. lastName→null), toggle, disable (row retained). Throwaway row
cleaned up; no test data left behind. `tsc --noEmit` clean project-wide.

---

## 2026-06-17 — 🔐 admin-auth (ws_users) migrated to MySQL — admin login reads from SQL

**What:** Migrated the administrator login/auth flow off MongoDB onto MySQL `ws_users`, following the
established `isMysqlModule("admin-auth")` branch pattern. Added module `admin-auth` to `.env`
`MIGRATION_MYSQL_MODULES`.

**Schema (`prisma/schema.prisma`):** Added models:
- `AdminUser` → `@@map("ws_users")`. Laravel snake_case columns; `status` and `is_dark` are
  `enum('0','1')` in MySQL, modeled as Prisma enums `AdminStatusFlag {inactive=0, active=1}` and
  `AdminDarkFlag {light=0, dark=1}`. **No `role`/`deleted` columns exist** on this table.
- `AdminAccessToken` → `@@map("ws_admin_access_tokens")` (new table, see DDL below) mirroring
  `ws_customer_access_token`.
- `AdminRoleRow`/`AdminPermissionRow` → `ws_roles`/`ws_permissions`; `AdminModelHasRole`/
  `AdminModelHasPermission` → spatie pivots `ws_model_has_roles`/`ws_model_has_permissions`
  (read-only role/permission resolution for the login response).

**DDL (applied to `websankul_staging`):** created `ws_admin_access_tokens`
`(id INT PK AI, admin_user_id BIGINT UNSIGNED, token TEXT, refresh_token TEXT NULL, active TINYINT(1),
deleted TINYINT(1), created_at DATETIME, expires_at DATETIME, updated_at TIMESTAMP, INDEX on admin_user_id,
INDEX on (active,deleted))`.

**Service (`src/admin/auth/admin.auth.service.ts`):** Added MySQL branches to `adminLogin`,
`changeAdminPassword`, `refreshAdminToken`, `logoutAdmin`, `updateAdminProfile`. New repository
`src/modules/admin-auth/admin-auth.repository.ts` + transformer `admin-auth.transformer.ts` (returns the
**same admin DTO shape** as the Mongo branch: `id, firstName, lastName, email, role, roles[], permissions[],
image, isDark`). `role` is derived from spatie role names (super_admin/editor/admin). JWT payload uses the
numeric `ws_users.id` as a string; Redis `admin_session:{id}` caching unchanged.

**Verified:** repository lookup + pivot role resolution (`it@websankul.com` → role `admin`, guard `web`),
token write/read/delete round-trip, and bcrypt compare — including that **legacy Laravel `$2y$10$` hashes
verify with `bcryptjs`**, so all existing admins log in with current passwords. `tsc --noEmit` clean.

---

## 2026-06-15 — 🚀 FULL FLIP enabled in this env (all 30 module keys ON) + full HTTP suite green

**What:** Turned ON every built module flag in `.env` `MIGRATION_MYSQL_MODULES` (was 12, now all 30:
added `catalog-course,catalog-video,catalog-ebook,catalog-exam,catalog-material,catalog-book,offline-batch,
commerce-price,commerce-subscription,commerce-ebook-sub,commerce-promoter,commerce-promocode,commerce-educator,
commerce-order,ebook-order,book-order,offline-enquiry,package-chat`). Restarted `yarn dev`, ran `yarn migration:api`.

**Result:** **All suites passed — zero fallout.** Every previously flag-gated `skip: !xMysql` test now runs +
passes. The 13 remaining SKIPs are all hardcoded `skip: true` placeholders with **no HTTP endpoint** (catalog-video
URL encryption; commerce-price/subscription/ebook-sub/promoter/promocode/educator READ masters returned only nested;
commerce-order/ebook-order/book-order write-paths needing a real Razorpay callback; offline-enquiry/package-chat
writes) — not flag-controllable; data paths already proven via tsx. They stay skipped by design.

**No schema/query change** — this is a config flip only. Earlier this session: regenerated Prisma client (fixed
93 stale `@prisma/client` typecheck errors), added the api-tests **mock-JWT store** (`_lib/token-store.ts`,
`mint-jwt.ts`, `yarn migration:api:auth`) + **auto API-doc-on-pass** (`_lib/capture.ts`, `_lib/doc-writer.ts` →
`api-tests/<module>/API_DOC.md`), and attached `getCustomerToken()` to the offline-batch/offline-city/customer-lookups
client tests that were 401ing (their routes now require a Bearer token).

**⚠ Prod caveat:** this `.env` must NOT ship to production as-is until the `ws_package_chat` ALTER
(`migration/schema-changes/2026-06-13_extend_ws_package_chat.sql`) is run on the prod DB. Rollback = remove keys + restart.

---

## 2026-06-13 — `package-chat` BUILT + WIRED (READ + WRITE, Phase 3b) — flag OFF · ⚠ FIRST SCHEMA ADD

**What:** The LAST 3b write path. Package announcement chat (admin/system posts; subscription-gated client
read). Wired the client READ + the admin WRITE behind `isPackageChatMysql()` (flag OFF):
`GET /client/package/:packageId/chat` · `POST /admin/package/:id/chat` · `DELETE /admin/package/chat/:messageId`.

### ⚠ SCHEMA CHANGE (the first additive ALTER in this migration)
`ws_package_chat` was a legacy **STUB** (`id, package_id, message, timestamps`) — it could NOT represent the
live Mongo PackageChat (media + sender + push), so migrating against it would have silently broken the chat
response. Per sign-off, the table was **EXTENDED** (additive only, prod-safe):
```
ALTER TABLE ws_package_chat ADD media_url VARCHAR(1000) NULL,
  ADD media_type ENUM('image','video','pdf','audio','other') NULL DEFAULT 'other',
  ADD sender_type ENUM('admin','system') NOT NULL DEFAULT 'admin',
  ADD sender_id VARCHAR(255) NULL, ADD push_sent TINYINT(1) NOT NULL DEFAULT 0;
```
The statement is captured in [`migration/schema-changes/2026-06-13_extend_ws_package_chat.sql`](migration/schema-changes/2026-06-13_extend_ws_package_chat.sql)
(run once on prod — project uses manual ALTER + `prisma db pull`, no Prisma Migrate). Prisma: the stub `chat`
model → **`PackageChat`** + enums `PackageChatMediaType`/`PackageChatSenderType`; Package back-relation
`chat chat[]` → `chat PackageChat[]`; regenerated (pinned 5.22.0, carets re-checked intact).

### Field mapping / drift
- SQL `message` ↔ Mongo `text` (Mongo defaults text to ""; message is NOT NULL → store "" for media-only).
- `sender_id` is **VARCHAR** — holds the admin ObjectId (admin auth stays Mongo), so string|null, not int.
- `media_type`/`sender_type` modeled as Prisma enums. `push_sent` Boolean. `package_id` INT.
- **list ordering:** Mongo sorts by `createdAt desc`; SQL `created_at` is second-granularity `datetime`, so
  same-second posts tie → added `id desc` tiebreaker to preserve true insertion order (caught in tsx).
- **subscription gate (client read):** the MySQL branch gates via commerce-subscription's
  `hasActivePackageSubscription` (int ids) instead of the Mongo gate; branches before the ObjectId guard.

### Verification
tsx (`scripts/_tmp/verify-package-chat.ts`, flag OFF, live DB, package 3): **21/21 passed** — package
existence guard, post (text / media-only→message="" / system sender), paginated list (newest-first +
tiebreak) + total, delete (+ missing→false), field mapping. Created rows cleaned up; staging restored to 0.
Typecheck 0 errors (ex 2 known). **Flag OFF — the 3b write cluster is now COMPLETE.**

---

## 2026-06-13 — `offline-enquiry` BUILT + WIRED (lead-capture write, Phase 3b) — flag OFF

**What:** Small single-table write module `src/modules/offline-enquiry/` (batch enquiry). **Wired** behind
`isOfflineEnquiryMysql()` (flag OFF): `POST /client/offline/enquiry`. No schema change — `OfflineEnquiry`
model already existed (its `mobile` Int→BigInt fix landed in the offline-batch pass).

### Drift handled
- **`mobile` BIGINT:** input is a string; digits parsed → BigInt for the column, surfaced back as a string
  in the DTO (Mongo shape). 12-digit numbers (e.g. with country code) overflow Int32 → BigInt required.
- **anonymous vs NOT NULL customer_id:** the route is anonymous-allowed (best-effort auth; userId may be
  null) but `ws_offline_enquiry.customer_id` is INT NOT NULL. Store the **`0` sentinel** for anonymous (no FK
  enforced); the DTO maps 0 → null to keep the Mongo shape.
- **no `remarks` column:** the Mongo enquiry accepts an optional `remarks`; SQL has no column. The validator
  still accepts it (contract-stable) but it's DROPPED on the SQL write (documented gap — lead-capture sink).
- **`batch_id` INT:** MySQL branch validates an int batch id + checks existence via offline-batch's table.
  Wired before the ObjectId schema parse (MySQL batch id is an int).

### Verification
tsx (`scripts/_tmp/verify-offline-enquiry.ts`, flag OFF, live DB): **10/10 passed** — batch existence guard,
authenticated write (BigInt mobile round-trip incl. 12-digit overflow case), anonymous write (0-sentinel ↔
null), cleanup. Staging restored to 4 rows. Typecheck 0 errors (ex 2 known). **Flag OFF.**

---

## 2026-06-13 — `catalog-book` WIRED (book listing + detail) — flag OFF

**What:** Wired the two book read endpoints that were built-but-blocked. `GET /client/books` (listBooks) +
`GET /client/books/:id` (getBookDetail) now branch on `isBookMysql()`. No new module, no schema change — a
pure wiring pass enabled by `book-order` landing (it migrated the order/cart tables the enrichment needs).

### Why it was blocked, and why it's unblocked now
listBooks/getBookDetail enrich each book with per-customer **cart qty/cartId** (ws_book_cart*) +
**isPurchased** (ws_book_order* by fulfilled status). Those tables were Mongo-only until `book-order` (Phase
3b) migrated them — now the int book id-space matches and the joins work.

### Composition (catalog-book DATA + book-order STATE)
- catalog-book `listBooksData`/`getBookById` supply the book data + data-only computed fields (isPaid, key,
  daysLeft=null, isNew, shareableLink via callback).
- NEW book-order read helpers compose the per-customer state: `getActiveCartState` (cartId = ws_book_cart
  .cart_id + a bookId→qty map from ws_book_cart_item) and `getPurchasedBookIdSet` (ws_book_order_item book
  ids joined to orders in verified/shipped/delivered). Repo reads added to book-order (it owns those tables).
- Controller merges `qty` + `isPurchased` onto each book; response byte-identical to the Mongo branch.

### Drift / parity notes
- **status set:** purchased = order status in (verified, shipped, delivered) — same strings on SQL + Mongo.
- **C3 seam:** customerId coerced `Number(req.user.id)`. Detail branches BEFORE the ObjectId guard (MySQL
  book id is an int). `pages` already a number in the DTO (Mongo did `pages ?? 0`).

### Verification
tsx (`scripts/_tmp/verify-catalog-book-wired.ts`, flag OFF, live DB): **12/12 passed** — listBooksData (10
books, computed fields, shareableLink), real active cart (customer 472339, book 7 qty=1) merge, isPurchased
proven by seeding a verified order+item then cleaning up, detail composition (purchased true for buyer, false
for non-buyer). Staging restored to 6/1. Typecheck 0 errors (ex 2 known). Registry + schema-comparison
regenerated. **catalog-book flag still OFF** — flips with the catalog/commerce/order cluster.

---

## 2026-06-13 — `book-order` BUILT + WIRED (book cart-checkout write path, Phase 3b) — flag OFF

**What:** Third write-path module `src/modules/book-order/` — a DIFFERENT shape (cart checkout → **5 tables**,
line items, courier AWB counter). Scoped + signed off in [`migration/BOOK_ORDER_SCOPE.md`](migration/BOOK_ORDER_SCOPE.md).
**Wired** behind `isBookOrderMysql()` (flag OFF): `POST /client/payment/create-order` (book cart) + the
**book branch** of `POST /client/payment/verify`.

### ⚠ SCHEMA FIX (read-breaking BigInt drift)
`ws_book_tracking.tracking_id` + `ws_book_order.tracking_id` are **BIGINT** (the courier AWB, ~1.19e11 —
overflows Int32) but Prisma mapped them **`Int`** → reads THREW. Fixed `BookTracking.tracking_id Int→BigInt`,
`BookOrder.trackingId Int?→BigInt?`, regenerated (pinned 5.22.0; carets re-checked, intact). Surfaced as number.

### The 5-table fan-out
- **create-order (2 phases):** preview the cart (`ws_book_cart` + `ws_book_cart_item` child rows → totals
  with the `ws_termsandcondition` module='book' free-shipping threshold = 500) → create Razorpay → ONE `$transaction`
  writes `ws_book_order` (pending; `order_items` TEXT blob + cart_id + razorpay payload, all NOT NULL) **+
  `ws_book_order_item` rows** (FK `order_id` = the VARCHAR business key).
- **verify:** ONE `$transaction` — insert `ws_book_tracking` (bigint **AUTO_INCREMENT** = the AWB; live base
  119400693004, no Counter needed) → flip order→verified + tracking_id + gateway_transaction_id → **deactivate
  the cart** (`ws_book_cart.status=0`, matching user+shipping; cart_item rows kept, Mongo parity).

### Drift handled
- **customer_id is INT** on ws_book_order (NOT the VARCHAR split of course/ebook). order_id is the VARCHAR
  business key (≠ int PK); item + tracking FK on the string.
- **Embedded → child:** Mongo BookOrder.items[] → order_item rows (+ denormalized order_items JSON blob).
- **Tracking history LOSS (signed-off D-B3):** `ws_book_tracking` is `{tracking_id,order_id,status}` — no
  history/note/location. Persist the flat row; the DTO **synthesizes** the single verify entry
  `[{status:'Order Placed', note:'Payment received', at}]`. Multi-step timeline = noted fidelity gap.
- **varchar(10) status (caught in tsx):** "Order Placed" (12) overflows `ws_book_tracking.status` → store
  short code "verified"; DTO carries the human text.

### Dual-read fallback + verification
verify checks MySQL first, falls through to the Mongo fan-out on miss. tsx (`scripts/_tmp/verify-book-order.ts`,
flag OFF, live DB, seeded cart): **25/25 passed** — create→items snapshot, owner-lookup miss→null, verify
(AWB allocation, BigInt no-overflow, tracking.order_id=VARCHAR key, cart deactivation, cart_item kept,
synthesized history), idempotent re-verify (no second AWB). Created rows cleaned up; staging restored to
6/1/2/2/3. Typecheck 0 errors (ex 2 known).

### Scope
book-order only (signed off); **wiring catalog-book is a clean follow-up** (its reads are built, were blocked
on order/cart deps — now unblocked). **Flag OFF** — go-live needs separate sign-off.

---

## 2026-06-13 — `ebook-order` BUILT + WIRED (ebook write path, Phase 3b) — flag OFF

**What:** Second write-path module `src/modules/ebook-order/` (ebook purchase). Rides the commerce-order
pattern. **Wired** behind `isEbookOrderMysql()` (flag OFF): `POST /client/payment/create-order/ebook` +
the **ebook branch** of `POST /client/payment/verify`. No schema change — `EBookOrder`/`EBookSubscription`
Prisma models already existed and passed the drift check.

### The split (one-doc → TWO tables — simpler than course, no tracking)
- **create-order** writes **`ws_ebook_order`** only (status=pending). `unique_id` (NOT NULL) = the receipt id.
- **verify** runs ONE `$transaction`: flip order→complete + razorpay_payment_id; then extend an active
  `ws_ebook_subscription` (fold endAt +DAYS, sum price, repoint at the latest order) OR create a fresh one.
- The verify ebook branch returns `data:{kind:"ebook", order}` — the ORDER, not the subscription — so the
  DTO mirrors the Mongo EbookOrder doc.

### Drift handled (verified vs live DDL + real rows)
- **customer_id TYPE SPLIT:** order VARCHAR / subscription INT (C3 coercion `Number(req.user.id)`).
- **NO `ebook_id` on the order table** — only `plan_id`; the ebook is **re-derived from the plan** at verify
  + in the DTO (Mongo's EbookOrder carries ebookId; SQL doesn't).
- **status enum IDENTICAL strings** ('pending'|'complete'|'cancel') on SQL + Mongo — no translation (unlike
  course's paymentStatus map).
- **`order_price`** is the paid amount (no separate discount col). **`duration` = DAYS**. **`payment_type`**
  enum('online','backend') → 'online'.

### Dual-read fallback (rollback safety)
verify checks MySQL for the ebook order FIRST when flag ON; on miss falls through to the Mongo fan-out.

### Verification
tsx (`scripts/_tmp/verify-ebook-order.ts`, flag OFF, live DB, plan 1 / ebook 1 / 180 DAYS): **28/28 passed** —
create→verify round-trip, owner-lookup miss→null, fresh grant (180-DAY endAt, ebook_id re-derived, order FK),
idempotent re-verify (no dup sub), upsert-extend (reuses sub, +180 days, repoints at latest order, exactly 1
active row). Created rows cleaned up; staging restored to 2 orders / 1 sub. Typecheck 0 errors (ex 2 known).

### Scope
EBOOK after COURSE (signed off). book-order next; live-course/test-series deferred (no SQL tables).
**Flag OFF** — go-live needs separate sign-off.

---

## 2026-06-13 — `commerce-order` BUILT + WIRED (course write path, Phase 3b) — flag OFF

**What:** Built the first **write-path** module `src/modules/commerce-order/` (course purchase) and
**wired** both endpoints behind `isCommerceOrderMysql()` (flag OFF): `POST /client/payment/create-order/course`
and the **course branch** of `POST /client/payment/verify`. No schema change needed — the 3 Prisma models
(`PackageCourseOrder`, `PackageCourseSubscription`, `PackageCourseSubscriptionTracking`) already existed and
passed the drift check.

### The one-doc → three-tables write
Mongo writes one `PackageCourseSubscription` doc (order + entitlement). SQL splits it:
- **create-order** writes **`ws_package_course_order`** only (status=pending).
- **verify** runs ONE `$transaction`: flip order→complete + razorpay_payment_id; then EITHER extend an
  existing active course sub (fold endAt via DAYS planDuration + sum amount, no new row) OR create
  `ws_package_course_subscription` + `ws_package_course_subscription_tracking`. The verify response merges
  order payment fields + subscription entitlement fields into the Mongo-shaped `data.subscription`.

### Drift handled (verified vs live DDL + real rows)
- **customer_id TYPE SPLIT:** order table VARCHAR, subscription table INT — same logical id. Cast int→string
  at the order boundary, int on the subscription. C3 seam coercion (`Number(req.user.id)`) at both controllers.
- **`tracking` / tracking.id BIGINT** (~1.19e11, overflow Int32) — Prisma `BigInt`, surfaced as number.
- **`tracking.order` FKs order.id**, not subscription.id (confirmed in tx + tsx).
- **order.status enum ↔ Mongo paymentStatus:** pending↔pending, complete↔verified, cancel↔failed.
- **Mongo↔SQL names:** Mongo `packageId`=plan=SQL `pcb_id`; `targetPackageId`=package=SQL `package_id`.
- **`duration` = DAYS** — endAt via planDuration `asDays:true`.

### Dual-read fallback (rollback safety, WRITE_PATH_SCOPE §3.2)
verify checks MySQL for the course order FIRST when the flag is ON; on miss it **falls through to the Mongo
fan-out**. So a flag flip between create-order and verify (or a pre-flip Mongo order) can't orphan a payment.

### Verification
tsx (`scripts/_tmp/verify-commerce-order.ts`, flag OFF, live DB): **28/28 passed** — create→verify round-trip,
owner lookup + miss→null, fresh grant (DAYS endAt, BigInt tracking, tracking.order=order.id), idempotent
re-verify (no dup sub), upsert-extend (reuses sub _id, +90 days, second order makes no new sub). All created
rows cleaned up; staging restored to 3 orders / 2 subs / 3 tracking. Typecheck 0 errors (ex 2 known files).

### Scope (signed off)
COURSE only; ebook/book ride the same pattern next. live-course/test-series stay deferred (no SQL tables).
**Flag stays OFF** — NOT added to `MIGRATION_MYSQL_MODULES` until a separate go-live sign-off.

---

## 2026-06-13 — Write-path (Phase 3b) SCOPED + signed off — no code yet

**What:** Read the real 569-line `src/client/payment/verify.controller.ts` and the live SQL
write tables; wrote [`migration/WRITE_PATH_SCOPE.md`](migration/WRITE_PATH_SCOPE.md) and got sign-off.
**No write-path code written** (satisfies RESUME_HERE §1 "don't write write-path code without the plan").

### Findings (correct the checkpoint's summary)
- `verify` is a **5-way fulfillment dispatch** (book · course · ebook · live-course · test-series),
  not "Razorpay + subscription". live-course & test-series hit **Mongo-only collections with NO SQL
  tables** → stay deferred (§7). Real 3b target = **course** (ebook adjacent next).
- **One-doc-vs-three-tables impedance mismatch:** Mongo `PackageCourseSubscription` carries order +
  entitlement in one doc; SQL splits to `ws_package_course_order` → `ws_package_course_subscription`
  → `ws_package_course_subscription_tracking`.
- **Schema trap:** `ws_package_course_order.customer_id` is **VARCHAR(ObjectId)** but
  `ws_package_course_subscription.customer_id` is **INT** — same logical id, two types across the two
  tables in one write. Plus `subscription.tracking` + `tracking.id` are **BIGINT** (overflow class).
- `tracking.order` column FKs **order.id**, not subscription.id.

### Sign-off decisions
- **Scope:** course path **ONLY** first (ebook/book ride the same pattern later).
- **Flag:** `commerce-order`, gates create-order + verify end-to-end; **NOT** added to
  `MIGRATION_MYSQL_MODULES` until a separate go-live sign-off.
- **Rollback safety:** verify uses a **dual-read fallback** (query flagged store, fall back to the
  other on miss) so a flag flip between create-order and verify can't orphan an in-flight payment.
- create-order writes the `order` row only; verify writes `subscription`+`tracking` in one
  `$transaction`; upsert-extend reproduced in SQL with the **DAYS** planDuration helper.

### Next
Build per WRITE_PATH_SCOPE §5: Prisma-model the 3 tables (varchar/int customer_id split, BigInt
tracking, status/payment_type enums) → `src/modules/commerce-order/` → tsx verify (flag OFF) → wire
behind `isMysqlModule("commerce-order")` with dual-read fallback → typecheck → full doc protocol.

---

## 2026-06-12 — Offline center/batch browse reads wired (`offline-batch` built) — flag OFF

**What:** Built `offline-batch` (`ws_offline_center` + `ws_offline_batch`) and **wired** the offline browse reads behind `isOfflineBatchMysql()` (flag OFF): `GET /client/offline/centers`, `/batches`, `/centers/:id`, `/batches/:id` (all PUBLIC routes). Cities come from the already-migrated `offline-city`.

### ⚠ TWO schema fixes (both would otherwise break reads)
1. **bigint overflow:** `OfflineCenter.phone` was Prisma `Int` but the DDL is `bigint` — center 3's phone `9099665555` **overflows Int32** → read throws. Fixed to `BigInt`; the DTO surfaces it as a **string** (the Mongo model stores phone as a string). Also fixed `OfflineEnquiry.mobile Int→BigInt` (+ added its `created_at`) for the future write path.
2. **phantom column:** there is **NO `status` column** on `ws_offline_batch` OR `ws_offline_center`, yet every Mongo handler filters `{status:true}` and Prisma `OfflineBatch.status` was a phantom field (mapped nothing) → **removed**. The MySQL branch drops the status filter (all rows active) and synthesizes `status: true` in the DTO to keep the response shape stable.

### Field mapping
- `ws_offline_center.image` is a **JSON column** (array of URLs) → Mongo `images: string[]`.
- SQL column **typo**: batch `discription` → Mongo `description`.
- center→city and batch→center→city relations populated (Mongo `.populate` parity).

### Scope (deferred)
- `getOfflineDashboard` stays on Mongo — it also reads the unmigrated `OfflineBannerSlider`. `submitEnquiry` (POST → `ws_offline_enquiry`) is a **WRITE path**, not built.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-offline-batch.ts` (run, passed, removed): 3 centers + 3 batches, **read did not throw** on bigint phone; phone→string, `images[]` from JSON, status synth true, city ref resolved; city/center filters + search; center detail with nested batches; batch→center→city populated; `discription`→`description`; upcoming filter respects a real `1899` sentinel start_at edge; dashboard centers-by-city grouping. **ALL CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — `pendrive-course` SKIPPED (decommissioned feature) — will NOT be migrated

**Decision (user, 2026-06-12):** the entire pendrive-course surface is **no longer useful** and is **out of migration scope**. Do NOT build modules for it. Tables to ignore: `ws_pendrive_course`, `ws_pendrive_course_cart`, `ws_pendrive_course_cart_item`, `ws_pendrive_course_order`, `ws_pendrive_course_storage_device`, `ws_pendrive_course_tag`, `ws_pendrive_course_tracking` (7 tables). They stay in the DB for data preservation but get no read/write path. Removes 7 tables from the "remaining" count.

---

## 2026-06-12 — Book store DATA reads built (`catalog-book`) — flag OFF, NOT wired

**What:** Built `catalog-book` (`ws_book`, 10 rows) — the physical-book store catalogue reads. Dual-path, **flag OFF**, and **NOT wired** (same pattern as catalog-package).

### Why not wired
- The client `listBooks`/`getBookDetail` handlers enrich each book with per-customer **cart `qty`** (`ws_book_cart*`) and **`isPurchased`** (`ws_book_order*` by order status). Those order/cart tables are **NOT migrated**, and with book on MySQL (int ids) but orders/cart still on Mongo (ObjectIds), the purchased/cart keys wouldn't match the int book ids. So the module supplies the book DATA + the data-only computed fields, and flips with the **book-order/cart wave**.

### What the module produces (verified)
- Book rows + the computed fields reproducible from the row alone: **`isPaid`** (discountedPrice > 0), **`key`** (isCombo ? "combo" : "individual"), **`daysLeft`** (null — one-time purchase), **`isNew`** (createdAt window), and the per-request deep link via a `buildShareLink` callback. The order/cart-derived `qty` + `isPurchased` are left to the caller.
- **Schema fix:** `ws_book.order_by` nullable in the DDL but Prisma typed non-null → relaxed to `Int?`.
- **Mongo-only fields absent from `ws_book`:** `packageIds[]` (embedded M:N for the package-detail material(Book) tab — appliesTo-style, not reproducible), `examCountdownCategoryId`, `termsAndConditions`, `bookUrl`, `publication`, `deliveryEta`, `isTrending`. `isTrending` synthesized false; `publication`/`deliveryEta` synthesized to the Mongo defaults so the response shape stays stable.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-catalog-book.ts` (run, passed, removed): 10 books; book 10 'Computer' → key 'individual', isPaid true (price 200), daysLeft null, isTrending false + publication/deliveryEta defaults, shareableLink from callback; listing ordered by order_by asc, all active, computed fields on every item; language filter; name search; findByIds bulk + empty guard. **ALL 18 CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — Exam category NAVIGATION wired to MySQL (`catalog-exam` built) — flag OFF

**What:** Built `catalog-exam` (`ws_exam` + `ws_exam_category`) and **wired** `GET /client/exam-categories/:id/children` behind `isExamMysql()` (flag OFF). Mirrors `catalog-material` — category navigation only.

### Schema + differences vs material
- **Schema fix:** `ws_exam_category.name`/`image` nullable in the DDL but Prisma typed non-null → relaxed to `String?` (no NULLs today).
- **Display field is `name`** (not `title`): the DTO sets BOTH `title` + `name` to the column value (the Mongo handler does `title: cat.name`).
- **`ws_exam_category` has a `deleted` flag** (material category had none) → active = `status = true AND deleted = false`.
- **Per-child exam count is UNCONDITIONAL** (`Exam.countDocuments({categoryId})` with no status filter) — matches the Mongo handler exactly (material filtered active).

### Structural translation (same as material)
- Mongo `ExamCategory.childCategoryIds[]` embed → SQL `parent_id` self-FK (children = `WHERE parent_id = id`). `havingChildDirectory` via one distinct query. Wired **before** the ObjectId guard (MySQL id is int).

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-catalog-exam.ts` (run, passed, removed): 121 categories; category 86 → 13 active children (excludes deleted/inactive, == direct active count); `title` mirrors `name`; category 124 has children → `havingChildDirectory=true`, leaf 88 → false; per-child `count` equals an **unconditional** Exam count (no status filter). **ALL CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — Material category NAVIGATION wired to MySQL (`catalog-material` built) — flag OFF

**What:** Built `catalog-material` (`ws_material` + `ws_material_category`) and **wired** `GET /client/material-categories/:id/children` behind `isMaterialMysql()` (flag OFF). Scoped to **category navigation** — the genuinely-wirable subset of the material surface.

### ⚠ SCOPE — material ITEM listing stays BLOCKED (intentionally not built)
- `listMaterialsByCategory` gates each item via `getPurchasedMaterialIds` (`src/client/material/entitlement.ts`), which joins **LiveCourse + LiveCourseSubscription** (unmigrated) and reads the **Mongo-only embedded `materialCategories.category[]`** arrays on Course/Package/LiveCourse. Also `ws_material` has **no `isPaid` column** (the item filter is Mongo-only). Not reproducible from SQL this pass — only the category tree is.

### STRUCTURAL TRANSLATION — embedded ids → parent self-FK
- The Mongo `MaterialCategory.childCategoryIds[]` embed has **no SQL column**. Children resolve via the SQL `ws_material_category.parent` self-FK: children of X = `WHERE parent = X`. `havingChildDirectory` = "≥1 row with `parent = this.id`" — computed in **one distinct query** for the whole page, not N. Prisma Material + MaterialCategory models are clean (no schema fix).

### Composition
- `getCategoryChildren(parentId, search)`: parent category + active children (order_by) + per-child active-material count + `havingChildDirectory`. Wired **before** the ObjectId guard (a MySQL category id is an int).

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-catalog-material.ts` (run, passed, removed): category 270 (root) → 1 active child (1867 'test'), child `count=0` + `havingChildDirectory=false`; `title` mapped from the `title` column; missing parent → null. Plus a direct check: `parentsWithChildren([270,1867])` → `[270]` (270 has a child, 1867 doesn't) confirming the `havingChildDirectory` logic. **ALL CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — `Goal` is NOT migratable (Mongo-only architecture) — investigated, deferred (no code)

**Finding:** The audit listed `Goal` as a blocker for the package listing/filter handlers. Investigation shows it **cannot be migrated as a flat module** — it's a new-architecture Mongo-only entity, same class as the promocode `appliesTo` divergence:

- **Mongo `Goal`** (collection `ws_goals`) = `{ title, labels: [{_id, name}], isActive }` with **embedded labels**. `listPackagesByGoal` filters `Goal.find({"labels._id": {$in}})` and `Package.goalLabelId`; the `goalId` query param on `listPackages` filters the same structure.
- **There is NO `ws_goals` table in MySQL.** The only goal table is **`ws_customer_target_goal`** (Prisma `CustomerTargetGoal`) — a **flat** master `{id, name, image, active}` with **no `labels`, no `title`**. It is a structurally different, pre-redesign entity; `Package.goalId` references it.

So building reads off `ws_customer_target_goal` would yield a flat goal master that **no handler consumes in that shape** (inert code), and `listPackagesByGoal` **cannot be reproduced from SQL**. **Decision: DEFER Goal** — it's a Mongo-only architecture concern (the `ws_goals`→`ws_customer_target_goal` reconciliation is a separate, later effort), NOT a migration this wave.

**Silver lining (re-scopes the package surface):** while tracing this, confirmed **`enrichPackages`** (the helper every package listing uses) touches ONLY `PackageCourseEbookPrice` + `PackageCourseSubscription` — **both already built** — and does **NOT** touch Goal. So the core package listings are blocked on the `Package` module being unwired + the Mongo-only filter fields (`isSmartCourse`/`isPlannerCourse`), **not** on Goal. Only the goal-specific filters (`listPackagesByGoal`, `goalId` param) are Goal-blocked, and those are Mongo-only anyway.

**Next instead:** `Material` + `Exam` — real flat SQL tables (`ws_material` 226 rows, `ws_exam` 1 row, both with Prisma models), blocking category browse + course/package detail. The genuinely-migratable next targets.

---

## 2026-06-12 — eBook surface wired to MySQL (`catalog-ebook` built) — listing + detail composed, flag OFF

**What:** Built `catalog-ebook` (`ws_ebook`) and **wired** `GET /client/ebooks` (listing) + `GET /client/ebooks/:id` (detail) behind `isEbookMysql()` (flag OFF). Second wired vertical after course listing. Composes three modules: `catalog-ebook` (rows) + `commerce-price` (plans) + `commerce-ebook-sub` (entitlement).

### Key finding — NO separate ebook-price module needed
- The audit listed `EbookPrice` as a blocker, but investigation showed: the Mongo `EbookPrice` binds to `ws_ebook_prices`, **which does not exist in MySQL**. Ebook pricing actually lives in the **shared `ws_package_course_ebook_price`** (214 ebook-owned rows) — already covered by **`commerce-price`**. Added `commerce-price.listActivePricesByEbooks` (plural) and reused it. So the ebook vertical needed only ONE new module (`catalog-ebook`), not two.

### Schema + field handling
- **Schema fix:** `ws_ebook.description` + `author` are nullable in the DDL but Prisma typed them non-nullable → relaxed to optional (non-breaking; no other Prisma EBook consumer).
- **Mongo-only fields absent from `ws_ebook`:** `isTrending`/`isPaid`/`examCountdownCategoryId`/`demoFileName`/`bookFileName`. **`isPaid` is DERIVED from the plans** (paid when ≥1 active plan price > 0) — which is exactly the controller's documented fallback when the Mongo `isPaid` field is absent (always, for SQL rows) → faithful. `isTrending` synthesized `false`. Field renames: `terms_and_conditions`→`termsAndConditions`, `order_by`→`order`, `demo_url`→`demoUrl`, `book_url`→`bookUrl`.

### Composition
- **`listEbooksWithPlans` / `getEbookDetailWithPlans`:** active ebooks (name/author search + language filter) + active plans (commerce-price) + per-customer access window (commerce-ebook-sub `listActiveByCustomerForEbooks`, strict `status:true` + `endAt>now`, latest wins). Computed `details[]`/`isNew`/`isPurchased`/`daysLeft`. The **per-request deep link** is supplied by a `buildShareLink(ebookId)` callback so the HTTP concern stays in the controller. `availablePromoCode` always `[]` (ebooks aren't in the promo `appliesTo` model).
- Wired **before** the ObjectId guards (a MySQL ebook/customer id is an int). C3: customerId resolved to int at the boundary.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-ebook-listing.ts` (run, passed, removed): 2 ebooks; single read + `isTrending=false`; listing with ebook 18 (2 plans) + 45 (3 plans), both `isPaid=true` (price-derived); `details[]` shape; `shareableLink` from the callback; ordered by `order_by` asc; purchase-state false for the expired sub (no active window → null endAt/daysLeft); language filter (Gujarati=2, English=0); name search. **ALL 19 CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — Course LISTING wired to MySQL (`catalog-course` extended) — first commerce-consuming endpoint composed + wired, flag OFF

**What:** Extended `catalog-course` so the course **listing** endpoints (`GET /client/courses`, `GET /client/courses/category/:id`) can serve from MySQL, and **wired** them behind `isCourseMysql()` (flag still OFF). This is the **first endpoint that actually consumes the commerce reads** — it composes three migrated modules: `catalog-course` (rows) + `commerce-price` (plans) + `commerce-subscription` (ownership). Motivated by an audit (`docs/migration/FLIP_SCOPE.md`) showing 40/41 client handlers were blocked on unmigrated collections; `listCoursesHandler` was the first fully-coverable one once commerce-price/-subscription existed.

### ⚠ SCHEMA CHANGE — surface ws_course enum flags
- `ws_course.is_featured` + `purchase` are MySQL `enum('0','1')` that existed in the DDL but were **absent from the Prisma `Course` model** (the old scope note said "SQL enums not surfaced"). The listing **filters on `isPopular`** and returns `isPaid`, so they're now required. Added a Prisma enum **`CourseFlag01 { no @map("0"), yes @map("1") }`** (Prisma identifiers can't start with a digit) and mapped `Course.purchase`/`is_featured` to it, plus `featured_order Int?`. Regenerated v5.22.0.
- Transformer mapping: **`isPopular = is_featured === '1'`** (Mongo default false); **`isPaid = purchase !== '0'`** — i.e. NULL/'1' → true (honouring the Mongo `default: true`), only explicit '0' → false. `isPopular` is now a real filterable SQL column. Non-breaking (only added nullable fields; grep-verified no other Prisma Course consumer).

### The composition (MySQL equivalent of Mongo `paginateCoursesWithPlans`)
- **`listCoursesWithPlans(opts)`** in the service: paginated active courses (isPopular filter + name/desc search + sort + category restriction), each enriched with active plans **split by material** (commerce-price `listActivePricesByCourses`) and per-customer **purchase state** (commerce-subscription).
- **`daysLeft` rule ported exactly:** longest-lived active sub for the course wins; a **lifetime grant (endAt null) beats any dated sub**; a sub matches by `courseId` OR via one of the course's `planId`s. Added `commerce-subscription.listActiveForCoursesOrPlans` (includes lifetime; the prior `listActiveByCustomer` used `endAt > now` which **excluded lifetime** — wrong for this path).
- **C3:** `customerId` resolved to int at the controller boundary (parsed defensively while OFF). **paymentStatus divergence:** the Mongo query filters `paymentStatus:"verified"`, but the SQL subscription table has no such column (it collapses into `status`) — so `status=true` is the entitlement gate (documented).
- Populated refs match Mongo `.populate()`: educator `{_id,name}`, subject/video-category `{_id,title}` replace the scalar id strings on list items.

### Wiring
- `listCoursesHandler` + `listCoursesByCategoryHandler` branch on `isCourseMysql()` **before** the Mongo ObjectId guards (a MySQL categoryId is an int). Same `{success, data, pagination}` contract. Flag OFF → Mongo path unchanged.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-course-listing.ts` (run, passed, removed): is_featured='1'→isPopular true, purchase='0'→isPaid false; `{data,pagination}` + totalPages; course 75's 5 plans all land in `withoutMaterial`; educator/subject refs are `{_id,name}`/`{_id,title}`; isPurchased false (no sub) with + without a customer; `isPopular` filter includes/excludes correctly; name search hits. **ALL 17 CHECKS PASSED.** `tsc` clean repo-wide. (daysLeft/lifetime logic is a faithful port of the verified Mongo logic — not exercisable on staging, which has no course subs.)

---

## 2026-06-12 — Commerce · Educator READ built (`commerce-educator`) — Phase 3a, flag OFF — **3a READS COMPLETE**

**Module:** Phase 3a module 6 (C1 order) and the **FINAL 3a read module**. Table `ws_course_educator` (56 rows) — a **full entity** (email/password/about/view/last_seen_at), NOT a join table (it was mis-grouped as a "catalog relation" earlier). Built **READ-ONLY** dual-path (`src/modules/commerce-educator/`), **flag OFF**, as the public educator master + a lightweight `{_id,name,image}` ref for embedding in course listings.

### Security + drift
- **`password` is NEVER surfaced** — the client educator path does `.select('-password')`. The DTO excludes it; the ref projection is `{_id,name,image}` only. Verified by explicit test assertions on the single, list, and ref read shapes.
- **⚠ LATENT RISK (logged, deliberately NOT fixed):** `id` is **`bigint unsigned`** but the Prisma model maps it as **`Int`**. Current ids are **20–85** (56 rows) → no overflow. Changing to `BigInt` would ripple into the `Course.courseEducatorId` FK and the already-built/verified `catalog-course` module for **zero present benefit** — revisit (educator + Course FK together) only if ids ever approach 2³¹. (Contrast the subscription `tracking` bigint, which DID overflow and HAD to be fixed.)
- **`image`** nullable in the DDL but Prisma non-nullable `String` → DTO surfaces `image: string | null` defensively (no NULLs in data; Mongo marks `image` required so real embeds always have it). **No SQL `deleted` flag** (the Mongo soft-delete has no SQL counterpart) → active = `status = true` is the sole visibility gate. `last_seen_at`/`email_verified_at` omitted (not needed for the public master). No schema change this module.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-commerce-educator.ts` (run, passed, removed): 56 rows; `password` absent from single/list/ref DTOs; `view` numeric; `listActive` returns only `status=true`, name-ordered; ref projection is exactly `{_id,name,image}`; `findByIds` bulk + empty guard. **ALL CHECKS PASSED.** Module `tsc` clean repo-wide.

### Reads exposed
`findById` / `findActiveById` / `findByIds` (bulk course-educator hydration) / `listActive` (name search) / `findRefById` (`{_id,name,image}` embed).

### ✅ PHASE 3a READS COMPLETE
All six 3a read modules are built + verified, flag OFF: `commerce-price`, `commerce-subscription`, `commerce-ebook-sub`, `commerce-promoter`, `commerce-promocode`, `commerce-educator`. **Next: THE FLIP** — turn 3a + catalog (4 keys) + customer-address/profile/bank ON together (one consistent int id-space; first go-live since the customer module), plus the D2 catalog relations. Then **3b** (write-path, Razorpay, isolated, last).

---

## 2026-06-12 — Commerce · Promoter + Promocode READ built (`commerce-promoter`, `commerce-promocode`) — Phase 3a, flag OFF

**Modules:** Phase 3a modules 4 & 5 (C1 order — the promocode group). `commerce-promoter` (`ws_promoter`, 114 — the promocode owner master) + `commerce-promocode` (`ws_promocode`, 2 + `ws_promoted_package_course_ebook`, 5). Both **READ-ONLY** dual-path, **flag OFF**.

### ⚠ DECISION — promocode is SQL-faithful, NOT the client appliesTo contract
- The live Mongo `PromoCode` model (collection `ws_promo_codes`) uses a **newer discount mechanism**: `discountType` (flat|percentage) + `discountValue` + `appliesTo: {type: package|course|liveCourse, ids[]}`. The client `applyPromocode`/`listPromocodes` paths read **that** shape (via `promoCovers`/`computePromoDiscount`).
- The SQL tables have **none** of those fields — the discount is a **per-plan** `promoter_percentage` + `customer_percentage` split in `ws_promoted_package_course_ebook` (keyed by `pcb_price_id` = the plan). So the **client promocode contract CANNOT be reproduced from SQL**. **Decision (user-confirmed 2026-06-12):** build **SQL-faithful reads only**, flag OFF (same pattern as catalog-package); the `appliesTo` reconciliation is a separate, later effort.

### Schema fixes (nullable drift — DDL vs Prisma)
- **Promoter:** `full_name`/`email`/`phone` are nullable in the DDL but Prisma typed them non-nullable `String` → relaxed to `String?` (no NULLs in current data; guards a future NULL).
- **Promocode:** `promocode`/`promo_start_at`/`promo_expire_at` nullable in the DDL but Prisma non-nullable → relaxed to optional. (`title`/`description` are NOT NULL in DDL but Prisma optional — safe direction.) Regenerated client v5.22.0; non-breaking (no other code reads these Prisma models — grep-verified).

### Read semantics + security
- **Promoter:** `password` exists on the row (full entity, like `ws_course_educator`) but is **NEVER surfaced** in the DTO (Mongo marks it `select:false`). camelCase mapping (`full_name`→`fullName`, `is_delete`→`isDelete`). Active = `status=true AND is_delete=false`.
- **Promocode:** valid = `status=true AND promo_start_at < now < promo_expire_at`; public listings add `type='public'`, soonest-to-expire first; code lookup uppercases (Mongo parity). Promoted-plan rows (per-plan %) included on single-promocode reads. Owner `0` sentinel → null.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-promocode-group.ts` (run, passed, removed): promoter 114 rows, `password` absent from DTO, camelCase + active filter; promocode 2 + promoted 5, `POLICE60` resolves its 5 promoted plans with correct per-plan %, case-insensitive window-bounded `findValidByCode` (in-window match / out-window null), `listActivePublic` + `countActivePublic` agree. **ALL CHECKS PASSED.** Modules `tsc` clean repo-wide.

### Reads exposed
- **promoter:** `findById` / `findActiveById` / `findByIds` (bulk owner hydration) / `listActive` (name+email search).
- **promocode:** `findById` (w/ plans) / `findValidByCode` / `listActivePublic` + `countActivePublic` (paginated) / `listPromotedPlans`.

---

## 2026-06-12 — Commerce · eBook Subscription READ built (`commerce-ebook-sub`) — Phase 3a, flag OFF + **Prisma schema fix (missing cols)**

**Module:** Phase 3a module 3 (C1 order). Table `ws_ebook_subscription` (1 row) — the **ebook entitlement source of truth** (a customer can download/read an ebook iff an active, unexpired row exists). Built **READ-ONLY** dual-path (`src/modules/commerce-ebook-sub/`). **Writes (create on payment) are Phase 3b.** **Flag NOT enabled** — flips with catalog + the rest of 3a (joined on int catalog ebook + int customer id-space).

### ⚠ SCHEMA CHANGE — Prisma model was missing the entitlement flag
- The DDL has **`status`** (tinyint, the active-entitlement flag) + **`payment_type`** (enum), both **ABSENT from the Prisma `EBookSubscription` model**. The read contract is impossible without `status`. **Added** `status Boolean?` + `payment_type PackageCourseEbookPaymentType` (reused the existing enum).
- **`start_at`/`end_at` nullable:** DDL marks both `Null: YES`; Prisma typed them non-nullable `DateTime`. **Relaxed** to `DateTime?` so a NULL-dated row can't crash a read (the single staging row has both set). Regenerated client v5.22.0. No existing code reads these Prisma fields (grep-verified), so non-breaking; `tsc` clean repo-wide.

### Read semantics
- **Active = `status ≠ false` AND `end_at > now`**, latest `endAt` wins. `status` is nullable (default 1) → NULL treated as **active** (matches column default + Mongo default); the repository active filters use `status: {not: false}` to stay consistent with the transformer's NULL→true coercion.
- `price` Decimal → number. Owner `0` sentinel → null. **C3:** `customer_id` is **int** (same as package subscription) → module takes/returns int `customerId`.
- Mongo-only promo fields (`promocodeId`/`promoterId`/`referrerId`) are NOT columns here (order row / 3b) → not produced.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-commerce-ebook-sub.ts` (run, passed, removed): read did not throw (status/payment_type/nullable dates resolve); `status` + `payment_type` surface; price Decimal→number; active check true before `endAt` / false after; `findByOrderId`; `listByCustomer` scoping; `countActiveByEbook`. **ALL CHECKS PASSED.** Module `tsc` clean.

### Reads exposed
`hasActiveEbookSubscription` + `getActive…` (access gate) · `findById` · `findByOrderId` · `list{,Active}EbookSubscriptionsByCustomer` · `countActiveByEbook` — mirror `findOne({customerId, ebookId, status:true, endAt:{$gt:now}})`.

---

## 2026-06-12 — Commerce · Subscription READ built (`commerce-subscription`) — Phase 3a, flag OFF + **Prisma schema fix (bigint)**

**Module:** Phase 3a module 2 (C1 order). Table `ws_package_course_subscription` (2 rows) — the **entitlement source of truth** (a customer owns a course/package iff an active, unexpired row exists). Built **READ-ONLY** dual-path (`src/modules/commerce-subscription/`). **Writes (create/extend on payment) are Phase 3b** (verify.controller / webhook) — NOT in this module. **Flag NOT enabled** — flips with catalog + the rest of 3a (rows are joined on the int catalog + int customer id-space and read by still-Mongo consumers).

### ⚠ SCHEMA CHANGE — `tracking` Int → BigInt (would otherwise THROW on read)
- The SQL `tracking` column is **`bigint`**; both staging rows hold ~**1.19e11** (`119400642963`, `119400280393`), which **overflow Int32**. The Prisma model mapped it as `trackingId Int?` → **a plain read would throw** `Value out of range`. Confirmed via `MAX(tracking) > 2147483647 = 1`.
- **Fix:** `PackageCourseSubscription.trackingId Int? → BigInt?` and the referenced `PackageCourseSubscriptionTracking.id Int → BigInt` (the FK target; its own `id` is `bigint` with values ~1.19e11). Regenerated client v5.22.0. The transformer coerces `bigint → number` (lossless — below `Number.MAX_SAFE_INTEGER` ~9e15; null-guards the >2^53 case). No existing code reads these Prisma fields (verified by grep — all `trackingId` usages are Mongo/courier), so the change is non-breaking; `tsc` clean repo-wide (only pre-existing unrelated errors).
- `PackageCourseSubscriptionTracking` itself (the tracking table) is a **3b write-path** entity — only its PK type was corrected here so the schema validates and the back-relation compiles; no module built for it.

### Mongo↔SQL field-NAME divergence (handled in the transformer)
- Mongo `packageId` = the **PLAN** ref (PackageCourseEbookPrice) = SQL **`pcb_id`** (`planId`). Mongo `targetPackageId` = the **actual package** = SQL **`package_id`** (`packageId`). The DTO uses the **Mongo names** so consumer predicates port 1:1.
- **C3 seam:** `customer_id` is **`int`** here (not varchar like the order tables). In the migrated id-space the customer IS the int id (per customer-auth), so the module takes/returns `customerId` as an **int**; string→int resolution is the caller's boundary. Matches the C3 recommended default.
- Mongo-only commerce/promo fields (`promocodeId`, `promoterId`, `paidAmount`, `paymentStatus`, `razorpay*`, …) are NOT columns on this table (order row / 3b) → not produced. Owner `0` sentinel → null (same as commerce-price). Active entitlement = `status = true AND end_at > now`.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-commerce-subscription.ts` (run, passed, removed): read did **not throw** on bigint tracking; `tracking` coerced lossless to a safe integer; SQL `package_id`→`targetPackageId` + `pcb_id`→`packageId` mapping; active check true before `endAt` / false after; `listByCustomer` scoping; `countActiveByPackage`. **ALL CHECKS PASSED.** Module `tsc` clean.

### Reads exposed
`hasActive{Course,Package}Subscription` + `getActive…` (access gates) · `findById` · `list{,Active}SubscriptionsByCustomer` · `countActiveBy{Package,Course}` — mirror the dominant Mongo entitlement predicates (`findOne({customerId, courseId|packageId, status:true, endAt:{$gt:now}})`).

---

## 2026-06-12 — Commerce · Price built (`commerce-price`) — Phase 3a, flag OFF

**Module:** First commerce-wave module (Phase 3a, sub-order C1 = price first, lowest risk). Table `ws_package_course_ebook_price` (1353 rows) — pure read-only plan/pricing lookup, no writes, no auth fields. Built dual-path (`src/modules/commerce-price/`: repository + service + transformer + types). **Flag NOT enabled** — flips together with catalog + the rest of 3a in one consistent int id-space (every price consumer joins int-id catalog rows + ObjectId-id subscription/order rows). Confirmed C1–C4 recommended defaults.

### Schema state — `PackageCourseEbookPrice` CLEAN (no Prisma change)
- Prisma model is a FAITHFUL 1:1 of the live DDL (all 13 cols, correct `@map`s). `DESCRIBE` vs model matched exactly — **no schema fix required** (unlike Package/Course nullable fixes).

### DRIFT found + handled (caught by the tsx verify script, not assumed)
1. **Owner-id `0` sentinel:** `package_id` / `course_id` / `ebook_id` use **`0`** (NOT only `NULL`) as the "not this owner" marker — 927/1353 rows mix `0`s with one real id. The transformer coalesces `0`/null → `null` to match Mongo's `null` representation. Verified the `> 0` invariant holds: **no row owns more than one entity** (`(pkg>0)+(course>0)+(ebook>0) ≤ 1` for all rows). Repository owner sampling/filters use `> 0`, not `IS NOT NULL`.
2. **`duration` is DAYS, not months** (memory `project_plan_duration_unit`): confirmed live — the `"12 Month"` plan row carries `duration: 365`. Surfaced raw by this read-only lookup; `endAt` computation (planDuration `asDays`/`setDate`) is the Phase 3b write boundary's concern.
3. **`material_price` null → 0:** nullable in SQL but defaults to `0` in the Mongo model; transformer coalesces.

### Verification (flag OFF → live-DB tsx, not HTTP)
- `scripts/_tmp/verify-commerce-price.ts` (run, passed, removed): 1353 rows; findById/findByIds round-trip + transform; owner `0`→null; exactly-one-owner; material_price null→0; per-owner active lists ordered by `duration` asc. **ALL CHECKS PASSED.** `tsc --noEmit` clean for the module (only pre-existing errors elsewhere).

### Reads exposed
`findById` / `findActiveById` / `findByIds` + `listActiveBy{Package,Course,Ebook}` and `…ByPackages/ByCourses` — all active-only owner lists ordered by `duration` asc (mirrors the Mongo `.sort({duration:1})` plan listings).

---

## 2026-06-11 — Commerce/Dashboard wave SCOPED (no code yet) — [`migration/COMMERCE_WAVE_SCOPE.md`](./migration/COMMERCE_WAVE_SCOPE.md)

**Decision:** the next wave is commerce/dashboard (chosen over migrating D2 catalog relations standalone — D2 is keyed entirely on the still-OFF int catalog id-space, unblocks nothing, ~12k churny rows for zero activation). Commerce is what catalog is *waiting on* (catalog detail/listing join pricing + check subscriptions), so it's the real unblock.

**Recommended sequencing — read-first, NOT one big flip:**
- **3a (read, flag OFF, unblocks catalog):** `commerce-price` (`ws_package_course_ebook_price`, 1353), `commerce-subscription` read (`ws_package_course_subscription`, 2), `commerce-ebook-sub` read (`ws_ebook_subscription`, 1), `commerce-promoter` (`ws_promoter`, 114), `commerce-promocode` (`ws_promocode` 2 + `ws_promoted_package_course_ebook` 5), `commerce-educator` (`ws_course_educator`, 56 — a full entity, not a join table).
- **3a + D2 folded in:** `ws_package_specific_subject` (1623), `ws_video_category_relation` (2456), `ws_video_category_package_relation` (6907), `ws_package_course_material` (1) — ride the catalog flip.
- **Flip 3a + catalog + address/profile/bank together** (one consistent int id-space — first go-live since the customer module).
- **3b (write-path, DANGEROUS, isolated, last):** `commerce-order` (`ws_package_course_order`) + subscription writes + `_tracking` + `commerce-ebook-order` — driven by `verify.controller.ts` (569 lines, Razorpay).

**Schema-drift flags spotted from `DESCRIBE` BEFORE coding:**
1. `customer_id` is **`varchar(255)`** in `ws_package_course_order` + `ws_ebook_order` (Mongo ObjectId-as-string), but **`int`** in `ws_package_course_subscription` — one wave carries both id representations; the order→subscription seam must be handled deliberately (C3).
2. Reserved-word columns needing Prisma `@map`: `ws_package_course_subscription_tracking.order`, `ws_video_category_relation.order`.
3. `price.duration` = **DAYS** (memory `project_plan_duration_unit`) → planDuration helper, `setDate` not `setMonth`.
4. `ws_course_educator` is a full entity (email/password/about/view/last_seen) — mis-grouped as a "relation" earlier; read-only in 3a.

**Open decisions (C1–C4) listed in the scope doc** — confirm 3a sub-order (price first), D2 timing (fold in), the customer_id seam, and 3b isolation before any code.

---

## 2026-06-11 — Catalog · Video built (`catalog-video`) — flag OFF + URL-contract parity PASS

**Module:** Catalog sub-module 3 of 3. Tables `ws_video` (156) + `ws_video_category` (157). M:N relation tables `ws_video_category_relation` (2456) + `ws_video_category_package_relation` (6907) **DEFERRED** (D2). See [`migration/CATALOG_MODULE_SCOPE.md`](./migration/CATALOG_MODULE_SCOPE.md). **Flag NOT enabled.**

### Schema state — `Video` CLEAN (no Prisma change)
- `Video` model matches the live DDL exactly (`platform, vimeo_id?, aws_id?, youtube_id?, slug, topic, order_by→order, type→priceType enum, status`). No drift, no schema edit, no regen needed.
- Minor: `ws_video_category` DDL has `parent`/`educator_id`/`pdf` cols the Prisma `VideoCategory` omits — read-safe (not selected). Mongo-only `courseId`/`liveCourseId`/`childCategoryIds`/`liveSessionId` are absent from `ws_video_category` (used by lecture course-membership + catalog browse) — a reason video stays OFF.

### D2 decision — DEFER the relation tables
The migrated client surface builds video-category groups from the Mongo `Package.specificSubjects[]` array + `VideoCategory.childCategoryIds` (catalog.controller.ts:74,120), NOT from the SQL `ws_video_category_relation` / `_package_relation` join tables (a legacy/admin representation). No enabled client path reads them ⇒ defer to the commerce/browse wave. Their Prisma models already exist, so no work is wasted.

### THE VIDEO-URL ENCRYPTION CONTRACT — parity PASS ✅
- Encryption (`utils/videoEncryption` via `encryptVideoSource`) is deterministic given (token, sourceId); sourceId is picked by `platform` from {youtube_id, aws_id, vimeo_id}. Token is random per request → URL is per-request, parity is per-(token, sourceId).
- The Prisma `Video` fields have the SAME names as the Mongo model, so a MySQL-sourced object fed into the SAME util yields an identical URL for a fixed token — **parity by construction**.
- **Verified (fixed token 1234567890123456, video 33089, aws):** MySQL `videoURL` === Mongo-shaped `videoURL` (`Ocgw9A2BWEoSRocWQ0tryTl76PeR9YFx9xCE57gp0fs=`), and `decrypt(videoURL) === aws_id`. Round-trip confirmed.
- **NEVER reimplement encryption** — the module exposes `getVideoEncryptInput()` / `toVideoEncryptInput()` returning the exact object the shared util consumes. `toVideoEncryptInput` coerces ""/null platform ids to undefined (live data stores "" for unused platform columns).

### New module (`src/modules/catalog-video/`)
- `repository.ts`: `findVideoById`, `listActiveVideosByCategory`, `countActiveVideosByCategory`; `findCategoryById`, `listActiveCategories`.
- `transformer.ts`: `toVideoDto`, `toVideoEncryptInput` (the URL contract), `toVideoCategoryDto`.
- `service.ts`: dual-path reads + `getVideoEncryptInput`; key `catalog-video`.
- `types.ts`: DTOs + `VideoEncryptInput` + the full contract/scope note.

### NOT done — flag stays OFF ⚠️
- Video/category ids int (MySQL) vs ObjectId (Mongo); still-Mongo consumers (lecture, free, dashboard resume, progress, catalog browse) join those ids. lecture course-membership needs `VideoCategory.courseId` (Mongo-only); paid access checks PackageCourseSubscription (commerce-wave). No controller wired (no safe standalone video-URL endpoint). ⇒ `catalog-video` flips **with** the commerce/dashboard wave (D3).

### Verification (live DB, tsx)
- 152 active categories; 5 active videos in category 3105 (list + count agree); URL-contract parity PASS (above). Temp script removed.

### Index/migration
- None. Reads only; no new indexes; no live DDL change; no Prisma change.

---

## 2026-06-11 — Catalog · Course built (`catalog-course`) — flag OFF

**Module:** Catalog sub-module 2 of 3. Tables `ws_course` (1 row) + `ws_course_subject_category` (1 row). See [`migration/CATALOG_MODULE_SCOPE.md`](./migration/CATALOG_MODULE_SCOPE.md). **Flag NOT enabled** (same id-coupling + commerce-join reasons as package).

### Prisma schema (drift fix) ⚠️
- `Course.image`: `String` → `String?` — the live `ws_course.image` DDL is **nullable** but Prisma declared it NOT NULL. Regenerated client v5.22.0. No live DDL change.

### Schema-drift notes (verified vs live `DESCRIBE`)
- `ws_course` nullable cols: `image`, `name`, `vcategory_id`, `pc_material_id`, `featured_order`.
- `ws_course` cols with NO Prisma mapping: `is_featured` (enum '0'/'1'), `purchase` (enum '0'/'1'), `featured_order` (int). The Mongo `Course` carries conceptual equivalents `isPopular`/`isPaid` (booleans) + Mongo-only `subtitle` and embedded `materialCategories[]`/`examCategories[]`. The SQL enums are not surfaced (no consumer reads them off the migrated row).
- `course_category_id` → `CourseSubjectCategory` (Prisma `courseSubjectCategoryId`); confirmed by data (course 75 → category 774).

### New module (`src/modules/catalog-course/`)
- `repository.ts`: `listActiveCategories`, `countActiveCoursesByCategory` (Prisma `groupBy`); `findCourseById`, `listActiveCourses` (name/desc search), `listActiveCoursesByCategory`.
- `transformer.ts`: `toCourseCategoryDto`/`…WithCountDto`, `toCourseDto` (only physically-present cols).
- `service.ts`: dual-path `listCourseCategoriesWithCounts` + course reads; key `catalog-course`.
- `types.ts`: DTOs + scope/drift note.

### App wiring
- `src/client/course/course.controller.ts` `listCourseCategoriesHandler` branches on `isCourseMysql()`. Listing/detail endpoints stay Mongo (they join PackageCourseEbookPrice plans + PackageCourseSubscription ownership and embed Mongo-only category groups).

### NOT done — flag stays OFF (same as package) ⚠️
- Course / subject-category ids are **int** (MySQL) vs **ObjectId** (Mongo); still-Mongo listing/detail/dashboard consumers join those ids. And listing endpoints need commerce-wave joins + Mongo-only fields. ⇒ `catalog-course` flips **together with** the commerce/dashboard wave (D3).

### Verification (live DB, tsx)
- `listCourseCategoriesWithCounts` → 1 category, `courseCount:1` (groupBy correct). `listActiveCourses`/`findCourseById(75)`/`listActiveCoursesByCategory(774)` → 1 row each, nullable `image`/`pcMaterialId` handled. Temp script removed.

### Index/migration
- None. Reads only; no new indexes; no live DDL change.

---

## 2026-06-11 — Catalog · Package built (`catalog-package-type` + `catalog-package`) — flags OFF

**Module:** Catalog sub-module 1 of 3 (`package → course → video`, D1). Tables `ws_package_type` (6 rows) + `ws_package` (4 rows). See [`migration/CATALOG_MODULE_SCOPE.md`](./migration/CATALOG_MODULE_SCOPE.md). **Both flags NOT enabled** (id-space coupling — see below).

### Prisma schema (drift fix) ⚠️
- `Package.shareable_link`: `String` → `String?` — the live `ws_package` DDL has `shareable_link` **nullable**, but the Prisma model declared it NOT NULL (would throw on a NULL row). Regenerated client v5.22.0. (All 4 current rows are non-null, but the type now matches the DDL.)
- No DDL change to the live DB.

### Schema-drift notes (verified vs live `DESCRIBE`)
- `ws_package_type` has ONLY `{id, name, created_at, updated_at}` — the Mongo `PackageType` additionally carries `order` + `active` which `listPackageTypes` filters/sorts on. MySQL branch synthesizes `order:0` + `active:true` to keep the response JSON shape identical.
- `ws_package.educator_id` exists in the DDL but is **absent from the Prisma `Package` model** (and NULL for all 4 rows) → transformer surfaces `educatorId: null`. Add to the Prisma model + regen if a consumer ever needs it.
- `ws_package` is a STRUCTURAL SUBSET of Mongo `ws_packages`: the SQL table lacks `subtitle, isPaid, isSmart/PlannerCourse, goalId, goalLabelId, examCountdown*, packageCategoryId, specificSubjects[], materialCategories[], examCategories[], withMaterialText/withoutMaterialText`. Every client package endpoint also joins commerce-wave tables (PackageCourseEbookPrice plans, PackageCourseSubscription ownership, PromoCode, PackageChat). ⇒ the full `/client/packages` contract CANNOT be reproduced from `ws_package` alone this wave.

### New module (`src/modules/catalog-package/`)
- `repository.ts`: `listPackageTypes`; `findPackageById`, `listActivePackages`, `listActivePackagesByType` (all `active:true`, ordered `order_by` then id).
- `transformer.ts`: `toPackageTypeDto` (synthesized order/active), `toPackageDto` (only physically-present columns; `educatorId:null`).
- `service.ts`: dual-path; two keys — `catalog-package-type` (Phase A) + `catalog-package` (Phase B).
- `types.ts`: DTOs + the full scope/drift note.

### App wiring
- `src/client/package/package.controller.ts` `listPackageTypes` branches on `isPackageTypeMysql()` (`catalog-package-type`). All other package endpoints stay Mongo (they need commerce joins + Mongo-only fields).

### NOT done — both flags stay OFF (audit finding) ⚠️
- **`ws_package_type` id-space coupling.** Type ids are **int** in MySQL but **ObjectId** in Mongo. Still-Mongo consumers join package-type ids: `purchase-history.controller.ts:89`, `my-subscriptions.controller.ts:108`, `dashboard.controller.ts:146`, package detail/list, `categories`, `free`, + admin package CRUD (`deletePackageType`). Flipping `listPackageTypes` to MySQL alone would return int ids from `/packages/types` while every other surface returns ObjectId package-type ids → inconsistent id space → broken FE. So `catalog-package-type` flips **together with** `catalog-package` and the commerce/dashboard wave (mirrors the address/profile/bank deferral, D3).

### Verification (live DB, tsx)
- Phase A: `listPackageTypes` → 6 rows, correct synthesized shape.
- Phase B: `listActivePackages` → 4 rows (incl. empty-string & NULL-tolerant `shareable_link`), ordered `order_by` (-8,1,11,14); `findPackageById(91)` full DTO; `listActivePackagesByType(1)` → 4. Temp script removed.

### Index/migration
- None. Reads only; no new indexes; no live DDL change.

---

## 2026-06-10 — `offline-city` migrated (DDL change) + cart resolution

**Module:** `offline-city` (cities only, to unblock `customer-address`) — see [`migration/OFFLINE_MODULE_SCOPE.md`](./migration/OFFLINE_MODULE_SCOPE.md). **Enabled** in `MIGRATION_MYSQL_MODULES`.

### DDL change (live DB) ⚠️
```sql
ALTER TABLE ws_offline_city
  ADD COLUMN status TINYINT(1) NOT NULL DEFAULT 1 AFTER image,
  ADD COLUMN `order` INT NOT NULL DEFAULT 0 AFTER status;
```
Reason (decision D1): Mongo `OfflineCity` has `status`/`order` (active-gating + manual ordering) but the legacy dump's `ws_offline_city` had neither. Added them to preserve behavior. Existing rows default to `status=1, order=0`.

### Prisma schema
- `OfflineCity`: added `status Boolean @default(true)` + `order Int @default(0) @map("order")`. Regenerated client v5.22.0.

### New module (`src/modules/offline-city/`)
- `repository.ts`: `listActive` (status=true, order then name), `findById`, `findNameById`.
- `transformer.ts`: row→DTO (string ids), `toCityNameDto`.
- `service.ts`: dual-path `listActiveCities` + `resolveCityName` (cart cityId→name).

### App wiring
- `src/client/address/address.controller.ts` `listCities` branches on `isOfflineCityMysql()`.
- `src/client/cart/cart.controller.ts` `attachShippingToCart` cityId→name resolution branches on the flag.

### NOT done (blocker for address flip)
- Cart (`cart.controller.ts:177`) + course-order (`course.service.ts:306`) still **read** `CustomerAddress` via Mongoose (ObjectId). `customer-address` stays OFF until those reads are branched — else enabling it breaks checkout.

### Verification (live DB)
- 2 cities, correct order/status. End-to-end: MySQL address `cityId=2` → `"Ahmedabad"` via the cart resolution path. Repo test rows cleaned up.

### Index/migration
- DDL: 2 columns added to `ws_offline_city` (additive, defaults). No new indexes.

---

## 2026-06-10 — Customer Module: `customer-bank-account` built + shipping assessed (flags OFF)

**Module:** `customer-bank-account` (Customer Module step 4) — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md) §7. **Flag NOT enabled** (referral withdrawal flow + reward-points transaction are Mongo-coupled).

### New module (`src/modules/customer-bank-account/`)
- `repository.ts` Prisma CRUD on `ws_customer_bank_account`: `listByCustomer`, `findOwned`, `create`, `updateOwned`, `deleteOwned` (hard delete = Mongo `findOneAndDelete` parity). Owner-scoped on `customer_id`.
- `transformer.ts` row→DTO (string ids, Mongo `_id`-shape compatible).
- `service.ts` dual-path via `isMysqlModule("customer-bank-account")`.

### App wiring
- `src/client/referral/referral.controller.ts`: 4 CRUD handlers (`listBankAccounts`, `createBankAccount`, `updateBankAccount`, `deleteBankAccount`) branch on `isBankAccountMysql()`. MySQL path uses integer ids; IFSC lookup (bank/branch/city) stays server-side in the controller.
- `requestWithdrawal` left on Mongo (embedded `bankAccount.toObject()` + reward-points txn) — branching it would create a mixed-backend transaction.

### Schema note
- Live `ws_customer_bank_account` has all columns the Prisma model declares (incl. `bank_name`/`branch_name`/`city`) — no phantom-column mismatch. No schema change needed.

### Shipping assessment
- `CustomerShipping` has **no standalone CRUD** — it's an internal checkout snapshot created/read inside cart + course-order flows and embedded into orders/subscriptions. Not migratable as part of the Customer Module; migrates with cart/orders. Prisma `CustomerShipping` (BigInt phones) already in place for that future work.

### Verification (live DB, customer 472347)
- Bank CRUD: create→list→update→delete cycle, owner-scoped, test row removed (DB clean).

### Index/migration
- No new indexes. No DDL.

---

## 2026-06-10 — Customer Module: `customer-profile` built (flag OFF)

**Module:** `customer-profile` (Customer Module step 3) — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md) §4. **Flag intentionally NOT enabled** (profile dashboard aggregates not-yet-migrated collections → stays on Mongo).

### Prisma schema
- Added `facebookId String? @default("0") @map("facebook_id") @db.VarChar(255)` to `Customer`. Read-only (no FB write path). Regenerated client v5.22.0.

### New module (`src/modules/customer-profile/`)
- `name.ts` — `full_name` ↔ first/middle/last split (read) / join (write) helpers.
- `repository.ts` — Prisma on `ws_customer`: `findActiveById`/`findLiveById`, `emailTakenByOther`, `hydrateGoals` (JSON int ids → ws_customer_target_goal, order preserved), `updateById`, `softDelete`, `setProfilePicture`, single-token device `setDeviceToken`/`clearDeviceToken`/`setDeviceTokenByPhone`.
- `transformer.ts` — row + goals → ProfileDto; `deriveProfileCompleted` (full_name present, not stored).
- `service.ts` — 9 fns, `{ ok, message, data }` envelope.

### App wiring
- `src/client/profile/customer.service.ts`: all 8 exported fns branch on `isProfileMysql()` → delegate to the module. Get/update keep the existing Redis profile cache (read-through + invalidate); picture upsert/delete keep S3 cleanup via the service's returned `previousUrl`; delete-account revokes MySQL `ws_customer_access_token` rows via `customerAuthRepository.deactivateTokens` + clears session cache.
- `dashboard.controller.ts` left on Mongo (cross-module aggregation) — untouched.

### Decisions encoded
- name: split full_name (join on write); device: single `device` token (newest wins, legacy parity); isProfileCompleted: derived; facebookId: read-only.

### Verification (live DB, customer 472347)
- `"DIXIT PATEL"` → `["DIXIT","","PATEL"]`; goals `[7,8,12,13,14]` → named DTOs in order; `isProfileCompleted=true`; `isNewUser=false`; facebook_id not leaked. Update name-join + goals rewrite, then restored (DB clean). Name split/join edge cases (1–4 tokens, empty, partial) verified.

### Index/migration
- No new indexes. One additive Prisma field map (`facebook_id`, column already exists). No DDL.

---

## 2026-06-10 — Customer Module: `customer-address` built (flag OFF)

**Module:** `customer-address` (Customer Module step 2) — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md) §3. **Flag intentionally NOT enabled** (runtime stays on Mongo until OfflineCity + cart checkout migrate).

### New module (`src/modules/customer-address/`)
- `repository.ts` Prisma CRUD on `ws_customer_address`: `listByCustomer`, `findOwned`, `create`, `updateOwned`, `softDeleteOwned`, `setDefault` (transaction). String→BigInt phone + string→Int pincode conversions; all queries owner-scoped on `user_id`.
- `transformer.ts` row→DTO: BigInt phones + int FKs → strings (Mongo `_id`-shape compatible); no nested populate.
- `service.ts` dual-path via `isMysqlModule("customer-address")`; uniform `{ ok, status, data|message }`.

### App wiring
- `src/client/address/address.controller.ts`: all 6 handlers (`getMyAddresses`, `getAddressById`, `createAddress`, `updateAddress`, `setDefaultAddress`, `deleteAddress`) branch on `isAddressMysql()`. MySQL path uses **integer** ids (bypasses Mongo ObjectId-regex validation).
- `src/client/address/address.validation.ts`: added `createAddressSchemaMysql` / `updateAddressSchemaMysql` — numeric FK ids, freeform `label`, **required `city`** string.

### Data note (caught by live-DB test)
- `ws_customer_address.city` is **NOT NULL** and is what legacy rows actually populate (`city_id` is NULL in the dump). Added `city` to input/DTO/validation accordingly.

### Verification (live DB)
- Full create→list→setDefault→update→soft-delete cycle for customer 472341; BigInt phone `9664796376` round-trips; test row removed (DB clean).

### Index/migration
- No new indexes. No DDL. Reads/writes existing `ws_customer_address` only.

---

## 2026-06-10 — Customer Module: schema fixes + `customer-lookups` enabled

**Module:** `customer-lookups` (Customer Module, step 1 of remaining migration — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md))

### Prisma schema (`prisma/schema.prisma`)
- `model CustomerAddress`: `phone` and `alternate_phone` changed `Int`/`Int?` → **`BigInt`/`BigInt?`**.
  Reason: 10-digit phone numbers (e.g. `8160530058`, `9664796376`) overflow `Int` (max 2,147,483,647) and fail to read.
- `model CustomerAddress`: kept `label String?`, `isDefault Boolean? @default(false) @map("is_default")`, `cityId Int? @map("city_id")`.
  Reason: live DB (`DESCRIBE ws_customer_address`) **has** these columns even though the legacy `websankul_staging.sql` dump does not — decision **"keep columns to match DB"** so default-address/label/city migrate without loss.
- `model CustomerShipping`: `phone`/`alternate_phone` changed `Int` → **`BigInt`** (same overflow fix).
- Ran `prisma generate` (v5.22.0); generated client verified against live DB.

### App wiring (`src/client/address/address.controller.ts`)
- `getStates`, `getEducations`, `getCharacteristic` (educations only) now branch on
  `isMysqlModule("customer-lookups")` → call `customer-lookups.service` (Prisma) when on, else Mongoose.
  DTOs projected to the exact existing Mongo contract (`{_id,name,stateCode}` / `{_id,name}`).
  Goal (rich onboarding collection) stays on Mongo.

### Env
- `MIGRATION_MYSQL_MODULES` += `customer-lookups` in `.env` and `.env.example`.

### Verification (live DB `127.0.0.1:3307/websankul_staging`)
- States: 12 active, correct shape. Educations: 10 active, correct shape.
- BigInt phone `8160530058` reads cleanly (would have overflowed old `Int`).
- `label`/`isDefault` columns read without error.

### Index/migration
- No new indexes. No destructive DDL. Live DB already had BigInt phone columns + the 3 extra columns (changed externally before this session).
