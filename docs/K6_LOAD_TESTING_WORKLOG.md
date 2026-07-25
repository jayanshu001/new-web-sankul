# k6 Load Testing — Tests & Results

Target: local PM2 cluster (2 API workers, compiled `dist/`) + docker MySQL/Redis. 2026-07-24.

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
