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
yarn seed:superadmin     # fresh DB only — create an admin login (see step 5b)
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

> **`ws_goal` removed (2026-07-01).** `2026-07-01_migrate_ws_goal_into_target_goal.sql`
> consolidates `ws_goal` into `ws_customer_target_goal` (single goal master),
> **remaps** `ws_package.goal_id` + `ws_exam_countdown.goal_id` in SQL, then **drops
> `ws_goal`**. This runs automatically as part of `yarn db:migrate` — nothing else is
> needed for goals, and the goal backfills below are obsolete (see step 5). The
> `Goal` Prisma model no longer exists (`prisma.goal` is gone); only
> `prisma.customerTargetGoal` remains.

> **Existing DB caveat:** the ledger starts empty, so a DB restored from a recent dump may already have some tables. `CREATE TABLE IF NOT EXISTS` is safe; some un-guarded `ALTER`s may error as "already exists". Seed the ledger with already-applied filenames first, or skip the offending file. Fresh DB: just run it.
>
> Do **not** `yarn db:pull` to evolve the schema — it rewrites the curated `schema.prisma`.

## 5. Run backfills

DDL adds columns/tables; existing rows need populating. Run the `tsx scripts/backfill-*.ts` matching the DDL you applied (full set on a fresh dump; only the new ones on an already-migrated DB). They're re-runnable, but **review on production** first. Several read from a Mongo source — skip those on a server that never had Mongo.

> ⚠️ **Do NOT run these three — they are OBSOLETE after the `ws_goal` removal and will
> fail:**
> `backfill-c4-goal-label-ids.ts` and `backfill-catalog-package-fields.ts` call
> `prisma.goal.*`, which no longer exists (crash: *"Cannot read properties of undefined"*);
> `backfill-package-goal-id.ts` reads from **Mongo** (`Goal.model`) and cannot run on a
> MySQL-only server. Their work — label ids + `ws_package.goal_id` remap — is now handled
> entirely by the `2026-07-01_migrate_ws_goal_into_target_goal.sql` DDL in step 4.

**Full set (run the ones matching the DDL you applied):**

```bash
tsx scripts/backfill-customer-device-tokens.ts
tsx scripts/backfill-live-course-to-sql.ts
tsx scripts/backfill-wave7-blocked-to-sql.ts
tsx scripts/backfill-mongo-only-tail.ts
tsx scripts/backfill-c4-wishlist.ts
tsx scripts/backfill-c4-testseries.ts
tsx scripts/backfill-c6-examcountdown-cols.ts
tsx scripts/backfill-c8-referral-content.ts
tsx scripts/backfill-c8-permission-category.ts
tsx scripts/backfill-promo-code.ts
tsx scripts/backfill-lecture-notes.ts
tsx scripts/backfill-lecture-progress-scope.ts
tsx scripts/backfill-is-trending.ts
tsx scripts/backfill-package-category-link.ts
tsx scripts/backfill-package-examcountdown-cols.ts
tsx scripts/backfill-book-ebook-exam-countdown-arrays.ts
tsx scripts/backfill-video-category-subject-key.ts
tsx scripts/backfill-most-popular-plans.ts
tsx scripts/backfill-live-recordings.ts
tsx scripts/backfill-live-recordings-from-streamos.ts
tsx scripts/backfill-live-reminder-customer-id.ts
tsx scripts/backfill-stranded-ready-sessions.ts
tsx scripts/backfill-strip-recording-trailing-quote.ts
```

## 5b. Seed a super-admin (fresh DB only)

A freshly imported DB may have no usable admin login. Create one (writes to MySQL `ws_users` + the `super_admin` spatie role/pivot):

```bash
SEED_ADMIN_EMAIL=you@websankul.com SEED_ADMIN_PASSWORD='ChangeThis1' yarn seed:superadmin
```

Idempotent; change the password after first login. Login: `POST /api/v1/admin/auth/login`.

## 6. Verify

```bash
yarn db:verify      # connectivity / tables
yarn typecheck      # the only hard gate
yarn migration:api  # smoke tests vs real MySQL
```

## 7. Run / deploy

- **Local:** `yarn dev` (single process via tsx — workers + HTTP together)
- **Local PM2 (split topology):** `yarn build && pm2 start ecosystem.config.cjs`
- **Production:** `yarn deploy:prod` (install → migrate → generate → build → pm2 reload)

### 7a. PM2 process topology (production)

Two PM2 apps in `ecosystem.config.cjs`:

| App | Role | Env flags |
|-----|------|-----------|
| `websankul-api` | HTTP + WebSockets (cluster ×2 default) | `WORKER_ENABLED=false`, `HTTP_SERVER_ENABLED=true` |
| `websankul-worker` | BullMQ (notifications, PDF upload, plan popularity) | `WORKER_ENABLED=true`, `HTTP_SERVER_ENABLED=false` |

```bash
# First deploy
yarn build
pm2 start ecosystem.config.cjs --env production

# Subsequent deploys
yarn deploy:prod

# Logs
pm2 logs websankul-api --lines 50
pm2 logs websankul-worker --lines 50
pm2 status
```

**Do not** run `cpuMonitor.ts` / `autoScale.ts` in production.

### 7b. Health probes

| Endpoint | Expect |
|----------|--------|
| `GET /healthz` | 200 always (liveness) |
| `GET /readyz` | 200 when MySQL + Redis healthy; 503 during graceful shutdown |

Post-deploy smoke:

```bash
curl -s http://localhost:5000/healthz
curl -s http://localhost:5000/readyz
```

### 7c. MySQL connection pool sizing

Add `connection_limit` to `DATABASE_URL` in production:

```
DATABASE_URL="mysql://user:pass@host:3306/db?connection_limit=10"
```

Formula: `connection_limit × (api_instances + worker_instances) × server_count ≤ max_connections × 0.8`

Example: `max_connections=150`, 2 API + 1 worker, `connection_limit=10` → 30 connections.

### 7d. Redis (production)

- Use managed Redis or hardened self-hosted instance with **AUTH** (`REDIS_PASSWORD` in app `.env`).
- Queue backend is **BullMQ/Redis** — RabbitMQ is not used (removed from `docker-compose.yml`).
- Local dev: `yarn db:up` starts MySQL (`127.0.0.1:3307`) + Redis (`127.0.0.1:6380`).

### 7e. OS dependencies (server packages)

Required on the host for full feature parity:

```bash
# Ubuntu/Debian
apt-get install -y ffmpeg chromium-browser fonts-noto fonts-noto-cjk
```

- **ffmpeg** — live camera ingest (`src/socket/camera-ingest.ts`)
- **Chromium** — Puppeteer PDF receipts/solutions (`src/libs/core/generate.ts`)

### 7f. Rollback

```bash
git checkout <previous-tag-or-commit>
yarn install --frozen-lockfile
yarn build
pm2 reload ecosystem.config.cjs --env production
```

DDL/backfills are additive — snapshot MySQL before schema deploys on production.

Sanity: boots with Prisma connected, `/readyz` → 200 once warm, **one** PDF worker processing uploads.

> Full operations checklist: `docs/DEPLOYMENT_OPERATIONS_AUDIT.md`
7