# New Web Sankul — Deployment and Operations Audit

Audit date: 2026-07-01

Scope: PM2 process topology, build pipeline, Docker Compose, Redis/MySQL infrastructure, environment validation, OS dependencies, and production operations for `new-web-sankul`.

Related documents:

- [Scalability and API Optimization Audit](./SCALABILITY_OPTIMIZATION_AUDIT.md) — API performance, queues, sockets, caching
- [Implementation Issues Audit](./IMPLEMENTATION_ISSUES_AUDIT.md) — webhooks, auth, error handling, logging correctness
- [Migration Deploy Runbook](./migration/DEPLOY_RUNBOOK.md) — step-by-step MySQL-only deploy commands

Migration context: MySQL/Prisma-only runtime. Schema changes via `docs/migration/schema-changes/*.sql` and `yarn db:migrate` (not `prisma migrate deploy`).

---

## Executive Summary

The application cannot be deployed with `pull → install → pm2 start` alone. It requires a TypeScript build, DDL migration step, and careful PM2 topology. Several infrastructure configs are dev-friendly and not production-hardened.

Highest priority before go-live:

- Fix PM2 worker topology — BullMQ workers run in every cluster instance today.
- Align TypeScript module format (`"type": "module"` vs CommonJS `tsc` output).
- Increase PM2 `listen_timeout` and tune `max_memory_restart`.
- Size MySQL `connection_limit` for `instances × servers`.
- Harden Redis (auth, localhost bind); remove unused RabbitMQ.
- Run `yarn db:migrate` on every deploy before app restart.

---

## Priority 0 — Deployment Blockers

### D0.1 Production Startup Requires a Build Step

Evidence:

- `package.json:12–13` — `"build": "tsc"`, `"start": "pm2 start ecosystem.config.cjs"`.
- `ecosystem.config.cjs:5` — `script: "dist/index.js"`.

Impact:

- Deploy must include `yarn build` before PM2 start/reload.
- Stale or missing `dist/` causes PM2 to run old code or fail.

Recommendations:

**Step 1 — Every deploy:**

```bash
yarn install --frozen-lockfile
yarn db:migrate          # if schema DDL changed
yarn prisma:generate
yarn build
pm2 reload ecosystem.config.cjs --env production
```

**Step 2 — Add a `deploy:prod` script** wrapping the above in correct order.

**Step 3 — Clean `dist/` before build** if stale compiled files become a problem.

---

### D0.2 Module Format Mismatch Can Break PM2 Startup

Evidence:

- `package.json:5` — `"type": "module"`.
- `tsconfig.json:28` — `"module": "commonjs"`.
- PM2 runs `dist/index.js`.

Impact:

- Node treats `.js` files as ESM when `"type": "module"` is present.
- TypeScript CommonJS output contains `require`/`exports`, which can fail under ESM execution.

Recommendations:

**Step 1 — Align module format before production (pick one):**
  - **Option A:** remove `"type": "module"` and keep CommonJS output.
  - **Option B:** change TypeScript to `module: "NodeNext"` and use true ESM output.
  - **Option C:** emit CommonJS files as `.cjs`.

**Step 2 — Staging smoke test after build:**

```bash
node dist/index.js
# or
pm2 start ecosystem.config.cjs --env staging
curl http://localhost:5000/healthz
curl http://localhost:5000/readyz
```

---

### D0.3 PM2 Worker Topology — Workers Run in Every API Instance

Evidence:

- `src/index.ts:65–70` — notification, PDF upload, and plan-popularity schedulers start unconditionally.
- `ecosystem.config.cjs:6–7` — cluster mode, `instances: 2` default.
- `src/admin/pdfUpload/pdfUpload.scheduler.ts` — `concurrency: 1` (single-PDF FIFO design).
- `src/admin/notification/scheduler.ts` — worker `concurrency: 5`.

Impact:

- PDF workers: `1 × PM2 instances` → multiple concurrent uploads, defeating FIFO design.
- Notification workers: `5 × PM2 instances` → duplicate FCM dispatches, wasted rehydration.
- Plan popularity cron runs N identical sweeps per pod every 24h.
- Scaling API pods also scales background workers.

Recommendations:

**Step 1 — Split into two PM2 apps in `ecosystem.config.cjs`:**

