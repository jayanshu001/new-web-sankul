# `ws_exam_category_pivot` — schema handoff & API work guide

> **Status (schema):** DDL + Prisma model + seeders — **done**  
> **Status (API):** Read/write paths implemented — **done** (2026-07-10)  
> **Testing guide (pull + reproduce):** [`EXAM_CATEGORY_PIVOT_CHANGELOG_AND_TESTING.md`](./EXAM_CATEGORY_PIVOT_CHANGELOG_AND_TESTING.md)  
> **Owner (API):** _assign colleague for QA / follow-up_  
> **DDL file:** [`schema-changes/2026-07-10_exam_category_pivot.sql`](./schema-changes/2026-07-10_exam_category_pivot.sql)  
> **Seed source:** [`old_db/ws_exam_category_pivot.sql`](../../old_db/ws_exam_category_pivot.sql) (~17.5k rows from production)

---

## 1. What was done (you do **not** need to redo)

| Step | Artifact | Command |
|------|----------|---------|
| Empty table DDL | `docs/migration/schema-changes/2026-07-10_exam_category_pivot.sql` | `yarn db:migrate` |
| Prisma model | `prisma/schema.prisma` → `ExamCategoryPivot` | `yarn prisma:generate` |
| Data seeder (prod SQL) | `scripts/seed-exam-category-pivot.ts` | `yarn seed:exam-category-pivot` |
| Data seeder (local demo) | same script, `--demo` | `yarn seed:exam-category-pivot:demo` |

**Apply locally:**

```powershell
cd new-web-sankul
yarn db:migrate          # creates empty ws_exam_category_pivot
yarn prisma:generate     # prisma.examCategoryPivot available

# Staging / local (few exams) — builds pivot from ws_exam in DB
yarn seed:exam-category-pivot:demo

# Production SQL file — needs matching ws_exam rows in DB
yarn seed:exam-category-pivot
```

Verify:

```sql
SHOW CREATE TABLE ws_exam_category_pivot;
SELECT COUNT(*) FROM ws_exam_category_pivot;  -- expect 0 until seeded
```

---

## 2. Why this table exists

| Mechanism | Cardinality | Purpose |
|-----------|-------------|---------|
| `ws_exam.exam_category_id` | **One** category per exam | Primary / leaf subject category |
| `ws_exam_category_pivot` | **Many** categories per exam | Extra catalog links (root parents, multi-tree visibility) |

**Missing from** `old_db/websankul_staging.sql` — exists in **production** only. Staging dump has 1 exam row; full pivot seed needs matching `ws_exam` rows or a filtered import.

**Production shape:**

```sql
id          BIGINT UNSIGNED PK AUTO_INCREMENT
exam_id     INT NOT NULL  → ws_exam.id
category_id INT NOT NULL  → ws_exam_category.id
created_at, updated_at
UNIQUE (exam_id, category_id)
FK CASCADE on delete (exam + category)
```

---

## 3. Seed data (separate from DDL — DevOps / before API QA)

DDL creates an **empty** table. Import data when ready:

```powershell
# Local / staging (few exams — recommended for websankul_staging.sql)
yarn seed:exam-category-pivot:demo

# Production SQL export (needs matching ws_exam rows in DB)
yarn seed:exam-category-pivot
```

| Command | When to use |
|---------|-------------|
| `yarn seed:exam-category-pivot:demo` | Staging dump, 1 exam, no prod `ws_exam` rows |
| `yarn seed:exam-category-pivot` | Full prod DB with exams 714+ |

**Demo mode** links each `ws_exam` to its category tree (+ optional extra root **12**). Staging exam `300001` references missing category `1637` → falls back to category **6**.

| Env | Default | Purpose |
|-----|---------|---------|
| `SEED_EXAM_CATEGORY_PIVOT_DEMO_CATEGORY_ID` | `6` | Fallback leaf when `exam_category_id` missing |
| `SEED_EXAM_CATEGORY_PIVOT_DEMO_EXTRA_ROOT` | `12` | Extra root link per exam (`0` = off) |
| `SEED_EXAM_CATEGORY_PIVOT_FILE` | `old_db/ws_exam_category_pivot.sql` | SQL export path (sql mode) |
| `SEED_EXAM_CATEGORY_PIVOT_SKIP_ORPHANS` | `true` | Sql mode: drop orphan FK rows |
| `SEED_EXAM_CATEGORY_PIVOT_DRY_RUN` | `false` | Preview only, no writes |
| `SEED_EXAM_CATEGORY_PIVOT_TRUNCATE` | `false` | `TRUNCATE` before insert (dev) |

**Manual SQL** (alternative):

```sql
-- Example: after loading into a temp table or filtered file
INSERT INTO ws_exam_category_pivot (exam_id, category_id, created_at, updated_at)
SELECT p.exam_id, p.category_id, p.created_at, p.updated_at
FROM ws_exam_category_pivot_import p
INNER JOIN ws_exam e ON e.id = p.exam_id
INNER JOIN ws_exam_category c ON c.id = p.category_id
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);
```

> FK constraints will **reject** orphan `exam_id` / `category_id` rows.

---

## 4. Prisma usage (for API work)

