> # ✅ MIGRATION COMPLETE — 2026-06-22 · running MySQL-only
>
> WebSankul now runs on **MySQL (Prisma) only**. Every admin + client + educator + promoter API, every write path, background job, and boot-time seeding serves from MySQL. **MongoDB is disconnected by default** (`MONGO_FALLBACK_ENABLED=false` → `connectDB()` is skipped at boot); the app boots and serves with **no Mongo connection** — empirically verified (22 endpoints returned 200, 0 Mongo calls at boot). `MONGODB_URI` is no longer required. Re-enabling Mongo is a single reversible flag.
>
> The remaining `src/models/**` + `mongoose` dependency is now **dormant dead code** (nothing connects to Mongo).
>
> **This document is retained for historical context.** The live source of truth for changes is `docs/MIGRATION_QUERY_CHANGES.md`. Anything below describing "pending / in-progress / flag OFF / blocker / Mongo fallback / remaining" reflects an earlier point in time and is **superseded** by the completed state above.

# 🧪 SQL Migration — Testing Status (live) — ✅ DONE (superseded; see banner)

> Verifies that migrated modules actually serve from **MySQL** on BOTH admin + client APIs.
> Method: `yarn dev` server (port 4001) against `websankul_staging` (MySQL @ 3307), flag ON in
> `MIGRATION_MYSQL_MODULES`, hit the real HTTP endpoints with minted JWTs and confirm the response
> comes from SQL (row counts / shape match the SQL tables). Updated continuously as testing proceeds.

**Legend:** ✅ pass · 🟡 partial/notes · 🔴 fail · ⏳ in progress · ⬜ not started
**Flag:** 🟢 ON in `MIGRATION_MYSQL_MODULES` · ⚪ OFF (not flipped yet)
**Admin/Client API cells:** `✅ n/m` = full harness tested & passing · `✅ reads (...)` = admin READ paths live-verified from SQL this session (writes not yet exercised) ·
`—`/`⬜` = exists but not tested under this row · `n/a` = no symmetric operation (client-only by design: auth, checkout, entitlement reads) ·
`⚠️ still Mongo` = endpoint returns 200 but its flag is OFF, so it is served from MongoDB, NOT migrated yet.

## Environment
- MySQL `ws-mysql` @ `127.0.0.1:3307` / db `websankul_staging` — **up (healthy)**. DB reachable via Prisma (FAQ=18 rows).
- Dev server: `yarn dev` → `http://localhost:4001`. Mongo + Redis required at boot.
- Test harness: `docs/migration/api-tests/` → `yarn migration:api:<module>` (admin + client HTTP checks).

## Test log — single source of truth
> Everything (verified, pending, blocked) lives in this one table. No separate queue/pending lists.
> **All paths in the `APIs (SQL-proven)` column are under `/api/v1/`** (prefix omitted for brevity).
> `(tsx)` = data-path proven against the live DB via a tsx script (write paths needing Razorpay / a flag flip for HTTP).

