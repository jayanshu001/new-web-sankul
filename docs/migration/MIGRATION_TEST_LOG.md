# Migration Test Log

> **Purpose:** Record what you tested, when, and whether it passed — before moving to the next migration step.  
> **How to test:** Follow [`testing-guide.md`](./testing-guide.md)  
> **Build progress:** [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md)  
> **Doc index:** [`README.md`](./README.md)

**Legend:** `⬜` Not run · `✅` Pass · `❌` Fail · `⏭️` Skipped (reason in Notes)

---

## Summary

| Phase / module | Status | Last tested | Tester |
|----------------|--------|-------------|--------|
| Phase 1 — MySQL + dump | ✅ | 2026-06-04 | Agent (automated) |
| Phase 2 — `app-update` | 🔄 | 2026-06-04 | Agent (automated only) |
| Phase 2 — `version` | 🔄 | 2026-06-04 | Agent (automated only) |
| Phase 2 — client `upgrade` | ✅ | 2026-06-04 | `yarn migration:api` |
| Phase 2 — Admin API (HTTP) | ✅ | 2026-06-04 | `yarn migration:api` (automated) |
| Phase 2 — Write-back PUT | ⬜ | — | — |
| Phase 2 — React admin UI | ⬜ | — | — |
| Phase 2 — `faq` | 🔄 | 2026-06-04 | Agent (automated) |
| Phase 2 — API automation (`api-tests/`) | ✅ | 2026-06-04 | app-update, version, faq — **28/28** incl. PUT/POST/DELETE |
| Next module: _(testimonial / customer)_ | ⬜ | — | — |

Update this table after each testing session.

---

## Phase 1 — Database preservation

### Automated (`yarn db:verify`)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P1-A1 | MySQL connection | `OK` | ✅ | 2026-06-04 | — | |
| P1-A2 | Database name | `websankul_staging` | ✅ | 2026-06-04 | — | |
| P1-A3 | `ws_*` table count | 89 | ✅ | 2026-06-04 | — | |
| P1-A4 | `ws_customer` rows | 26 | ✅ | 2026-06-04 | — | |
| P1-A5 | `ws_package` rows | 4 | ✅ | 2026-06-04 | — | |

### DBeaver / SQL (manual)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P1-D1 | Connect 127.0.0.1:3307 | Success | ✅ | 2026-06-04 | User | DBeaver |
| P1-D2 | `ws_app_update` id=1 | `latestVersion=4235200` | ⬜ | | | Run SQL from testing-guide |
| P1-D3 | `ws_versions` id=1 | `latestVersionCode=40976` | ⬜ | | | |
| P1-D4 | Spot-check `ws_customer` | Rows visible | ⬜ | | | |

---

## Phase 2 — CMS pilot (`app-update`, `version`)

**Env required:** `MIGRATION_MYSQL_MODULES=app-update,version`  
**Scripts:** `yarn db:test-cms-pilot` · Server: `yarn dev`

### Automated

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-A1 | `yarn db:test-cms-pilot` | `CMS pilot OK` | ✅ | 2026-06-04 | — | |
| P2-A2 | App update from MySQL | `latestVersion=4235200` | ✅ | 2026-06-04 | — | |
| P2-A3 | Version from MySQL | `latestVersionCode=40976` | ✅ | 2026-06-04 | — | |

### Server boot

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-B1 | Log: MySQL modules active | Lists `app-update,version` | ⬜ | | | |
| P2-B2 | Log: Prisma connected | No error | ⬜ | | | |
| P2-B3 | Log: MongoDB connected | No error | ⬜ | | | |

### DBeaver ↔ read path

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-D1 | `ws_app_update` vs pilot script | Same `latestVersion` | ⬜ | | | |
| P2-D2 | `ws_versions` vs pilot script | Same version codes | ⬜ | | | |

### Admin API — `GET` (requires admin JWT)

| ID | Endpoint | Expected (staging dump) | Result | Date | Tester | Notes |
|----|----------|-------------------------|--------|------|--------|-------|
| P2-H1 | `GET /api/v1/admin/cms/app-update` | `latestVersion: 4235200`, `updateType: flexible` | ⬜ | | | |
| P2-H2 | `GET /api/v1/admin/cms/version` | `latestVersionCode: 40976` | ⬜ | | | |

### Admin API — `PUT` write-back (local only)

| ID | Endpoint | Expected | Result | Date | Tester | Notes |
|----|----------|----------|--------|------|--------|-------|
| P2-W1 | `PUT /api/v1/admin/cms/app-update` | Row updates in DBeaver `ws_app_update` | ⬜ | | | Revert after test |
| P2-W2 | `GET` after PUT | Matches new value | ⬜ | | | |

### Client API (requires customer JWT)

