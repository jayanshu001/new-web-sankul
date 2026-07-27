# k6 Staging — Capacity & Scaling Report

**Date:** 2026-07-27 (final campaign, post all code/DB fixes)  
**Environment:** staging server `websankul-v2`  
**Related:** [Run log](./K6_LOAD_TESTING_STAGING_RUNLOG.md) · [Issues](./K6_LOAD_TESTING_STAGING_ISSUES.md)

---

## Server resources (current)

| Resource | Value |
| --- | --- |
| CPU | 4 cores |
| RAM | 7.8 GB (≈3.2 GB available under load) |
| API processes | 2× PM2 cluster workers (`websankul-api`) |
| Worker process | 1× `websankul-worker` (BullMQ) |
| MySQL | Docker `ws-mysql`, `websankul_staging`, ~500k PCS rows |
| Redis | Docker `ws-redis`, port 6380 |
| Load generator | **Co-located** on same server (absolute latency is conservative) |

---

## Code & DB fixes applied before this report

| Fix | Type |
| --- | --- |
| `idx_pcs_customer_status_endat` | DB index — my-subscriptions, dashboard ownership |
| `idx_ebook_sub_customer_status_endat` | DB index — ebook subscriptions |
| `idx_*_created_at` on revenue tables | DB index — admin dashboard aggregates |
| Admin subscription list 90-day default | Query/app — avoids PCS full-scan |
| Admin export same date default | Query/app |
| Search harness `?q=` param | Test fix (was triggering 6-type empty search) |
| Cache `/my-subscriptions` 30s | App — reduces dashboard fan-out DB hits |
| Cache `/notifications/count` 15s | App — reduces dashboard fan-out DB hits |

---

## Final campaign results (2026-07-27)

| Scenario | Throughput | Global p95 | Error rate | Verdict |
| --- | --- | --- | --- | --- |
| **Baseline** (`load.js`, 50 VU) | **48.6 req/s** | **66 ms** | **0%** | ✅ PASS |
| **Stress** (2×/3×/4×, peak ~205 rps) | 205 rps issued | 749 ms | **0%** | ✅ PASS |
| **Spike** (200 VU burst) | 104 rps | ~30 ms | **0%** | ✅ PASS |
| **Socket.IO** (200 sockets) | — | connect 12 ms | **0%** | ✅ PASS |
| **Soak** (15m, 25 VU) | 29.5 rps | 56 ms | 10.6%* | ⚠️ See note |
| **Cache cold/warm** | 8 rps | <100 ms | **0%** | ✅ PASS |
| **Rate limiter** | 20 rps → 429s | 7 ms | **0%** | ✅ PASS |
| **Shutdown** (pm2 reload) | 22 rps | 12 ms | **0%**, **0×502** | ✅ PASS |
| **Scalability 2 workers** | 64 rps @ 20 offered | 50 ms | **0%** | ✅ PASS |
| **Scalability 1 worker** | 64 rps @ 20 offered | 62 ms | **0%** | ✅ PASS |

\*Soak errors (10.6%) occurred during overlapping `pm2 reload` operations from other tests in the same window — **not a code defect**. Re-run soak in isolation for a clean stability sign-off.

### Baseline per-group latency (50 VU, the “normal traffic” number)

| Group | p95 |
| --- | --- |
| catalog (cached) | **17 ms** |
| dashboard | **33 ms** |
| search | **67 ms** |
| write (heartbeat) | **77 ms** |
| analytics (admin) | **859 ms** |

---

## How much traffic can this implementation handle?

### Recommended operating envelope (current server, 2 workers)

| Metric | Safe steady-state | Burst / peak |
| --- | --- | --- |
| **HTTP throughput** | **~45–50 req/s** sustained | **~150–200 req/s** short bursts |
| **Concurrent browse VUs** | **50–75 VUs** | **200 VUs** (spike tested, 0% errors) |
| **Concurrent WebSockets** | — | **200+** (100% connect/join) |
| **Heartbeat writes** | **10 req/s** | **10 req/s** (tested in baseline) |
| **Global p95 (normal mix)** | **<100 ms** | **<800 ms** under 4× stress |
| **Error rate (normal mix)** | **0%** | **0%** at tested peaks |

**In plain terms:** this staging box comfortably handles **~2,800–3,000 requests/minute** of realistic app traffic (browse + heartbeat + admin) with sub-100ms typical latency. Short bursts toward **12,000 req/min** were handled with zero errors.

### Before vs after optimization

| Metric | Before fixes | After fixes |
| --- | --- | --- |
| Baseline throughput | ~28 req/s | **48.6 req/s** (+73%) |
| Baseline global p95 | 7–11 s | **66 ms** (~100×) |
| Stress ceiling | Aborted @ 28 rps | **205 rps**, 0% errors |
| Spike errors | 6% | **0%** |

The bottleneck was **missing DB indexes + unscoped admin queries + search harness bug**, not raw server CPU/RAM.

---

## Scaling expectations

### Horizontal scaling (more PM2 API workers)

| Load level | Expected effect (post-fix) |
| --- | --- |
| **Normal (~50 req/s)** | **Minimal gain** — 1 worker ≈ 2 workers (64 vs 64 rps at 20 offered). Work is cache-heavy; Redis absorbs repeated reads. |
| **High (~150+ req/s)** | **Moderate gain** — more workers help accept connections and run Node event loops in parallel. DB pool per worker (`connection_limit=10`) becomes the limiter — watch MySQL `Threads_connected`. |
| **Very high** | Diminishing returns unless MySQL pool + query capacity scale too. |

**Rule of thumb:** add workers when **CPU per worker >70% sustained** at target RPS, not before fixing slow queries.

### Vertical scaling (more CPU/RAM per server)

| Resource | Expected effect |
| --- | --- |
| **More CPU** | Helps stress ceiling (205 rps was co-located with k6 on 4 cores). Dedicated load generator + 8 cores could push burst headroom. |
| **More RAM** | PM2 workers use ~180–400 MB each. Current 8 GB is sufficient for 2–4 workers + MySQL/Redis on same box. |
| **Dedicated DB server** | Largest win at scale — moves MySQL I/O off the app box. |

### Recommended production topology (when traffic grows)

```
                    ┌─────────────┐
   Users ──────────►│  LB / CDN   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         API worker 1  API worker 2  API worker N
              │            │            │
              └────────────┼────────────┘
                           ▼
                    ┌─────────────┐
                    │    Redis    │  (shared cache + rate limit + sockets)
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │    MySQL    │  (indexes critical — see DDL 2026-07-27)
                    └─────────────┘

   Load testing ──► separate VM (not co-located with API)
```

---

## Production migration checklist

Apply on production **after** load-test sign-off:

1. `yarn db:migrate` — applies all `2026-07-27_*.sql` index files
2. Deploy app with admin 90-day default + route caching
3. Re-run smoke + baseline on production staging mirror
4. Monitor: MySQL slow query log, PM2 memory, p95 on `/dashboard` and `/my-subscriptions`

---

## Sign-off status

| Criterion | Status |
| --- | --- |
| All 10 scenario types executed | ✅ |
| Baseline passes (0% errors) | ✅ |
| Stress completes without abort | ✅ |
| Spike + Socket.IO pass | ✅ |
| Rate limiter + shutdown pass | ✅ |
| Scalability re-run post-fix | ✅ |
| Soak clean run (isolated) | ⏳ Re-run recommended (prior run had pm2 interference) |
| Production DDL deployed | ⏳ Pending (by design — after load-test sign-off) |

**Recommendation:** Safe to proceed with **production migration** after an isolated 15m soak re-run. Core performance and reliability targets are met.
