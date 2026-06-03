# Migration — documentation update guide

> **Purpose:** Single checklist for **which files to update** after migration work, so the team always has current steps and status.  
> **Audience:** Anyone implementing or reviewing a Phase 2+ MySQL module migration in `new-web-sankul`.

**Start here after code changes** — then use the scenario checklists below.

---

## Golden rules

1. **Do not add the next module to `MIGRATION_MYSQL_MODULES`** until required tests are **Pass** in [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md).
2. **Regenerate** auto-generated docs (`yarn docs:*`) — do not hand-edit those files except for one-off fixes (re-run generator instead).
3. **Log build progress** in [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md) changelog; **log test results** in [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md).
4. **Complex field mappings** (e.g. Customer `full_name` vs `firstName`): update generator appendices in `scripts/generate-schema-comparison.ts`, then regen.

---

## Quick checklist (copy for PR / handoff)

Use this every time you merge migration-related work:

```txt
[ ] Code: src/modules/<module>/ (repository, service, transformer, types)
[ ] Controllers wired with isMysqlModule("<key>") in src/admin/ or src/client/
[ ] prisma/schema.prisma updated (if new/changed tables)
[ ] yarn prisma:generate
[ ] .env.example — MIGRATION_MYSQL_MODULES comment / example updated
[ ] scripts/generate-migrated-modules.ts — MIGRATED_REGISTRY new entry
[ ] scripts/generate-schema-comparison.ts — MIGRATED_TABLES / appendices (if needed)
[ ] New smoke test script (optional): scripts/test-mysql-<module>.ts + package.json script
[ ] docs/migration/api-tests/<module-key>/ — HTTP tests + register in run-module.ts / run-all.ts
[ ] testing-guide.md — new module test section (if new patterns)
[ ] MIGRATION_TEST_LOG.md — Pass/Fail rows filled
[ ] MIGRATION_TRACKER.md — phase status + changelog entry
[ ] README.md — current status one-liner (if phase/module milestone)
[ ] yarn docs:migrated-modules
[ ] yarn docs:schema-comparison
[ ] yarn docs:field-comparison
```

---

## Scenarios — what to update

### A. New module migrated to MySQL (most common)

| Step | File / action | Required? |
|------|----------------|-----------|
| 1 | Implement `src/modules/<name>/` | ✅ |
| 2 | Wire `src/admin/**` / `src/client/**` with `isMysqlModule()` | ✅ |
| 3 | `prisma/schema.prisma` (model matches legacy table) | ✅ if new table |
| 4 | `yarn prisma:generate` | ✅ |
| 5 | `.env` / `.env.example` — add module key to `MIGRATION_MYSQL_MODULES` | ✅ |
| 6 | `scripts/generate-migrated-modules.ts` — add `MIGRATED_REGISTRY` entry | ✅ |
| 7 | `scripts/generate-schema-comparison.ts` — add to `MIGRATED` / `MIGRATED_TABLES` if status logic needs it | ✅ |
| 8 | `scripts/test-mysql-<module>.ts` + `package.json` `db:test-*` script | Recommended |
| 9 | `docs/migration/testing-guide.md` — API/SQL steps for module | ✅ |
| 10 | `docs/migration/MIGRATION_TEST_LOG.md` — test rows | ✅ before enabling next module |
| 11 | `docs/migration/MIGRATION_TRACKER.md` — § Phase 2 table + changelog | ✅ |
| 12 | `yarn docs:migrated-modules` | ✅ |
| 13 | `yarn docs:schema-comparison` | ✅ |
| 14 | `yarn docs:field-comparison` | ✅ |
| 15 | `docs/migration/MIGRATED_MODULES.md` | Auto via step 12 |
| 16 | `docs/migration/README.md` — “Current status” if milestone | Optional |

**Do not** enable the module in production env until step 10 passes.

---

### B. Prisma / MySQL schema change only (no new module)

| File / action | Required? |
|---------------|-----------|
| `prisma/schema.prisma` | ✅ |
| `yarn prisma:generate` | ✅ |
| Re-import or migrate DB if local dump out of sync | If needed |
| `yarn docs:schema-comparison` | ✅ |
| `yarn docs:field-comparison` | ✅ |
| `MIGRATION_TRACKER.md` changelog | ✅ |
| `testing-guide.md` / test log | If behavior or validation changed |

---

### C. Phase 1 infra (Docker, dump, import)

| File / action | Required? |
|---------------|-----------|
| `docker-compose.yml` | If service changed |
| `scripts/mysql-import.ps1` / `.sh` | If import path changed |
| `scripts/verify-mysql.ts` | If checks changed |
| `docs/migration/phase-1-mysql.md` | ✅ |
| `docs/migration/MIGRATION_TRACKER.md` | ✅ |
| `.env.example` — `DATABASE_URL`, ports | ✅ |
| `MIGRATION_TEST_LOG.md` Phase 1 section | ✅ |

---

### D. Tests only (no code/schema change)

| File / action | Required? |
|---------------|-----------|
| `docs/migration/MIGRATION_TEST_LOG.md` | ✅ |
| `docs/migration/MIGRATION_TRACKER.md` | Only if sign-off / phase complete |

