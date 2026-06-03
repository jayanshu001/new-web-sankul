# Migration documentation

All Web Sankul **MySQL migration** docs for `new-web-sankul` live in this folder.

**After any migration change →** [**MIGRATION_DOC_UPDATES.md**](./MIGRATION_DOC_UPDATES.md) (which files to update + PR checklist).

---

## Documents

| Document | Purpose |
|----------|---------|
| [**PRISMA_MODULE_FLOW.md**](./PRISMA_MODULE_FLOW.md) | **Flowcharts:** Prisma boot, request path, how to migrate a module |
| [**MIGRATION_DOC_UPDATES.md**](./MIGRATION_DOC_UPDATES.md) | **Checklist:** what to update after code/schema/test changes |
| [**api-tests/**](./api-tests/README.md) | **HTTP tests** against local `yarn dev` (per migrated module) |
| [**MIGRATION_TRACKER.md**](./MIGRATION_TRACKER.md) | What was built, phase status, changelog |
| [**MIGRATION_TEST_LOG.md**](./MIGRATION_TEST_LOG.md) | What you tested (Pass/Fail) — update as you go |
| [**testing-guide.md**](./testing-guide.md) | How to validate each phase and module |
| [**SCHEMA_COMPARISON.md**](./SCHEMA_COMPARISON.md) | Legacy MySQL vs Mongo vs post-migration (table inventory) |
| [**MIGRATED_MODULES.md**](./MIGRATED_MODULES.md) | **Only** modules on MySQL/Prisma (Phase 2+) |
| [**FIELD_COMPARISON.md**](./FIELD_COMPARISON.md) | Module-by-module column/field + constraints matrix |
| [**phase-1-mysql.md**](./phase-1-mysql.md) | Phase 1: Docker MySQL, import dump, Prisma setup |
| [**legacy_system_migration_strategy.md**](./legacy_system_migration_strategy.md) | Full 8-phase migration strategy (architecture & phases) |

---

## Quick commands

```powershell
cd D:\Projects\web-sankul\new-web-sankul

yarn db:up              # start MySQL container
yarn db:import          # import websankul_staging.sql
yarn db:verify          # Phase 1 check
yarn db:test-cms-pilot  # Phase 2 CMS pilot check
yarn db:test-faq        # Phase 2 FAQ check
yarn docs:schema-comparison  # Regenerate SCHEMA_COMPARISON.md
yarn docs:field-comparison   # Regenerate FIELD_COMPARISON.md
yarn docs:migrated-modules   # Regenerate MIGRATED_MODULES.md
yarn migration:api           # HTTP API tests (yarn dev must be running)
yarn migration:api:faq       # HTTP tests for one module
yarn prisma:generate
yarn dev
```

---

## Workflow

```txt
1. Read MIGRATION_TRACKER.md        → know current phase
2. Do migration work (code / Prisma / env)
3. Follow MIGRATION_DOC_UPDATES.md  → update the right docs & run yarn docs:*
4. Follow testing-guide.md          → run tests for that step
5. Update MIGRATION_TEST_LOG.md     → mark ✅ / ❌ before next module
6. Update MIGRATION_TRACKER.md      → changelog when step is done
```

---

## Current status (summary)

- **Phase 1:** MySQL + dump + Prisma — done  
- **Phase 2:** CMS pilot + **FAQ** on MySQL — complete manual tests in test log; next: banners  

See [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md) for details.
