# Web Sankul — Migration Tracker

> **Project:** `new-web-sankul` (modern stack)  
> **Strategy reference:** [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md)  
> **Last updated:** 2026-06-10  
> **Current phase:** Phase 2/3 — Backend stabilization (**in progress**; 11 modules enabled on MySQL: app-update, version, faq, banner-slider, testimonial, department, terms, popup, customer-auth, customer-lookups, offline-city. CMS group + **Customer Module** done. **Catalog** (package/course/video) built dual-path, **all 4 flags OFF** — flips with the commerce wave; video URL-encryption parity PASS. customer-address/profile/bank-account also code-complete flags OFF. Next: **commerce/dashboard wave** — flips catalog + address/profile/bank ON together as the catalog id-space moves to int.)  
> **Doc index:** [`README.md`](./README.md) (all migration docs live in this folder)  
> **How to test:** [`testing-guide.md`](./testing-guide.md)  
> **Test results log:** [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) ← record Pass/Fail here

This file is the **single source of truth** for migration **build** progress.  
**Test** progress is logged separately in [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) (do not skip).

---

## Table of contents

1. [Context & decision](#1-context--decision)
2. [Are we following the strategy doc?](#2-are-we-following-the-strategy-doc)
3. [Repository map](#3-repository-map)
4. [Migration phases (overview)](#4-migration-phases-overview)
5. [Phase 1 — completed steps](#5-phase-1--completed-steps)
6. [Phase 2 — in progress (CMS pilot)](#6-phase-2--in-progress-cms-pilot)
7. [Files added or changed](#7-files-added-or-changed)
8. [Local MySQL (Docker)](#8-local-mysql-docker)
9. [Environment variables](#9-environment-variables)
10. [Yarn / npm scripts](#10-yarn--npm-scripts)
11. [Verification results](#11-verification-results)
12. [DBeaver connection](#12-dbeaver-connection)
13. [Troubleshooting](#13-troubleshooting)
14. [What is NOT done yet](#14-what-is-not-done-yet)
15. [Phase 2 — remaining modules](#15-phase-2--remaining-modules)
16. [Changelog](#16-changelog)

---

## 1. Context & decision

### Legacy production architecture

| Layer | Location | Stack | Database |
|--------|----------|--------|----------|
| Admin panel | `websankul-staging` | Laravel | MySQL (`ws_*` tables) |
| API | `websankul-api-staging` | Node.js + Prisma | MySQL (same schema) |
| Staging data dump | `websankul-staging/database/websankul_staging.sql` | SQL dump | MySQL 8.0.36 |

### New platform (`new-web-sankul`)

| Layer | Stack | Database (before migration) |
|--------|--------|------------------------------|
| API + admin routes | Express, TypeScript | **MongoDB** (Mongoose) |
| Branch | `migration` (same as `main` at Phase 1 start) | — |

### Problem

The new app was built on **MongoDB** with a **redesigned schema** (ObjectIds, renamed fields, new collections). Moving production MySQL data into Mongo in one shot was high risk.

### Finalized decision (from strategy doc)

- **Keep MySQL** as the database of record.
- Use **Prisma ORM** in `new-web-sankul`.
- **Preserve production data** via dump import + incremental schema changes.
- **Keep API response contracts** stable for React admin / client apps (transformer/DTO layer in later phases).
- **Do not** run a full MySQL → MongoDB migration.

---

## 2. Are we following the strategy doc?

**Yes.** Work maps directly to [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md):

| Strategy requirement | How we are doing it |
|----------------------|---------------------|
| §6–7: MySQL + Prisma (not Mongo for production data) | Phase 1: Docker MySQL + dump + Prisma schema |
| §8.1: Preserve production data | Using `websankul_staging.sql` as local source of truth |
| §8.4: Maintain API stability | Transformers map MySQL → same JSON (`isUpdateAvailable`, etc.) |
| §9 workflow: Import → Prisma → stabilize APIs | Phase 1 import done; Phase 2 first APIs on Prisma |
| §10 Phase 2: Reconnect APIs, Prisma, repositories | CMS pilot: repository → service → transformer |
| §10 Phase 3: Transformer / DTO layer | Introduced in pilot (not optional later) |
| §12 architecture: modules / repositories / services / transformers | `src/modules/app-update`, `src/modules/version` |
| §13.3: Incremental refactoring only | `MIGRATION_MYSQL_MODULES` — one module at a time |
| §13.5: Production stability first | Mongo still default until module listed in env |

**Not doing (by design):** full MySQL→Mongo migration, big-bang schema rewrite, removing Mongo before all modules are ported.

---

## 3. Repository map

```
web-sankul/
├── websankul-staging/                    # Legacy Laravel admin + SQL dump
│   └── database/websankul_staging.sql
├── websankul-api-staging/                # Legacy Node API + Prisma schema (reference)
│   └── prisma/schema.prisma
└── new-web-sankul/                       # Target modern API (this repo)
    ├── docs/migration/                   # ← all migration docs (this folder)
    │   ├── legacy_system_migration_strategy.md  # Full 8-phase strategy
    │   ├── README.md
    │   ├── MIGRATION_TRACKER.md          # build log (this file)
    │   ├── MIGRATION_TEST_LOG.md         # test pass/fail log
    │   ├── testing-guide.md
    │   └── phase-1-mysql.md
    ├── docker-compose.yml                # ws-mysql + redis + rabbitmq
    ├── prisma/schema.prisma              # Copied from legacy API, then generate
    ├── src/config/prisma.ts              # Prisma client singleton
    └── scripts/                          # import + verify
```

---

## 4. Migration phases (overview)

| Phase | Name | Status |
|-------|------|--------|
| **1** | Production database preservation | ✅ **Done** |
| **2** | Backend stabilization (Mongoose → Prisma, module by module) | 🔄 **In progress** (CMS pilot) |
| **3** | API compatibility layer (DTOs / transformers) | 🔄 Started with Phase 2 pilot |
| **4** | Incremental schema refactoring | ⏳ Not started |
| **5** | Data migration & transformation scripts | ⏳ Not started |
| **6** | Feature modernization | ⏳ Not started |
| **7** | Testing & validation | ⏳ Not started |
| **8** | Production rollout | ⏳ Not started |

---

## 5. Phase 1 — completed steps

### Step 1.1 — Agree on migration approach

- Read `legacy_system_migration_strategy.md`.
- Confirmed scope: MySQL + Prisma in `new-web-sankul`, not MongoDB for production data.

### Step 1.2 — Add MySQL to Docker Compose

- Extended `docker-compose.yml` with service **`ws-mysql`**.
- Image: `mysql:8.0`, container name: `ws-mysql`.
- Host port **3307** → container **3306** (avoids conflict with local MySQL on 3306).
- Auto-created database: `websankul_staging`.
- Default root password: `websankul_dev` (overridable via `MYSQL_ROOT_PASSWORD`).
- Persistent volume: `mysql_data`.
- Charset: `utf8mb4` / `utf8mb4_unicode_ci`.

**Command used:**

```powershell
cd D:\Projects\web-sankul\new-web-sankul
docker compose up -d ws-mysql
```

**Result:** Container `ws-mysql` running; image pulled successfully on first run.

---

### Step 1.3 — Add Prisma to the project

| Action | Detail |
|--------|--------|
| Copy schema | `websankul-api-staging/prisma/schema.prisma` → `new-web-sankul/prisma/schema.prisma` |
| Models | **77** Prisma models mapped to `ws_*` MySQL tables |
| Dependencies | `@prisma/client@5.22.0`, `prisma@5.22.0` (dev) |
| Client module | `src/config/prisma.ts` — `prisma`, `connectPrisma`, `disconnectPrisma` |
| Generator | Removed deprecated `extendedWhereUnique` preview feature for Prisma 5 |

**Commands used:**

```powershell
yarn install
yarn prisma:generate
```

**Result:** Prisma Client generated under `node_modules/@prisma/client`.

---

### Step 1.4 — Configure environment

Added to `.env` (and documented in `.env.example`):

```env
MYSQL_ROOT_PASSWORD=websankul_dev
DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
```

**Note:** `MONGODB_URI` remains required for the **current** app boot (`src/index.ts` still uses Mongoose). MySQL is wired for migration work until Phase 2 switches modules to Prisma.

---

### Step 1.5 — Import staging SQL dump

| Item | Value |
|------|--------|
| Source file | `../websankul-staging/database/websankul_staging.sql` |
| Target DB | `websankul_staging` (drop + recreate before import) |
| Script | `scripts/mysql-import.ps1` (Windows) / `scripts/mysql-import.sh` (Linux/macOS) |

**Command used:**

```powershell
yarn db:import
```

**Script behavior:**

1. `docker compose up -d ws-mysql`
2. Wait until `SELECT 1` succeeds (up to ~120s)
3. `DROP DATABASE IF EXISTS websankul_staging`
4. `CREATE DATABASE websankul_staging` (utf8mb4)
5. Pipe SQL dump into `mysql` inside the container

**Fix applied during import:** PowerShell treated MySQL stderr warnings as errors; import script updated to use `cmd /c` for wait and import so warnings do not fail the script.

**Result:** Import completed successfully (~14s on dev machine).

---

### Step 1.6 — Verify database + Prisma

**Command used:**

```powershell
yarn db:verify
```

**Script:** `scripts/verify-mysql.ts` — connects via Prisma, counts `ws_*` tables, samples `Customer` and `Package` row counts.

**Results (2026-06-04):**

| Check | Value |
|--------|--------|
| MySQL connection | OK |
| Active database | `websankul_staging` |
| `ws_*` tables | **89** |
| `ws_customer` rows | **26** |
| `ws_package` rows | **4** |

---

### Step 1.7 — Connect DBeaver (manual UI)

Confirmed data visible in DBeaver using:

| Field | Value |
|--------|--------|
| Host | `127.0.0.1` |
| Port | `3307` |
| Database | `websankul_staging` |
| User | `root` |
| Password | `websankul_dev` |

Optional driver properties if needed: `allowPublicKeyRetrieval=true`, `useSSL=false`.

---

## 6. Phase 2 — in progress (CMS pilot)

### Objective (strategy § Phase 2)

APIs for selected modules must work against the **imported MySQL** data with the same behavior as before schema changes.

### Step 2.1 — Module-level MySQL toggle

| Item | Detail |
|------|--------|
| Config | `src/config/migration.ts` |
| Env | `MIGRATION_MYSQL_MODULES=app-update,version,faq` |
| Behavior | Listed modules use Prisma; others still use Mongoose |

### Step 2.2 — Layered architecture (strategy §12 + § Phase 3)

```txt
ws_app_update / ws_versions (MySQL)
    → repository (Prisma)
    → service (module switch)
    → transformer (DTO / API contract)
    → controller (unchanged routes)
```

### Step 2.3 — Pilot modules

| Module | MySQL table | Admin routes | Client routes |
|--------|-------------|--------------|---------------|
| `app-update` | `ws_app_update` (id=1) | `GET/PUT /admin/cms/app-update` | via `checkUpgrade` |
| `version` | `ws_versions` (id=1) | `GET/PUT /admin/cms/version` | `GET /client/.../version`, `checkUpgrade` |
| `faq` | `ws_faq` (type enum) | `CRUD /admin/cms/faqs` | `GET /client/faqs`, `GET /client/faq-types` |

**Transformer notes:**

- MySQL column `isUpdateAvailble` (legacy typo) → API field `isUpdateAvailable`.
- MySQL has **no** `ws_faq_types` table — types are enum `general` | `referral`; API exposes synthetic `typeId` objects for admin/client compat.
- Admin create/update body on MySQL uses `type` (not Mongo `typeId`).

### Step 2.6 — FAQ module (2026-06-04)

```powershell
yarn db:test-faq
```

**Result:** 13 FAQs (5 general, 8 referral); 2 synthetic faq-types.

### Step 2.4 — Boot & shutdown

- `src/index.ts`: `connectPrisma()` when `MIGRATION_MYSQL_MODULES` is non-empty
- `src/utils/gracefulShutdown.ts`: `disconnectPrisma()` on shutdown
- `src/config/env.ts`: requires `DATABASE_URL` when MySQL modules are enabled

### Step 2.5 — Smoke test

```powershell
yarn db:test-cms-pilot
```

**Result (2026-06-04):**

```
App update: latestVersion=4235200, updateType=flexible, isUpdateAvailable=false
Version: latestVersionCode=40976, lastSupportedVersionCode=40976
CMS pilot OK — data loaded from staging MySQL.
```

### How to test (required before next module)

See **[`testing-guide.md`](./testing-guide.md)** and log results in **[`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md)**.

| Layer | Command / action |
|-------|------------------|
| Automated | `yarn db:verify`, `yarn db:test-cms-pilot` |
| Data | DBeaver SQL checks (guide § Phase 1 / 2) |
| API | `GET/PUT` admin CMS routes with JWT (guide § Step D–F) |
| UI | React admin CMS screens (optional) |

**Sign-off rule:** All required rows in test log = ✅ before adding the next module to `MIGRATION_MYSQL_MODULES`.

To **revert pilot to Mongo** only: remove modules from `MIGRATION_MYSQL_MODULES` (or unset the variable).

---

## 7. Files added or changed

| Path | Purpose |
|------|---------|
| `docs/migration/MIGRATION_TRACKER.md` | Build / migration log (this file) |
| `docker-compose.yml` | Added `ws-mysql` service + `mysql_data` volume |
| `prisma/schema.prisma` | MySQL schema (from legacy API) |
| `src/config/prisma.ts` | Prisma client for new code |
| `scripts/mysql-import.ps1` | Windows dump import |
| `scripts/mysql-import.sh` | Unix dump import |
| `scripts/verify-mysql.ts` | Connection + sanity checks |
| `.env.example` | `DATABASE_URL` + `MYSQL_ROOT_PASSWORD` template |
| `.env` | Added MySQL variables (local, not committed) |
| `package.json` | `db:*` and `prisma:generate` scripts; Prisma deps |
| `docs/migration/phase-1-mysql.md` | Phase 1 setup how-to |
| `src/config/migration.ts` | Per-module MySQL vs Mongo switch |
| `src/modules/app-update/*` | Repository, service, transformer |
| `src/modules/version/*` | Repository, service, transformer |
| `src/modules/cms/upgrade-check.service.ts` | Client upgrade check |
| `src/modules/faq/*` | FAQ repository, service, transformer |
| `scripts/test-mysql-cms-pilot.ts` | Phase 2 CMS pilot smoke test |
| `scripts/test-mysql-faq.ts` | Phase 2 FAQ smoke test |
| `docs/migration/testing-guide.md` | How to validate each phase/module |
| `docs/migration/MIGRATION_TEST_LOG.md` | Pass/fail test record (you fill this in) |
| `docs/migration/README.md` | Index of migration documentation |
| `docs/migration/SCHEMA_COMPARISON.md` | Legacy MySQL vs Mongo vs Prisma schema matrix |
| `scripts/generate-schema-comparison.ts` | Regenerate schema comparison doc |

**Still mostly Mongoose:**

- `src/config/db.ts` — Mongo for non-migrated modules
- `src/index.ts` — Mongo + conditional Prisma
- All other routes — Mongoose until listed in `MIGRATION_MYSQL_MODULES`

---

## 8. Local MySQL (Docker)

```powershell
# Start
yarn db:up
# or: docker compose up -d ws-mysql

# Stop
yarn db:down

# Logs
docker compose logs -f ws-mysql

# Shell into MySQL CLI
docker compose exec -it ws-mysql mysql -uroot -pwebsankul_dev websankul_staging
```

**Re-import dump** (destructive — drops database):

```powershell
yarn db:import
```

---

## 9. Environment variables

| Variable | Required for | Example (local) |
|----------|----------------|-----------------|
| `DATABASE_URL` | Prisma, `yarn db:verify` | `mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging` |
| `MYSQL_ROOT_PASSWORD` | Docker + import scripts | `websankul_dev` |
| `MONGODB_URI` | Current API runtime (`yarn dev`) | Atlas or local Mongo (unchanged) |
| `PRISMA_LOG_QUERIES` | Optional SQL logging | `true` |
| `MIGRATION_MYSQL_MODULES` | Comma-separated modules on Prisma | `app-update,version` |

---

## 10. Yarn / npm scripts

| Script | Description |
|--------|-------------|
| `yarn db:up` | Start `ws-mysql` container |
| `yarn db:down` | Stop `ws-mysql` |
| `yarn db:import` | Import `websankul_staging.sql` (PowerShell) |
| `yarn db:import:sh` | Same import via bash |
| `yarn db:verify` | Test Prisma + count tables/rows |
| `yarn db:pull` | Introspect DB → update `prisma/schema.prisma` |
| `yarn prisma:generate` | Regenerate Prisma Client after schema changes |
| `yarn db:test-cms-pilot` | Smoke test CMS modules against MySQL |

---

## 11. Verification results

```
MySQL connection: OK
Active database: websankul_staging
ws_* tables: 89
ws_customer rows: 26
ws_package rows (Package model): 4
```

Re-run anytime:

```powershell
yarn db:verify
```

---

## 12. DBeaver connection

1. **Database** → **New Database Connection** → **MySQL**
2. **Host:** `127.0.0.1` — **Port:** `3307`
3. **Database:** `websankul_staging`
4. **Username:** `root` — **Password:** `websankul_dev`
5. **Test Connection** → download driver if prompted → **Finish**
6. Browse **Tables** → filter `ws_%`

Ensure `ws-mysql` is running before connecting.

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Connection refused on 3307 | Container not running | `yarn db:up`, wait ~30s on first boot |
| Access denied | Password mismatch | Match `.env` and DBeaver to `websankul_dev` |
| Empty / missing tables | Import not run | `yarn db:import` |
| `yarn db:import` fails immediately on Windows | MySQL not ready | Wait, retry; check `docker compose logs ws-mysql` |
| Prisma errors after schema drift | Dump ≠ `schema.prisma` | `yarn db:pull` then `yarn prisma:generate` |
| DBeaver SSL / public key errors | MySQL 8 driver defaults | Driver props: `allowPublicKeyRetrieval=true`, `useSSL=false` |

---

## 14. What is NOT done yet

- [ ] Replace Mongoose globally (only pilot modules on MySQL)
- [x] Port first API routes to MySQL (app-update, version, client upgrade)
- [x] Transformer/DTO layer for pilot modules
- [ ] Map Mongo-only features (live courses, folders, permissions, etc.) to MySQL tables or new migrations
- [ ] Sync `prisma/schema.prisma` with dump via `db pull` if drift is found
- [ ] Staging/production deployment of MySQL-backed API
- [ ] Record count parity checks vs production
- [ ] Regression tests for admin + client apps

**Runtime today:** `yarn dev` still uses **MongoDB** only.

---

## 15. Phase 2 — remaining modules

Recommended order (safest first):

1. ~~**App update + version**~~ — ✅ done (pilot).
2. ~~**FAQ**~~ — ✅ done (`ws_faq`, enum types).
3. **System / read-only** — ✅ done:
   - ~~**Banner slider**~~ — ✅ done (`ws_banner_slider`; lowercase↔cased `key`, `keyId` null, reorder).
   - ~~**Testimonial**~~ — ✅ done (`ws_testimonial`; `discription`→`description` bridge).
   - ~~**Department**~~ + `department_contact` — ✅ done (two-table join under embedded `contacts[]`; `decscription`→`description`).
   - ~~**Terms & Conditions**~~ — ✅ done (`ws_termsandcondition`; `module` fixed enum; client array vs `?module=` single/null).
   - ~~**Popup notification**~~ — ✅ done (`ws_popup_notification`; `promoExpireAt` date map; client active-popup query; S3 image is DB-agnostic middleware).
   - ~~**Dynamic image**~~ — ➖ skipped: model exists but no controller/route uses it (no API surface).
   - ~~**Social link / social-link-type**~~ — ➖ skipped: Mongo-only (no `ws_social*` table in dump, no Prisma model).
4. ~~**Customer auth**~~ — ✅ done (`ws_customer` + `ws_customer_otp` + `ws_customer_access_token`; OTP generate/resend/validate/logout/refresh; added `refresh_token` column; `full_name`→`firstName`; `authenticate` not read-path coupled).
5. **Catalog** — courses, packages, videos — ✅ **built dual-path, all flags OFF** (`catalog-package-type`, `catalog-package`, `catalog-course`, `catalog-video`). Video URL-encryption parity PASS. D2 relation tables deferred. **Flips together with the commerce/dashboard wave** — the whole catalog id-space (int vs ObjectId) is joined by still-Mongo commerce/dashboard consumers, so it can't flip standalone.
6. **Commerce** — orders, subscriptions, promocodes — ⏳ **next** (the wave that flips catalog + address/profile/bank ON together as the catalog id-space moves to int).
7. **Hardest last** — live classes, chat, new permission system.

Per module workflow:

```txt
Legacy Prisma query (websankul-api-staging) as reference
    → Repository (Prisma) in new-web-sankul
    → Service
    → Transformer (keep API JSON shape)
    → Route/controller
    → Test against MySQL dump + React admin
```

**Next module to port:** the **commerce/dashboard wave** — orders, subscriptions (`PackageCourseEbookPrice` plans, `PackageCourseSubscription`), promocodes, and the dashboard aggregates. This wave flips all 4 catalog keys + `customer-address`/`customer-profile`/`customer-bank-account` ON together, moving the catalog id-space from ObjectId to int across every consumer at once.

---

## 16. Changelog

| Date | Phase | What was done |
|------|-------|----------------|
| 2026-06-13 | Phase 3b (WRITE) | **`package-chat` — LAST 3b write path built + wired (READ+WRITE), flag OFF. ⚠ FIRST SCHEMA ADD.** Package announcement chat. Client read (`GET /client/package/:packageId/chat`, subscription-gated) + admin write/delete (`POST`/`DELETE /admin/package/.../chat`) wired behind `isPackageChatMysql()`. **SCHEMA CHANGE:** `ws_package_chat` was a STUB (message only) that couldn't represent the Mongo PackageChat → **EXTENDED** via additive ALTER (media_url, media_type enum, sender_type enum, sender_id VARCHAR, push_sent) — captured in [`schema-changes/2026-06-13_extend_ws_package_chat.sql`](./schema-changes/2026-06-13_extend_ws_package_chat.sql); prod-safe, run once. Stub Prisma model `chat`→`PackageChat` + enums; regenerated. **Field map:** message↔text (NOT NULL→"" for media-only); sender_id VARCHAR (admin ObjectId; admin auth stays Mongo); list adds `id desc` tiebreaker (second-granularity datetime ties); client read gates via commerce-subscription `hasActivePackageSubscription` (int ids). Verified via live-DB `tsx` (**21/21**: existence guard, post text/media-only/system, paginated newest-first + total, delete, field mapping); staging restored to 0; `tsc` clean. Registry + schema-comparison regenerated. **Flag OFF — the 3b write cluster is now COMPLETE.** |
| 2026-06-13 | Phase 3b (WRITE) | **`offline-enquiry` — lead-capture write built + wired, flag OFF.** Small single-table write (`ws_offline_enquiry`). Wired `POST /client/offline/enquiry` behind `isOfflineEnquiryMysql()` (anonymous-allowed). No schema change (OfflineEnquiry existed; mobile BigInt fix landed in offline-batch). **DRIFT:** mobile BIGINT (input string → digits→BigInt, surfaced as string; 12-digit/country-code overflow Int32); anonymous vs NOT NULL customer_id → store **0 sentinel** (DTO 0→null); **no remarks column** (validator accepts, SQL write drops it); batch_id INT (validated + existence-checked via offline-batch, before the ObjectId parse). Verified via live-DB `tsx` (**10/10**: batch guard, authed write w/ BigInt round-trip, anon 0-sentinel, cleanup); staging restored to 4; `tsc` clean. Registry + schema-comparison regenerated. **Flag OFF.** |
| 2026-06-13 | Wiring | **`catalog-book` WIRED (book listing + detail), flag OFF.** A pure wiring pass (no new module/schema) unblocked by `book-order` landing. `GET /client/books` (listBooks) + `GET /client/books/:id` (getBookDetail) now branch on `isBookMysql()`. The per-customer **cart qty/cartId** (ws_book_cart*) + **isPurchased** (ws_book_order* by fulfilled status) enrichment — previously the blocker, since those tables were Mongo-only — is now composed from NEW book-order read helpers (`getActiveCartState` / `getPurchasedBookIdSet`); the int book id-space now matches. catalog-book supplies book DATA + computed fields; the controller merges qty + isPurchased (response byte-identical). purchased = status in (verified,shipped,delivered). C3 coercion; detail branches before the ObjectId guard. Verified via live-DB `tsx` (**12/12**: listBooksData + real cart merge + isPurchased proven by seed/cleanup + detail composition); staging restored 6/1; `tsc` clean. Registry + schema-comparison regenerated. **Flag OFF — flips with the catalog/commerce/order cluster.** |
| 2026-06-13 | Phase 3b (WRITE) | **`book-order` — THIRD write path built + wired (book cart checkout), flag OFF.** A DIFFERENT shape (5 tables, line items, courier AWB) — scoped + signed off in [`BOOK_ORDER_SCOPE.md`](./BOOK_ORDER_SCOPE.md). Wired `POST /client/payment/create-order` (book cart) + the **book branch** of `POST /client/payment/verify` behind `isBookOrderMysql()`. **⚠ SCHEMA FIX (read-breaking):** `ws_book_tracking.tracking_id` + `ws_book_order.tracking_id` are BIGINT (AWB ~1.19e11, overflow Int32) but Prisma mapped Int → reads THREW; fixed both to BigInt, regenerated. **create-order (2 phases):** preview cart (`ws_book_cart`+`ws_book_cart_item` → totals w/ `ws_termsandcondition` module='book' free-shipping=500) → Razorpay → ONE `$transaction` writes `ws_book_order` (pending; order_items JSON blob + cart_id + razorpay payload, all NOT NULL) + `ws_book_order_item` rows (FK order_id = VARCHAR business key). **verify:** ONE `$transaction` — insert `ws_book_tracking` (bigint **AUTO_INCREMENT** = AWB; base 119400693004, no Counter) → flip order→verified + tracking_id → deactivate cart (status=0, match user+shipping; cart_item rows KEPT). **customer_id is INT** here (not the course/ebook VARCHAR split). **Embedded→child** (items[]→rows + JSON blob). **Tracking history LOSS (signed-off D-B3):** SQL has no history cols → persist flat row, DTO SYNTHESIZES the single verify entry; varchar(10) status → store short 'verified'. **Dual-read fallback** in verify. Completing this **UNBLOCKS catalog-book wiring**. Verified via live-DB `tsx` (**25/25**: create+items, owner-lookup miss→null, AWB allocation + BigInt no-overflow + tracking FK + cart off + cart_item kept + synthesized history, idempotent re-verify no 2nd AWB); created rows cleaned up (staging 6/1/2/2/3 restored); `tsc` clean. Registry + schema-comparison regenerated. **Flag OFF — go-live needs separate sign-off.** |
| 2026-06-13 | Phase 3b (WRITE) | **`ebook-order` — SECOND write path built + wired (ebook purchase), flag OFF.** Rides the commerce-order pattern. Wired `POST /client/payment/create-order/ebook` + the **ebook branch** of `POST /client/payment/verify` behind `isEbookOrderMysql()`. **ONE-DOC→TWO-TABLES (no tracking, unlike course):** create-order writes `ws_ebook_order` (pending; `unique_id` NOT NULL = receipt id); verify ONE `$transaction` flips order→complete + extend-or-create `ws_ebook_subscription`. The verify ebook branch returns `data:{kind:'ebook',order}` (the ORDER, not the sub) so the DTO mirrors the Mongo EbookOrder doc. **DRIFT (no schema change):** customer_id VARCHAR(order)/INT(sub) split (C3 coercion); **NO ebook_id on the order table** → ebook re-derived from the plan at verify + in the DTO; order.status enum strings IDENTICAL on SQL+Mongo (no translation); order_price = paid amount; duration=DAYS; payment_type enum('online','backend'). **Upsert-extend** (fold +DAYS, sum price, repoint sub at latest order, no new row) + idempotent re-verify. **Dual-read fallback** in verify (MySQL first, Mongo on miss). Verified via live-DB `tsx` (**28/28**: round-trip, owner-lookup miss→null, fresh grant 180-DAY endAt + ebook_id re-derive + order FK, idempotency, upsert-extend, exactly-1-active-row); created rows cleaned up (staging restored 2/1); `tsc` clean (0 ex 2 known). Registry + schema-comparison regenerated. **Flag OFF — go-live needs separate sign-off.** |
| 2026-06-13 | Phase 3b (WRITE) | **`commerce-order` — FIRST write path built + wired (course purchase), flag OFF.** Scoped + signed off ([`WRITE_PATH_SCOPE.md`](./WRITE_PATH_SCOPE.md)): COURSE only; ebook/book next; live-course/test-series deferred (NO SQL tables). Wired `POST /client/payment/create-order/course` + the **course branch** of `POST /client/payment/verify` behind `isCommerceOrderMysql()`. **ONE-DOC→THREE-TABLES:** Mongo writes one `PackageCourseSubscription` doc; SQL splits order (`ws_package_course_order`, written at create-order, status=pending) vs entitlement (`ws_package_course_subscription`) vs trail (`ws_package_course_subscription_tracking`), both written at verify in ONE `$transaction` (flip order→complete + extend-or-create sub+tracking). **DRIFT (no schema change — models already existed):** customer_id TYPE SPLIT (order VARCHAR, sub INT — C3 `Number(req.user.id)` coercion); tracking + tracking.id BIGINT (overflow Int32) → number; `tracking.order` FKs order.id NOT sub.id; order.status enum↔Mongo paymentStatus (pending/complete/cancel ↔ pending/verified/failed); duration=DAYS (planDuration asDays). **UPSERT-EXTEND reproduced** (second buy folds +DAYS endAt + sums amount, no dup card; idempotent re-verify). **DUAL-READ FALLBACK** (rollback safety): verify checks MySQL first, falls through to the Mongo fan-out on miss → a flag flip between create-order and verify can't orphan a payment. Verify response merges order payment + sub entitlement into the Mongo-shaped `data.subscription`. Verified via live-DB `tsx` (**28/28**: round-trip, owner-lookup miss→null, fresh grant, idempotency, upsert-extend, BigInt, DAYS endAt, tracking FK); created rows cleaned up (staging restored 3/2/3); `tsc` clean (0 ex 2 known). Registry + schema-comparison regenerated. **Flag OFF — go-live needs separate sign-off.** |
| 2026-06-12 | Wiring | **Offline center/batch browse reads wired (`offline-batch` built).** `GET /client/offline/{centers,batches}(/:id)` wired behind `isOfflineBatchMysql()` (flag OFF, public routes). `ws_offline_center` + `ws_offline_batch` (+ city). **pendrive-course SKIPPED** first (decommissioned, 7 tables, no migration). **2 SCHEMA FIXES:** (1) bigint overflow — OfflineCenter.phone Int→BigInt (9099665555 overflows; DTO → string) + OfflineEnquiry.mobile Int→BigInt; (2) phantom column — NO `status` col on batch/center but handlers filter {status:true} + Prisma OfflineBatch.status mapped nothing → removed; MySQL branch treats all active + synthesizes status:true. image JSON→images[]; SQL typo `discription`→`description`; center→city relations populated. Dashboard stays Mongo (OfflineBannerSlider); enquiry is a write path (deferred). Verified vs live DB via `tsx` (read no-throw on phone, JSON images, relations, filters, dashboard grouping); `tsc` clean repo-wide. Registry + schema-comparison + api-test (`yarn migration:api:offline-batch`) wired. |
| 2026-06-12 | Catalog | **Book store DATA reads built (`catalog-book`) — flag OFF, NOT wired.** `ws_book` (10) catalogue reads + data-only computed fields (isPaid=price>0, key=combo/individual, daysLeft=null, isNew, shareableLink callback). **NOT wired** (like catalog-package): listBooks/getBookDetail enrich with cart qty (ws_book_cart*) + isPurchased (ws_book_order* by status) — order/cart tables unmigrated, int-vs-ObjectId → flips with the book-order/cart wave. **Schema fix:** ws_book.order_by → nullable. Mongo-only fields (packageIds[] embed, isTrending, publication/deliveryEta) synthesized to defaults. Verified vs live DB via `tsx` (18 checks: computed fields, ordering, filters, search, bulk); `tsc` clean repo-wide. Registry + schema-comparison + api-test (`yarn migration:api:catalog-book`) wired. |
| 2026-06-12 | Wiring | **Exam category NAVIGATION wired (`catalog-exam` built).** `GET /client/exam-categories/:id/children` wired behind `isExamMysql()` (flag OFF). Mirrors catalog-material. **Schema fix:** ExamCategory name/image → nullable. **Differences vs material:** display field `name` (DTO carries title+name); `deleted` flag → active=status&&!deleted; per-child exam count UNCONDITIONAL (no status filter — Mongo parity). Structural translation: childCategoryIds[] embed → `parent_id` self-FK. Verified vs live DB via `tsx` (cat 86→13 children, deleted excluded, havingChildDirectory, unconditional count parity); `tsc` clean repo-wide. Registry + schema-comparison + api-test (`yarn migration:api:catalog-exam`) wired. |
| 2026-06-12 | Wiring | **Material category NAVIGATION wired (`catalog-material` built).** `GET /client/material-categories/:id/children` wired behind `isMaterialMysql()` (flag OFF). `ws_material` + `ws_material_category` (clean Prisma, no schema fix). **Goal investigated + DEFERRED first** (Mongo-only `ws_goals` with embedded labels[]; no SQL table — only flat `ws_customer_target_goal`; `listPackagesByGoal` not reproducible). **Scope:** material ITEM listing stays BLOCKED (entitlement helper joins LiveCourse + Mongo-only `materialCategories[]` embeds; no `isPaid` column). **Structural translation:** Mongo `childCategoryIds[]` embed → SQL `parent` self-FK (children = WHERE parent=id; havingChildDirectory via one distinct query). Verified vs live DB via `tsx` (cat 270→child 1867, count/havingChildDirectory, parentsWithChildren logic); `tsc` clean repo-wide. Registry + schema-comparison + api-test (`yarn migration:api:catalog-material`) wired. |
| 2026-06-12 | Wiring | **eBook surface wired to MySQL (`catalog-ebook` built).** `GET /client/ebooks` (listing) + `/ebooks/:id` (detail) wired behind `isEbookMysql()` (flag OFF). Composes catalog-ebook (`ws_ebook`) + commerce-price (plans) + commerce-ebook-sub (entitlement). **Key finding:** no separate ebook-price module needed — the Mongo `EbookPrice`→`ws_ebook_prices` table **doesn't exist in MySQL**; ebook pricing lives in the **shared `ws_package_course_ebook_price`** (already covered by commerce-price; added plural `listActivePricesByEbooks`). **Schema fix:** ws_ebook description/author → nullable. **isPaid derived from plans** (≥1 active plan >0 — the controller's documented fallback, faithful for SQL); isTrending synthesized false; availablePromoCode always [] (ebooks not in promo appliesTo). Verified vs live DB via `tsx` (19 checks: plans composition, price-derived isPaid, ordering, language filter, search, purchase-state); `tsc` clean repo-wide. Registry + schema-comparison + new api-test (`yarn migration:api:catalog-ebook`) wired. |
| 2026-06-12 | Phase 3a → wiring | **Course LISTING wired to MySQL (`catalog-course` extended) — FIRST commerce-consuming endpoint composed + wired (flag OFF).** Audit (`FLIP_SCOPE.md`) found 40/41 client handlers blocked on unmigrated collections; `listCoursesHandler` was the first fully-coverable one (its only deps — Course + PackageCourseEbookPrice + PackageCourseSubscription — are all built). **Built `listCoursesWithPlans`** composing catalog-course (rows) + commerce-price (plans split by material) + commerce-subscription (purchase state isPurchased/daysLeft, lifetime-aware), mirroring Mongo `paginateCoursesWithPlans` exactly. **SCHEMA FIX:** surfaced `ws_course.is_featured`/`purchase` (MySQL enum('0','1')) via new Prisma enum `CourseFlag01` + `featured_order` → Mongo `isPopular`/`isPaid` (isPopular now a filterable column). Added `commerce-subscription.listActiveForCoursesOrPlans` (lifetime-inclusive; the existing listActiveByCustomer wrongly excluded endAt=null). **Wired** `listCoursesHandler` + `listCoursesByCategoryHandler` on `isCourseMysql()` ahead of the ObjectId guards (MySQL categoryId is int). Verified vs live DB via `tsx` (17 checks PASS: enum→bool, plans buckets, populated refs, pagination, isPopular filter, search, purchase-state); `tsc` clean repo-wide. Registry + catalog api-test updated. Flag OFF → flips with the commerce/catalog cluster. |
| 2026-06-12 | Phase 3a (commerce) | **`commerce-educator` (READ) built — flag OFF; ✅ 3a READS COMPLETE.** Table `ws_course_educator` (56) — a **full entity** (email/password/about/view/last_seen_at), NOT a join table. Read-only public master + `{_id,name,image}` ref for course-listing embeds. **SECURITY:** `password` (NOT NULL) never surfaced (`.select('-password')` parity) across single/list/ref reads. **⚠ LATENT RISK (logged, deliberately NOT fixed):** `id` is `bigint unsigned` mapped `Int` — ids 20–85, no overflow; changing→BigInt would ripple into Course.courseEducatorId FK + the built catalog-course module for zero benefit. `image` nullable (DTO defensive); no SQL `deleted` flag → active=status. No schema change. Verified vs live DB via `tsx` (password-excluded, ref={_id,name,image}, active-only list — ALL PASS); `tsc` clean repo-wide. Registry + schema-comparison + api-test (`yarn migration:api:commerce-educator`) wired. **All six 3a read modules now built + verified, flag OFF (price, subscription, ebook-sub, promoter, promocode, educator). NEXT: THE FLIP** — 3a + catalog (4) + address/profile/bank ON together (first go-live since the customer module) + D2 relations; then 3b write-path (Razorpay, isolated, last). |
| 2026-06-12 | Phase 3a (commerce) | **`commerce-promoter` + `commerce-promocode` (READ) built — flag OFF** (3a modules 4 & 5; the promocode group). `commerce-promoter` (`ws_promoter`, 114 — owner master) + `commerce-promocode` (`ws_promocode` 2 + `ws_promoted_package_course_ebook` 5). **⚠ DECISION (user-confirmed):** the live Mongo PromoCode uses `discountType/discountValue` + `appliesTo{type,ids[]}`; the SQL tables have none of that (discount is a per-plan promoter%/customer% split in the promoted-plan join) → the **client applyPromocode contract CANNOT be reproduced from SQL** → built **SQL-faithful reads only**, flag OFF (same pattern as catalog-package); appliesTo reconciliation is a later effort. **SECURITY:** promoter `password` on the row but NEVER surfaced (Mongo select:false). **SCHEMA FIXES:** promoter full_name/email/phone `String`→`String?`; promocode promocode/promo_start_at/promo_expire_at →nullable (DDL parity); regenerated. Promoter active = status&&!isDelete; promocode valid = status && start<now<expire, promoted plans (per-plan %) on detail read. Verified vs live DB via `tsx` (POLICE60→5 plans, window-bounded case-insensitive code lookup, owner master password-excluded — ALL PASS); `tsc` clean repo-wide. Registry + schema-comparison + api-tests (`yarn migration:api:commerce-promoter` / `:commerce-promocode`) wired. |
| 2026-06-12 | Phase 3a (commerce) | **`commerce-ebook-sub` (READ) built — flag OFF** (3a module 3; the **ebook entitlement source of truth**). Table `ws_ebook_subscription` (1). **Read-only** — writes (create on payment) are **3b**. **⚠ SCHEMA FIX:** the Prisma `EBookSubscription` model was **missing `status`** (tinyint, the active-entitlement flag) **+ `payment_type`** (enum) that exist in the DDL — read contract impossible without `status`; **added** both (reused the `PackageCourseEbookPaymentType` enum), and relaxed `start_at`/`end_at` `DateTime`→`DateTime?` (DDL nullable). Regenerated. **Active = status≠false (NULL=active, matching default 1) AND end_at>now**, latest endAt wins; price Decimal→number; **C3** `customer_id` int (module takes/returns int customerId). Mongo-only promo fields not on this table → not produced. Verified vs live DB via `tsx` (status/payment_type read, active/expired boundary, byOrder, count — ALL PASS); `tsc` clean repo-wide. Registry + schema-comparison + api-test (`yarn migration:api:commerce-ebook-sub`) wired. |
| 2026-06-12 | Phase 3a (commerce) | **`commerce-subscription` (READ) built — flag OFF** (3a module 2; the **entitlement source of truth**). Table `ws_package_course_subscription` (2). **Read-only** — writes (create/extend on payment) are **3b** (verify.controller). **⚠ SCHEMA FIX:** SQL `tracking` is `bigint` (both staging rows ~1.19e11, overflow Int32) but Prisma mapped `trackingId Int?` → **reads would throw**; fixed `trackingId Int?→BigInt?` + the FK target `PackageCourseSubscriptionTracking.id Int→BigInt`, regenerated. Transformer coerces bigint→number (lossless). **Name divergence handled:** Mongo `packageId`=plan=SQL `pcb_id`; Mongo `targetPackageId`=package=SQL `package_id` — DTO uses Mongo names so consumer predicates port 1:1. **C3:** `customer_id` is int (migrated id-space → module takes/returns int customerId; string→int at the caller boundary). Mongo-only promo/payment fields not on this table → not produced. Verified vs live DB via `tsx` (read no-throw on bigint, active/expired boundary, name mapping, counts — ALL PASS); `tsc` clean repo-wide. Registry + schema-comparison + api-test (`yarn migration:api:commerce-subscription`) wired. |
| 2026-06-12 | Phase 3a (commerce) | **`commerce-price` built — flag OFF** (first commerce-wave module; C1 sub-order = price first, lowest risk). Table `ws_package_course_ebook_price` (1353) — pure read-only plan/pricing lookup, no writes/auth. Dual-path in `src/modules/commerce-price/`. `PackageCourseEbookPrice` Prisma model is a **faithful 1:1** of the DDL (all 13 cols, correct `@map`s) — **no schema fix**. **DRIFT found via the tsx verify script:** owner cols (`package_id`/`course_id`/`ebook_id`) use **`0` as the "not this owner" sentinel** (not only NULL — 927/1353 rows mix `0`s + one real id); transformer coalesces `0`/null → null to match Mongo; verified the **exactly-one-owner** invariant holds (`>0` count ≤ 1 every row). `duration` = **DAYS** confirmed live (the `"12 Month"` row carries `365`) — surfaced raw, endAt is 3b's concern; `material_price` null → 0 (Mongo default). **Flag OFF** — flips with catalog + the rest of 3a (consumers join int catalog + ObjectId subscription/order ids). Verified vs live DB via `tsx` (ALL PASS); `tsc` clean for the module. Registry + schema-comparison + api-tests (`yarn migration:api:commerce-price`) wired. Confirmed C1–C4 recommended defaults. |
| 2026-06-11 | Phase 3 (commerce) | **Commerce/dashboard wave SCOPED** — [`COMMERCE_WAVE_SCOPE.md`](./COMMERCE_WAVE_SCOPE.md) (no code yet). Chosen over migrating D2 catalog relations standalone (D2 keyed on the still-OFF int catalog id-space → unblocks nothing). Commerce is what catalog *waits on* (detail/listing join pricing + check subscriptions). **Recommended sequencing — read-first:** **3a** (`commerce-price` 1353, `commerce-subscription` read, `commerce-ebook-sub` read, `commerce-promoter` 114, `commerce-promocode` + promoted, `commerce-educator` 56) **+ D2 folded in** (`ws_package_specific_subject` 1623, `ws_video_category_relation` 2456, `ws_video_category_package_relation` 6907, `ws_package_course_material`) → **flip 3a + catalog + address/profile/bank together** (first go-live since customer module) → **3b** write-path last & isolated (`commerce-order`, subscription writes, `_tracking`, `commerce-ebook-order` — Razorpay `verify.controller` 569 lines). **Schema-drift flags from `DESCRIBE` before coding:** `customer_id` is `varchar` in orders but `int` in subscription (dual id representation — C3 seam); reserved-word `@map` for `_tracking.order` + `video_category_relation.order`; `price.duration` = DAYS; `ws_course_educator` is a full entity not a join table. Open decisions C1–C4 in the doc. |
| 2026-06-11 | Phase 3 (catalog) | **Catalog read backbone built — all flags OFF.** `catalog-package-type` + `catalog-package` (`ws_package_type`/`ws_package`), `catalog-course` (`ws_course`/`ws_course_subject_category`), `catalog-video` (`ws_video`/`ws_video_category`). Decisions: D1 = package→course→video; D2 = **defer** video-category relation tables (client builds groups from Mongo `specificSubjects[]`, not the SQL joins); D3 = build all dual-path + **flip together with the commerce/dashboard wave**. Schema fixes: `Package.shareable_link` + `Course.image` → nullable (DDL parity). **Video URL-encryption contract parity PASS** (fixed-token MySQL===Mongo URL, decrypt===aws_id; never reimplemented — module feeds the shared `encryptVideoSource`). **Found:** entire catalog id-space is int (MySQL) vs ObjectId (Mongo), joined by still-Mongo consumers (purchase-history, my-subscriptions, dashboard, lecture, free, categories) + commerce-wave tables (plans/subscriptions) — no catalog key can flip standalone. All paths verified vs live DB via `tsx`. Registry + schema-comparison generators + api-tests (`yarn migration:api:catalog`) wired. HTTP run pending live `yarn dev`. |
| 2026-06-10 | Phase 2 | **`offline-city` enabled** (cities only) to unblock `customer-address`. Added `status`/`order` columns to `ws_offline_city` (DDL); branched `listCities` + cart `cityId`→name resolution. Verified end-to-end (address cityId=2 → "Ahmedabad" via cart). **Found:** flipping `customer-address` ON also needs the cart/course address *reads* migrated (still Mongoose/ObjectId) — address stays OFF until that small follow-up. |
| 2026-06-10 | Phase 2 | **Customer Module completed.** `customer-lookups` enabled (states/educations/characteristic wired in `address.controller.ts`; live-DB verified 12 states/10 educations). `customer-address`, `customer-profile`, `customer-bank-account` built dual-path, **flags OFF** (each gated by a non-customer dep: OfflineCity/cart, dashboard sources, referral withdrawal). Schema: address/shipping phone `Int`→`BigInt`; `facebook_id` mapped read-only on `Customer`. Shipping assessed as part of cart/order (not standalone). All MySQL paths verified vs live DB via `tsx`. Registry + schema-comparison generators updated; `MIGRATED_MODULES.md` → 13 modules. HTTP `migration:api` run pending live `yarn dev`. |
| 2026-06-06 | Phase 2 | `customer-auth` on Prisma — OTP generate/resend/validate/logout/refresh (`ws_customer` + otp + access_token). Added nullable `refresh_token` column; `full_name`→`firstName`; service branched in place, `authenticate.ts` untouched. `migration:api` — **82/82** (issued MySQL token authenticates protected routes). |
| 2026-06-06 | Fixes | Repaired two pre-existing HEAD regressions from the merge: restored clobbered service imports in `cms.controller.ts` (25 tsc errors) and the missing `package.json` migration scripts block; added the `Explore` banner key. |
| 2026-06-06 | Phase 2 | `popup` on Prisma — `promoExpireAt`↔`promo_expire_at` date map; client active-popup query (status+expiry+newest). Confirmed S3 upload is DB-agnostic middleware. `migration:api` — **73/73**. Read-only/CMS group complete; `social-link` confirmed Mongo-only. |
| 2026-06-06 | Phase 2 | `terms` on Prisma — client array vs `?module=` single/null preserved. Tests caught MySQL `module` enum (error 1265 on free-string write); added MySQL-specific enum zod schema on admin writes. `migration:api` — **64/64**. |
| 2026-06-06 | Phase 2 | `department` (contact-us) on Prisma — `ws_department` + `ws_department_contact` join under embedded `contacts[]`; admin `contactSchema` extended for call/whatsapp flags. `migration:api` — **52/52**. `dynamic-image` skipped (no API surface). |
| 2026-06-06 | Phase 2 | Generators (`schema-comparison`, `field-comparison`) now load `.env` so migrated status follows `MIGRATION_MYSQL_MODULES`. |
| 2026-06-06 | Phase 2 | `banner-slider` + `testimonial` on Prisma; `yarn migration:api` — **45/45** (incl. reorder, writes). Registry/docs regenerated. |
| 2026-06-06 | Phase 1 | Local env re-provisioned; dump imported via `db:import:sh`; `db:verify` — 89 tables, 26 customers, 4 packages. |
| 2026-06-04 | Phase 2 | FAQ module on Prisma (`ws_faq`); `yarn db:test-faq` — 13 rows. |
| 2026-06-04 | Phase 2 | CMS pilot: `app-update` + `version` on Prisma; transformers; `MIGRATION_MYSQL_MODULES`. |
| 2026-06-04 | Phase 2 | `yarn db:test-cms-pilot` — staging values from MySQL (4235200 / 40976). |
| 2026-06-04 | Docs | Tracker §2 strategy alignment; Phase 2 section added. |
| 2026-06-04 | Docs | Added `testing-guide.md` + `MIGRATION_TEST_LOG.md` for validation tracking. |
| 2026-06-04 | Planning | Reviewed `legacy_system_migration_strategy.md`; mapped repos and schema gap (MySQL vs Mongo). |
| 2026-06-04 | Phase 1 | Added `ws-mysql` to `docker-compose.yml` (port 3307). |
| 2026-06-04 | Phase 1 | Added Prisma schema, client, scripts, `.env.example`, `docs/migration/phase-1-mysql.md`. |
| 2026-06-04 | Phase 1 | `yarn prisma:generate` succeeded. |
| 2026-06-04 | Phase 1 | Docker MySQL started; `yarn db:import` completed. |
| 2026-06-04 | Phase 1 | `yarn db:verify` — 89 tables, 26 customers, 4 packages. |
| 2026-06-04 | Phase 1 | DBeaver connection confirmed by team. |
| 2026-06-04 | Docs | Created `MIGRATION_TRACKER.md` (under `docs/migration/`). |
| 2026-06-04 | Docs | Consolidated all migration docs into `docs/migration/`. |
| 2026-06-04 | Docs | Added `SCHEMA_COMPARISON.md` + `yarn docs:schema-comparison` generator. |

---

*When you complete a new migration step, add a row to **§14 Changelog** and update the phase table in **§3**.*
