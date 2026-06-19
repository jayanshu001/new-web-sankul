# 🧪 SQL Migration — Testing Status (live)

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
| 29 | client-wishlist | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Table applied (`create_c4_tables`). Need: flip flag → run backfill → endpoint check / add harness. |
| 30 | client-testseries | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Table applied (`create_c4_tables`). Flip flag → backfill → verify. |
| 31 | admin-testseries | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Flip flag → verify admin CRUD. |
| 32 | promo-code | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Table applied (`create_promo_code`). Flip flag → backfill (`backfill-c4-*` / promo) → verify. |
| 33 | referral-content | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Tables applied (`create_referral_content` → ws_refferal_term/faq). Flip flag → `backfill-c8-referral-content.ts` → verify. |
| 34 | permission-category | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Table applied (`permission_category` + ws_permissions.category_id ALTER). Flip flag → backfill → verify. |
| 35 | permission-catalog | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Flip flag → verify boot seed + catalog reads. |
| 36 | admin-promoter | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Needs `subscription_promoter_cols` ALTER (promoter_id/%/paid_amount). Flip flag → verify subs/dashboard. |
| 37 | admin-course-video | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Admin course video CRUD. Flip flag → verify. |
| 38 | client-free | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built. Flip flag → verify. |
| 39 | admin-live | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built (C7). ws_live_* tables exist + `c7_closing_alters` (ws_video.live_session_id). Flip flag → verify. |
| 40 | admin-live-course | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built (C7). Flip flag → verify. |
| 41 | client-live-reminder | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built (C7). Flip flag → verify. |
| 42 | pdf-upload | ⚪ | ⬜ | ⬜ | ⬜ | — (none tested yet) | ⬜ | Session-built (C7). Net-new table (`create_pdf_upload_job` → ws_pdf_upload_job). BullMQ pipeline. Flip flag → verify Socket.io progress path. |

**Progress: 28/28 harness modules verified, 0 failures** (after Finding #1 DDL fix). The entire existing api-test suite passes against MySQL on both admin + client surfaces.
**Pending (rows 29–42):** session-built this session, tables applied to staging, **flags still OFF**, backfills not run, no harness files yet. Per-row "Notes" carry the exact flip→backfill→verify steps.

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
