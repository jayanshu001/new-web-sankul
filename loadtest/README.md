# loadtest/ — k6 load testing

Implements the plan in [`docs/K6_LOAD_TESTING_PLAN.md`](../docs/K6_LOAD_TESTING_PLAN.md).
**Never run against production** (ground rule #1).

## Status

- **Phase 0 (setup)** — done: skeleton + `lib/` + smoke scenario.
- **Phase 1 (smoke)** — `scenarios/smoke.js`, PASS (checks 100%, 0 failures).
- **Phase 2 (baseline load)** — `scenarios/load.js` built + validated. Journeys J1–J7
  authored; data.js seeded with real IDs. Multi-scenario: browse + heartbeat + admin.
- **Phase 3 (stress)** — `scenarios/stress.js` built + shakeout-validated (`ramping-arrival-rate`,
  2×/3×/4× steps, abort-on-fail). **Real run HELD** until a proper target exists (staging +
  `yarn build && yarn start`) and a valid Phase-2 baseline gives a real `PEAK_RPS`.
- **Phase 4 (spike)** — `scenarios/spike.js` (HTTP burst 10→500, cold-cache stampede) +
  `scenarios/live-ws.js` (Socket.IO connection storm via raw ws + `lib/socketio.js`) built +
  shakeout-validated (ws handshake/auth/join round-trips 100%). **Real run HELD** for a
  proper target. Flush Redis (`redis-cli -p 6380 FLUSHDB`) before the HTTP spike for a true cold run.
- **Phase 5 (soak)** — `scenarios/soak.js` (constant-vus + steady heartbeat, `-e DURATION=2h`)
  built + shakeout-validated. **Real run HELD** — a leak hunt needs a long run on a stable target.
- **Phase 6 (targeted)** — all four built + shakeout-validated:
  - `cache-cold.js` (6a) — run twice, cold (after FLUSHDB) vs warm; compare per-group delta.
  - `ratelimit.js` (6b) — the ONE limiter-ON run; asserts 429 at the 300/60s budget. **Run
    against a target WITHOUT `RATE_LIMIT_DISABLED`.**
  - `shutdown.js` (6c) — steady load + `/readyz` poll; trigger `pm2 reload` mid-run; asserts **zero 502s**.
  - `scalability.js` (6d) — fixed arrival rate, run at `pm2 scale 1` vs `max`; CPU-bound vs DB-bound.

**Harness complete AND run.** All 8 phases were executed 2026-07-24 against a local PM2
cluster (2 API workers, compiled `dist/`) — see `docs/K6_LOAD_TESTING_WORKLOG.md` §"Real-run
campaign" and `docs/loadtest-results.md`. **Headline: the system is DB-bound** (MySQL is the
sole ceiling; app-tier scaling doesn't help). Limiter (300/60s cluster-wide), zero-downtime
reload, and no-leak soak all verified. Remaining: act on the DB fix loop; re-run Phase 2 on
staging for a quotable production number.

> **Tokens expire (~1h).** Re-run `yarn migration:api:auth` before every run — a stale
> token shows up as `http_req_failed` 100% (all 401s), not a server problem.

## Layout

```
lib/       http.js auth.js data.js metrics.js   # shared helpers
journeys/  j1-catalog j2-dashboard j3-search j4-playback j5-exam j6-live j7-admin
scenarios/ smoke.js  load.js                     # Phase 1, Phase 2
results/   --summary-export JSON (gitignored)
```

## Run smoke (local target)

```bash
# 1. target prep
RATE_LIMIT_DISABLED=true yarn dev      # in one terminal (or set the flag in .env)
yarn db:up                             # mysql + redis
yarn migration:api:auth                # mint fresh tokens (~1h TTL) → .auth.json

# 2. run
BASE_URL=http://localhost:3000 k6 run loadtest/scenarios/smoke.js
```

**Exit criteria:** `checks` rate = 100%, `http_req_failed` = 0. If it fails, fix the
**script** — never debug a big run that never smoked.

## Run Phase 2 baseline

```bash
BASE_URL=http://localhost:4001 k6 run loadtest/scenarios/load.js \
  --summary-export=loadtest/results/load-$(date +%F).json
```

Tunables (`-e KEY=value`): `PEAK` (peak browse VUs, default 100), `HEARTBEAT_RPS`
(default 10), `ADMIN_VUS` (default 10), `EXAM_WRITE=true` (adds the J5 attempt-write
lifecycle — **disposable DB only**). Phase durations: `WARMUP RAMP HOLD RUN` (default
1m/3m/10m/15m) — shorten for a shakeout. **Read numbers from the HOLD only.**

> The headline "number you quote" must come from a proper target — `yarn build &&
> yarn start` (PM2) against staging, with `PEAK` set from real analytics — not from
> `yarn dev` (single unbuilt tsx process). Record git SHA · instances · pool ·
> `max_connections` · cache state with every result (§10).

## Notes

- Tokens in `docs/migration/api-tests/.auth.json` expire (~1h). Re-run
  `yarn migration:api:auth` if smoke logs a stale-token warning.
- Endpoint paths here are the **real** mounts (`/courses`, `/packages`,
  `/notifications/count`, `/search`) — the plan's §8 uses illustrative names.
- Seed real IDs into `lib/data.js` before Phase 2 (smoke doesn't need them).
