# Prisma migration flow — how modules use MySQL

> **Purpose:** Visual and step-by-step guide for how `new-web-sankul` runs **Prisma** on legacy MySQL tables for migrated modules, while other modules stay on **MongoDB (Mongoose)**.  
> **Related:** [phase-1-mysql.md](./phase-1-mysql.md) · [MIGRATED_MODULES.md](./MIGRATED_MODULES.md) · [MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md)

---

## 1. Big picture (two databases, one API)

```mermaid
flowchart TB
  subgraph clients [Clients]
    AdminUI[React Admin]
    Mobile[Mobile App]
  end

  subgraph api [new-web-sankul Express API]
    Routes[Routes / Controllers]
    Toggle{isMysqlModule?}
    ServiceMySQL[Service layer]
    Repo[Repository layer]
    Prisma[Prisma Client]
    ServiceMongo[Service layer]
    Mongoose[Mongoose models]
  end

  subgraph data [Data stores]
    MySQL[(MySQL websankul_staging\nws_* tables)]
    Mongo[(MongoDB\nMongoose collections)]
  end

  AdminUI --> Routes
  Mobile --> Routes
  Routes --> Toggle
  Toggle -->|module in MIGRATION_MYSQL_MODULES| ServiceMySQL
  Toggle -->|not migrated| ServiceMongo
  ServiceMySQL --> Repo
  Repo --> Prisma
  Prisma --> MySQL
  ServiceMongo --> Mongoose
  Mongoose --> Mongo
```

| Store | ORM | Config | Used for |
|-------|-----|--------|----------|
| **MySQL** | Prisma | `DATABASE_URL`, `prisma/schema.prisma` | Migrated modules (`app-update`, `version`, `faq`, …) |
| **MongoDB** | Mongoose | `MONGODB_URI`, `src/models/**/*.model.ts` | Everything else until migrated |

---

## 2. Server startup — when Prisma connects

```mermaid
flowchart TD
  Start[yarn dev / node src/index.ts] --> Env[validateEnvOrExit]
  Env --> CheckModules{MIGRATION_MYSQL_MODULES\nnon-empty?}
  CheckModules -->|yes| NeedDb[Require DATABASE_URL]
  NeedDb --> ConnectPrisma[connectPrisma\nsrc/config/prisma.ts]
  ConnectPrisma --> LogMod[Log: MySQL modules active]
  CheckModules -->|no| SkipPrisma[Skip Prisma connect]
  LogMod --> ConnectMongo[connectDB MongoDB]
  SkipPrisma --> ConnectMongo
  ConnectMongo --> Listen[HTTP server listen]
```

**Key files**

| Step | File |
|------|------|
| Env validation (needs `DATABASE_URL` if any MySQL module) | `src/config/env.ts` |
| Module list parser | `src/config/migration.ts` |
| Prisma connect / disconnect | `src/config/prisma.ts` |
| Boot order | `src/index.ts` |

**Example `.env`**

```env
DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
MIGRATION_MYSQL_MODULES=app-update,version,faq
```

---

## 3. HTTP request flow (migrated module)

Example: `GET /api/v1/admin/cms/faqs` when `faq` is migrated.

```mermaid
sequenceDiagram
  participant C as Client
  participant R as cms.routes.ts
  participant Ctrl as cms.controller
  participant Svc as faq.service.ts
  participant Tog as isMysqlModule
  participant Repo as faq.repository.ts
  participant P as Prisma Client
  participant DB as MySQL ws_faq

  C->>R: GET /admin/cms/faqs + JWT
  R->>Ctrl: listFaqs()
  Ctrl->>Svc: listFaqsService()
  Svc->>Tog: isMysqlModule("faq")?
  Tog-->>Svc: true
  Svc->>Repo: faqRepository.findMany()
  Repo->>P: prisma.fAQ.findMany(...)
  P->>DB: SELECT ... FROM ws_faq
  DB-->>P: rows
  P-->>Repo: FAQ[]
  Repo-->>Svc: rows
  Svc->>Svc: toFaqDto() transformer
  Svc-->>Ctrl: FaqDto[]
  Ctrl-->>C: JSON success + data
```

**Layer responsibilities**

| Layer | Role | Example path |
|-------|------|----------------|
| **Route** | URL, auth middleware | `src/admin/cms/cms.routes.ts` |
| **Controller** | HTTP status, body parse, call service | `src/admin/cms/cms.controller.ts` |
| **Service** | Business logic, **MySQL vs Mongo branch** | `src/modules/faq/faq.service.ts` |
| **Repository** | **Prisma only** — no HTTP | `src/modules/faq/faq.repository.ts` |
| **Transformer** | DB shape → stable API JSON | `src/modules/faq/faq.transformer.ts` |
| **Prisma schema** | Table/column mapping | `prisma/schema.prisma` (`@@map("ws_faq")`) |

---

## 4. Service branch pattern (the migration toggle)

Every migrated module follows the same decision in **service**, not in the controller:

```mermaid
flowchart LR
  A[Service function called] --> B{isMysqlModule MODULE_KEY?}
  B -->|yes| C[repository.*\nPrisma → MySQL]
  C --> D[transformer → DTO]
  B -->|no| E[Mongoose Model.*\nMongo collection]
  E --> F[map to same DTO shape]
  D --> G[Return to controller]
  F --> G
```

**Code pattern (FAQ)**

```typescript
const MODULE = "faq";

export const listFaqs = async (...) => {
  if (isMysqlModule(MODULE)) {
    const rows = await faqRepository.findMany(...);
    return rows.map(toFaqDto);
  }
  const docs = await FAQ.find(...).lean();
  return docs.map(...); // legacy Mongo path
};
```

**Repository (Prisma only)**

