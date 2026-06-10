# 🔖 RESUME HERE — Migration Session Handoff

> **Purpose:** Cold-start context so work can resume exactly where it paused. Read this first.
> **Last updated:** 2026-06-10
> **Branch:** `migration` (do NOT merge to `main` until full migration + sign-off)
> **Working dir:** `/Users/pratikzankat/new-web-sankul`

---

## ⏸️ WHERE WE ARE RIGHT NOW

**Between modules. About to START the catalog module. No catalog code written yet.**

I scoped catalog and asked the user **3 decisions** (below). Waiting on answers before coding.
Nothing is half-implemented. All finished work is in the working tree but **NOT committed**.

### The 3 open decisions blocking catalog (from [`CATALOG_MODULE_SCOPE.md`](./CATALOG_MODULE_SCOPE.md) §5)
- **D1 — sub-order:** recommended `package → course → video` (safest first; video last for the encryption contract).
- **D2 — video-category relations** (`ws_video_category_package_relation`, `ws_video_category_relation`): migrate with video, or follow-up?
- **D3 — enable strategy:** flip each sub-module as built, OR build all three dual-path then flip together after a consumer audit (safer; mirrors the address deferral).

**Immediate next action when resuming:** get D1–D3 answers, then build `package` first (lowest risk: 4 rows, metadata, no encryption).

---

## ✅ WHAT'S DONE (this work session)

### Customer Module — COMPLETE (all sub-modules built)
| Sub-module | Flag | State |
|---|---|---|
| `customer-auth` | ✅ live | done before this session |
| `customer-lookups` | ✅ live | wired states/educations/characteristic in `address.controller.ts` |
| `customer-address` | ⚪ OFF | code complete; **flip DEFERRED to commerce wave** (coupled to cart/course/shipping) |
| `customer-profile` | ⚪ OFF | code complete; OFF because dashboard aggregates non-customer collections |
| `customer-bank-account` | ⚪ OFF | code complete; OFF because referral withdrawal is Mongo-coupled |
| shipping | — | NOT standalone — part of cart/order; migrates with commerce |

### offline-city — COMPLETE + ENABLED
- Cities-only, migrated to unblock address. Added `status`/`order` columns to `ws_offline_city` (DDL).
- Wired `listCities` + cart `cityId`→name resolution.
- **Address flip was deferred** (see below), so offline-city is enabled but address stays OFF.

### New module dirs created
`src/modules/`: `customer-address/`, `customer-profile/`, `customer-bank-account/`, `offline-city/`
(each: repository + service + transformer + types; profile also has `name.ts`)

---

## 🧠 KEY DECISIONS MADE (don't relitigate)

1. **Address flip DEFERRED to commerce wave.** End-goal is full MySQL (Mongo retires), but address is coupled to cart (`cart.controller.ts:177`) + course-order (`course.service.ts:306`) which still READ `CustomerAddress` via Mongoose (ObjectId). Flipping address ON now would break checkout for 2 legacy rows. Enable it WITH cart/orders/shipping.
2. **Build-flag-OFF pattern:** when a module is coupled to unmigrated modules, build the dual-path code but leave the flag OFF. Verify via live-DB `tsx` tests instead of HTTP.
3. **Customer decisions (encoded, done):** name = split `full_name` (join on write); device tokens = single `device` col (newest wins); `isProfileCompleted` = derived; `facebookId` = mapped read-only; address kept `label`/`is_default`/`city_id` to match live DB; offline-city `status`/`order` added via DDL.

---

## ⚙️ HOW THIS REPO / MIGRATION WORKS (conventions)

- **Toggle:** `src/config/migration.ts` → `isMysqlModule("<key>")`, driven by `MIGRATION_MYSQL_MODULES` in `.env`.
- **Currently enabled (11):** `app-update, version, faq, banner-slider, testimonial, department, terms, popup, customer-auth, customer-lookups, offline-city`.
- **Module pattern:** `src/modules/<key>/` = repository (Prisma) + service (dual-path branch) + transformer (row→DTO, keep Mongo JSON shape) + types. Controllers in `src/client/**` or `src/admin/**` branch on `isMysqlModule()`.
- **Source of truth = the MySQL dump** (live DB on `127.0.0.1:3307/websankul_staging`, docker `ws-mysql`). Migrated modules serve dump data. customer-auth tests use real dump customer phone `9664796376`.
- **Per-module doc protocol** (from [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md), scenario A) — DO ALL OF THESE after each module:
  1. `scripts/generate-migrated-modules.ts` — add `MIGRATED_REGISTRY` entry
  2. `scripts/generate-schema-comparison.ts` — add per-table status line
  3. `.env` + `.env.example` — add key (only when tests pass / safe to enable)
  4. `docs/migration/api-tests/<key>/client.api.test.ts` + register in `run-all.ts`, `run-module.ts`, `modules.manifest.ts` + `package.json` `migration:api:<key>` script
  5. `MIGRATION_TEST_LOG.md` — summary row + detail section
  6. `MIGRATION_TRACKER.md` — phase line + §16 changelog
  7. `README.md` — current-status block
  8. Regenerate: `yarn docs:migrated-modules`, `docs:schema-comparison`, `docs:field-comparison`
  9. `docs/MIGRATION_QUERY_CHANGES.md` — append schema/query change (newest first) — **user's standing rule**

