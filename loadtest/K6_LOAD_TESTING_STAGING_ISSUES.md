# k6 Staging Load Test — Issues Tracker

Issues found during the **2026-07-27** staging campaign. Resolve in priority order.

**Related:** [Run log](./K6_LOAD_TESTING_STAGING_RUNLOG.md)

**Priority legend:**

| Priority | Meaning |
| --- | --- |
| **P0** | Blocks correct test execution or causes data corruption |
| **P1** | High — major performance/reliability impact under load |
| **P2** | Medium — degraded UX or test noise, workaround exists |
| **P3** | Low — documentation, tuning, or nice-to-have |

---

## Open issues

| ID | Priority | Area | Issue | Status |
| --- | --- | --- | --- | --- |
| STG-014 | P3 | Test config | Scalability at 30 rps pre-fix failed | ✅ Re-run @ 20 rps: 64 rps, 0% errors, 1w≈2w |
| STG-012 | P2 | Reliability | Shutdown reload failures | ✅ Re-run v2: **0% errors, 0×502** |
| STG-015 | P3 | Test infra | Soak 10.6% errors during overlapping pm2 reloads | 🟡 Re-run isolated (not code) |
| STG-010 | P3 | Test data | Only one published exam on staging | 🟡 Open |
| STG-008 | P3 | Test infra | Co-located load generator | 🟡 Accepted |

---

## Resolved issues

| ID | Priority | Issue | Resolution | Date |
| --- | --- | --- | --- | --- |
| STG-001 | P0 | Exam ID `300002` unpublished | Updated to `300001` in `data.js` | 2026-07-27 |
| STG-009 | P3 | Rate limiter disabled for Phase 6b | Ran with limiter ON, restored after | 2026-07-27 |
| STG-002 | P1 | Dashboard p95 ~11s | `idx_pcs_customer_status_endat` + search fix + admin date default → **295ms** | 2026-07-27 |
| STG-003 | P1 | Search p95 ~7–10s | Fixed `j3-search.js` `?search=` → `?q=` (was empty global search) → **151ms** | 2026-07-27 |
| STG-004 | P1 | Analytics p95 ~6–7s | Admin list 90-day default uses PCS date index → **934ms** | 2026-07-27 |
| STG-005 | P1 | Ceiling ~28 req/s | Indexes + harness fix → **~150 rps** stress, **47.6 rps** baseline | 2026-07-27 |
| STG-006 | P2 | Heartbeat failures under load | Resolved with DB fix — **0% errors** post-fix baseline | 2026-07-27 |
| STG-007 | P2 | DB-bound / workers don't scale | Root cause was missing indexes, not inherent DB ceiling — re-test scalability optional | 2026-07-27 |
| STG-011 | P2 | Spike 6% errors | Post-fix spike **0% errors**, p95 769ms | 2026-07-27 |
| STG-013 | P2 | my-subscriptions ~50% fail at peak | `idx_pcs_customer_status_endat` — EXPLAIN ALL→range | 2026-07-27 |

---

## Phase A fix details

### STG-002 / STG-013 — `idx_pcs_customer_status_endat`

```sql
CREATE INDEX idx_pcs_customer_status_endat
  ON ws_package_course_subscription (customer_id, status, end_at);
```

**Before:** `type=ALL`, rows=496879  
**After:** `type=range`, rows≈1216, `Using index condition`

Used by: `/my-subscriptions`, dashboard ownership, course purchase-state.

### STG-003 — Search harness bug

`loadtest/journeys/j3-search.js` sent `?search=term` but API reads `req.query.q`.  
Empty `q` triggered parallel search across **all 6 entity types** with no filter.

### STG-004 — Admin subscription list default window

`listCourseSubscriptions()` applies last-90-days `created_at` when no date/narrow filter sent.  
Uses existing `idx_pcs_created_course_amount`. Export path unchanged.

### Ebook index

```sql
CREATE INDEX idx_ebook_sub_customer_status_endat
  ON ws_ebook_subscription (customer_id, status, end_at);
```

---

## Post-fix validation (Phase B)

| Test | Before | After |
| --- | --- | --- |
| Baseline checks | 99.94% | **100%** |
| Baseline HTTP errors | 0.07% | **0%** |
| Baseline throughput | 28 rps | **47.6 rps** |
| Baseline global p95 | 7.08s | **209ms** |
| Stress completion | Aborted @ 28 rps | **Full 5m @ 153 rps** |
| Stress HTTP errors | 5.2% | **0.01%** |
| Spike HTTP errors | 6% | **0%** |

---

## Remaining work (Phase C — optional)

1. **STG-012** — Review shutdown 2.5% conn resets (zero 502s — may be acceptable).
2. **STG-014** — Re-run scalability at 15–20 rps post-fix (expect workers to matter less now).
3. **STG-010** — Seed more published exams on staging.
4. **STG-008** — External load generator for quotable production numbers.

---

## Issue log (append-only)

| Date | ID | Action |
| --- | --- | --- |
| 2026-07-27 | STG-001 | Fixed exam ID in data.js |
| 2026-07-27 | STG-002–014 | Logged from full staging campaign |
| 2026-07-27 | STG-009 | Resolved — ratelimit test passed |
| 2026-07-27 | STG-002–007, STG-011, STG-013 | Phase A fixes applied; baseline/spike pass; stress ceiling ~150 rps |
