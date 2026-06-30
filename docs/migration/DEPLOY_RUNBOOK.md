# DEPLOY RUNBOOK — WebSankul (MySQL-only)

For anyone pulling the `migration` branch or deploying it. Single source of truth for the deploy steps.

**Context:** the app is **MySQL-only**. `src/config/migration.ts` hard-codes `isMysqlModule() === true` and `isMongoFallbackEnabled() === false`, so `MIGRATION_MYSQL_MODULES` is inert and Mongo is never connected. The schema is *introspected* (no `prisma/migrations/`), so schema changes live as dated DDL in `docs/migration/schema-changes/*.sql` — applied with **`yarn db:migrate`** (not `prisma migrate deploy`).

---

## TL;DR

```bash
git pull && yarn install
# set DATABASE_URL in .env
yarn db:up               # local only (docker ws-mysql :3307 + Redis)
yarn db:migrate          # apply all pending schema DDL — one command, idempotent
yarn prisma:generate
# run the relevant scripts/backfill-*.ts (see step 5)
yarn typecheck && yarn migration:api
yarn dev                 # or: yarn build && yarn start (prod)
```

---

## 1. Pull & install

```bash
git checkout migration && git pull
yarn install
```

## 2. Configure `.env`

Copy `.env.example` and set real values. Required to boot:

| Var | Notes |
|-----|-------|
| `DATABASE_URL` | `mysql://user:pass@host:port/db`. Always required (Prisma boots on every path). |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Always. |
| `ALLOWED_ORIGINS`, `RAZORPAY_WEBHOOK_SECRET`, `REDIS_HOST`, `REDIS_PORT` | Prod. |

`MONGODB_URI` is no longer required. Set other groups as needed (SMTP, Spaces `DO_*`, Razorpay, OTP, Firebase, VideoCrypt/StreamOS, courier).

## 3. Database up

- **Local:** `yarn db:up` (docker `ws-mysql` on port 3307 + Redis).
- **Prod:** point `DATABASE_URL` at the managed MySQL instance (no docker step).

## 4. Apply schema DDL — one command

```bash
yarn db:migrate
yarn prisma:generate
```

`yarn db:migrate` (`scripts/apply-ddl.ts`) replays every `docs/migration/schema-changes/*.sql` in date order, applying only files not yet recorded in the `_ddl_migrations` ledger table. Idempotent, stops on first failure. Then `prisma:generate` syncs the client.

> **Existing DB caveat:** the ledger starts empty, so a DB restored from a recent dump may already have some tables. `CREATE TABLE IF NOT EXISTS` is safe; some un-guarded `ALTER`s may error as "already exists". Seed the ledger with already-applied filenames first, or skip the offending file. Fresh DB: just run it.
>
> Do **not** `yarn db:pull` to evolve the schema — it rewrites the curated `schema.prisma`.

## 5. Run backfills

DDL adds columns/tables; existing rows need populating. Run the `tsx scripts/backfill-*.ts` matching the DDL you applied (full set on a fresh dump; only the new ones on an already-migrated DB). They're re-runnable, but **review on production** first. Several read from a Mongo source — skip those on a server that never had Mongo.

## 6. Verify

```bash
yarn db:verify      # connectivity / tables
yarn typecheck      # the only hard gate
yarn migration:api  # smoke tests vs real MySQL
```

## 7. Run / deploy

- **Local:** `yarn dev`
- **Prod:** `yarn build && yarn start` (pm2)

Sanity: boots with no Mongo connection, Prisma connected, schedulers up, `/readyz` → 200 once warm.

## 8. Rollback

DDL/backfills are additive — no revert needed. Re-enabling Mongo is a one-line change in `src/config/migration.ts` (`isMongoFallbackEnabled`). **Snapshot MySQL before step 4** on production.
