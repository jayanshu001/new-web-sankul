# Migration — Testing & Validation Guide

Use this guide **at every phase/module** before moving on. Record results in [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md).

---

## Quick workflow

```txt
1. Run automated checks (scripts)     → log in Test Log § Automated
2. Validate data in DBeaver         → log in Test Log § Data
3. Call APIs (or use admin UI)      → log in Test Log § API / UI
4. Optional write-back test         → log in Test Log § Write-back
5. Mark module "validated" in tracker only when all required rows pass
```

**Rule:** Do not add the next module to `MIGRATION_MYSQL_MODULES` until the current module’s required tests are **Pass** in the test log.

---

## Prerequisites (every session)

| # | Check | Command / action |
|---|--------|------------------|
| P1 | Docker running | Docker Desktop started |
| P2 | MySQL container up | `yarn db:up` → `docker compose ps ws-mysql` = running |
| P3 | Dump imported | `yarn db:import` (if empty DB or fresh volume) |
| P4 | `.env` has MySQL URL | `DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging` |
| P5 | Prisma client generated | `yarn prisma:generate` |
| P6 | For Phase 2+ modules | `MIGRATION_MYSQL_MODULES` lists modules you are testing |

---

## Phase 1 — Database preservation

### Automated

```powershell
cd D:\Projects\web-sankul\new-web-sankul
yarn db:verify
```

| Pass criteria |
|---------------|
| `MySQL connection: OK` |
| `Active database: websankul_staging` |
| `ws_* tables` ≥ 80 (staging dump: **89**) |
| `ws_customer rows` > 0 (staging: **26**) |

### DBeaver (manual)

1. Connect: host `127.0.0.1`, port **3307**, DB `websankul_staging`, user `root`, password `websankul_dev`.
2. Run:

```sql
SELECT COUNT(*) AS ws_tables
FROM information_schema.tables
WHERE table_schema = 'websankul_staging' AND table_name LIKE 'ws_%';

SELECT COUNT(*) AS customers FROM ws_customer;
SELECT * FROM ws_app_update WHERE id = 1;
SELECT * FROM ws_versions WHERE id = 1;
```

| Pass criteria |
|---------------|
| Table count matches `yarn db:verify` |
| Sample rows visible, no connection errors |

---

## Phase 2 — Per-module validation (CMS pilot example)

Applies to any module once it is listed in `MIGRATION_MYSQL_MODULES`.

### Step A — Automated (no HTTP)

```powershell
# Ensure pilot modules are enabled in .env:
# MIGRATION_MYSQL_MODULES=app-update,version

yarn db:test-cms-pilot
```

| Pass criteria |
|---------------|
| `CMS pilot OK` |
| `latestVersion` = **4235200** (matches `ws_app_update` in DBeaver) |
| `latestVersionCode` = **40976** (matches `ws_versions`) |

### Step B — Confirm API uses MySQL (server boot)

```powershell
yarn dev
```

In server logs, expect:

```text
[migration] MySQL modules active: app-update,version
MySQL connected (Prisma).
MongoDB connected.
```

| Pass criteria |
|---------------|
| Both Prisma and Mongo connect (Mongo still required for other routes) |
| No Prisma connection errors |

### Step C — DBeaver ↔ API data match (read)

| Source | `ws_app_update` id=1 | `ws_versions` id=1 |
|--------|----------------------|---------------------|
| DBeaver | `latestVersion`, `updateType`, `isUpdateAvailble` | `latestVersionCode`, `lastSupportedVersionCode` |
| API GET (below) | `latestVersion`, `updateType`, `isUpdateAvailable` | same field names as Mongo API |

Note: API uses `isUpdateAvailable` (transformer maps MySQL typo column).

### Step D — Admin API (HTTP)

**Automated (recommended):** see [`api-tests/README.md`](./api-tests/README.md)

```powershell
# Terminal 1: yarn dev
# Terminal 2:
yarn migration:api
# or: yarn migration:api:faq
```

Set `MIGRATION_TEST_ADMIN_EMAIL` / `MIGRATION_TEST_ADMIN_PASSWORD` in `.env`. Optional client tests: `MIGRATION_TEST_CUSTOMER_PHONE`.

**Manual (PowerShell)** — same checks if you prefer:

**Base URL:** `http://localhost:4001` (or your `PORT` in `.env`)

**1. Get admin JWT** (admin users still in Mongo until that module is migrated):

```powershell
$body = @{ email = "YOUR_ADMIN_EMAIL"; password = "YOUR_PASSWORD" } | ConvertTo-Json
$r = Invoke-RestMethod -Method POST -Uri "http://localhost:4001/api/v1/admin/auth/login" `
  -ContentType "application/json" -Body $body
