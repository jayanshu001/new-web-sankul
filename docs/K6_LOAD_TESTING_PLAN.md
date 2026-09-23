# k6 Load Testing Plan — WebSankul Backend

The single source of truth for performance testing this API. **Tool: k6, exclusively.**
No alternatives are considered; everything below assumes k6 semantics — executors,
scenarios, thresholds, checks, tags, and its metric names.

Roadmap in one line:
**Phase 0 setup → 1 smoke → 2 baseline load → 3 stress → 4 spike → 5 soak → 6 targeted
(cache / limiter / shutdown / scalability) → 7 report & fix loop.**

---

## Table of contents

- [§1 Install & verify k6](#1-install--verify-k6)
- [§2 What the repo already gives you](#2-what-the-repo-already-gives-you)
- [§3 Ground rules](#3-ground-rules)
- [§4 The roadmap — 7 phases with exit criteria](#4-the-roadmap--7-phases-with-exit-criteria)
- [§5 k6 concepts we rely on](#5-k6-concepts-we-rely-on)
- [§6 What exactly we measure](#6-what-exactly-we-measure)
- [§7 Thresholds](#7-thresholds)
- [§8 Journeys mapped to real endpoints](#8-journeys-mapped-to-real-endpoints)
- [§9 Repo layout & conventions](#9-repo-layout--conventions)
- [§10 Running & recording](#10-running--recording)
- [§11 Reporting and the fix loop](#11-reporting-and-the-fix-loop)
- [§12 Teardown](#12-teardown)

---

## 1. Install & verify k6

```bash
brew install k6          # macOS
k6 version               # expect v0.4x+
```

Why k6 and nothing else, for the record: it's a single Go binary, so the load generator
never competes with the Node API for CPU; scenarios/executors model arrival rate
properly; thresholds exit non-zero so runs can gate CI; and it speaks WebSocket, which
we need for the live-session tests.

---

## 2. What the repo already gives you

| Thing | Where | Why it matters for k6 |
| --- | --- | --- |
| Rate-limit kill-switch | `src/config/rateLimiter.ts:10` (`RATE_LIMIT_DISABLED`) | Without it every limiter 429s at ~300 req/min and you measure the limiter, not the API |
| JWT minting | `yarn migration:api:auth` → `docs/migration/api-tests/.auth.json` | Load it in `setup()`; never hammer `/auth/login` from VUs |
| Metrics endpoint | `GET /metrics` (`src/app.ts:305`) | Mounted **above** the limiter — stays readable under load |
| Health probes | `GET /healthz`, `GET /readyz` (`src/app.ts:288-289`) | `/readyz` → 503 while draining; drives the Phase 6 shutdown test |
| Route-level cache | `cacheRoute({ ttl, entity, scope })`, `docs/CACHE_POLICY.md` | Cold vs warm runs are two different systems — test both |
| Endpoint inventory | `docs/postman/`, `scripts/build-postman.cjs` | Source of routes + payload shapes for journey scripts |
| Functional API harness | `docs/migration/api-tests/` | Per-module correctness; k6 complements it, doesn't replace it |

Every route requires `Authorization: Bearer <token>` (auth/refresh/webhook/health/share
excepted) — every k6 request must carry one.

---

## 3. Ground rules

1. **Never run k6 against production.** It burns Razorpay / 2Factor SMS / FCM quotas,
   writes junk into `ws_*`, and trips real limits for real users. Staging, or local
   `yarn db:up && yarn dev`.
2. **Never script these endpoints** (side effects / real money / external quota):
   - `/client/payment/*`, `/verify` — Razorpay orders
   - `/admin/uploads/presign`, `/admin/ebooks/:id/pdf` — Spaces cost + BullMQ concurrency-1 queue
   - `POST /admin/live-sessions/:id/start` — fires real FCM push to buyers
   - OTP send — real SMS via 2Factor
   - `POST /admin/exports` — floods the report-export queue
3. **One variable per run.** Don't change PM2 instances and query code between runs.
4. **Discard the warm-up.** First ~60s is JIT + Prisma pool fill + Redis cache fill.
   Read numbers from the *hold* phase only.
5. **No result without its config.** git SHA, PM2 instances, `connection_limit`,
   cache state — see §10.

---

## 4. The roadmap — 7 phases with exit criteria

Sequential. Do not start a phase until the previous one's exit criteria are met.

### Phase 0 — Setup
**Do:** install k6; `yarn db:up`; `yarn migration:api:auth`; set `RATE_LIMIT_DISABLED=true`
on the target; seed a known dataset (course/exam/package IDs) into `loadtest/lib/data.js`;
build the `loadtest/` skeleton (§9).
**Exit:** `k6 run loadtest/scenarios/smoke.js` executes and reaches the server.

### Phase 1 — Smoke
**k6:** `executor: 'constant-vus'`, `vus: 2`, `duration: '1m'`.
**Purpose:** validate the *scripts*, not the server. Tokens valid, no 401/422, envelopes parse.
**Exit:** `checks` rate = 100%, `http_req_failed` = 0.
**If it fails, fix the script.** Never debug a 200-VU run that never smoked.

### Phase 2 — Baseline load ← *the number you quote*
**k6:** `ramping-vus` — 1m→50, 3m→peak, **10m hold at peak**, 1m→0. Full journey mix (§8).
**Purpose:** p95/p99 and error rate at expected peak traffic; confirm memory stays flat.
**Exit:** all §7 thresholds pass. Record the row in §11 — this is your baseline; every
later run is compared to it.

### Phase 3 — Stress
**k6:** `ramping-arrival-rate`, stepping 2× → 3× → 4× peak, 2m per step.
**Purpose:** find the ceiling (RPS where p95 crosses SLO or errors exceed 1%) **and the
failure mode** — graceful (slow but 200) vs ugly (500s, pool timeouts, PM2 restarts).
**Watch:** Prisma pool timeouts, MySQL `too many connections`, `dropped_iterations`.
**Exit:** ceiling RPS documented, failure mode characterized as graceful or ugly.

### Phase 4 — Spike
**k6:** `ramping-vus` — 10 → 500 VUs in **20s**, hold 2m, drop to 10, hold 2m.
**Purpose:** the burst this platform actually has — everyone opens the app when a live
class starts. Exercises cold-cache stampede on shared routes.
**Watch:** N identical DB queries on a single cache miss; and whether the service
**recovers** in the post-spike hold or stays degraded.
**Exit:** error rate returns to baseline within 60s of the drop.

### Phase 5 — Soak
**k6:** `constant-vus` at 50–70% of peak, `duration: '2h'` (4h if you can).
**Purpose:** the only phase that finds leaks — memory, sockets, handles, Redis keys,
connection pool, log-disk fill.
**Watch:** RSS trending up in `pm2 monit`; p95 creeping upward hour over hour.
**Exit:** RSS and p95 flat across the run (no monotonic trend).

### Phase 6 — Targeted tests
Four short, high-value runs, each isolating one thing:

| # | Test | k6 setup | Proves |
| --- | --- | --- | --- |
| 6a | **Cold vs warm cache** | Phase-2 scenario, once after `redis-cli FLUSHDB`, once warm | True DB cost vs cached cost of each route — needed to size the DB |
| 6b | **Rate limiter** (the one run with limiting **ON**) | 1 VU, high rate, single token | Limiter 429s at the configured budget, is user-keyed (`userOrIpKey`), and is cluster-wide via Redis not per-worker |
| 6c | **Graceful shutdown** | Mid Phase-2 load, run `pm2 reload` | `/readyz` flips to 503, in-flight requests drain, **zero 502s** |
| 6d | **PM2 scalability** | Phase-2 scenario at `instances: 1` vs `max` | CPU-bound (scales with workers) vs DB-bound (flat — more workers just add connections and hurt) |

### Phase 7 — Report & fix loop
Write the run rows (§11), pick the top bottleneck, fix it, **re-run the identical
scenario**, and record the delta. Repeat until thresholds pass at target load. A fix
without a matching re-run doesn't count.

---

## 5. k6 concepts we rely on

**Executors** — pick deliberately, this is the most common mistake:
- `ramping-vus` — models **concurrent users** (browse traffic). Use for Phases 2, 4.
- `constant-arrival-rate` / `ramping-arrival-rate` — models **fixed request rate**
  regardless of response time. Use for the lecture heartbeat and Phase 3.
  **VU-based executors self-throttle when the server slows and hide the problem** — never
  use them to model a target RPS.
- `constant-vus` — Phases 1, 5.
- `shared-iterations` / `per-vu-iterations` — one-shot data-driven runs.

**Multiple scenarios in one run** — the realistic setup: browse traffic as `ramping-vus`
*plus* heartbeat writes as `constant-arrival-rate` *plus* 10 admin VUs, all concurrently,
each with its own `exec` function and `tags`.

**`setup()` / `teardown()`** — run once. Load `.auth.json` in `setup()`, return the token
pool; every VU receives it as the `data` argument. Clean up test rows in `teardown()`.

**`SharedArray`** — mandatory for IDs/tokens/search terms. Without it every VU copies the
dataset into its own memory and the generator OOMs at high VU counts.

**Tags & groups** — tag every request (`{ tags: { group: 'catalog' } }`) so per-group
thresholds (§7) work and the summary breaks down by journey.

**Checks vs thresholds** — `check()` records correctness but does **not** fail the run;
only a `threshold` sets the exit code. So always pair them: `checks: ['rate>0.99']`.

**Custom metrics** — `Trend` for per-journey latency, `Rate` for business-level success,
`Counter` for things like cache misses inferred from response headers.

---

## 6. What exactly we measure

### k6 built-in metrics
| Metric | What it tells you |
| --- | --- |
| `http_req_duration` p50/p95/p99 | Latency. p99 is where users actually feel pain |
| `http_req_waiting` (TTFB) | Server think time, excludes network — **use this to blame the server** |
| `http_req_failed` | Error rate (non-2xx + network) |
| `http_reqs` rate | Throughput (RPS) — the capacity number |
| `vus` vs `http_reqs` | RPS flatlining while VUs climb = saturation point found |
| `dropped_iterations` | k6 couldn't hold the arrival rate — server (or generator) saturated |
| `iteration_duration` | Full journey time — the closest thing to perceived user experience |
| `http_req_connecting` / `tls_handshaking` | If these dominate, it's network/LB, not your code |
| `checks` | **Correctness** under load, not just speed |

### Checks — correctness, not just status codes
A load test that only asserts `status === 200` misses the worst failures. Per response:
- Envelope intact: `{ success, code, data, message, messages }` (`utils/httpResponse.ts`)
- `success === true`, `code` as expected
- Pagination fields present on list routes (`page`, `limit`, `total`)
- `_id` values are strings — the transformer contract
- Arrays non-empty where they must be — catches "silently degraded to `[]`", a 200 that
  is really a failure
- No leaked raw Prisma row shape (snake_case keys in the payload)

### Server-side signals, collected during every phase
| Signal | Command / URL | Looking for |
| --- | --- | --- |
| App metrics | `GET /metrics` | request rate, error rate, latency histogram |
| Node process | `pm2 monit` | one core at 100% = single-instance bound; RSS growth = leak |
| Event loop | `/metrics` lag gauge | lag > 100ms = sync work blocking the loop |
| MySQL | `SHOW FULL PROCESSLIST` + slow log | queries stacking in `Sending data` = missing index |
| MySQL | `SHOW STATUS LIKE 'Threads_connected'` | nearing `max_connections` = pool misconfigured |
| Prisma pool | app logs | pool timeouts → raise `connection_limit` **or** fix the slow query |
| Redis | `redis-cli INFO stats` | `instantaneous_ops_per_sec`, `evicted_keys` (evictions = cache too small) |
| Cache | hit/miss logs per `docs/CACHE_POLICY.md` | low warm hit ratio = key cardinality bug (`scope:"user"` on a shared route) |
| Logs | `logs/` | error spikes, Winston write contention |

**Expected first bottleneck here:** Prisma query patterns (N+1 in transformers, missing
`ws_*` indexes) or the connection pool — not Express.

---

## 7. Thresholds

Start here, tighten after Phase 2 gives a baseline. k6 exits non-zero on breach, so these
double as CI gates.

```js
export const options = {
  thresholds: {
    // global
    http_req_failed:   ['rate<0.01'],                     // <1% errors
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    checks:            ['rate>0.99'],                     // correctness held under load

    // per journey — cached reads must be fast
    'http_req_duration{group:catalog}':   ['p(95)<300'],
    'http_req_duration{group:dashboard}': ['p(95)<400'],
    'http_req_duration{group:search}':    ['p(95)<600'],
    'http_req_duration{group:write}':     ['p(95)<800'],
    'http_req_duration{group:analytics}': ['p(95)<1500'],  // heavy aggregates get room

    // Phase 3 only — abort once it's clearly broken
    // http_req_failed: [{ threshold:'rate<0.05', abortOnFail:true, delayAbortEval:'30s' }],
  },
};
```

SLO to validate against: **p95 < 500ms, p99 < 1.5s, errors < 1% at N concurrent users** —
set N from real analytics, not a guess.

---

## 8. Journeys mapped to real endpoints

Model **user journeys**, not isolated endpoints — a single-endpoint hammer gives an
unrealistically good cache hit ratio and never exercises the real query mix.

### J1 — Browse / catalog · `group: catalog` (highest volume, mostly cached, read-only)
```
GET /client/course                          (cached 86400, scope user)
GET /client/course/categories               (cached, shared)
GET /client/course/categories/:id/courses   (cached)
GET /client/course/:id                      (cached)
GET /client/catalog/:type/:id/videos        (NOT cached — expect the slow one)
GET /client/catalog/:type/:id/materials     (cached)
GET /client/exam/categories
GET /client/package · /client/ebook · /client/book
```
**Checking:** cache hit ratio, p95 on the uncached `/videos` route, whether `scope:"user"`
keys blow up Redis memory at high VU counts.

### J2 — Logged-in home / dashboard · `group: dashboard`
```
GET /client/dashboard            (cached 60s, scope user)
GET /client/dashboard/resume     (uncached)
GET /client/profile
GET /client/my-subscriptions
GET /client/notification/unread-count
```
**Checking:** the fan-out route — one call triggers many queries. A 60s *user*-scoped TTL
means ~200 cold rebuilds/min at 200 unique VUs; that's the real cost.

### J3 — Search & pagination · `group: search`
```
GET /client/search?search=<term>&page=&limit=
GET /client/course?search=&page=2
GET /client/catalog/:type/:id/videos?search=
```
Drive from a **varied term list including Gujarati/Hindi** so you don't test one cached
query. **Checking:** LIKE-scan cost, `searchFilter.ts` multi-token AND behavior, collation
errors (MySQL 3988) under concurrency, deep-pagination cost (`page=50`).

### J4 — Video / lecture playback · `group: write` (contract-critical)
```
GET  /client/course/lecture?...                   (encrypted URL contract)
POST /client/course/lectures/:videoId/progress    (heartbeat — HIGH WRITE VOLUME)
GET  /client/learning/progress/my
```
**Checking:** the heartbeat is the platform's highest-frequency write — every playing
student posts on an interval. Give it its **own `constant-arrival-rate` scenario** at a
fixed RPS. Watch row-lock contention on `ws_lecture_progress` / `ws_enrollment_resume`,
and assert the video URL shape holds under load.

### J5 — Exam attempt lifecycle · `group: write` + `analytics` (stateful, contention-prone)
```
GET  /client/exam/:id/detail
GET  /client/exam/:id/questions
POST /client/exam/:id/attempts/start
POST /client/exam/:id/attempts/:attemptId/answer   ← repeated, ~1 per question
POST /client/exam/:id/attempts/:attemptId/submit
GET  /client/exam/:id/solution
GET  /client/exam/my/analytics                     ← heavy aggregate
```
**Checking:** the realistic worst case — a daily test where thousands start at once.
Per-VU state (each VU owns its `attemptId`), lock contention on answer saves, and whether
`submit` is idempotent under retry. **Disposable DB only.**

### J6 — Live session · `group: live` (Phase 4's main target)
```
GET /client/live-course
GET /client/live-course/:id/recordings
ws  Socket.IO connect + join
```
**Checking:** the spike profile. Socket.IO connection storms need a **separate k6
`ws`/websockets scenario** — HTTP VUs won't exercise them.

### J7 — Admin surface · `group: analytics` (low concurrency, heavy queries)
```
GET /admin/dashboard
GET /admin/subscription?filters...    (report query + date ranges)
GET /admin/customer?search=&page=
```
**Checking:** admins are few but expensive. Run ~10 admin VUs **concurrently with** J1/J2
load — the real risk is one admin report starving the client-facing connection pool.
This mixed-workload interference is the most valuable admin test.

### Traffic mix for Phase 2 (tune to your analytics)
`J1 40% · J2 25% · J4 15% · J3 10% · J5 5% · J7 5%` — plus J6 as its own spike scenario.

---

## 9. Repo layout & conventions

```
loadtest/
  lib/
    auth.js        # reads docs/migration/api-tests/.auth.json → token pool (setup())
    http.js        # BASE_URL, headers, envelope check helper, tagged request wrapper
    data.js        # SharedArray: seeded course/exam/package ids + search terms
    metrics.js     # custom Trend / Rate / Counter definitions
  journeys/
    j1-catalog.js  j2-dashboard.js  j3-search.js  j4-playback.js
    j5-exam.js     j6-live.js       j7-admin.js
  scenarios/
    smoke.js       # Phase 1
    load.js        # Phase 2  (journey mix)
    stress.js      # Phase 3
    spike.js       # Phase 4
    soak.js        # Phase 5
    cache-cold.js  ratelimit.js  scalability.js   # Phase 6
  results/         # --summary-export JSON, gitignored
  README.md
```

Conventions:
- **One distinct customer token per VU** where possible. A shared token = one cache key,
  one row, and the user-keyed limiter — wildly optimistic and unrepresentative.
- Tag every request with `group` (§7 depends on it).
- IDs come from `data.js`, seeded and stable — never random, or runs aren't comparable.
- Journeys are plain exported functions; scenario files only compose executors + options.
- `sleep()` between steps to model think time; without it you're testing a bot, not users.

Sample Phase-2 stages:
```js
stages: [
  { duration: '1m',  target: 50  },  // warm up — discard
  { duration: '3m',  target: 200 },  // ramp
  { duration: '10m', target: 200 },  // HOLD — read numbers here
  { duration: '1m',  target: 0   },
]
```

---

## 10. Running & recording

```bash
# target prep (once per session)
RATE_LIMIT_DISABLED=true      # .env — testing only, NEVER left on in prod
yarn db:up                    # mysql + redis
yarn migration:api:auth       # mint tokens

# phases
BASE_URL=http://localhost:3000 k6 run loadtest/scenarios/smoke.js
BASE_URL=http://localhost:3000 k6 run loadtest/scenarios/load.js \
  --summary-export=loadtest/results/load-$(date +%F).json
BASE_URL=http://localhost:3000 k6 run loadtest/scenarios/stress.js
BASE_URL=http://localhost:3000 k6 run loadtest/scenarios/spike.js
BASE_URL=http://localhost:3000 k6 run loadtest/scenarios/soak.js
```

Useful flags: `--vus/--duration` to override, `--out json=results/raw.json` for
time-series detail, `--http-debug` when a script misbehaves, `-e KEY=value` for
per-run config.

Record with every result: **git SHA · target env · PM2 `instances` · Prisma
`connection_limit` · MySQL `max_connections` · cache cold/warm · dataset size.**
Runs without these columns aren't comparable.

---

## 11. Reporting and the fix loop

Keep `docs/loadtest-results.md`, one row per run:

| Date | SHA | Env | Instances | Pool | Phase | Peak VUs | RPS | p95 | p99 | Err% | Bottleneck |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Per finding, record: endpoint, observed limit, **root cause** (query / index / pool / CPU
/ cache key), fix, and the delta after re-running the identical scenario. If a run leads
to a query, index, or schema change, log it in `docs/MIGRATION_QUERY_CHANGES.md`
(newest first) per the project rule.

---

## 12. Teardown

- Remove `RATE_LIMIT_DISABLED` from the target `.env` and restart.
- Clean up test rows (attempts, progress, enquiries, subscriptions) — ideally in
  k6's `teardown()`.
- `yarn typecheck` if any code changed as a result.
