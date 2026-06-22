# ✅ MIGRATION COMPLETE — 2026-06-22 · running MySQL-only

WebSankul now runs on **MySQL (Prisma) only**. Every admin + client + educator + promoter API, every write path, background job, and boot-time seeding serves from MySQL. **MongoDB is disconnected by default** (`MONGO_FALLBACK_ENABLED=false` → `connectDB()` is skipped at boot); the app boots and serves with **no Mongo connection** — empirically verified (22 endpoints returned 200, 0 Mongo calls at boot). `MONGODB_URI` is no longer required. Re-enabling Mongo is a single reversible flag.

The remaining `src/models/**` + `mongoose` dependency is now **dormant dead code** (nothing connects to Mongo).

**This document is retained for historical context.** The live source of truth for changes is `docs/MIGRATION_QUERY_CHANGES.md`. Anything below describing "pending / in-progress / flag OFF / blocker / Mongo fallback / remaining" reflects an earlier point in time and is **superseded** by the completed state above.

# Phase 1 — Local MySQL + Prisma

Import the legacy staging dump into Docker MySQL and connect Prisma from `new-web-sankul`.

**Testing:** After setup, run checks in [`testing-guide.md`](./testing-guide.md) and log results in [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md).

**All migration docs:** [`README.md`](./README.md)

## Prerequisites

- Docker Desktop running
- Dump at `../websankul-staging/database/websankul_staging.sql`
- `.env` includes `DATABASE_URL` (see `.env.example`)

## Steps

### 1. Configure environment

```powershell
copy .env.example .env
# Or add to existing .env:
# DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
# MYSQL_ROOT_PASSWORD=websankul_dev
```

### 2. Install dependencies

```powershell
yarn install
yarn prisma:generate
```

### 3. Start MySQL

```powershell
yarn db:up
# or: docker compose up -d ws-mysql
```

Host port **3307** → container **3306** (avoids conflict with a local MySQL on 3306).

### 4. Import staging database

```powershell
yarn db:import
```

This recreates `websankul_staging` and loads the SQL dump.

### 5. Verify Prisma connection

```powershell
yarn db:verify
```

Expected output: connection OK, ~80+ `ws_*` tables, customer/package row counts.

### 6. (Optional) Re-introspect schema from DB

If the dump differs from `prisma/schema.prisma`:

```powershell
yarn db:pull
yarn prisma:generate
```

## Troubleshooting

| Issue | Fix |
|--------|-----|
| Port 3307 in use | Change host port in `docker-compose.yml` and update `DATABASE_URL` |
| Import fails | `docker compose logs ws-mysql` |
| Prisma client out of date | `yarn prisma:generate` |
| Empty tables after import | Re-run `yarn db:import` (drops and recreates DB) |

## Next (Phase 2)

Replace Mongoose data access module-by-module with Prisma repositories while keeping API response shapes via transformers.