```ts
import { prisma } from "../../config/prisma";

// By category
await prisma.examCategoryPivot.findMany({ where: { categoryId: 6 } });

// By exam
await prisma.examCategoryPivot.findMany({ where: { examId: 714 } });

// Include relations
await prisma.exam.findMany({
  where: {
    OR: [
      { examCategoryId: categoryId },
      { examCategoryPivot: { some: { categoryId } } },
    ],
  },
});
```

Model: `ExamCategoryPivot` → table `ws_exam_category_pivot`  
Relations: `Exam.examCategoryPivot[]`, `ExamCategory.examCategoryPivot[]`

---

## 5. API / repository changes (**your work**)

Today **all** exam-by-category queries use only `ws_exam.exam_category_id`. They must also consider the pivot when listing or counting exams under a category (especially package/course **Tests** tabs and parent categories).

### 5.1 Read paths — update query logic

When resolving exams for category `C` (and optionally its descendants `ids[]`):

```txt
Match exam if:
  exam.exam_category_id IN ids
  OR
  EXISTS pivot WHERE pivot.exam_id = exam.id AND pivot.category_id IN ids
```

| Priority | Module | File | Functions / area |
|----------|--------|------|------------------|
| 1 | client-exam | `src/modules/client-exam/client-exam.repository.ts` | `examsByCategory`, `examsByCategoryPaged`, `countExamsByCategoryPaged` |
| 2 | client-catalog | `src/modules/client-catalog/client-catalog.service.ts` | `catalogTests` — `prisma.exam.count({ examCategoryId: { in: ids } })` |
| 3 | catalog-course | `src/modules/catalog-course/course-detail.sql.ts` | Tests block — same count pattern |
| 4 | catalog-exam | `src/modules/catalog-exam/catalog-exam.repository.ts` | `countExams` / category-scoped counts |
| 5 | client-free | `src/modules/client-free/client-free.service.ts` | Free exam listings if filtered by category |

**Suggested Prisma pattern** (leaf category, no descendants):

```ts
where: {
  status: true,
  OR: [
    { examCategoryId: categoryId },
    { examCategoryPivot: { some: { categoryId } } },
  ],
}
```

**With descendant ids** (`ids` from `descendantIds("ws_exam_category", "parent_id", rootId)`):

```ts
OR: [
  { examCategoryId: { in: ids } },
  { examCategoryPivot: { some: { categoryId: { in: ids } } } },
]
```

Deduplicate in application layer if an exam matches both paths (same exam, one row).

### 5.2 Write paths — admin exam CRUD

| Module | File | Change |
|--------|------|--------|
| admin-exam | `src/modules/admin-exam/admin-exam.service.ts` | On create/update: sync pivot rows |
| admin-exam | `src/modules/admin-exam/admin-exam.repository.ts` | `createMany` / `deleteMany` on `examCategoryPivot` |

**Minimum sync rule (match prod behaviour):**

- Keep `exam_category_id` as the canonical primary category on `ws_exam`.
- Ensure pivot contains at least `(exam_id, exam_category_id)` after create/update.
- If admin UI later supports multiple categories, replace pivot set for that exam.

On **delete exam**: FK `ON DELETE CASCADE` removes pivot rows automatically.

### 5.3 Out of scope (different tables)

Do **not** confuse with:

- `ws_exam_category_course` — course ↔ category (already implemented)
- `ws_exam_category_package` — package ↔ category (already implemented)

---

## 6. Testing checklist

After API changes + seed:

| Check | How |
|-------|-----|
| Table exists | `yarn db:migrate` on fresh DB |
| Prisma client | `yarn prisma:generate` + `yarn typecheck` |
| Counts match prod | Compare category exam counts for a known package/course with prod |
| Client listing | GET exams under a parent category linked only via pivot |
| Admin CRUD | Create exam → pivot row exists for `exam_category_id` |
| Cascade delete | Delete exam → pivot rows gone |

Add HTTP tests under `docs/migration/api-tests/exam-category-pivot/`:

```bash
yarn seed:exam-category-pivot:demo   # staging/local fixture
yarn migration:api:exam-category-pivot
```

**Verified 2026-07-10:** 13/13 passed — see [`EXAM_CATEGORY_PIVOT_CHANGELOG_AND_TESTING.md`](./EXAM_CATEGORY_PIVOT_CHANGELOG_AND_TESTING.md) for full pull + test steps.

---

## 7. Docs to update when API is done

Per [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md):

- `MIGRATION_TRACKER.md` — changelog entry
- `SCHEMA_COMPARISON.md` — `yarn docs:schema-comparison`
- `FIELD_COMPARISON.md` — `yarn docs:field-comparison`
- `DEPLOY_RUNBOOK.md` — note seed step if added to deploy flow

---

## 8. Reference

| Item | Location |
|------|----------|
| Staging dump (no pivot) | `old_db/websankul_staging.sql` |
| Production pivot export | `old_db/ws_exam_category_pivot.sql` |
| DDL | `docs/migration/schema-changes/2026-07-10_exam_category_pivot.sql` |
| Deploy flow | `docs/migration/DEPLOY_RUNBOOK.md` |

---

*Schema landed: 2026-07-10. API handoff — implement read/write paths in §5.*
