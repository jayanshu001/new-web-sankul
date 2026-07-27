# k6 Load Testing — Staging Run Log

Live document updated after each staging test run.

**Target:** staging server `websankul-v2` — PM2 cluster (2× `websankul-api` workers) + Docker MySQL/Redis  
**BASE_URL:** `http://localhost:4001`  
**k6 binary:** `.tools/k6` (v0.57.0)  
**Auth:** `yarn migration:api:auth` → `docs/migration/api-tests/.auth.json` (~1h TTL)  
**Rate limiter:** `RATE_LIMIT_DISABLED=true` in `.env` (except Run 11)

**Related:** [Issues tracker](./K6_LOAD_TESTING_STAGING_ISSUES.md)

---

## Environment snapshot

| Item | Value |
| --- | --- |
| Campaign date | 2026-07-27 |
| Git deploy | `yarn deploy:prod` completed same day |
| API instances | 2 (PM2 cluster, restored after scalability test) |
| MySQL | `websankul_staging` @ 127.0.0.1:3307 |
| Redis | port 6380 (Docker `ws-redis`) |
| Test customer | ID `472335` (`.env` `MIGRATION_TEST_CUSTOMER_ID`) |
| Exam ID (data.js) | `300001` (fixed from `300002` on run 5) |
| Load generator | Co-located on same server as API |

---

## Run progress (all scenarios)

| # | Phase | Scenario | Status | Date |
| --- | --- | --- | --- | --- |
| 1 | Smoke | `smoke.js` | ✅ PASS | 2026-07-27 |
| 2 | Baseline | `load.js` (run 1) | ⚠️ Partial | 2026-07-27 |
| 3 | Baseline | `load.js` (run 2) | ⚠️ Partial | 2026-07-27 |
| 4 | Stress | `stress.js` (short) | ❌ Aborted | 2026-07-27 |
| 5 | Baseline | `load.js` (run 3, exam fix) | ⚠️ Partial | 2026-07-27 |
| 6 | Stress | `stress.js` (full) | ❌ Aborted @ 28 rps | 2026-07-27 |
| 7 | Spike (HTTP) | `spike.js` | ⚠️ Partial | 2026-07-27 |
| 8 | Spike (Socket.IO) | `live-ws.js` | ✅ PASS | 2026-07-27 |
| 9 | Soak | `soak.js` (15m) | ⚠️ Partial | 2026-07-27 |
| 10 | Cache cold | `cache-cold.js` | ✅ PASS | 2026-07-27 |
| 11 | Cache warm | `cache-cold.js` | ✅ PASS | 2026-07-27 |
| 12 | Rate limiter | `ratelimit.js` | ✅ PASS | 2026-07-27 |
| 13 | Shutdown | `shutdown.js` + pm2 reload | ⚠️ Partial | 2026-07-27 |
| 14 | Scalability (2 workers) | `scalability.js` | ⚠️ Partial | 2026-07-27 |
| 15 | Scalability (1 worker) | `scalability.js` | ⚠️ Partial | 2026-07-27 |
| 16 | **Post-fix baseline** | `load.js` | ✅ **PASS** | 2026-07-27 |
| 17 | **Post-fix stress** | `stress.js` | ⚠️ Partial | 2026-07-27 |
| 18 | **Post-fix spike** | `spike.js` | ✅ **PASS** | 2026-07-27 |
| 19 | **Final campaign** | All scenarios | ✅ See below | 2026-07-27 |

**Summary:** Final campaign (post all code/DB fixes + caching) — baseline **48.6 rps / p95 66ms / 0% errors**. See [Capacity report](./K6_LOAD_TESTING_STAGING_CAPACITY.md).

---

## Detailed run entries

### Run 1 — Smoke (`smoke.js`)

```bash
BASE_URL=http://localhost:4001 .tools/k6 run loadtest/scenarios/smoke.js
```