---

## ⚠️ GOTCHAS / ENVIRONMENT QUIRKS (important)

- **`node_modules` is PARTIAL** — `yarn dev` can't boot, full `tsc`/HTTP api-tests can't run here. I verify MySQL paths via standalone `tsx` scripts against the live DB instead. To complete HTTP sign-off the user must `yarn install` then `yarn dev` + `yarn migration:api:<key>`.
- **`prisma` CLI not installed locally** — use `npx --yes prisma@5.22.0 generate` (the project pins 5.22; global npx may grab 7.x which errors on `url` in schema).
- **`prisma generate`'s install sometimes re-pins `package.json`** (`^5.22.0` → `5.22.0`). After generate, CHECK package.json: if pins lost the caret, fix by editing the two lines back — do NOT `git checkout package.json` (that also wipes my added `migration:api:*` script lines). Caret lines: `"@prisma/client": "^5.22.0"`, `"prisma": "^5.22.0"`.
- **DB access:** `docker compose exec -T ws-mysql mysql -uroot -pwebsankul_dev websankul_staging -e "..."`.
- **tsx test scripts:** must live INSIDE the project (not `/tmp`) to resolve `@prisma/client`. I use `scripts/_tmp/` then `rm -rf` it. Pass `DATABASE_URL='mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging'`.
- **RECURRING SCHEMA-DRIFT BUG:** Prisma models drift from the live DDL. Before building any table, run `DESCRIBE <table>` and compare: (a) phantom columns (Prisma has cols the DDL lacks → reads fail), (b) `Int` vs `bigint` (phone overflow), (c) NOT NULL cols the Mongo model omits (e.g. address `city`). Seen on: address (phone Int, phantom label/is_default/city_id, NOT NULL city), offline (batch.status phantom, center.phone Int, city missing status/order). **Catalog `Video` checked = clean.**
- **CROSS-DB-BOUNDARY ID COUPLING:** flipping a module ON breaks any STILL-MONGO consumer that reads its ids (int vs ObjectId + different store). This is why address/profile/bank are OFF. **Audit consumers before enabling any module.** Catalog likely has this (commerce/dashboard read catalog ids) — audit in catalog build step 1.

---

## 📍 NEXT MODULE: CATALOG (scoped, not started)

Full scope: [`CATALOG_MODULE_SCOPE.md`](./CATALOG_MODULE_SCOPE.md). Highlights:
- **IN scope:** `ws_package` (4) + `ws_package_type`, `ws_course` (1) + subject category, `ws_video` (156) + `ws_video_category` (157) + relation tables.
- **OUT (commerce wave):** all `*_order`, `*_subscription`, `*_cart`, `*_price`, exam/material category joins.
- **Video URL contract (memory rule):** encryption is isolated in `utils/videoEncryption` via `encryptVideoSource()` in `src/client/course/lecture.controller.ts`. Prisma `Video` already has `platform`/`youtube_id`/`aws_id`/`vimeo_id` → feed the SAME object into the SAME util = identical token+URL. **Never reimplement encryption.** All video-URL endpoints (lecture, free, dashboard resume) must route through the util.
- **Suggested build order:** package → course → video (video last, with Mongo-vs-MySQL token/URL parity check).

---

## 📂 SCOPE / REFERENCE DOCS WRITTEN THIS SESSION
- [`CUSTOMER_MODULE_REMAINING.md`](./CUSTOMER_MODULE_REMAINING.md) — customer audit + completion record
- [`OFFLINE_MODULE_SCOPE.md`](./OFFLINE_MODULE_SCOPE.md) — offline-city + address-deferral finding
- [`CATALOG_MODULE_SCOPE.md`](./CATALOG_MODULE_SCOPE.md) — next module scope + open decisions
- [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md) — schema/query change log (newest first)

---

## 🧹 HOUSEKEEPING
- **Nothing committed yet** — ~20 modified/new files in the working tree on `migration`. Consider committing the finished Customer Module + offline-city as a checkpoint before starting catalog (user was offered this; not yet done).
- **Pending verification** (needs `yarn install`): full `yarn typecheck` + HTTP `yarn migration:api:customer-lookups` / `:offline-city`. Data paths already verified via live-DB tsx tests.