```javascript
module.exports = {
  apps: [
    {
      name: "websankul-api",
      script: "dist/index.js",
      instances: process.env.API_INSTANCES || 2,
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "512M",
      wait_ready: true,
      listen_timeout: 45000,
      kill_timeout: 40000,
      env_production: {
        NODE_ENV: "production",
        WORKER_ENABLED: "false",
      },
    },
    {
      name: "websankul-worker",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "768M",
      wait_ready: true,
      listen_timeout: 45000,
      kill_timeout: 40000,
      env_production: {
        NODE_ENV: "production",
        WORKER_ENABLED: "true",
        HTTP_SERVER_ENABLED: "false",
      },
    },
  ],
};
```

**Step 2 — Gate workers in `src/index.ts`:**

```typescript
if (process.env.WORKER_ENABLED === "true") {
  await initNotificationScheduler();
  await initPdfUploadScheduler();
  initPlanPopularityScheduler();
}
```

**Step 3 — Gate HTTP server** when `HTTP_SERVER_ENABLED === "false"` (worker-only process).

**Step 4 — Redis leader lock** for notification rehydration so only one worker scans on boot.

**Step 5 — Document:** `pm2 start ecosystem.config.cjs --only websankul-api` vs `--only websankul-worker`.

---

### D0.4 PM2 `wait_ready` Timeout Is Too Short

Evidence:

- `ecosystem.config.cjs:10–11` — `wait_ready: true`, `listen_timeout: 10000`.
- `src/index.ts` sends `pm2Ready()` only after Prisma connect, permission sync, scheduler init, sockets, camera ingest, and `httpServer.listen()`.

Impact:

- Slow MySQL, Redis, permission sync, or notification rehydration can exceed 10 seconds.
- PM2 marks startup failed even though the app would succeed with more time.

Recommendations:

**Step 1 — Increase `listen_timeout` to 30–60 seconds** (see D0.3 example: 45000).

**Step 2 — Add `kill_timeout` greater than graceful shutdown hard timeout** (e.g. 35000–45000ms). See `src/utils/gracefulShutdown.ts`.

**Step 3 — Move notification rehydration to worker process** or defer until after readiness.

**Step 4 — Log startup phase durations** in `index.ts` for ops visibility.

---

## Priority 1 — High Impact Operations Issues

### D1.1 PM2 Memory Limit Is Too Low for Current Workload

Evidence:

- `ecosystem.config.cjs:9` — `max_memory_restart: "300M"`.
- API can run Puppeteer (PDFs) and ffmpeg (camera ingest) in-process.
- BullMQ workers currently run inside each API instance.

Impact:

- Normal PDF/live-ingest traffic triggers PM2 memory restarts.
- Restarts during heavy traffic look like random crashes.

Recommendations:

**Step 1 — Separate API and worker processes** (D0.3) before tuning memory.

**Step 2 — Raise limits based on load-test RSS:**
  - API-only: 512M–1G
  - Worker (notifications + PDF): 768M–1.5G

**Step 3 — Keep `max_memory_restart` as a safety guard,** not normal pressure control.

**Step 4 — Move ffmpeg ingest and Puppeteer PDF to dedicated nodes** when traffic grows.

---

### D1.2 MySQL Connection Pool Not Sized for PM2 Cluster

Evidence:

- `src/config/prisma.ts` — default `PrismaClient`, no explicit pool config.
- No `connection_limit` in `DATABASE_URL`.
- `ecosystem.config.cjs` — 2 API instances default; each Prisma client uses ~5–10 connections.

Impact:

- `API_instances × worker_instances × pool_size` can exhaust MySQL `max_connections`.
- Connection wait timeouts manifest as 5xx errors.

Recommendations:

**Step 1 — Set `connection_limit` in production `DATABASE_URL`:**

```
DATABASE_URL="mysql://user:pass@host:3306/db?connection_limit=10"
```

**Step 2 — Size using this formula:**

```
connection_limit × (api_instances + worker_instances) × server_count ≤ max_connections × 0.8
```

Example: MySQL `max_connections=150`, 2 API + 1 worker on 1 server, `connection_limit=10` → 30 connections (safe).

**Step 3 — Monitor** `SHOW STATUS LIKE 'Threads_connected'` under load.

**Step 4 — Document pool sizing** in `DEPLOY_RUNBOOK.md`.

---

### D1.3 Package Manager — Use Frozen Lockfile

Evidence:

- `yarn.lock` is committed; `package-lock.json` is in `.gitignore`.
- `DEPLOY_RUNBOOK.md` uses `yarn install`.

Impact:

- Deterministic builds when using frozen lockfile.

Recommendations:

**Step 1 — Production deploy:** `yarn install --frozen-lockfile` (never `npm install`).

**Step 2 — Keep `yarn.lock` committed.**

---

