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
| Phase 2 — `banner-slider` | ✅ | 2026-06-06 | `yarn migration:api:banner-slider` (automated) |
| Phase 2 — `testimonial` | ✅ | 2026-06-06 | `yarn migration:api:testimonial` (automated) |
| Phase 2 — `department` | ✅ | 2026-06-06 | `yarn migration:api:department` (automated) |
| Phase 2 — `dynamic-image` | ➖ | 2026-06-06 | No API surface (model unused) — nothing to migrate |
| Phase 2 — `terms` | ✅ | 2026-06-06 | `yarn migration:api:terms` (automated) |
| Phase 2 — `popup` | ✅ | 2026-06-06 | `yarn migration:api:popup` (automated) |
| Phase 2 — `customer-auth` | ✅ | 2026-06-06 | `yarn migration:api:customer-auth` (automated, real dump customer) |
| Phase 2 — API automation (`api-tests/`) | ✅ | 2026-06-06 | + customer-auth — **82/82** (OTP generate/validate/refresh/logout against real ws_customer; issued token authenticates a protected route) |
| Next module: _(catalog: course/package/video)_ | ⬜ | — | — |

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

## Phase 2 — Banner Slider (`banner-slider`)

**Env:** `MIGRATION_MYSQL_MODULES=...,banner-slider`
**MySQL table:** `ws_banner_slider` · **Script:** `yarn migration:api:banner-slider` (Server: `yarn dev`)

### Automated (HTTP `api-tests/`)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-B-A1 | `GET /api/v1/admin/cms/banners` | sorted `orderBy` asc; key Mongo-cased; `keyId: null` | ✅ | 2026-06-06 | `migration:api` | 2 rows in dump |
| P2-B-A2 | `GET /api/v1/admin/cms/banners/:id` | single banner | ✅ | 2026-06-06 | `migration:api` | |
| P2-B-A3 | `POST` + `PUT` + `reorder` + `DELETE` banners | write round-trip + key casing + keyRef | ✅ | 2026-06-06 | `migration:api` | revert after |
| P2-B-C1 | `GET /api/v1/client/banners` | array, sorted `orderBy` asc | ✅ | 2026-06-06 | `migration:api` | |
| P2-B-C2 | `GET /api/v1/client/banners?key=Packages` | only `Packages` banners | ✅ | 2026-06-06 | `migration:api` | |

**Contract bridges verified:** MySQL lowercase `key` (`package`/`course`) ↔ Mongo-cased enum (`Packages`/`Courses`); `keyRef` derived; `keyId` null (catalog modules not migrated yet); reorder via Prisma `$transaction`.

### DBeaver (optional)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-BD1 | `SELECT COUNT(*) FROM ws_banner_slider` | 2 | ⬜ | | | |

---

## Phase 2 — Testimonial (`testimonial`)

**Env:** `MIGRATION_MYSQL_MODULES=...,testimonial`
**MySQL table:** `ws_testimonial` · **Script:** `yarn migration:api:testimonial` (Server: `yarn dev`)

### Automated (HTTP `api-tests/`)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-T-A1 | `GET /api/v1/admin/cms/testimonials` | 5 rows, sorted `rating` desc, `description` present | ✅ | 2026-06-06 | `migration:api` | |
| P2-T-A2 | `GET /api/v1/admin/cms/testimonials/:id` | single testimonial | ✅ | 2026-06-06 | `migration:api` | |
| P2-T-A3 | `POST` + `PUT` + `DELETE` testimonials | write round-trip; `description` persisted | ✅ | 2026-06-06 | `migration:api` | revert after |
| P2-T-C1 | `GET /api/v1/client/testimonials` | array, sorted `rating` desc | ✅ | 2026-06-06 | `migration:api` | |

**Contract bridge verified:** legacy MySQL column `discription` (typo) → API field `description`.

### DBeaver (optional)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-TD1 | `SELECT COUNT(*) FROM ws_testimonial` | 5 | ⬜ | | | |

---

## Phase 2 — Department / Contact-Us (`department`)