$token = $r.data.token   # adjust path if response shape differs
```

**2. App update**

```powershell
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod -Method GET -Uri "http://localhost:4001/api/v1/admin/cms/app-update" -Headers $headers
```

| Pass criteria |
|---------------|
| `success: true` |
| `data.latestVersion` = **4235200** |
| `data.updateType` = `flexible` |
| `data.isUpdateAvailable` = `false` (or matches DB) |

**3. Version**

```powershell
Invoke-RestMethod -Method GET -Uri "http://localhost:4001/api/v1/admin/cms/version" -Headers $headers
```

| Pass criteria |
|---------------|
| `data.latestVersionCode` = **40976** |
| `data.lastSupportedVersionCode` = **40976** |

### Step E — Client API (optional)

Requires a **customer** JWT (`authenticate` on client routes).

```powershell
# After customer login:
Invoke-RestMethod -Method GET -Uri "http://localhost:4001/api/v1/client/version" -Headers @{ Authorization = "Bearer $customerToken" }

Invoke-RestMethod -Method GET -Uri "http://localhost:4001/api/v1/client/upgrade?clientVersion=40000" -Headers @{ Authorization = "Bearer $customerToken" }
```

| Pass criteria |
|---------------|
| `upgrade` returns `latestVersion` consistent with app-update row |
| `isUpdateAvailable` / `isForceUpdate` logic unchanged vs pre-migration behavior |

### Step F — Write-back (proves Prisma write path)

**Only on local DB** — pick a value you can revert.

```powershell
$payload = @{
  latestVersion = 4235201
  updateType = "flexible"
  isUpdateAvailable = $false
} | ConvertTo-Json

Invoke-RestMethod -Method PUT -Uri "http://localhost:4001/api/v1/admin/cms/app-update" `
  -Headers $headers -ContentType "application/json" -Body $payload
```

Then in DBeaver:

```sql
SELECT * FROM ws_app_update WHERE id = 1;
```

| Pass criteria |
|---------------|
| `latestVersion` = **4235201** in MySQL |
| GET `/app-update` returns the same value |
| Revert to **4235200** when done (PUT again or re-import dump) |

### Step G — React admin UI (optional)

1. Point admin frontend to `http://localhost:4001`.
2. Open CMS → App Update / Version screens.
3. Values should match DBeaver and GET APIs.

| Pass criteria |
|---------------|
| UI loads without errors |
| Displayed numbers match API/DBeaver |

### Step H — Mongo fallback (regression)

1. Remove `app-update,version` from `MIGRATION_MYSQL_MODULES` (or comment out).
2. Restart `yarn dev`.
3. GET `/admin/cms/app-update` should read from **Mongo** again.

| Pass criteria |
|---------------|
| App still responds (no 500) |
| Data may differ from MySQL — proves toggle works |

Re-enable `MIGRATION_MYSQL_MODULES` after this test.

---

## Phase 2 — FAQ module

**Env:** `MIGRATION_MYSQL_MODULES=...,faq`

```powershell
yarn db:test-faq
```

| Pass criteria |
|---------------|
| `FAQ module OK` |
| 13 FAQs (5 `general`, 8 `referral`) |
| 2 synthetic faq-types |

**DBeaver:**

```sql
SELECT type, COUNT(*) FROM ws_faq GROUP BY type;
SELECT * FROM ws_faq WHERE id = 1;
```

**Admin API** (with JWT):

- `GET /api/v1/admin/cms/faqs`
- `GET /api/v1/admin/cms/faq-types`
- Create: `POST /api/v1/admin/cms/faqs` body `{ "type": "general", "question": "...", "answer": "...", "isExpand": false }`

**Client API:**

- `GET /api/v1/client/faqs?type=general`
- `GET /api/v1/client/faq-types`

Log results in [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) § Phase 2 — FAQ.

---

## Template for the next module (copy to test log)

When you port e.g. `faq` or `banner-slider`:

1. Add module name to `MIGRATION_MYSQL_MODULES`.
2. Run `yarn db:verify` (sanity).
3. DBeaver: count rows in target `ws_*` table(s).
4. Document admin/client **method + URL + expected JSON** in test log.
5. GET list/detail → compare fields to SQL.
6. POST/PUT one row → confirm in DBeaver.
7. UI smoke (if applicable).
8. Log **Pass/Fail** in [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md).

---

## Troubleshooting tests

| Failure | What to check |
|---------|----------------|
| `db:verify` fails | `yarn db:up`, `yarn db:import`, `DATABASE_URL` port **3307** |
| `db:test-cms-pilot` zeros | `MIGRATION_MYSQL_MODULES` set; dump has id=1 rows |
| API 401 | Admin/customer token expired or wrong login |
| API 500 Prisma | `yarn prisma:generate`; table exists; run server logs |
| API data ≠ DBeaver | Module not in `MIGRATION_MYSQL_MODULES`; restart server |
| PUT not in MySQL | Module still on Mongoose; check env and restart |

---

## Related docs

- [`README.md`](./README.md) — index of all migration docs
- [`SCHEMA_COMPARISON.md`](./SCHEMA_COMPARISON.md) — table/collection/column differences (run `yarn docs:schema-comparison` to refresh)
- [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) — what was built, when
- [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) — your pass/fail record
- [`phase-1-mysql.md`](./phase-1-mysql.md) — Phase 1 setup only
- [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md) — full 8-phase strategy