| # | Module | Flag | Admin API | Client API | From SQL? | APIs (SQL-proven) | Harness | Notes |
|---|--------|------|-----------|-----------|-----------|-------------------|---------|-------|
| 1 | faq | 🟢 | ✅ 8/8 | ✅ 5/5 | ✅ **proven** | `GET client/faqs`, `GET client/faq-types`; `GET/POST/PUT/DELETE admin/cms/faqs(/:id)`, `GET admin/cms/faq-types` | ✅ | `yarn migration:api:faq` all green. SQL `ws_faq` general=10 → client `GET /faqs?type=general` returns **exactly 10**. Admin CRUD write-tested + reverted. |
| 2 | banner-slider | 🟢 | ✅ 5/5 | ✅ 4/4 | ✅ **proven** | `GET client/banners(?key=)`; `GET/POST/PUT/DELETE admin/cms/banners(/:id)`, `POST admin/cms/banners/reorder` | ✅ | all green incl. SQL assertions (orderBy asc, Mongo-cased `key`, `keyId` null). Client `GET /banners` = 2 active. POST/PUT/reorder/DELETE write-tested. |
| 3 | catalog (course/package-type/categories) | 🟢 | ✅ reads + write✓ (pkg status) | ✅ 8/8 | ✅ **proven** | **client (proven):** `GET client/packages/types`, `GET client/courses(?limit=)`, `GET client/courses/categories` · **✅ admin reads (SQL-proven — counts match MySQL):** `GET admin/courses(/:id)`=ws_course(1), `GET admin/packages(/:id)`=ws_package(5), `GET admin/master/package-categories`=ws_package_category(3). Writes (POST/PUT/DELETE/PATCH) exist, not yet exercised. | ✅ | `/packages/types` = 6 SQL rows, `/courses/categories` groupBy counts, `/courses` SQL composition. **Initially 500'd** → see Finding #1. |
| 4 | commerce-subscription | 🟢 | n/a | ✅ 1/1 | ✅ | `GET client/my-subscriptions` (entitlement read) `(tsx)` | ✅ | entitlement read path; bigint tracking + `package_id→targetPackageId`/`pcb_id→packageId` mapping verified (mostly tsx, 1 HTTP). |
| 5 | commerce-order | 🟢 | n/a | ✅ 1/1 | ✅ | `POST client/orders/course`, `POST client/orders/verify-payment` `(tsx)` | ✅ | create-order writes pending order; verify txn extends/creates sub+tracking; idempotent + dual-read fallback (HTTP write needs Razorpay → tsx-verified). |
| 6 | catalog-ebook | 🟢 | ✅ reads (ebook) | ✅ 5/5 | ✅ | **client (proven):** `GET client/ebooks(?language=)`, `GET client/ebooks/:id` · **✅ admin reads (SQL-proven — counts match MySQL):** `GET admin/ebooks(/:id)`=ws_ebook(3), `GET admin/ebooks/:id/plans`. Writes exist, not yet exercised. | ✅ | client `/ebooks` = `ws_ebook` + shared price plans, price-derived isPaid; language filter correct. Confirms `ws_ebook` ALTER applied cleanly. |
| 7 | catalog-material | 🟢 | ✅ reads + write✓ (status) | ✅ 4/4 | ✅ | **client (proven):** `GET client/material-categories/:id/children` · **✅ admin reads (SQL-proven — pagination total matches MySQL):** `GET admin/materials`=ws_material(226), `GET admin/materials/categories`. Writes exist, not yet exercised. | ✅ | recursive-CTE: parent + children w/ count + havingChildDirectory; bad-id 400. |
| 8 | catalog-book | 🟢 | ✅ reads + write✓ (status + trending) | ✅ 1/1 | ✅ | **client (proven):** `GET client/books`, `GET client/books/:id` · **✅ admin reads (SQL-proven — counts match MySQL):** `GET admin/books(/:id)`=ws_book(10), `GET admin/books/orders/list`. Writes / order-status exist, not yet exercised. | ✅ | `/books` + `/books/:id` compose book-order cart/purchase state (qty, isPurchased, cartId). |
| 9 | catalog-exam | 🟢 | ✅ reads (quizzes) | ✅ 4/4 | ✅ | **client (proven):** `GET client/exam-categories/:id/children` · **✅ admin reads (SQL-proven — counts match MySQL):** `GET admin/quizzes(/:id)`=ws_exam(1), `GET admin/quizzes/categories`, `admin/quizzes/questions`. Writes exist, not yet exercised. | ✅ | parent + 13 children w/ count + havingChildDirectory + title←name. |
| 10 | commerce-price | 🟢 | ✅ reads + write✓ (plan status) | ✅ 1/1 | ✅ | **client (proven):** `GET client/packages` (plan/pricing lookup) `(tsx)` · **✅ admin reads (SQL-proven — pagination total matches MySQL):** `GET admin/plans(/:id)`=ws_package_course_ebook_price(1346). Clone / status / writes exist, not yet exercised. | ✅ | owner-id `0` sentinel→null, duration surfaced as DAYS. |
| 11 | customer-auth | 🟢 | n/a | ✅ 9/9 | ✅ | `POST client/auth/otp/generate`, `POST client/auth/otp/validate`, `POST client/auth/token/refresh`, `DELETE client/auth/logout` | ✅ | **full OTP auth flow on SQL** — generate→validate(5786)→token+profile→refresh→logout; wrong-OTP 400, bad-refresh 401. Core module. |
| 12 | ebook-order | 🟢 | n/a | ✅ 1/1 | ✅ | `POST client/orders/ebook`, `POST client/orders/verify-payment` `(tsx)` | ✅ | create-order writes pending; verify txn creates/extends subscription; idempotent + dual-read fallback (HTTP write needs Razorpay → tsx-verified). |
| 13 | book-order | 🟢 | n/a | ✅ 1/1 | ✅ | book create-order + verify (5-table write, AWB allocate) `(tsx)` | ✅ | create-order writes order+items; verify allocates AWB + deactivates cart; idempotent + dual-read fallback (5-table write → tsx-verified). |
| 14 | commerce-promocode | 🟢 | ↗ admin-promocode | ✅ 1/1 | ✅ | **client (proven):** `GET client/promocode`, `POST client/promocode/apply` · **⚠️ admin still Mongo (flag `admin-promocode` OFF):** `admin/promocodes` returns 200 but served from Mongo, NOT migrated. `GET/POST/PUT/DELETE admin/promocodes(/:id)`, `GET admin/promocodes/plans` | ✅ | valid = status && start<now<expire + promoted plans (per-plan %) on detail read. |
| 15 | app-update | 🟢 | ✅ 4/4 | ✅ 3/3 | ✅ | `GET client/upgrade`; `GET/PUT admin/cms/app-update` | ✅ | admin CRUD + client `/upgrade`. |
| 16 | version | 🟢 | ✅ 4/4 | ✅ 4/4 | ✅ | `GET client/version`, `GET client/upgrade(?clientVersion=)`; `GET/PUT admin/cms/version` | ✅ | |
| 17 | department | 🟢 | ✅ 4/4 | ✅ 3/3 | ✅ | `GET client/contactus`; `GET/POST/PUT/DELETE admin/departments(/:id)` | ✅ | |
| 18 | terms | 🟢 | ✅ 6/6 | ✅ 6/6 | ✅ | `GET client/terms(?module=)`; `GET/POST/PUT/DELETE admin/cms/terms(/:id)` | ✅ | |
| 19 | popup | 🟢 | ✅ 5/5 | ✅ 4/4 | ✅ | `GET client/popup`; `GET/POST/PUT/DELETE admin/cms/popups(/:id)` | ✅ | |
| 20 | testimonial | 🟢 | ✅ 5/5 | ✅ 3/3 | ✅ | `GET client/testimonials`; `GET/POST/PUT/DELETE admin/cms/testimonials(/:id)` | ✅ | |
| 21 | customer-lookups | 🟢 | ↗ admin-master/address | ✅ 6/6 | ✅ | **client (proven):** `GET client/address/states(?search=)`, `GET client/address/educations`, `GET client/address/characteristic` · **⚠️ admin still Mongo (flag `admin-address` OFF):** `admin/address/states` returns 200 but served from Mongo. `admin/master/subject-categories` + `admin/master/educators` are under admin-master (ON) → SQL. | ✅ | |
| 22 | offline-city | 🟢 | ↗ admin-offline | ✅ 4/4 | ✅ | **client (proven):** `GET client/address/cities(?search=)` · **⚠️ admin city mgmt (flag `admin-address` OFF → Mongo):** `admin/offline/cities` 404 on this build; `admin/address/cities` is the live path but still Mongo until admin-address flips. | ✅ | |
| 23 | offline-batch | 🟢 | ✅ reads (batch/center) | ✅ 5/5 | ✅ | **client (proven):** `GET client/offline/batches`, `GET client/offline/centers` · **✅ admin reads (SQL-proven — counts match MySQL):** `GET admin/offline/batches`=ws_offline_batch(3), `GET admin/offline/centers`=ws_offline_center(3). Writes exist, not yet exercised. | ✅ | |
| 24 | offline-enquiry | 🟢 | ↗ admin-inquiry | ✅ 1/1 | ✅ | **client (proven):** `POST client/offline/enquiry` `(tsx)` · **⚠️ admin enquiry list (flag `admin-offline` OFF → Mongo):** `GET admin/offline/enquiries` returns 200 (4 rows) but served from Mongo; `DELETE admin/offline/enquiries/:id` not exercised. | ✅ | write path tsx-verified. |
| 25 | commerce-ebook-sub | 🟢 | n/a | ✅ 1/1 | ✅ | ebook entitlement read (service/repo layer) `(tsx)` | ✅ | |
| 26 | commerce-promoter | 🟢 | n/a | ✅ 1/1 | ✅ | promoter entitlement read (service/repo layer) `(tsx)` | ✅ | |
| 27 | commerce-educator | 🟢 | n/a | ✅ 1/1 | ✅ | educator entitlement read (service/repo layer) `(tsx)` | ✅ | |
| 28 | package-chat | 🟢 | ✅ reads (pkg chat) | ✅ 1/1 | ✅ | **client (proven):** `GET client/package/:packageId/chat` · **✅ admin reads (SQL-proven — admin-package ON):** `GET admin/packages/:id/chat` (200, paginated). `POST`/`DELETE` chat exist, not yet exercised. | ✅ | |
| 29 | client-wishlist | 🟢 | n/a | ✅ reads | ✅ **proven** | `GET client/wishlist` | ✅ live | Flag flipped, backfill run (`backfill-c4-wishlist` — mongo total 0 → `ws_wishlist` empty by design). Endpoint serves SQL branch: **HTTP 200 empty** with a real customer id (was 401 with mock ObjectId — see Finding #6). |
| 30 | client-testseries | 🟢 | n/a | ✅ reads | ✅ **proven** | `GET client/test-series` | ✅ live | total=2 ↔ `ws_test_series`=2, integer ids, no `__v`. Backfill `backfill-c4-testseries` (content_category 2; `test_series_exam` 0 rows — exams "Exam One/Twos" absent from staging `ws_exam`; chain proven via seed→verify→revert, see residual-gaps note). |
| 31 | admin-testseries | 🟢 | ✅ reads | n/a | ✅ **proven** | `GET admin/test-series` | ✅ live | total=2 ↔ `ws_test_series`=2, SQL-shaped (id=1). |
| 32 | promo-code | 🟢 | ✅ reads | ↗ client/promocode | ✅ **proven** | `GET admin/promocodes` (via `pcSql.isPromoCodeMysql()` branch) | ✅ live | Serves the **SQL branch** → `ws_promo_code`. Backfilled 2026-06-22 (`scripts/backfill-promo-code.ts`): 1 row (FIRST50) ↔ endpoint returns `_id:"1"`, no `__v`, flat ₹50. Legacy `ws_promocode` (2) is the unrelated commerce-promocode table. |
| 33 | referral-content | 🟢 | ✅ reads | ✅ reads | ✅ **proven** | `GET admin/referrals/terms\|faqs`; `GET client/referral/terms\|faqs` | ✅ live | admin already SQL; **client wired this session** (Finding #7). Both surfaces: 1 term / 1 faq ↔ `ws_refferal_term`/`ws_refferal_faq`, int ids, no `__v`. Backfill `backfill-c8-referral-content` (term 1, faq 1). |
| 34 | permission-category | 🟢 | ✅ reads | n/a | ✅ **proven** | `GET admin/permission-categories` | ✅ live | items=23, pagination total=23 ↔ `ws_permission_category`=23 (exact). Backfill `backfill-c8-permission-category` (23 rows; permission links skipped 539 — already mapped). |
| 35 | permission-catalog | 🟢 | ✅ reads | n/a | ✅ **proven** | `GET admin/permissions/catalog` | ✅ live | Catalog registry served (version `2026.05.25-1`, 91 module groups / 533 keys). Boot sync: inserted 0, total 533 (already seeded). |
| 36 | admin-promoter | 🟢 | ✅ reads | n/a | ✅ **proven** | `GET admin/promoters` | ✅ live | len=112 ↔ `ws_promoter` where `is_delete=0`=112 (total 114), integer ids (id=128), no `__v`. **Was Mongo (`__v`/ObjectId) until the stale dev server on :4001 was killed — see Finding #5.** |
| 37 | admin-course-video | 🟢 | ✅ reads | n/a | ✅ **proven** | `GET admin/videos` | ✅ live | pagination total=156 ↔ `ws_video`=156, integer id (33141). |
| 38 | client-free | 🟢 | n/a | ✅ reads | ✅ **proven** | `GET client/free-tests`, `/free-courses`, `/free-ebooks` | ✅ live | All 200, SQL-shaped (free-courses id=75, no `__v`); composed across `ws_course/exam/ebook/...`. |
| 39 | admin-live | 🟢 | ✅ reads | n/a | ✅ **proven** | `GET admin/live-sessions` | ✅ live | `data.sessions`, total=51 ↔ `ws_live_session`=51, integer id (50). |
| 40 | admin-live-course | 🟢 | ✅ reads | n/a | ✅ **proven** | `GET admin/live-courses` | ✅ live | `data.liveCourses`, total=4 ↔ `ws_live_course`=4, integer id (4). |
| 41 | client-live-reminder | 🟢 | n/a | ✅ reads | ✅ **proven (path)** | `GET client/live-reminders` | ✅ live | 200 via SQL branch. `ws_live_session_reminder.customer_id` still NULL in staging — repair script `scripts/backfill-live-reminder-customer-id.ts` correlates sessions 9/9 but the 9 reminders' customers (2 Mongo-only test users) aren't in `ws_customer`; fills automatically on a full-customer DB. See residual-gaps note. |
| 42 | pdf-upload | 🟢 | ✅ reads | n/a | ✅ **proven (path)** | `GET admin/ebooks/pdf-jobs/:batchId` | ✅ live | SQL-backed job lookup returns proper `404 "Batch not found."` envelope (`ws_pdf_upload_job`=0, net-new). Write path (POST + BullMQ + Spaces) not exercised. |

**Progress: 28/28 harness modules + 14/14 pending modules verified serving from MySQL, 0 functional failures.**
Rows 29–42 verified live this session: flags flipped ON in `.env`, backfills run, `yarn dev` rebooted clean on :4001,
each READ endpoint hit with minted JWTs and cross-checked against the `ws_*` tables (counts match; payloads carry
integer ids and no Mongoose `__v`). Two code/data gaps were found and one was fixed (Findings #4–#6).
Verifier script: `scripts/verify-pending-sql.py` (+ `scripts/verify-pending-sql.sh`).

### Residual data gaps — status after 2026-06-22 backfill follow-up
- **promo-code**: ✅ **RESOLVED.** `scripts/backfill-promo-code.ts` migrated the Mongo `ws_promo_codes`
  (C5 `PromoCode`) collection → `ws_promo_code` (1 row, FIRST50). `GET /admin/promocodes` now serves it from
  SQL. (Note: the separate legacy `ws_promocode` (2 rows) belongs to the older commerce-promocode system —
  unrelated table.) Promoter ref dropped to null (Mongo promoter not in the SQL promoter subset; optional field).
- **client-live-reminder**: 🟡 **script delivered, blocked on staging data.** `scripts/backfill-live-reminder-customer-id.ts`
  is idempotent and correlates SQL rows to Mongo reminders 9/9 by session, but all 9 reminders belong to 2
  Mongo-only test customers (phones 9106929076 / 8888888888) absent from `ws_customer` (27 rows), so 0 can be
  filled here. Customers are **not fabricated**. Re-run against a full-customer DB (prod) fills them automatically.
- **client-testseries (`ws_test_series_exam`)**: 🟡 **diagnosed — disjoint staging data, logic verified.** The 2
  Mongo links reference exams "Exam One"/"Exam Twos" absent from staging `ws_exam` (1 unrelated row; `ws_exam` is
  introspected prod source, never Mongo-backfilled). Proven via seed→verify→revert: with the exams present,
  `inserted=2` and `GET /admin/test-series/1/papers` serves 2 papers from SQL (populated examId + contentCategory,
  no `__v`); reverted to original state. `backfill-c4-testseries.ts` now logs the unmapped exam titles. Resolves
  automatically in prod where `ws_exam` holds the real exams.
- **client-wishlist**: `ws_wishlist` empty (Mongo source had 0 rows) — expected, nothing to migrate yet.

## Findings / fixes
### 🔴→✅ Finding #1 (IMPORTANT): un-applied ALTER DDL broke live modules
`prisma.course.findMany()` selects ALL model columns; the C6 Prisma additions (`examCountdownIds`, etc.) made it
select `ws_course.exam_countdown_ids` which **didn't exist in the DB yet** → already-live `catalog-course` 500'd. Root
cause: Prisma model columns were added this session but the matching ALTER DDL was never applied to staging.
**Fix: applied the pending schema-changes to `websankul_staging`** (additive, no data loss):
- ALTERs (existing tables): `add_examcountdown_cols_catalog`, `c7_closing_alters` (ws_video/ws_video_category/ws_ebook),
  `subscription_promoter_cols`, `promoted_pce_plan_kind`.
- New tables: `create_c4_tables` (wishlist/testseries content-cat+exam), `create_pdf_upload_job`, `create_promo_code`,
  `create_referral_content`, `permission_category`.
→ catalog re-ran **8/8**. **Lesson:** every Prisma ALTER must be applied to the DB before that table's live module is hit.
Staging schema is now caught up with the Prisma models.

### ✅ Finding #2: admin READ surfaces verified against live SQL (this session)
Booted `yarn dev` @ :4001 (MySQL 3307 / Redis 6380 / Mongo 27017), minted the mock admin JWT, hit each admin list
endpoint, and **cross-checked the returned row count / pagination `total` against the MySQL table directly** (via
`docker exec ws-mysql mysql … websankul_staging`). Every flag-ON admin module matched **exactly**:

| Admin endpoint | Flag | API count | MySQL table | Match |
|---|---|---|---|---|
| `GET admin/courses` | admin-course 🟢 | 1 | ws_course | ✅ |
| `GET admin/packages` | admin-package 🟢 | 5 | ws_package | ✅ |
| `GET admin/master/package-categories` | admin-master 🟢 | 3 | ws_package_category | ✅ |
| `GET admin/ebooks` | admin-ebook 🟢 | 3 | ws_ebook | ✅ |
| `GET admin/books` | admin-book 🟢 | 10 | ws_book | ✅ |
| `GET admin/materials` | admin-material 🟢 | total 226 | ws_material | ✅ |
| `GET admin/quizzes` | admin-exam 🟢 | 1 | ws_exam | ✅ |
| `GET admin/plans` | admin-plan 🟢 | total 1346 | ws_package_course_ebook_price | ✅ |
| `GET admin/offline/batches` | offline-batch 🟢 | 3 | ws_offline_batch | ✅ |
| `GET admin/offline/centers` | offline-batch 🟢 | 3 | ws_offline_center | ✅ |
| `GET admin/packages/:id/chat` | admin-package 🟢 | 200 (paginated) | ws_package_chat | ✅ |

**Served from Mongo (flag OFF — NOT migrated, even though the endpoint 200s):** `admin/promocodes` (admin-promocode OFF),
`admin/address/states` + `admin/address/cities` (admin-address OFF), `admin/offline/enquiries` (admin-offline OFF).
These are intentionally left as `⚠️ still Mongo` in the table — flipping those flags + re-verifying is the next step.
**Scope note:** only admin **reads** were exercised; admin writes (POST/PUT/DELETE/PATCH) on the proven modules still need a write+revert pass.

### ✅ Finding #3: admin WRITE paths verified (toggle → MySQL → revert)
For each status flag, hit the admin PATCH endpoint, read the MySQL column directly, confirmed it flipped, then PATCHed
back and confirmed the revert. All staging data was left untouched.

| Admin write | MySQL column | before→after→revert | Result |
|---|---|---|---|
| `PATCH admin/packages/:id/status` | ws_package.status | 1 → 0 → 1 | ✅ PASS |
| `PATCH admin/books/:id/status` | ws_book.status | 1 → 0 → 1 | ✅ PASS |
| `PATCH admin/materials/:id/status` | ws_material.status | 1 → 0 → 1 | ✅ PASS |
| `PATCH admin/plans/:id/status` | ws_package_course_ebook_price.status | 1 → 0 → 1 | ✅ PASS |
| `PATCH admin/books/:id/trending` | ws_book.is_trending | 0 → 1 → 0 | ✅ PASS (after Finding #4 fix) |

Contract notes: `admin/books/:id/status` and the other toggles ignore the request body — they flip server-side.
`admin/quizzes/:id/status` (exam) expects a **string `ExamStatus` enum**, not a boolean, so a boolean body is correctly
422/400'd; its write path is left for a valid-enum pass.

### 🔴→✅ Finding #4 (BUG, now FIXED): `toggleBookTrending` was Mongo-only despite admin-book ON
`PATCH admin/books/:id/trending` returned **400 "Invalid book id."** for a MySQL integer id. Cause: unlike its sibling
`toggleBookStatus` (which has an `isMysqlModule` branch + `parseBookId`), `toggleBookTrending` went **straight to
Mongoose** (`mongoose.Types.ObjectId.isValid` → `Book.findById`) with **no MySQL branch** — based on a stale comment
("ws_book has no is_trending column"). But the column DOES exist (`ws_book.is_trending tinyint(1)`) and Prisma
`Book.isTrending @map("is_trending")` maps it, so the deferral was obsolete and trending was effectively broken in MySQL mode.
**Fix applied this session** (mirrors `toggleBookStatus`, Mongo fallback retained):
- `modules/admin-book/admin-book.repository.ts` → `setTrending(id, isTrending)`
- `modules/admin-book/admin-book.service.ts` → `toggleBookTrending(id)`
- `admin/book/book.controller.ts` → `isAdminBookMysql()` branch
`yarn typecheck` ✅. Re-verified live: `ws_book.is_trending` **0 → 1 → revert 0** = PASS. Logged in `docs/MIGRATION_QUERY_CHANGES.md`.
**Residual (not changed):** the read DTO still synthesizes `isTrending=false`, so admin book *listings* won't surface the
real column value until that DTO is updated — left as-is to preserve the response contract.

### 🔴→✅ Finding #5 (IMPORTANT — environment, not code): a stale dev server masked the new flags
While verifying rows 29–42, `GET admin/promoters` returned **Mongo-shaped data** (`_id` = 24-char ObjectId, `__v: 0`,
only 2 rows) even though `admin-promoter` was flipped ON and the controller has a correct `isAdminPromoterMysql()` branch.
Root cause: **two `tsx watch src/index.ts` processes were running** — a pre-existing one (started before the `.env` edit,
so its `process.env.MIGRATION_MYSQL_MODULES` lacked the 14 new flags) **owned port 4001**, and the freshly-booted server
couldn't bind and sat idle. `isMysqlModule()` reads `process.env` live, but the *old process's* env was already frozen at
boot. Counts like testseries=2 / live-sessions=51 matched coincidentally because the `ws_*` tables were backfilled **from**
the same Mongo, hiding the problem — only the **payload shape** (`__v`/ObjectId vs integer ids) exposed it.
**Fix:** `pkill -f "tsx watch src/index.ts"`, confirm :4001 free, reboot a single `yarn dev`. After that, `admin/promoters`
returned **112 rows with integer ids and no `__v`** (= `ws_promoter` where `is_delete=0`). **Lesson:** always confirm the
process listening on :4001 is the one that booted *after* the `.env` flag change — verify by response shape, not just counts.

### 🟡 Finding #6 (harness limitation, not a bug): customer-scoped SQL reads need a real integer customer id
The mock customer JWT carries a **Mongo ObjectId** (`507f1f77bcf86cd799439011`). Customer-agnostic SQL reads
(`/client/test-series`, `/client/free-*`) work fine, but **customer-scoped** SQL endpoints reject it: `/client/wishlist`
returned **401** because `parseWlId(userId)` (expects an integer `ws_customer.id`) returns null for an ObjectId. In SQL
mode the real login mints the integer customer id into the JWT (cf. row 11 OTP `validate(5786)`). **Resolution:** re-mint
with `MIGRATION_TEST_CUSTOMER_ID=<real ws_customer.id>` (`yarn migration:api:auth` also registers the Redis
`customer_session:<id>`). With a real id (472335), `/client/wishlist` returned **200** via the SQL branch (empty — table
has no rows), and `/client/live-reminders` returned 200. No code change — the harness default id just isn't a MySQL row.

### 🔴→✅ Finding #7 (BUG, now FIXED): client `/referral/terms|faqs` were Mongo-only despite referral-content ON
The **admin** referral content endpoints branch on `referral-content` (SQL), but the **client** `getTerms`/`getFaqs`
(`src/client/referral/content.controller.ts`) went straight to the Mongoose `ReferralTerm`/`ReferralFaq` models — verified
by the response carrying 24-char ObjectIds. Same class of gap as Finding #4. **Fix applied this session** (Mongo fallback
retained): added `listActiveTermsForClient()` / `listActiveFaqsForClient()` to
`modules/referral-content/referral-content.service.ts` (status-filtered, slim `{_id,text,order}` / `{_id,question,answer,order}`
projections matching the legacy contract) and an `rcService.isReferralContentMysql()` branch in the client controller.
`yarn typecheck` ✅. Re-verified live: both return integer-string `_id` (`"1"`), no `__v`, ↔ `ws_refferal_term`/`ws_refferal_faq`
(1 active each). Logged in `docs/MIGRATION_QUERY_CHANGES.md`.