| Metric | Result |
| --- | --- |
| Checks | 100% (324/324) |
| HTTP failures | 0% |
| p95 latency | 1.07s |
| **Verdict** | ✅ **PASS** |

---

### Run 2 — Baseline (`load.js` run 1)

```bash
BASE_URL=http://localhost:4001 .tools/k6 run \
  -e PEAK=50 -e HEARTBEAT_RPS=10 -e ADMIN_VUS=5 \
  -e WARMUP=30s -e RAMP=1m -e HOLD=3m -e RUN=5m \
  --summary-export=loadtest/results/load-staging-2026-07-27-1629.json \
  loadtest/scenarios/load.js
```

| Metric | Result |
| --- | --- |
| Throughput | 26.5 req/s |
| Checks | 97.9% |
| HTTP errors | 2.75% |
| Global p95 | 8.22s |
| catalog p95 | 88ms |
| dashboard p95 | 12.31s |
| Exam endpoints | 0% (stale ID `300002`) |
| **Verdict** | ⚠️ **Partial** |

---

### Run 3 — Baseline (`load.js` run 2)

Same parameters as run 2. Export: `loadtest/results/load-staging-run2-2026-07-27-1657.json`

| Metric | Result |
| --- | --- |
| Throughput | 26.6 req/s |
| Checks | 98.5% |
| HTTP errors | 2.03% |
| **Verdict** | ⚠️ **Partial** — consistent with run 2 |

---

### Run 4 — Stress (`stress.js` short shakeout)

```bash
.tools/k6 run -e PEAK_RPS=25 -e STEP=30s -e RAMP=15s loadtest/scenarios/stress.js
```

Aborted at ~50 req/s after ~34s. 5% errors, 589 dropped iterations.  
**Verdict:** ❌ **FAIL** (threshold abort)

---

### Run 5 — Baseline (`load.js` run 3, exam ID fix)

**Fix:** `loadtest/lib/data.js` — `examIds` `300002` → `300001`

| Metric | Result |
| --- | --- |
| Throughput | 28.2 req/s |
| Checks | 99.94% |
| HTTP errors | 0.07% (7 heartbeat) |
| Global p95 | 7.08s |
| catalog p95 | 71ms |
| dashboard p95 | 10.95s |
| Exam endpoints | 100% |
| **Verdict** | ⚠️ **Partial** — functional pass; latency SLOs fail |

Export: `loadtest/results/load-staging-run3-2026-07-27-1725.json`

---

### Run 6 — Stress (`stress.js` full)

```bash
.tools/k6 run -e PEAK_RPS=14 -e STEP=1m -e RAMP=30s \
  --summary-export=loadtest/results/stress-staging-2026-07-27-1749.json \
  loadtest/scenarios/stress.js
```

Steps: 28 / 42 / 56 req/s (2×/3×/4× of ~14 rps baseline). Aborted at **28 req/s** after ~62s.

| Metric | Result |
| --- | --- |
| HTTP errors | 5.23% |
| Dropped iterations | 597 |
| Global p95 | 14.11s |
| Checks | 96.48% |
| Failure mode | Graceful — slow + timeouts, no crash |
| **Verdict** | ❌ **FAIL** — ceiling ≤28 req/s |

---

### Run 7 — Spike HTTP (`spike.js`)

```bash
docker exec ws-redis redis-cli FLUSHDB
.tools/k6 run -e SPIKE=200 -e HOLD=1m -e RAMP=20s \
  --summary-export=loadtest/results/spike-staging-2026-07-27-1752.json \
  loadtest/scenarios/spike.js
```

| Metric | Result |
| --- | --- |
| Peak VUs | 200 |
| HTTP errors | 6.00% |
| catalog p95 | 297ms (cache absorbed stampede) |
| Global p95 | 17.55s |
| Checks | 96.0% |
| Recovery | Completed full run; errors during burst |
| **Verdict** | ⚠️ **Partial** — survived burst, latency threshold failed |

---

