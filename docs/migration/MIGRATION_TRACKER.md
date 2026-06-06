# Web Sankul — Migration Tracker

> **Project:** `new-web-sankul` (modern stack)  
> **Strategy reference:** [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md)  
> **Last updated:** 2026-06-06  
> **Current phase:** Phase 2 — Backend stabilization (**in progress**; 8 modules on MySQL: app-update, version, faq, banner-slider, testimonial, department, terms, popup. Read-only/CMS group complete — next: customer auth)  
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
4. **Customer auth** — login, OTP, tokens (high traffic; needs transformers) — ⏳ **next**.
5. **Catalog** — courses, packages, videos.
6. **Commerce** — orders, subscriptions, promocodes.
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

**Next module to port:** `department` / `dynamic-image` (remaining read-heavy CMS), then `customer` auth.

---

## 16. Changelog

| Date | Phase | What was done |
|------|-------|----------------|
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