### D1.4 Docker Compose Ports May Conflict With `socketserver`

Evidence:

- `docker-compose.yml:29–30` — Redis on host `6380`.
- `docker-compose.yml:47–49` — RabbitMQ on `5673` and `15673`.
- Legacy `socketserver` project uses the same host ports.

Impact:

- Second `docker compose up` on a shared host fails with port conflicts.
- Accidental cross-project Redis usage corrupts sessions/cache/rate limits.

Recommendations:

**Step 1 — Use different host ports per project** or one shared managed Redis with strict key namespaces.

**Step 2 — Bind to localhost in dev:**

```yaml
ports:
  - "127.0.0.1:6380:6379"
```

**Step 3 — Document `REDIS_HOST`, `REDIS_PORT`, `DATABASE_URL` per deployed service.**

---

### D1.5 Redis Compose Config Is Dev-Friendly, Not Production-Hardened

Evidence:

- `redis.conf:16–17` — `bind 0.0.0.0`, `protected-mode no`.
- `requirepass` commented out.
- `maxmemory 256mb`, `maxmemory-policy allkeys-lru`.
- Redis used for sessions, rate limits, cache, BullMQ, Socket.IO pub/sub.

Impact:

- Misconfigured firewall exposes Redis publicly.
- LRU eviction can evict session keys or rate-limit counters under memory pressure.

Recommendations:

**Step 1 — Production: managed Redis** (DigitalOcean, ElastiCache, etc.) or hardened self-hosted instance.

**Step 2 — Enable auth:** uncomment `requirepass` in `redis.conf`; set `REDIS_PASSWORD` in app env.

**Step 3 — Bind to localhost** when using host networking: `127.0.0.1:6380:6379`.

**Step 4 — Split Redis by workload** where budget allows:
  - Sessions + rate limits: `noeviction`
  - Cache: `allkeys-lru`
  - Queues: `noeviction`

**Step 5 — Firewall rules** blocking Redis and management ports from public internet.

---

### D1.6 RabbitMQ Is Started But Not Used

Evidence:

- `docker-compose.yml:44–57` starts RabbitMQ with management UI.
- `package.json` has no `amqplib` dependency.
- Queue implementation uses BullMQ/Redis.

Impact:

- Extra public-facing service with credentials and memory usage.
- Operators may believe RabbitMQ workers are active.

Recommendations:

**Step 1 — Remove RabbitMQ from `docker-compose.yml`** unless AMQP is implemented.

**Step 2 — Document BullMQ/Redis as the actual queue backend** in `DEPLOY_RUNBOOK.md`.

---

### D1.7 Production Environment Validation Is Incomplete

Evidence:

- `src/config/env.ts` requires JWT secrets, `DATABASE_URL`, and in prod: CORS, Razorpay webhook secret, Redis.
- Runtime features depend on SMTP, Firebase, DigitalOcean Spaces, metrics token, payout webhook secret, StreamOS, VideoCrypt.

Impact:

- PM2 starts successfully while SMTP, uploads, push, or video features are broken.
- First real user action discovers missing credentials.

Recommendations:

**Step 1 — Expand env validation by deployment profile:**

| Profile | Extra required vars |
|---------|---------------------|
| API | `SMTP_*`, `FIREBASE_SERVICE_ACCOUNT`, `DO_*` |
| Worker | Same as API if workers send email/push |
| All prod | `METRICS_TOKEN` if `/metrics` is exposed |

**Step 2 — Add post-deploy smoke test checklist** (see Load Test Checklist below).

**Step 3 — Fail fast at boot** for enabled feature flags with missing credentials.

---

### D1.8 Server OS Dependencies Are Not Fully Documented

Evidence:

- `src/socket/camera-ingest.ts` requires `ffmpeg` on host.
- `src/libs/core/generate.ts` uses Puppeteer/Chromium for PDFs.

Impact:

- Live camera ingest and PDF generation fail after deployment even when Node/PM2 is healthy.

Recommendations:

**Step 1 — Document OS packages in `DEPLOY_RUNBOOK.md`:**

```bash
# Ubuntu/Debian example
apt-get install -y ffmpeg \
  chromium-browser fonts-noto fonts-noto-cjk
```

**Step 2 — Optional readiness sub-checks** for ffmpeg/Chromium when features enabled.

**Step 3 — Dedicated containers** for media ingest and PDF when scaling.

---

### D1.9 MySQL Schema Management Differs From Standard Prisma Migrate

Evidence:

- Schema is introspected; DDL lives in `docs/migration/schema-changes/*.sql`.
- Applied via `yarn db:migrate` (`scripts/apply-ddl.ts`), not `prisma migrate deploy`.

Impact:

- Operators familiar with `prisma migrate deploy` may skip DDL step.
- Missing DDL causes runtime Prisma errors on new columns/tables.

Recommendations:

**Step 1 — Every production deploy:**

```bash
yarn db:migrate
yarn prisma:generate
yarn build
pm2 reload ...
```

**Step 2 — Add DDL drift check** to CI (ledger vs files on disk).

**Step 3 — Never `yarn db:pull` on production** — rewrites curated `schema.prisma`.

---

### D1.10 Deployment Guide Lacks Full Operations Detail

Evidence:

- `docs/migration/DEPLOY_RUNBOOK.md` covers MySQL-only deploy steps.
- Missing: PM2 API vs worker topology, readiness probe expectations, pool sizing, Redis hardening, rollback, load-test gates.

Impact:

- Operators miss worker separation, readiness probe fix, connection pool sizing.

Recommendations:

**Step 1 — Extend `DEPLOY_RUNBOOK.md`** or create `docs/DEPLOYMENT.md` with:
  - PM2 API vs worker process commands
  - Health/readiness probe expectations (MySQL + Redis, not Mongo)
  - `DATABASE_URL` pool sizing formula
  - Redis hardening checklist
  - Rollback procedure (`git checkout`, `yarn build`, `pm2 reload`)
  - Pre-production load test gates

---

## Priority 2 — Operational Efficiency

### D2.1 PM2 Auto-Restart/Autoscale Scripts Are Risky Under Load

Evidence:

- `cpuMonitor.ts` and `autoScale.ts` in project root.
- `package.json:14–15` — `monitor:cpu` and `monitor:scale` scripts.
- No cooldown, queue awareness, or MySQL/Redis pressure checks.

Impact:

- CPU spikes from legitimate traffic trigger restarts during peak load.
- Rapid scaling exhausts MySQL connection budgets.
- Restart loops amplify incidents.

Recommendations:

**Step 1 — Do not run `cpuMonitor.ts` / `autoScale.ts` in production.**

**Step 2 — Scale from monitored RPS, latency, queue depth, CPU, memory, MySQL/Redis capacity.**

**Step 3 — Use orchestrator/PM2 restart policies for crashes only,** not CPU spikes.

---

### D2.2 Metrics Are Not Cluster-Aware in PM2

Evidence:

- `src/utils/metrics.ts` — in-process counters/histograms.
- `ecosystem.config.cjs` — multiple cluster instances.
- `/metrics` exposes only the process that handles the scrape.

Impact:

- Prometheus scraping through a load balancer misses other workers.
- Incomplete RPS/error/duration views.

Recommendations:

**Step 1 — Scrape each PM2 instance** (per-process port or `pm2 describe` + sidecar).

**Step 2 — Add `instance_id` / `pid` labels** to all metrics.

**Step 3 — Or export to a central collector** (StatsD, Prometheus pushgateway).

---

### D2.3 Logging Volume and Disk I/O in Production

Evidence:

- `src/app.ts:156` — `morgan("dev")` always enabled.
- `src/utils/logger.ts:67` — level `debug`; rotating files under `logs/`.

Impact:

- High RPS → large log volume and disk I/O on the VPS.

Recommendations:

**Step 1 — Disable `morgan` in production** (code change in `app.ts`; see Scalability Audit P2.2).

**Step 2 — Set `LOG_LEVEL=info` in PM2 `env_production`.**

**Step 3 — Prefer stdout + log shipper** (e.g. journald, Vector, CloudWatch agent).

**Step 4 — Mount `logs/` on a volume with rotation limits** or disable file transport in prod.

---

## Suggested Deployment Plan

### Phase 0 — Before First Production Deploy

| Step | Action |
|------|--------|
| 0.1 | Fix module format mismatch (D0.2) |
| 0.2 | Split PM2 API + worker apps (D0.3) |
| 0.3 | Increase `listen_timeout` + `kill_timeout` (D0.4) |
| 0.4 | Set `connection_limit` in `DATABASE_URL` (D1.2) |
| 0.5 | Harden Redis; remove RabbitMQ (D1.5, D1.6) |
| 0.6 | Fix `/readyz` MySQL probe (see Implementation Audit I0.2) |
| 0.7 | Document OS deps: ffmpeg, Chromium (D1.8) |
| 0.8 | Add `deploy:prod` script with build + migrate + pm2 reload |

### Phase 1 — Production Hardening