```typescript
export const faqRepository = {
  findMany: (opts) => prisma.fAQ.findMany({ where: ..., orderBy: ... }),
  create: (input) => prisma.fAQ.create({ data: toPrismaFaqCreate(input) }),
  // ...
};
```

Controllers stay thin; they do not import Prisma directly.

---

## 5. How we **initiate** migration on a new module

Use this checklist when moving a feature from Mongoose to legacy MySQL.

```mermaid
flowchart TD
  subgraph prep [0. Preparation]
    P1[Confirm legacy table in\nwebsankul_staging.sql]
    P2[Ensure model in prisma/schema.prisma\n@@map ws_* table]
    P3[yarn prisma:generate]
  end

  subgraph code [1. Code — per module]
    C1[Create src/modules/name/\nrepository, service, transformer, types]
    C2[Wire service in controllers\nadmin + client]
    C3[Use isMysqlModule in service\nkeep Mongo fallback]
  end

  subgraph enable [2. Enable]
    E1[Add module key to\nMIGRATION_MYSQL_MODULES]
    E2[Restart yarn dev\nPrisma connects at boot]
  end

  subgraph test [3. Verify]
    T1[yarn db:test-* or service smoke]
    T2[yarn migration:api:module-key]
    T3[DBeaver row check]
    T4[Update docs + test log]
  end

  prep --> code --> enable --> test
```

### Step-by-step (detailed)

| Step | Action | Output |
|------|--------|--------|
| **0.1** | Table exists in staging dump + Prisma model with `@@map("ws_...")` | `prisma/schema.prisma` |
| **0.2** | `yarn prisma:generate` | `@prisma/client` types |
| **1.1** | Add `src/modules/<module>/` | `*.repository.ts` uses `prisma.*` |
| | | `*.service.ts` branches on `isMysqlModule("<key>")` |
| | | `*.transformer.ts` maps columns → API fields |
| **1.2** | Point controllers at service (not Mongoose directly) | Same routes as before |
| **1.3** | Register module key in `src/config/migration.ts` usage (string constant per service) | e.g. `const MODULE = "faq"` |
| **2.1** | Add key to `.env`: `MIGRATION_MYSQL_MODULES=...,new-module` | Runtime toggle |
| **2.2** | Restart API — log shows `MySQL modules active: ...` | Prisma used for that module |
| **3.1** | Add `scripts/test-mysql-<module>.ts` (optional) | Direct service/Prisma smoke |
| **3.2** | Add `docs/migration/api-tests/<module>/` | `yarn migration:api:<module>` |
| **3.3** | Regenerate docs + update [MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md) | Team visibility |

**Do not** remove the Mongoose branch until the module is fully validated and product agrees to drop Mongo for that feature.

---

## 6. Module key → files map (current project)

| Module key | MySQL table | Prisma model | Repository | Service toggle |
|------------|-------------|--------------|------------|----------------|
| `app-update` | `ws_app_update` | `AppUpdate` | `app-update.repository.ts` | `app-update.service.ts` |
| `version` | `ws_versions` | `Version` | `version.repository.ts` | `version.service.ts` |
| `faq` | `ws_faq` | `FAQ` (`prisma.fAQ`) | `faq.repository.ts` | `faq.service.ts` |

**Shared**

| Concern | File |
|---------|------|
| Prisma singleton | `src/config/prisma.ts` |
| Module list | `src/config/migration.ts` |
| Client upgrade (uses app-update + version) | `src/modules/cms/upgrade-check.service.ts` |

---

## 7. What Prisma generates vs what we write

```mermaid
flowchart LR
  Schema[prisma/schema.prisma] --> Gen[yarn prisma:generate]
  Gen --> Client[@prisma/client types\nprisma.fAQ, prisma.appUpdate, ...]
  Client --> Repo[Our repository files\nwe choose findMany/create/update]
  Repo --> SQL[Prisma emits SQL at runtime]
```

- We **do not** write raw SQL in app code for migrated modules.
- We **do** write Prisma API calls (`findMany`, `upsert`, `create`, …).
- Optional: `PRISMA_LOG_QUERIES=true` in `.env` to print SQL in logs.

---

## 8. Rollback / dual-run safety

```mermaid
flowchart TD
  Q[Need to use Mongo again for one module?]
  Q --> R[Remove module key from\nMIGRATION_MYSQL_MODULES]
  R --> Restart[Restart API]
  Restart --> M[Service uses Mongoose branch only]
  M --> Note[Prisma may still connect if\nother modules listed]
```

- Removing **all** keys from `MIGRATION_MYSQL_MODULES` → Prisma does not connect at boot.
- Per-module rollback does not require deleting repository code.

---

## 9. Testing paths (same Prisma stack)

| Test type | Command | Hits Prisma? |
|-----------|---------|----------------|
| Service / DB smoke | `yarn db:test-cms-pilot`, `yarn db:test-faq` | Yes (via service → repository) |
| HTTP API | `yarn migration:api`, `yarn migration:api:faq` | Yes (HTTP → service → repository) |
| Phase 1 DB | `yarn db:verify` | Yes (`prisma.$queryRaw` / counts) |

---

## 10. Related documentation

| Doc | Use when |
|-----|----------|
| [phase-1-mysql.md](./phase-1-mysql.md) | Docker MySQL, import dump, first-time setup |
| [MIGRATED_MODULES.md](./MIGRATED_MODULES.md) | Which modules are done |
| [api-tests/API_COVERAGE.md](./api-tests/API_COVERAGE.md) | Which HTTP endpoints are automated |
| [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) | Table/collection differences |
| [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) | Column-level mapping |
| [MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md) | What to update after each change |

---

*Last aligned with modules: `app-update`, `version`, `faq`.*