| ID | Endpoint | Expected | Result | Date | Tester | Notes |
|----|----------|----------|--------|------|--------|-------|
| P2-C1 | `GET /api/v1/client/version` | Same codes as admin/DBeaver | ⬜ | | | |
| P2-C2 | `GET /api/v1/client/upgrade?clientVersion=40000` | `latestVersion` ≥ 40976 logic | ⬜ | | | |

### UI (React admin)

| ID | Screen | Expected | Result | Date | Tester | Notes |
|----|--------|----------|--------|------|--------|-------|
| P2-U1 | CMS App Update | Matches P2-H1 | ⬜ | | | |
| P2-U2 | CMS Version | Matches P2-H2 | ⬜ | | | |

### Regression — Mongo fallback

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-R1 | Unset `MIGRATION_MYSQL_MODULES`, restart | GET app-update still 200 | ⬜ | | | |
| P2-R2 | Re-enable MySQL modules | Pilot script OK again | ⬜ | | | |

---

## Phase 2 — FAQ (`faq`)

**Env:** `MIGRATION_MYSQL_MODULES=app-update,version,faq`  
**Script:** `yarn db:test-faq`

### Automated

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-F1 | `yarn db:test-faq` | `FAQ module OK` | ✅ | 2026-06-04 | — | |
| P2-F2 | Total FAQs | 13 | ✅ | 2026-06-04 | — | |
| P2-F3 | general / referral split | 5 / 8 | ✅ | 2026-06-04 | — | |
| P2-F4 | Synthetic faq-types | 2 (general, referral) | ✅ | 2026-06-04 | — | |

### DBeaver

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-FD1 | `SELECT COUNT(*) FROM ws_faq` | 13 | ⬜ | | | |
| P2-FD2 | `type='referral'` count | 8 | ⬜ | | | |

### Admin API

| ID | Endpoint | Expected | Result | Date | Tester | Notes |
|----|----------|----------|--------|------|--------|-------|
| P2-FH1 | `GET /api/v1/admin/cms/faqs` | 13 items, `_id` numeric strings | ⬜ | | | |
| P2-FH2 | `GET /api/v1/admin/cms/faqs/1` | First FAQ row | ⬜ | | | |
| P2-FH3 | `GET /api/v1/admin/cms/faq-types` | general + referral | ⬜ | | | |
| P2-FW1 | `POST` FAQ with `type: general` | Row in MySQL | ⬜ | | | Revert after |
| P2-FW2 | `DELETE /faqs/:id` | Row removed | ⬜ | | | |

**MySQL admin body:** use `type` (`general`|`referral`), not Mongo `typeId`.

### Client API

| ID | Endpoint | Expected | Result | Date | Tester | Notes |
|----|----------|----------|--------|------|--------|-------|
| P2-FC1 | `GET /api/v1/client/faqs?type=general` | 5 items | ⬜ | | | |
| P2-FC2 | `GET /api/v1/client/faq-types` | 2 types | ⬜ | | | |

---

## Phase 2 — Next module: _______________

_Copy this block when you start the next module (e.g. `banner-slider`)._

**Module:** `_______________`  
**Added to env:** `MIGRATION_MYSQL_MODULES=_______________`  
**MySQL table(s):** `_______________`

### Automated

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| NX-A1 | `yarn db:verify` | OK | ⬜ | | | |
| NX-A2 | Module-specific script | _(create if needed)_ | ⬜ | | | |

### DBeaver

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| NX-D1 | Row count / sample row | | ⬜ | | | |

### API

| ID | Method | Endpoint | Expected | Result | Date | Tester | Notes |
|----|--------|----------|----------|--------|------|--------|-------|
| NX-H1 | GET | | | ⬜ | | | |
| NX-W1 | PUT/POST | | | ⬜ | | | |

### UI

| ID | Screen | Expected | Result | Date | Tester | Notes |
|----|--------|----------|--------|------|--------|-------|
| NX-U1 | | | ⬜ | | | |

**Module sign-off:** All required rows ✅ → update [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) changelog → proceed to next module.

---

## Issues found during testing

| Date | Module | Issue | Severity | Fixed? | Link / PR |
|------|--------|-------|----------|--------|-----------|
| | | | | | |

---

## Session notes

_Free-form notes per testing session (environment, blockers, decisions)._

### 2026-06-04

- Phase 1 automated checks passed.
- Phase 2 pilot: `yarn db:test-cms-pilot` passed against Docker MySQL.
- **You should complete:** P2-B*, P2-D*, P2-H* (CMS pilot), P2-F* (FAQ), optional write-back / UI — mark ✅ in tables above.

---

*After each test session, update **Summary** at the top and add a row to [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) §16 Changelog if the module is signed off.*
