# k6 Load Testing — Server Runbook

How to re-run the load tests (and **verify the DB index fix**) on the **staging** server —
the same tests we ran locally in `K6_LOAD_TESTING_WORKLOG.md`.

> **Ground rule: run against STAGING only, never production.** The write journeys
> (heartbeat, exam attempt) mutate data.

---

## 0. Prerequisites (on the staging box, once)

```bash
# k6 (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

k6 version   # confirm
```

The repo (with `loadtest/`) and `yarn`/`node` must be present. **Ideally run k6 from a
*separate* machine** pointed at staging, so the load generator doesn't steal CPU from the
API. If you must co-locate, treat the numbers as directional (same caveat as the local run).

---

## 1. Point the harness at staging + mint tokens

```bash
# 1. Target staging (used by loadtest/lib/http.js BASE_URL)
export BASE_URL="https://staging.your-domain.example"     # <-- staging base URL, no trailing slash

# 2. Mint fresh tokens for staging. Tokens are ~1h TTL — re-run before EVERY session.
#    Uses MIGRATION_TEST_CUSTOMER_ID (a real ws_customer id on staging) from .env.
yarn migration:api:auth
```

`yarn migration:api:auth` writes `docs/migration/api-tests/.auth.json` (customer + admin
tokens). If a run shows `http_req_failed` 100%, the token expired — just re-mint.

---

## 2. Smoke first (always)

Confirms the harness talks to staging and auth works before applying real load.

```bash
k6 run loadtest/scenarios/smoke.js
```

Expect: `checks` 100%, `http_req_failed` 0%. If not, fix auth/URL before continuing.

---

## 3. Baseline load — the quotable number (Phase 2)

```bash
k6 run \
  -e PEAK=100 \
  -e HEARTBEAT_RPS=10 \
  -e ADMIN_VUS=10 \
  loadtest/scenarios/load.js
```

Read numbers from the **10-minute HOLD only** (discard warm-up/ramp). Watch:
`http_req_duration` p95, and the per-group lines (`{group:analytics}`, `{group:dashboard}`,
`{group:catalog}`, …). Tunables: `WARMUP/RAMP/HOLD/RUN`, `EXAM_WRITE=true` (staging only —
it writes exam attempts).

---

## 4. Verify the DB index fix on the server (the important part)

This is what confirms the fix we made locally (`idx_pcs_created_course_amount`) actually
helps on real staging data (~600k `ws_package_course_subscription` rows).

### 4a. Confirm the index is present

```bash
mysql -h <staging-host> -u <user> -p <db> -e "SHOW INDEX FROM ws_package_course_subscription;"
```

Look for `idx_pcs_created_course_amount` on `(created_at, course_id, amount)`. If missing,
apply the DDL:

```bash
npx prisma db execute \
  --file docs/migration/schema-changes/2026-07-24_pcs_created_at_index.sql \
  --schema prisma/schema.prisma
```

### 4b. Prove EXPLAIN uses it (before vs after)

Run the admin analytics path's shape and confirm it's a range scan, not a full scan:

```sql
EXPLAIN
SELECT COUNT(*), SUM(amount)
FROM ws_package_course_subscription
WHERE created_at BETWEEN '2026-06-01' AND '2026-06-30'
  AND course_id IS NOT NULL;
```

- **Without** the index: `type=ALL`, `rows≈598743`.
- **With** the index: `type=range`, `rows` small, `Extra: Using index`.

### 4c. Measure the difference under load (A/B)

The clean way to get the delta: run the cold-cache analytics scenario, drop the index,
re-run, restore it. **On staging only.**

```bash
# Cold cache each time so you measure the DB, not Redis:
redis-cli -h <redis-host> -p <port> FLUSHDB

# AFTER (index present):
k6 run -e PEAK=10 loadtest/scenarios/cache-cold.js   # note group:analytics p95

# BEFORE (drop to compare, then put it straight back):
mysql ... -e "DROP INDEX idx_pcs_created_course_amount ON ws_package_course_subscription;"
redis-cli ... FLUSHDB
k6 run -e PEAK=10 loadtest/scenarios/cache-cold.js   # note group:analytics p95
# RESTORE immediately:
npx prisma db execute --file docs/migration/schema-changes/2026-07-24_pcs_created_at_index.sql --schema prisma/schema.prisma
```

Compare `http_req_duration{group:analytics}` p95 between the two. Locally this was
**4.84s → 343ms (~14×)**; staging will differ in absolute numbers but should show the same
large drop.

---

## 5. Optional deeper phases

Same as local; all point at `BASE_URL`. Run only when you need them:

| Test | Command | What it checks |
| --- | --- | --- |
| Stress | `k6 run -e PEAK_RPS=<baseline×3> loadtest/scenarios/stress.js` | Where it breaks + graceful degradation |
| Spike | `redis-cli FLUSHDB && k6 run loadtest/scenarios/spike.js` | Cold burst / cache stampede |
| Socket.IO | `k6 run -e SOCKETS=300 -e LIVE_CLASS_ID=<id> loadtest/scenarios/live-ws.js` | Connection storm |
| Soak | `k6 run -e DURATION=2h loadtest/scenarios/soak.js` | Memory leak hunt |
| Rate limiter | `k6 run loadtest/scenarios/ratelimit.js` | 300/60s → 429 (needs `RATE_LIMIT_DISABLED` **off**) |
| Shutdown | `k6 run loadtest/scenarios/shutdown.js` + `pm2 reload` mid-run | Zero 502s on deploy |
| Scalability | run at `pm2 scale <app> 1` vs `2` | CPU-bound vs DB-bound |

---

## 6. Reading & keeping results

Add `--summary-export loadtest/results/<name>-<date>.json` to any run to save it (result
JSONs are gitignored — they're run artifacts, not source). Record any findings back in
`docs/MIGRATION_QUERY_CHANGES.md` if they lead to a schema/index change.

---

## Quick reference

```bash
export BASE_URL="https://staging.your-domain.example"
yarn migration:api:auth                       # fresh tokens (~1h TTL)
k6 run loadtest/scenarios/smoke.js            # sanity
k6 run loadtest/scenarios/load.js             # baseline
redis-cli FLUSHDB && k6 run loadtest/scenarios/cache-cold.js   # verify index under cold load
```
