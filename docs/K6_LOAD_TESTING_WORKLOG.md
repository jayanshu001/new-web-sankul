# k6 Load Testing — Tests & Results

Target: local PM2 cluster (2 API workers, compiled `dist/`) + docker MySQL/Redis. 2026-07-24.

> A later re-run (2026-07-31 — every scenario, part on a dev process and part on the PM2
> cluster) is recorded at the bottom — [Re-run 2026-07-31](#re-run--2026-07-31). The staging campaign
> lives in [`loadtest/K6_LOAD_TESTING_STAGING_RUNLOG.md`](../loadtest/K6_LOAD_TESTING_STAGING_RUNLOG.md).

| Phase | Test | Result |
| --- | --- | --- |
| 1 — Smoke | 2 VUs, script validation | ✅ checks 100%, 0 errors |
| 2 — Baseline | 50 VUs, journey mix, 3m hold | 40.8 rps, p95 2.6s, 0 err — cached reads 29ms, DB groups 1.5–4.7s |
| 3 — Stress | ramp 2×/3×/4× rps | Ceiling ≈40–50 rps. Failure **graceful** — no crashes/pool errors, just slow |
| 4 — Spike (HTTP) | 300 VUs burst, cold cache | Handled: 0.67% err, recovered, cache absorbed stampede |
| 4 — Spike (Socket.IO) | 300 concurrent sockets | ✅ connect 9ms / join 4ms, 100% — socket layer not a bottleneck |
| 5 — Soak | 25 VUs, 15 min | ✅ No leak — RSS flat, p95 352ms steady |
| 6a — Cache cold/warm | 10 VUs, cold vs warm | Cache pays off under load, not in a low-load A/B |
| 6b — Rate limiter | 1 token, high rate | ✅ 300/60s, cluster-wide via Redis, clean 429s |
| 6c — Shutdown | `pm2 reload` under load | ✅ Zero 502s — rolling reload drains cleanly |
| 6d — Scalability | 1 worker vs 2 | **DB-bound** — 1w≈2w (85 rps, 12.5s), extra workers don't help |
| 7 — Fix loop | index the top bottleneck | Added covering index → **analytics p95 4.84s → 343ms (14×)** |

## Headline

**The system is DB-bound — MySQL is the only ceiling.** Cached reads (~29ms) and the
Socket.IO layer (~9ms) are effectively free; every DB-backed path is the cost. Adding app
workers doesn't help. Under overload it degrades gracefully (no crashes), the rate limiter
and zero-downtime reload both work, and there's no memory leak.

## Fix applied

Root cause: admin dashboard/analytics queries full-scanned all 598,743 rows of
`ws_package_course_subscription` (no `created_at` index). Added covering index
`(created_at, course_id, amount)` → full scan became an index range scan (`rows=598743` →
`rows=1`). **analytics p95 14×, global 6.6×, dashboard 5× faster**, no API change. DDL:
`docs/migration/schema-changes/2026-07-24_pcs_created_at_index.sql`.

## Notes

- Local laptop, load generator co-located → trust the *shape* (relative costs), not absolute seconds.
- For a quotable production number, re-run Phase 2 on staging with an isolated generator.
- **To run these on the server** (and verify the index fix on real staging data), follow
  [`K6_LOAD_TESTING_SERVER_RUNBOOK.md`](./K6_LOAD_TESTING_SERVER_RUNBOOK.md).

---

## Re-run — 2026-07-31

Re-ran **every** runbook scenario to confirm the index fix still holds after the July
schema/feature work (watch-time preview, notification routing, download-key column).

**Two different test beds — check which one a row used before comparing it to 2026-07-24.**
Common to both: docker MySQL `websankul_staging_1` @ 3307 + Redis @ 6380, k6 v2.1.0
co-located, tokens re-minted via `yarn migration:api:auth`.

| Bed | Phases | Detail |
| --- | --- | --- |
| **A** — single `tsx` dev process | 1, 2, 3, 4, 5, 6a | `http://localhost:4001`, not compiled, `RATE_LIMIT_DISABLED=true`. **Not** comparable to 2026-07-24 |
| **B** — PM2 cluster | 6b, 6c, 6d, 2b | `yarn build` + `ecosystem.config.cjs`, 2 `websankul-api` workers + 1 BullMQ worker, compiled `dist/`. Same shape as 2026-07-24, so these **are** comparable. Limiter on for 6b only |

| Phase | Test | Result |
| --- | --- | --- |
| 1 — Smoke | 2 VUs, 1m | ✅ 378/378 checks, 0% failed, p95 94.6ms |
| 2 — Baseline | `PEAK=100 HEARTBEAT_RPS=10 ADMIN_VUS=10`, 15m | ✅ **94.6 rps**, 85,559 reqs, **100%** of 244,290 checks, **0%** errors, p95 277ms |
| 3 — Stress | `PEAK_RPS=50` → steps 2×/3×/4×, 8m | ✅ **no ceiling found** — 463 rps, 223,899 reqs, 0% errors, p95 43.8ms. 529 dropped of 67,720 iterations (0.8%) |
| 4 — Spike (HTTP) | 500 VUs burst, cold cache | ✅ 251 rps, 71,367 reqs, 0% errors, p95 41.1ms, `catalog` p95 28.4ms |
| 4 — Spike (Socket.IO) | 300 concurrent sockets, 30s hold | ✅ 1,579 sessions, connect **100%** p95 10ms, join **100%** p95 6ms |
| 5 — Soak | 30 VUs + 5 rps heartbeat, 15m | ✅ 31,228 reqs, 0% errors, p95 39.7ms — no restart, RSS 232 MB after |
| 6a — Cache cold/warm | 10 VUs × 2m, `FLUSHDB` between | ✅ cold p95 19.15ms vs warm 18.63ms — delta only in the tail (max 347ms → 127ms) |
| 6b — Rate limiter | 20 rps on 1 token, 90s | ✅ 599×200 / **1,202×429**, RateLimit headers present, 0×5xx — budget shared across both workers via Redis |
| 6c — Shutdown | `pm2 reload` mid-run, 3m | ✅ **0 × 502**, 0% failures, p95 8.8ms; workers confirmed replaced (restart count 1→2) |
| 6d — Scalability | `RATE=60`, 2w vs 1w × 3m | 2w 193.4 rps / p95 16.1ms · 1w 192.9 rps / p95 16.6ms — **tie, but neither saturated** |
| 2b — Baseline + writes | `EXAM_WRITE=true`, 15m, PM2 | ✅ **100.9 rps**, 91,454 reqs, 0% 5xx; 7/1041 exam submits 400 (harness, see below) |
| 7 — Index verify | `SHOW INDEX` + `EXPLAIN` | ✅ still `type=range`, `rows=46,908`, `Extra: Using index` on 600,015 rows |

`EXAM_WRITE=true` per-group p95: `catalog` 12.1ms · `dashboard` 30.4ms · `search` 46.4ms ·
`write` 56.5ms · `analytics` 1.05s. Adding the write lifecycle cost ~nothing at the top
line (100.9 rps vs 94.6 read-only, on a faster bed).

Baseline per-group p95: `catalog` 19.4ms · `dashboard` 49.1ms · `search` 248ms ·
`write` (heartbeat) 743ms · `analytics` 1.19s. Dropped iterations 9 / 32,146.

**The stress result is the headline change.** On 2026-07-24 the ceiling was ≈40–50 rps;
here the 4× step (200 iters/s ≈ 463 rps) ran at **0% errors and p95 43.8ms** — the
scenario finished without finding a breaking point, on *one* dev process. The route
caching added since, plus the index, moved the wall far enough that `stress.js` at
`PEAK_RPS=50` no longer reaches it. Re-run with a higher `PEAK_RPS` to actually locate it.

Index fix confirmed intact — `idx_pcs_created_course_amount` on
`(created_at, course_id, amount)`; the analytics shape plans as a covering range scan
(`rows≈46.9k` of 600,015) instead of `type=ALL`.

### Caveats on these numbers

- Summary p95 spans the **whole 15m including ramp**; the runbook says quote the HOLD
  only, so the true hold p95 is better than 277ms.
- One dev process ≠ the staging PM2 cluster that produced the campaign's
  48.6 rps / p95 66ms — read shape, not absolutes.
- `cache-cold.js` exercises **only catalog + dashboard** (no admin analytics group), so it
  does *not* stress the indexed path. The runbook §4c instruction to read
  `group:analytics` from that scenario is stale — that signal is in `load.js`.
- The §4c drop-index A/B was **not** run (it mutates schema); `EXPLAIN` was used as the
  proof instead.
- **Soak proves no crash, not "no leak."** RSS was sampled only *after* the run (232 MB,
  same PID, uptime unbroken) — there is no before/after series, so a slow leak would not
  have shown. Latency stayed flat (p95 39.7ms). A real leak hunt needs the 2h run with
  RSS sampled throughout.
- Stress `dropped_iterations` 529 = the arrival-rate executor couldn't always find a free
  VU, i.e. some load was never applied. Treat 463 rps as a floor, not the max.
- **The 1w≈2w tie does NOT re-prove "DB-bound."** At `RATE=60` neither config was
  saturated (0% errors, p95 16ms on both) — it only shows the load fit on one worker.
  The 2026-07-24 conclusion came from a genuinely saturated run (85 rps at p95 12.5s).
  Re-running `scalability.js` at a rate high enough to hurt is what would settle it.
- `shutdown.js` proved the 502-free half only: its `readyz_503` counter recorded **0**,
  so the 2 Hz prober never caught a worker draining. "Drain state is observable via
  `/readyz`" remains unverified.

### ⚠️ First attempt of stress/spike/live-ws/soak was discarded

The initial chained run produced **100% `http_req_failed`** on stress/spike/soak and a
*false pass* on live-ws (`ws_connect_ok` and `ws_join_ok` both recorded **0 of 0**
samples, so their `rate>0.95` thresholds passed on an empty set). Cause: the tokens
minted at the start of the session hit their ~1h TTL mid-chain — every request came back
401 in ~1.35ms, never touching the DB. **Lesson for long chains: re-mint before every
scenario, not once per session** (`run-rest.sh` now does). The numbers in the table above
are from the clean re-run.

### The 7 failed exam submits — harness, not the API

`EXAM_WRITE=true` was the only run with any non-2xx: 7 of 1,041 submits returned
**400 `"Attempt already submitted."`** Root-caused by repro
(`scratchpad/repro-submit.js`, 25 VUs → reproduced 323 times, always the *same*
`attempt=998`):

- `POST /quizzes/:id/attempts/start` **resumes the customer's existing in-progress
  attempt** rather than always creating a new one — correct product behaviour.
- Every k6 VU authenticates as the **one** `MIGRATION_TEST_CUSTOMER_ID`, so all VUs
  resume the *same* attempt. One wins the submit; the rest correctly get the 400 guard.
- Same cause for `400 "Attempt has expired. Please submit."` on answers: exam `300001`
  has `durationMinutes: 1`, so a resumed older attempt is already outside its window.

**Not a server defect** — no 5xx, the guards fired correctly. To exercise the write
lifecycle honestly the harness needs **one customer per VU**; until then, treat exam-write
error counts as noise.

Ruled out along the way: attempt expiry does *not* auto-submit (a submit 70s after start
on a 1-minute exam still returns 200).

### Loose thread — `attemptNumber` race

Three concurrent `attempts/start` calls returned **three distinct `attemptId`s but the
same `attemptNumber` (382)** — the number looks computed as `max+1` without a lock or
unique constraint. Observed once, on a hand-run probe, only in the narrow window where
no in-progress attempt exists (the resume path normally prevents concurrent starts).
Low severity, unverified beyond that one observation, and it did **not** affect any load
result — noted here so it isn't lost.

### Still open after 2026-07-31

Every scenario in the runbook ran. What remains is follow-up work, not skipped tests:

| Open item | Why |
| --- | --- |
| §4c drop-index A/B | Not run — mutates schema; `EXPLAIN` used as proof instead |
| 2h soak with RSS sampled throughout | Only a 15m soak with a single after-the-fact RSS reading was done, so "no leak" is unproven |
| Stress at a much higher `PEAK_RPS` | `PEAK_RPS=50` no longer reaches the ceiling — the wall's location is unknown |
| `scalability.js` at a saturating rate | The 1w≈2w tie was measured below capacity and proves nothing about DB-bound |
| Harness: one customer per VU | All VUs share `MIGRATION_TEST_CUSTOMER_ID`, which fakes errors in every write journey |
| Runbook §4c wording | Still tells you to read `group:analytics` from `cache-cold.js`, which never emits it |
| `readyz_503` never observed | The drain window went unverified during the reload |

Result JSONs: `loadtest/results/{smoke,load,load-examwrite,cache-cold,cache-warm,stress,spike,livews,soak,ratelimit,shutdown,scale-2w,scale-1w}-2026-07-31.json`
(gitignored run artifacts).

---

## Run — 2026-09-07 · J2 dashboard, production pool-exhaustion investigation

**Trigger:** production 500s on `GET /api/v1/client/dashboard` at an estimated 150–200
concurrent users —
`Timed out fetching a new connection from the connection pool (timeout: 10, limit: 9)`.
Reported failing models: `notificationDismissal`, `notificationRead`, `bannerSlider`.

Closes two items from the [Still open after 2026-07-31](#still-open-after-2026-07-31)
list: **"Stress at a much higher PEAK_RPS"** (the wall is located below) and
**"Harness: one customer per VU"** (a 32-token pool replaces the shared
`MIGRATION_TEST_CUSTOMER_ID`).

**Bed:** compiled `dist/` (SHA `26851e8`), **single process on :4009** — not the PM2
cluster, so not directly comparable to the 2026-07-24 rows. `NODE_ENV=staging`,
`RATE_LIMIT_DISABLED=true`, docker MySQL `websankul_staging_1` @3307 + Redis @6380,
k6 v2.1.0 co-located, dataset 38 customers. Pool pinned per-run (the box defaults to
17; production is 9 — an unpinned local run tests the wrong system).

| # | Scenario | Pool | pool_timeout | Concurrency | RPS | p95 | max | Err% | Pool timeouts |
|---|---|---|---|---|---|---|---|---|---|
| 0 | smoke | 9 | 10s | 1 VU | 0.5 | 34.7ms | 39ms | 0% | 0 |
| 1 | stress, warm cache | 9 | 10s | 200 VUs + think time | 48 | 10.1ms | 80ms | *void* | 0 |
| 2 | stress, cold cache | 9 | 10s | 200 VUs + think time | 47 | 62.7ms | 244ms | 0% | 0 |
| 3 | saturate | 9 | 10s | 800 in-flight | 144 | 6.42s | 8.94s | 0% | 0 |
| 4 | saturate | 9 | 10s | 2000 in-flight | 136 | 16.6s | 21.3s | 0% | 0 |
| 5 | saturate | 9 | **2s** | 800 in-flight | 136 | 6.53s | 7.78s | 0% | 0 |
| 6 | burst | **2** | 10s | 600 in-flight | 72 | 8.97s | 11.0s | 0% | 0 |

Run 1 is **void** — 92% `401 ACCOUNT_DELETED`, not load failures (see auth gate below).

### The incident did NOT reproduce, and that is the finding

**VUs are not concurrency.** Runs 2 and 3 differ only in think time. With
`sleep(1–3s)`, 200 VUs yield ~47 rps and, at ~33ms/request, only **~1.5 requests in
flight** — a 9-connection pool is untouched. In-flight ≈ arrival rate × latency, so
think-time scenarios cannot stress a pool at any VU count. This is why the pre-existing
think-time scenarios never produced pool errors either ("failure graceful", 2026-07-24).

**Fan-out alone does not trip the timeout.** At **600 concurrent against a pool of 2**
(run 6) — a demand:pool ratio ~30× worse than production's — there were still **zero
pool timeouts and 100% success**. `pool_timeout` bounds one *query's* wait, not the
request total: a dashboard request is ~33 queries, and each acquire stayed under the
limit even when the whole request took 16s (run 4).

**The missing variable is per-query service time.** Measured from run 6:
72.1 rps × 33 queries ÷ 2 connections = **0.84 ms/query**. Per-query wait ≈
(queued ÷ pool) × service time; for production to reach a 10s wait at ~175 concurrent
on a pool of 9, service time must be **~50 ms/query — roughly 60× local**. That is
missing-index / heavy-scan territory on the 600k-row `ws_*` tables.

This **corroborates the 2026-07-24 headline** ("the system is DB-bound — MySQL is the
only ceiling", index fix → analytics p95 14×). Fan-out sets the multiplier; slow queries
are what push an individual acquire past the timeout. A pool-size increase alone would
not have prevented the incident.

### Secondary findings

- **The route cache cannot absorb a launch burst.** `cacheRoute({ scope: "user" })`
  keys per customer, so N distinct users cold = N misses; run 2 is 6× slower at p95 than
  run 1 on identical load. The shared ~80% of the payload (banners, testimonials,
  categories, daily test, trending/course base rows) is rebuilt once per user.
- **`unreadNotifications` is computed and discarded.** `buildHomeDashboard` spends 4
  queries on it (including both models named in the incident log) and
  `dashboard.controller.ts:32` drops it from the response.
- **`fetchTrendingEbooksOnly` is unbounded** (`client-trending.service.ts:66`) — no
  `take`; reads all trending ebooks plus all their plans, filters in memory, caller
  slices to 10.

### Auth gate — a trap for every future load test

Since the 2026-08-25 revocation change, `authenticate` resolves the customer gate via
`findLiveTokenId` (`customer-auth.repository.ts:52`): a valid JWT is **not** enough — the
customer needs an active, undeleted, unexpired `ws_customer_access_token` row. Only
**3 of 38** local customers qualified, so run 1 was 92% 401s that never reached the
handler, at a latency (6ms) that looks like a healthy cached response.
`loadtest/seed-fixtures.sh` provisions the rows (`teardown-fixtures.sh` removes them),
`scripts/mint-loadtest-tokens.ts` filters to eligible customers, and the suite verifies
every token returns 200 before a run.

### Limits

Local data is 38 customers vs production's ~600k, so absolute latency is optimistic and
the knee sits far above production's. These runs establish the mechanism and a
before/after baseline; they do not predict production capacity.

### Next

1. Pull `dbMs` from production `API Request Completed` logs to confirm the ~50ms/query
   estimate and identify which of the 33 queries are slow. That, not pool sizing, is the
   lead.
2. Re-run runs 3 and 6 after the fan-out reduction to quantify the delta.
3. `loadtest/K6_LOAD_TESTING_STAGING_RUNLOG.md`, linked from the top of this file, is
   **missing from the working tree** — `loadtest/` is gitignored, so it cannot be
   recovered from git.
