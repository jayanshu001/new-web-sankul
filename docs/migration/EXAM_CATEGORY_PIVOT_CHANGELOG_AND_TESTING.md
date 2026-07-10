# `ws_exam_category_pivot` — change summary & local testing guide

> **Branch feature:** Many-to-many exam ↔ category links via `ws_exam_category_pivot`, wired into read/write API paths.  
> **Verified:** 2026-07-10 — `migration:api:exam-category-pivot` **13/13** passed.  
> **Related docs:** [`EXAM_CATEGORY_PIVOT_API_HANDOFF.md`](./EXAM_CATEGORY_PIVOT_API_HANDOFF.md) (schema/API detail), [`DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md) (deploy).

---

## 1. What changed (overview)

### Problem

Production uses **`ws_exam_category_pivot`** so one exam can appear under multiple categories (root parents, cross-tree visibility). The staging SQL dump did **not** include this table. All exam-by-category queries previously used only `ws_exam.exam_category_id` (single category).

### Solution

| Layer | What we added |
|-------|----------------|
| **Database** | New table `ws_exam_category_pivot` (`exam_id`, `category_id`, timestamps, unique pair, FK cascade) |
| **Prisma** | Model `ExamCategoryPivot` + relations on `Exam` / `ExamCategory` |
| **Shared helper** | `src/modules/catalog-exam/exam-category-pivot.where.ts` — `examInCategoryWhere`, `examInCategoriesWhere`, `replaceExamCategoryPivot` |
| **Read paths** | Exam listings & counts now match `exam_category_id` **OR** pivot link |
| **Write paths** | Admin create/update re-syncs pivot (primary category + ancestors) |
| **Seeders** | Import prod SQL or build a local demo fixture |
| **HTTP tests** | `docs/migration/api-tests/exam-category-pivot/pivot.api.test.ts` |

### Query rule (all read paths)

```txt
Include exam when:
  exam.exam_category_id = categoryId
  OR
  EXISTS pivot row (exam_id, category_id) for that category
```

With descendant category lists, use `categoryId IN ids` on both sides (see `examInCategoriesWhere`).

---

## 2. Files & modules touched

### Schema & data

| File | Purpose |
|------|---------|
| `docs/migration/schema-changes/2026-07-10_exam_category_pivot.sql` | DDL — creates empty pivot table |
| `prisma/schema.prisma` | `ExamCategoryPivot` model |
| `scripts/seed-exam-category-pivot.ts` | Prod SQL import + `--demo` mode |
| `old_db/ws_exam_category_pivot.sql` | Production export (~9.4k unique pairs) |

### API — shared

| File | Change |
|------|--------|
| `src/modules/catalog-exam/exam-category-pivot.where.ts` | **New** — pivot WHERE helpers + `replaceExamCategoryPivot` |

### API — read paths

| Module | File | Functions / area |
|--------|------|------------------|
| client-exam | `src/modules/client-exam/client-exam.repository.ts` | `examsByCategory`, `examsByCategoryPaged`, `countExamsByCategoryPaged` |
| admin-exam | `src/modules/admin-exam/admin-exam.repository.ts` | `examListWhere` (admin list `?categoryId=`) |
| catalog-exam | `src/modules/catalog-exam/catalog-exam.repository.ts` | `countExams`, `examCountForCategory` |
| client-catalog | `src/modules/client-catalog/client-catalog.service.ts` | `catalogTests` counts |
| catalog-course | `src/modules/catalog-course/course-detail.sql.ts` | Course detail Tests tab counts |
| catalog-package | `src/modules/catalog-package/catalog-package.detail.sql.ts` | Package exam-group counts |
| client-free | `src/modules/client-free/client-free.service.ts` | Free exam listings by category |

### API — write paths

| Module | File | Change |
|--------|------|--------|
| admin-exam | `src/modules/admin-exam/admin-exam.service.ts` | Calls `replaceExamCategoryPivot` after create/update |

### Tests & tooling

| File | Purpose |
|------|---------|
| `docs/migration/api-tests/exam-category-pivot/pivot.api.test.ts` | 13 HTTP regression tests |
| `docs/migration/api-tests/exam-category-pivot/API_DOC.md` | Auto-generated captured requests/responses |
| `docs/migration/api-tests/run-module.ts` | Runner key `exam-category-pivot` |
| `docs/migration/api-tests/run-all.ts` | Included in full migration suite |
| `docs/migration/api-tests/modules.manifest.ts` | Module registry entry |
| `package.json` | `seed:exam-category-pivot`, `seed:exam-category-pivot:demo`, `migration:api:exam-category-pivot` |

---

## 3. Prerequisites (after `git pull`)

You need:

- **Node.js** + **Yarn** (project uses `yarn`)
- **Docker Desktop** (local MySQL + Redis)
- **`.env`** in `new-web-sankul/` with at least:
  - `DATABASE_URL` → local MySQL (default Docker: port **3307**)
  - `REDIS_URL` (or host/port vars used by the app)
  - `MIGRATION_MYSQL_MODULES` includes `client-exam`, `admin-exam`, `catalog-exam` (full list in `.env.example`)
  - `PORT` (default **4001**)

**Staging DB assumption:** `websankul_staging.sql` is already imported (exam `300001` exists). Demo tests rely on that exam + categories **6** and **12**.

---

## 4. Step-by-step — reproduce our local setup

Run everything from the **`new-web-sankul`** directory.

### Step 1 — Install dependencies

```powershell
cd new-web-sankul
yarn install
```

### Step 2 — Start MySQL & Redis

```powershell
yarn db:up
```

Wait until MySQL is healthy (`docker ps` — `ws-mysql` healthy).

### Step 3 — Import staging dump (first time only)

Skip if your local DB already has staging data.

```powershell
yarn db:import
```

Verify connection:

```powershell
yarn db:verify
```

### Step 4 — Apply DDL (creates pivot table)

```powershell
yarn db:migrate
```

Confirm table exists:

```sql
SHOW TABLES LIKE 'ws_exam_category_pivot';
```

### Step 5 — Regenerate Prisma client

```powershell
yarn prisma:generate
```

> If you get `EPERM` / DLL locked: **stop `yarn dev`**, run `yarn prisma:generate`, then start dev again.

### Step 6 — Typecheck

```powershell
yarn typecheck
```

### Step 7 — Seed demo pivot data (local/staging)

Use **demo** mode on staging — prod SQL import usually inserts **0 rows** (exam IDs in the export don't exist locally).

```powershell
yarn seed:exam-category-pivot:demo
```

Expected output (approximate):

```txt
Built 2 demo pivot row(s).
total rows in table : 2
```

Verify in SQL:

```sql
SELECT * FROM ws_exam_category_pivot WHERE exam_id = 300001;
-- expect rows for category_id 6 and 12
```

### Step 8 — Start API server (one instance only)

**Terminal A:**

```powershell
yarn dev
```

Wait for `Server Local IP` / listening on port **4001**.

**Important — port check (we hit this during QA):**

```powershell
netstat -ano | findstr :4001
```

You should see **one** `LISTENING` process (Node). If two processes bind to `4001` (e.g. Node + IDE port-forward), API tests become **flaky** (category 6 may pass, category 12 may fail). Kill extras before testing:

```powershell
# Note the PID from netstat, then:
taskkill /PID <pid> /F
```

Health check:

```powershell
curl http://localhost:4001/healthz
```

### Step 9 — Run automated HTTP tests (same as we did)

**Terminal B** (keep dev running in Terminal A):

```powershell
cd new-web-sankul
yarn migration:api:exam-category-pivot
```

**Expected:** `exam-category-pivot: 13/13 passed`

The test suite **self-resets** a fixture before assertions:

- Exam `300001` → `exam_category_id = 1637` (not 6 or 12 — forces pivot-only match)
- Pivot rows: `(300001, 6)` and `(300001, 12)`
- Valid `startAt` / `endAt` so listings are not filtered out

### Step 10 — Run related regression suites (optional but recommended)

```powershell
yarn tsx docs/migration/api-tests/run-module.ts catalog-exam
yarn tsx docs/migration/api-tests/run-module.ts catalog
```

**Expected:** `catalog-exam` 4/4, `catalog` 8/8 (1 skipped).

### Step 11 — Full migration suite (optional)

```powershell
yarn migration:api
```

Includes `exam-category-pivot` plus all other wired modules.

---

## 5. What the 13 HTTP tests cover

| # | Test | Endpoint |
|---|------|----------|
| 1 | Server up | `GET /healthz` |
| 2 | Auth tokens | Mock JWT from `docs/migration/api-tests/.auth.json` |
| 3 | Fixture setup | DB reset for exam `300001` + pivot rows |
| 4 | DB pivot rows | `(300001 ↔ 6)`, `(300001 ↔ 12)` |
| 5 | Client quizzes cat 6 | `GET /api/v1/client/quizzes/categories/6/exams` |
| 6 | Client quizzes cat 12 | `GET /api/v1/client/quizzes/categories/12/exams` |
| 7 | Paged listing cat 6 | `GET /api/v1/client/exam-categories/6/exams` |
| 8 | Paged listing cat 12 | `GET /api/v1/client/exam-categories/12/exams` |
| 9 | Negative control | `GET .../categories/14/exams` — must **not** include `300001` |
| 10 | Admin filter cat 6 | `GET /api/v1/admin/quizzes?categoryId=6` |
| 11 | Admin filter cat 12 | `GET /api/v1/admin/quizzes?categoryId=12` |
| 12 | Category children | `GET /api/v1/client/exam-categories/6/children` (pivot-aware counts) |
| 13 | Admin write | `PUT /api/v1/admin/quizzes/300001` — re-syncs pivot |

Captured examples: [`api-tests/exam-category-pivot/API_DOC.md`](./api-tests/exam-category-pivot/API_DOC.md)

**Skip write test:** set `MIGRATION_API_SKIP_WRITE=true` in `.env` to skip test #13.

---

## 6. Manual smoke tests (curl / Postman)

Use a customer JWT (`yarn migration:api:auth` mints test tokens to `docs/migration/api-tests/.auth.json`).

```http
GET /api/v1/client/quizzes/categories/6/exams
Authorization: Bearer <customer-token>
```

Response should include exam `_id: "300001"` in `data.exams[]` even though `ws_exam.exam_category_id` is **not** 6 (fixture uses pivot only).

Admin list:

```http
GET /api/v1/admin/quizzes?categoryId=12&limit=50
Authorization: Bearer <admin-token>
```

---

## 7. Production seed (not for local staging)

When the target DB has production `ws_exam` rows (IDs 714+):

```powershell
yarn seed:exam-category-pivot
```

Reads `old_db/ws_exam_category_pivot.sql`, filters orphan FKs by default (`SEED_EXAM_CATEGORY_PIVOT_SKIP_ORPHANS=true`).

| Env var | Default | Purpose |
|---------|---------|---------|
| `SEED_EXAM_CATEGORY_PIVOT_MODE` | `sql` | `demo` for local fixture |
| `SEED_EXAM_CATEGORY_PIVOT_FILE` | `old_db/ws_exam_category_pivot.sql` | SQL export path |
| `SEED_EXAM_CATEGORY_PIVOT_TRUNCATE` | `false` | `TRUNCATE` before insert (dev only) |
| `SEED_EXAM_CATEGORY_PIVOT_DEMO_CATEGORY_ID` | `6` | Fallback leaf category |
| `SEED_EXAM_CATEGORY_PIVOT_DEMO_EXTRA_ROOT` | `12` | Extra pivot link per exam (`0` = off) |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `seed:exam-category-pivot` inserts **0 rows** | Prod exam IDs missing in local DB | Use `yarn seed:exam-category-pivot:demo` |
| Category 6 passes, category 12 fails (flaky) | Two listeners on port `4001` | `netstat -ano \| findstr :4001` → kill duplicate PIDs |
| `yarn prisma:generate` EPERM | `yarn dev` locks Prisma DLL | Stop dev, regenerate, restart dev |
| `Server not reachable at .../healthz` | Dev server not running | `yarn dev` in separate terminal |
| Empty exam lists | Exam `endAt` in the past | Re-run tests (fixture sets future `endAt`) or `yarn seed:exam-category-pivot:demo` |
| `MIGRATION_MYSQL_MODULES must include ...` | Module flag missing | Add module to `.env`, restart `yarn dev` |

---

## 9. Quick command cheat sheet

```powershell
# One-time setup
yarn install
yarn db:up
yarn db:import          # first time only
yarn db:migrate
yarn prisma:generate
yarn typecheck

# Per test run
yarn seed:exam-category-pivot:demo
yarn dev                # terminal A — single instance
yarn migration:api:exam-category-pivot   # terminal B

# Related
yarn tsx docs/migration/api-tests/run-module.ts catalog-exam
yarn tsx docs/migration/api-tests/run-module.ts catalog
```

---

## 10. Deploy note

On deploy: `yarn db:migrate` creates the empty table → `yarn seed:exam-category-pivot` on production-shaped DB → `yarn prisma:generate` → restart API. See [`DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md).

---

*Document created: 2026-07-10. Matches the QA flow used on the `migration` branch.*