### Run 8 — Spike Socket.IO (`live-ws.js`)

```bash
.tools/k6 run -e SOCKETS=200 -e HOLD=1m -e HOLD_S=15 -e LIVE_CLASS_ID=1 \
  --summary-export=loadtest/results/live-ws-staging-2026-07-27-1755.json \
  loadtest/scenarios/live-ws.js
```

| Metric | Result |
| --- | --- |
| ws_connect_ok | 100% (1148/1148) |
| ws_join_ok | 100% |
| ws_connect_ms p95 | 12ms |
| ws_join_ms p95 | 5ms |
| **Verdict** | ✅ **PASS** — socket layer not a bottleneck |

---

### Run 9 — Soak (`soak.js`, 15 min)

```bash
.tools/k6 run -e DURATION=15m -e SOAK_VUS=25 -e HEARTBEAT_RPS=5 \
  --summary-export=loadtest/results/soak-staging-2026-07-27-1757.json \
  loadtest/scenarios/soak.js
```

| Metric | Result |
| --- | --- |
| Duration | 15 min |
| Checks | 100% (63,950/63,950) |
| HTTP errors | 0% |
| Throughput | 25.6 req/s steady |
| Global p95 | 1.19s |
| **Verdict** | ⚠️ **Partial** — stable (no errors/leak signal); p95 > 800ms SLO |

---

### Run 10 — Cache cold (`cache-cold.js`)

```bash
docker exec ws-redis redis-cli FLUSHDB
.tools/k6 run -e VUS=10 -e DURATION=2m \
  --summary-export=loadtest/results/cache-cold-staging-2026-07-27-1812.json \
  loadtest/scenarios/cache-cold.js
```

| Metric | Result |
| --- | --- |
| Checks | 100% |
| HTTP errors | 0% |
| Global p95 | 940ms |
| **Verdict** | ✅ **PASS** |

---

### Run 11 — Cache warm (`cache-cold.js`, no flush)

| Metric | Result |
| --- | --- |
| Checks | 100% |
| HTTP errors | 0% |
| Global p95 | 918ms |
| Cold vs warm delta | ~2% at 10 VUs (cache benefit visible under higher load) |
| **Verdict** | ✅ **PASS** |

Export: `loadtest/results/cache-warm-staging.json`

---

### Run 12 — Rate limiter (`ratelimit.js`)

**Setup:** Temporarily set `RATE_LIMIT_DISABLED=false`, `pm2 reload`, then restored after.

```bash
.tools/k6 run -e DURATION=90s \
  --summary-export=loadtest/results/ratelimit-staging.json \
  loadtest/scenarios/ratelimit.js
```

| Metric | Result |
| --- | --- |
| rl_200 | 600 (~300/min budget) |
| rl_429 | 1200 |
| 5xx errors | 0 |
| RateLimit headers on 429 | ✅ |
| **Verdict** | ✅ **PASS** — cluster-wide limiter works |

---

### Run 13 — Shutdown (`shutdown.js` + pm2 reload)

```bash
# k6 started in background; pm2 reload triggered at ~35s
.tools/k6 run -e DURATION=3m -e RATE=20 \
  --summary-export=loadtest/results/shutdown-staging.json \
  loadtest/scenarios/shutdown.js
```

| Metric | Result |
| --- | --- |
| http_502 | **0** ✅ |
| http_req_failed | 2.52% (100 conn resets during reload, not 502) |
| Checks | 98.61% |
| **Verdict** | ⚠️ **Partial** — **zero 502s** (primary goal met); minor failures during drain window |

---

### Run 14 — Scalability 2 workers (`scalability.js`)

```bash
.tools/k6 run -e RATE=30 -e DURATION=3m \
  --summary-export=loadtest/results/scale-2workers-staging.json \
  loadtest/scenarios/scalability.js
```

| Metric | Result |
| --- | --- |
| Completed req/s | ~33.7 |
| HTTP errors | 16.76% |
| Global p95 | 32.57s |
| Dropped iterations | 3243 |