**Env:** `MIGRATION_MYSQL_MODULES=...,department`
**MySQL tables:** `ws_department` + `ws_department_contact` · **Script:** `yarn migration:api:department` (Server: `yarn dev`)

### Automated (HTTP `api-tests/`)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-DP-A1 | `GET /api/v1/admin/departments` | sorted `order` asc; nested `contacts[]`; `description` bridge; call/whatsapp flags present | ✅ | 2026-06-06 | `migration:api` | 4 depts / 13 contacts |
| P2-DP-A2 | `POST` + `PUT` (replace contacts) + `DELETE` | write round-trip; contact-set replacement; flags persisted; clean delete | ✅ | 2026-06-06 | `migration:api` | revert after |
| P2-DP-C1 | `GET /api/v1/client/contactus` | `{ departments }` envelope; active depts only; active contacts sorted by `order` | ✅ | 2026-06-06 | `migration:api` | |

**Contract bridges verified:** Mongo embedded `contacts[]` ↔ MySQL `ws_department` + `ws_department_contact` join; `decscription`→`description`; `isCallAvailable`/`isWhatsAppAvailable` flags preserved (admin `contactSchema` extended to accept them); PUT replaces contact set via transaction; DELETE removes contacts then department.

### DBeaver (optional)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-DPD1 | `SELECT COUNT(*) FROM ws_department` | 4 | ⬜ | | | |
| P2-DPD2 | `SELECT COUNT(*) FROM ws_department_contact` | 13 | ⬜ | | | |

### Note — `dynamic-image`

`ws_dynamic_image` has a Prisma model (`DynamicImage`) and a Mongo model, but **no controller/route imports it** — there is no API surface to migrate. Skipped intentionally; revisit only if an endpoint is later added.

---

## Phase 2 — Terms & Conditions (`terms`)

**Env:** `MIGRATION_MYSQL_MODULES=...,terms`
**MySQL table:** `ws_termsandcondition` · **Script:** `yarn migration:api:terms` (Server: `yarn dev`)

### Automated (HTTP `api-tests/`)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-TM-A1 | `GET /api/v1/admin/cms/terms` | 3 rows; module/fsm/status typed | ✅ | 2026-06-06 | `migration:api` | |
| P2-TM-A2 | `GET /api/v1/admin/cms/terms/:id` | single row | ✅ | 2026-06-06 | `migration:api` | |
| P2-TM-A3 | `POST` + `PUT` + `DELETE` (module=`book`) | write round-trip; fsm/status persisted | ✅ | 2026-06-06 | `migration:api` | revert after |
| P2-TM-A4 | `POST` invalid module value | **400** (MySQL fixed enum) | ✅ | 2026-06-06 | `migration:api` | enum guard |
| P2-TM-C1 | `GET /api/v1/client/terms` | array of active terms | ✅ | 2026-06-06 | `migration:api` | |
| P2-TM-C2 | `GET /api/v1/client/terms?module=<known>` | single object (not array) | ✅ | 2026-06-06 | `migration:api` | `findOne` shape |
| P2-TM-C3 | `GET /api/v1/client/terms?module=__nope__` | `null` | ✅ | 2026-06-06 | `migration:api` | |
| P2-TM-C4 | inactive row absent from client list | hidden when `status:false` | ✅ | 2026-06-06 | `migration:api` | write-gated |