| Step | Action |
|------|--------|
| 1.1 | Tune `max_memory_restart` per process type (D1.1) |
| 1.2 | Expand env validation by profile (D1.7) |
| 1.3 | Resolve Docker port conflicts if co-hosted with socketserver (D1.4) |
| 1.4 | Extend DEPLOY_RUNBOOK with ops detail (D1.10) |
| 1.5 | Set up per-instance metrics scraping (D2.2) |

### Phase 2 — Ongoing Operations

| Step | Action |
|------|--------|
| 2.1 | Run load tests before each major release (checklist below) |
| 2.2 | Monitor MySQL connections and Redis memory |
| 2.3 | Never run cpuMonitor/autoScale in prod (D2.1) |
| 2.4 | Run `yarn db:migrate` on every schema change deploy (D1.9) |

---

## Load Test Checklist (Pre-Go-Live)

Run against staging with **production-like PM2 topology** (separate API + worker processes):

- [ ] `yarn build` succeeds; `node dist/index.js` smoke test passes.
- [ ] `/healthz` returns 200; `/readyz` returns 200 with MySQL + Redis healthy.
- [ ] `/readyz` returns 503 during graceful shutdown (`pm2 reload`).
- [ ] Only **one** PDF worker processes uploads (verify via queue job concurrency).
- [ ] Dashboard/home API at expected peak RPS (payload size + p95 latency).
- [ ] Rolling restart with active WebSocket connections.
- [ ] MySQL `Threads_connected` under peak vs `max_connections`.
- [ ] Redis memory under session + cache + queue + socket pub/sub load.
- [ ] OTP endpoints return 429 under abuse-like traffic.
- [ ] PDF downloads under concurrent access (memory on API + worker pods).
- [ ] Notification campaign: 10k recipients (worker memory + job duration).
- [ ] Payment webhook signature with real Razorpay raw payload fixtures.

---

## Quick Reference: Production Deploy Commands

```bash
git pull
yarn install --frozen-lockfile
yarn db:migrate
yarn prisma:generate
yarn build
pm2 reload ecosystem.config.cjs --env production
# or first-time:
pm2 start ecosystem.config.cjs --env production
```

Post-deploy smoke:

```bash
curl -s http://localhost:5000/healthz | jq .
curl -s http://localhost:5000/readyz | jq .
pm2 status
pm2 logs websankul-api --lines 50
pm2 logs websankul-worker --lines 50
```

---

## Document History

| Date | Version | Notes |
|------|---------|-------|
| 2026-07-01 | 1.0 | Split from `SCALABILITY_OPTIMIZATION_AUDIT.md` |
| 2026-07-01 | 1.1 | Deployment fixes applied (PM2 split, worker-only mode, compose hardening) |

---

## Fix Status (2026-07-01)

| Item | Status |
|------|--------|
| D0.1 Build step + `deploy:prod` script | **Fixed** — `package.json` |
| D0.2 Module format (`"type": "module"` removed) | **Fixed** — `package.json` |
| D0.3 PM2 API + worker split | **Fixed** — `ecosystem.config.cjs`, `index.ts` |
| D0.4 `listen_timeout` / `kill_timeout` | **Fixed** — `ecosystem.config.cjs` (45s / 40s) |
| D1.1 Memory limits per process type | **Fixed** — API 512M, worker 768M |
| D1.2 `connection_limit` documentation | **Fixed** — `.env.example`, `env.ts` warn, `DEPLOY_RUNBOOK.md` |
| D1.4 Docker localhost bind | **Fixed** — `docker-compose.yml` |
| D1.5 Redis hardening notes | **Fixed** — `redis.conf`, runbook |
| D1.6 RabbitMQ removed | **Fixed** — `docker-compose.yml` |
| D1.7 Env validation by profile | **Fixed** — `env.ts` `DEPLOY_PROFILE` warnings |
| D1.8 OS deps documented | **Fixed** — `DEPLOY_RUNBOOK.md` § 7e |
| D1.9 DDL migrate in deploy script | **Fixed** — `yarn deploy:prod` |
| D1.10 Ops detail in runbook | **Fixed** — `DEPLOY_RUNBOOK.md` § 7a–7f |
| D2.1 cpuMonitor/autoScale | **Documented** — do not run in prod |
| D2.2 Metrics instance labels | **Already present** — `metrics.ts` uses `pm_id` |
| D2.3 LOG_LEVEL in PM2 | **Fixed** — `ecosystem.config.cjs` `env_production` |
| Rehydrate leader lock | **Fixed** — `scheduler.ts` |