---

### Run 15 — Scalability 1 worker (`scalability.js`)

```bash
pm2 scale websankul-api 1
.tools/k6 run -e RATE=30 -e DURATION=3m \
  --summary-export=loadtest/results/scale-1worker-staging.json \
  loadtest/scenarios/scalability.js
pm2 scale websankul-api 2   # restored
```

| Metric | 2 workers | 1 worker |
| --- | --- | --- |
| Completed req/s | 33.7 | 33.2 |
| HTTP errors | 16.76% | 16.44% |
| Global p95 | 32.57s | 32.07s |

**Verdict:** ⚠️ **Partial** — throughput **flat** → **DB-bound** (extra workers do not help)

---

## Phase A fixes applied (2026-07-27)

| Fix | Files | What |
| --- | --- | --- |
| Customer sub index | `2026-07-27_pcs_customer_status_endat_index.sql` | `idx_pcs_customer_status_endat (customer_id, status, end_at)` — EXPLAIN ALL→range |
| Ebook sub index | `2026-07-27_ebook_sub_customer_status_endat_index.sql` | `idx_ebook_sub_customer_status_endat` |
| Search harness bug | `loadtest/journeys/j3-search.js` | Global search used `?search=` but API expects `?q=` → was scanning all 6 types |
| Admin sub list default | `admin-subscription.service.ts` | Unscoped list defaults to last 90 days `created_at` (uses existing PCS date index) |

Applied via `yarn db:migrate` + `yarn build` + `pm2 reload`.

---

### Run 16 — Baseline post-fix (`load.js`)

| Metric | Before (run 5) | **After** |
| --- | --- | --- |
| Checks | 99.94% | **100%** |
| HTTP errors | 0.07% | **0%** |
| Throughput | 28.2 rps | **47.6 rps** |
| Global p95 | 7.08s | **209ms** |
| dashboard p95 | 10.95s | **295ms** |
| search p95 | 6.81s | **151ms** |
| analytics p95 | 6.06s | **934ms** |
| **Verdict** | ⚠️ Partial | ✅ **PASS** (all k6 thresholds green) |

Export: `loadtest/results/load-staging-postfix-*.json`

---

### Run 17 — Stress post-fix (`stress.js`)

Full 5m run at 2×/3×/4× (48/72/96 rps steps) — **did not abort**.

| Metric | Before (run 6) | **After** |
| --- | --- | --- |
| Completed | Aborted @ 28 rps | **Full run ~153 rps peak** |
| HTTP errors | 5.23% | **0.01%** |
| Global p95 at peak | 14.11s | **3.9s** |
| **Verdict** | ❌ FAIL | ⚠️ **Partial** — p95 SLO fails at 4× only |

Export: `loadtest/results/stress-staging-postfix-*.json`

---

### Run 18 — Spike post-fix (`spike.js`)

| Metric | Before (run 7) | **After** |
| --- | --- | --- |
| HTTP errors | 6.00% | **0%** |
| Global p95 | 17.55s | **769ms** |
| catalog p95 | 297ms | **435ms** |
| **Verdict** | ⚠️ Partial | ✅ **PASS** |

Export: `loadtest/results/spike-staging-postfix.json`

---

## Staging headline (2026-07-27)

### Before fixes
1. All 10 scenario types executed; ceiling ~28 req/s; dashboard/search p95 7–12s.

### After Phase A fixes
1. **Baseline fully passes** — 100% checks, 0% errors, **47.6 rps**, global p95 **209ms**.
2. **Stress ceiling raised** from ~28 rps → **~150+ rps** (full run completes).
3. **Spike passes** — 0% errors at 200 VUs burst.
4. Root cause was **missing customer_id index** on ~497k-row PCS table + **search harness bug** + **unscoped admin list full-scan**.

---

## Result artifacts

All JSON exports in `loadtest/results/*-staging*.json` (gitignored).