**Contract bridges verified:** `ws_terms_and_conditions` ↔ `ws_termsandcondition`; client returns **array** (no `module`) vs **single object/null** (`?module=`), both `status:true`. **Schema-vs-data discovery:** MySQL `module` is `enum('book','pendrive','referral code')` — the tests caught a 500 (error 1265) on a free-string create; fixed by adding a MySQL-specific enum zod schema on admin writes (mirrors faq's `type`).

### DBeaver (optional)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-TMD1 | `SELECT COUNT(*) FROM ws_termsandcondition` | 3 | ⬜ | | | |

---

## Phase 2 — Popup Notification (`popup`)

**Env:** `MIGRATION_MYSQL_MODULES=...,popup`
**MySQL table:** `ws_popup_notification` · **Script:** `yarn migration:api:popup` (Server: `yarn dev`)

### Automated (HTTP `api-tests/`)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-PU-A1 | `GET /api/v1/admin/cms/popups` | newest first; `promoExpireAt` present | ✅ | 2026-06-06 | `migration:api` | 36 rows |
| P2-PU-A2 | `GET /api/v1/admin/cms/popups/:id` | single popup | ✅ | 2026-06-06 | `migration:api` | |
| P2-PU-A3 | `POST` + `PUT` + `DELETE` | write round-trip; `promoExpireAt` date persisted | ✅ | 2026-06-06 | `migration:api` | revert after |
| P2-PU-C1 | `GET /api/v1/client/popup` | single active popup or `null` (not array) | ✅ | 2026-06-06 | `migration:api` | |
| P2-PU-C2 | active honors status + expiry | inactive/expired excluded; future+active wins | ✅ | 2026-06-06 | `migration:api` | write-gated, 3 fixtures |

**Contract bridges verified:** `promoExpireAt` ↔ `promo_expire_at` (nullable `date`), `createdAt`/`updatedAt` ↔ snake_case; client active popup = `status:true AND promo_expire_at > now`, newest first, single/null. S3 image upload is route-level middleware (DB-agnostic) — controller receives `image` as a string.

### DBeaver (optional)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-PUD1 | `SELECT COUNT(*) FROM ws_popup_notification` | 36 | ⬜ | | | |

---

## Phase 2 — Customer Auth (`customer-auth`)

**Env:** `MIGRATION_MYSQL_MODULES=...,customer-auth`; `MIGRATION_TEST_CUSTOMER_PHONE=9664796376`
(in `TESTING_PHONE_NUMBERS` → static OTP `5786`, SMS skipped).
**MySQL tables:** `ws_customer` + `ws_customer_otp` + `ws_customer_access_token`
**Script:** `yarn migration:api:customer-auth` (Server: `yarn dev`)

### Automated (HTTP `api-tests/`)

| ID | Test | Expected | Result | Date | Tester | Notes |
|----|------|----------|--------|------|--------|-------|
| P2-CA-1 | `POST /client/auth/otp/generate` | ok + isNewUser | ✅ | 2026-06-06 | `migration:api` | real ws_customer row |
| P2-CA-2 | `POST /client/auth/otp/validate` (5786) | token + refreshToken + profile; phone matches | ✅ | 2026-06-06 | `migration:api` | issued token also authenticates `GET /client/faqs` |
| P2-CA-3 | `POST /client/auth/token/refresh` | working new token pair + profile | ✅ | 2026-06-06 | `migration:api` | |
| P2-CA-4 | refresh w/ invalid token | 401 | ✅ | 2026-06-06 | `migration:api` | |
| P2-CA-5 | `DELETE /client/auth/logout` | ok | ✅ | 2026-06-06 | `migration:api` | token row → active=0,deleted=1 |
| P2-CA-6 | validate w/ wrong OTP | 400 | ✅ | 2026-06-06 | `migration:api` | |

**De-risking finding:** `authenticate` middleware does NOT read the token table at
request time (JWT verify + Redis revocation only) — so the full suite's
`getCustomerToken()` now runs the MySQL OTP path and all 9 modules stay green
(**82/82**), proving general authenticated requests are unaffected.

**Schema change:** added nullable `refresh_token` column to
`ws_customer_access_token` (container + dump CREATE TABLE + Prisma model).
**DB spot-check:** after validate, a new token row has `refresh_token` set,
`active=1`; prior rows + post-logout row are `active=0,deleted=1`; OTP `5786`
recorded in `ws_customer_otp`.

### Note — refresh-token rotation behavior

`jwt.sign` is deterministic per-second for the same payload, so a refresh issued
within the same second yields an identical token *string* (true in both the Mongo
and MySQL branches — not a migration regression). The contract verified is a valid
**working** new pair, not string-level rotation.

---

## Phase 2 — Next module: _______________

_Copy this block when you start the next module (e.g. `course`)._

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

### 2026-06-06

- Local env re-provisioned (dump imported, `db:verify` = 89 tables / 26 customers / 4 packages).
- Migrated two read-heavy CMS modules: **`banner-slider`** and **`testimonial`** (repository → service → transformer → controller switch via `isMysqlModule()`).
- `yarn migration:api` → **45/45 passed** across app-update, version, faq, banner-slider, testimonial (incl. PUT/POST/DELETE + banner reorder).
- `tsc` clean for new/changed files (pre-existing unrelated errors in `material.controller`/`faq.service` casts unchanged).
- Generators `docs:schema-comparison` / `docs:field-comparison` now load `.env` so migrated status reflects the module list automatically.

### 2026-06-06 (cont.) — department

- Migrated **`department`** (contact-us master): two-table join `ws_department` + `ws_department_contact` under embedded `contacts[]`.
- Caught & fixed a real contract gap: admin `contactSchema` was stripping `isCallAvailable`/`isWhatsAppAvailable` (write test failed first run) — schema extended; re-test green.
- `yarn migration:api` → **52/52 passed** across all 6 modules.
- **`dynamic-image` skipped** — model exists but no controller/route uses it (no API surface).
- **Optional manual follow-up:** DBeaver count checks (P2-BD1, P2-TD1, P2-DPD1/2) and React admin UI screens.

### 2026-06-06 (cont.) — terms

- Migrated **`terms`** (terms & conditions): client `GET /terms` array vs `?module=` single-object/null shapes both preserved.
- **Schema-vs-data discovery the tests caught:** MySQL `module` is `enum('book','pendrive','referral code')`, not free text — a write with a random module returned 500 (MySQL error 1265). Fixed by adding a MySQL-specific enum zod schema on admin create/update (same approach as faq's `type`), and the suite now also asserts an invalid module → 400.
- `yarn migration:api` → **64/64 passed** across all 7 modules.
- Note: Prisma still types `module` as `String` (loose) — the enum truth lives in the validation layer. A future `db:pull` could tighten the Prisma model, but that's optional and out of scope here.

### 2026-06-06 (cont.) — popup

- Migrated **`popup`** (popup notification): `promoExpireAt` ↔ `promo_expire_at` date mapping + client active-popup query (`status:true AND promo_expire_at > now`, newest first, single/null).
- Confirmed the **S3 image upload is DB-agnostic** — route-level multer/`attachImage` middleware sets `image` as a string before the controller; no migration pattern change needed (same as `banner-slider.image`). This retires the "uploads need new handling" risk flagged earlier.
- `yarn migration:api` → **73/73 passed** across all 8 modules. **Read-only / CMS group now fully complete.**
- **`social-link` confirmed Mongo-only** (no `ws_social*` table in dump, no Prisma model) — like `dynamic-image`, nothing to migrate.
- **Next:** `customer` auth — its own focused, security-sensitive session.

### 2026-06-06 (cont.) — customer-auth

- Migrated **`customer-auth`** (client OTP/token flow): generate/resend/validate/logout/refresh, 3 tables. Service refactored in place (`auth.service.ts`) with an `isMysqlModule("customer-auth")` branch per function; Mongo path unchanged. `authenticate.ts` untouched.
- Added nullable `refresh_token` column to `ws_customer_access_token` (container + dump + Prisma) — the only schema change.
- `yarn migration:api` → **82/82** across 9 modules.
- **Found & fixed two pre-existing HEAD regressions** (introduced by the `Migration Initiated`/merge commits, unrelated to this work): (1) `src/admin/cms/cms.controller.ts` had its banner-slider/testimonial/terms/version/app-update service imports clobbered back to model imports while keeping the new handler bodies → 25 tsc errors; restored the imports. (2) `package.json` lost the entire migration scripts block (`db:*`, `docs:*`, `migration:api*`, `prisma:generate`); restored from commit `fb52512` + added `customer-auth`. Also added the `Explore` banner key (added to the validation enum after the banner module was built).
- tsc back to the 8 pre-existing baseline errors; none in migrated code.
- **Next:** catalog (`course`/`package`/`video`) — read-heavy data backbone, large surface.

*After each test session, update **Summary** at the top and add a row to [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) §16 Changelog if the module is signed off.*