---

### E. Revert module to Mongo (rollback)

| File / action | Required? |
|---------------|-----------|
| Remove module from `MIGRATION_MYSQL_MODULES` | ✅ |
| `MIGRATION_TEST_LOG.md` — note rollback | ✅ |
| `MIGRATION_TRACKER.md` changelog | ✅ |
| Keep `MIGRATED_MODULES.md` registry entry (code still exists) | Optional note in tracker |
| Regen docs if env-based status should reflect rollback | Optional |

---

## File reference (all migration docs & sources)

| File | Auto-generated? | When to update | How |
|------|-----------------|----------------|-----|
| [README.md](./README.md) | No | New doc added; phase milestone | Edit manually |
| [PRISMA_MODULE_FLOW.md](./PRISMA_MODULE_FLOW.md) | No | Prisma / module flow diagrams | Edit manually |
| **[MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md)** | No | This checklist itself changes | Edit manually |
| [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md) | No | Every completed step / phase | Edit manually + changelog |
| [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md) | No | After each test session | Edit manually (✅/❌) |
| [testing-guide.md](./testing-guide.md) | No | New module or new test procedure | Edit manually |
| [phase-1-mysql.md](./phase-1-mysql.md) | No | Docker/dump/import changes | Edit manually |
| [MIGRATED_MODULES.md](./MIGRATED_MODULES.md) | **Yes** | New migrated module | `yarn docs:migrated-modules` (+ registry) |
| [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) | **Yes** | Schema/model/table changes | `yarn docs:schema-comparison` |
| [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) | **Yes** | Schema/model/field changes | `yarn docs:field-comparison` |
| [legacy_system_migration_strategy.md](./legacy_system_migration_strategy.md) | No | Strategy/architecture decision | Rare; team agreement |
| `.env.example` | No | New env vars / module list | Edit manually |
| `src/config/migration.ts` | No | Only if toggle logic changes | Code review |
| `prisma/schema.prisma` | No | Legacy table mapping | Code + `prisma generate` |
| `websankul_staging.sql` (staging repo) | No | New staging snapshot | Re-import + regen all `docs:*` |

### Generator scripts (edit before regen)

| Script | Output | Edit when |
|--------|--------|-----------|
| `scripts/generate-migrated-modules.ts` | `MIGRATED_MODULES.md` | New completed module |
| `scripts/generate-schema-comparison.ts` | `SCHEMA_COMPARISON.md` | Migrated status keys; Customer/Book appendices |
| `scripts/generate-field-comparison.ts` | `FIELD_COMPARISON.md` | Usually regen only; optional appendix in script |

### Smoke tests (`package.json` scripts)

| Script | When to add |
|--------|-------------|
| `scripts/test-mysql-cms-pilot.ts` | CMS singleton modules |
| `scripts/test-mysql-faq.ts` | Per-module pattern — copy for next module |
| `scripts/verify-mysql.ts` | Phase 1 / global DB health |
| `docs/migration/api-tests/` | Per-module HTTP tests vs `yarn dev` (`yarn migration:api`) |

---

## Commands (run from `new-web-sankul`)

```powershell
cd D:\Projects\web-sankul\new-web-sankul

# After schema / model changes
yarn prisma:generate
yarn docs:migrated-modules
yarn docs:schema-comparison
yarn docs:field-comparison

# Validation
yarn db:verify
yarn db:test-cms-pilot    # app-update + version
yarn db:test-faq          # faq
# yarn db:test-<module>   # add when you create the next script
yarn migration:api        # all HTTP API tests (needs yarn dev + .env credentials)
yarn migration:api:faq    # one module
```

**Suggested order:** code → prisma generate → smoke test → test log → tracker → docs regen → README status.

---

## Who updates what (team roles)

| Role | Primary docs |
|------|----------------|
| **Developer** | Code, Prisma, generators registry, regen `docs:*`, testing-guide section |
| **Tester / QA** | `MIGRATION_TEST_LOG.md`, API/UI rows in testing-guide |
| **Tech lead** | `MIGRATION_TRACKER.md` sign-off, strategy doc, phase gates |
| **DevOps** | `phase-1-mysql.md`, `docker-compose.yml`, `.env.example`, dump import |

---

## Related reading order (new contributor)

```txt
1. MIGRATION_TRACKER.md        → where we are
2. PRISMA_MODULE_FLOW.md       → how Prisma + module toggle works
3. MIGRATION_DOC_UPDATES.md    → this file (what to update when)
4. testing-guide.md            → how to test
5. MIGRATED_MODULES.md         → what already runs on MySQL
6. SCHEMA_COMPARISON.md        → all tables inventory
7. FIELD_COMPARISON.md         → column-level detail
```

---

## Maintenance of this guide

Update **this file** when:

- A new migration doc is added under `docs/migration/`
- A new `yarn docs:*` or `yarn db:test-*` script is added
- The team agrees a new mandatory step (e.g. PR template checkbox)

Last structured for Phase 2 modules: `app-update`, `version`, `faq`.
