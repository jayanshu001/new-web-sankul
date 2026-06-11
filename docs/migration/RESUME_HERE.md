# 🔖 RESUME HERE — Migration Session Handoff

> **Purpose:** Cold-start context so work can resume exactly where it paused. **Read this first.**
> **Last updated:** 2026-06-11
> **Branch:** `migration` (do NOT merge to `main` until full migration + sign-off)
> **Working dir:** `/Users/pratikzankat/new-web-sankul`
> **Model note:** you are continuing a long migration done module-by-module. The pattern, rules, and
> tooling below are established — follow them, don't reinvent.

---

## ⏸️ WHERE WE ARE RIGHT NOW

**Between waves. Commerce/dashboard wave is SCOPED but NO code written yet.**
Catalog is fully built (all flags OFF). The commerce wave is the agreed next step (it's what unblocks
catalog). I scoped it into [`COMMERCE_WAVE_SCOPE.md`](./COMMERCE_WAVE_SCOPE.md) and asked the user **4
decisions (C1–C4)**. Waiting on answers before coding. **Nothing is half-implemented.** All finished work
is in the working tree but **NOT committed**.

### Immediate next action when resuming
1. Get the **C1–C4** answers (below). The user may just say "all recommended defaults" → then proceed.
2. Build **3a, `commerce-price` first** (`ws_package_course_ebook_price`, 1353 rows — pure lookup, lowest
   risk, no writes). Use the established `repository → service → transformer` + `isMysqlModule("commerce-price")`
   dual-path, flag OFF.

### The 4 open decisions blocking the build (from [`COMMERCE_WAVE_SCOPE.md`](./COMMERCE_WAVE_SCOPE.md) §5)
| # | Decision | Recommended default |
|---|---|---|
| **C1** | 3a sub-order | `price → subscription-read → promoter+promocode → educator` (price first, lowest risk) |
| **C2** | D2 catalog relations timing | **fold into 3a** (they ride the catalog flip; video build already deferred them once) |
| **C3** | `customer_id` string-vs-int seam | keep order `customer_id` as **string**, resolve to int customer at the subscription boundary |
| **C4** | 3b write-path isolation | **separate focused pass** AFTER 3a + catalog flip — do NOT build alongside reads |

---

## 🧭 THE PLAN (sequenced — read-first, NOT one big flip)

This is the **highest-risk wave** (subscription = entitlement source of truth; `verify.controller.ts` =
569-line Razorpay write-path). So it is deliberately split:

**Phase 3a — read-only (build dual-path, flag OFF) → UNBLOCKS CATALOG**
| Module key | Table(s) | Rows | Notes |
|---|---|---|---|
| `commerce-price` | `ws_package_course_ebook_price` | 1353 | pure lookup; `duration` = **DAYS** (planDuration helper, `setDate`). |
| `commerce-subscription` (read) | `ws_package_course_subscription` | 2 | entitlement read only; writes are 3b. `customer_id` is **int** here. |
| `commerce-ebook-sub` (read) | `ws_ebook_subscription` | 1 | ebook entitlement read. |
| `commerce-promoter` | `ws_promoter` | 114 | promocode owner master. |
| `commerce-promocode` | `ws_promocode` + `ws_promoted_package_course_ebook` | 2 / 5 | read-path for promocode validation. |
| `commerce-educator` | `ws_course_educator` | 56 | **full entity** (auth fields), NOT a join table. Read-only. |

**Phase 3a — D2 catalog relations (folded in, flip with catalog)**
`ws_package_specific_subject` (1623) · `ws_video_category_relation` (2456) · `ws_video_category_package_relation` (6907) · `ws_package_course_material` (1)

**→ THE FLIP:** turn 3a **+ catalog (4 keys) + customer-address/profile/bank** ON **together** — one
consistent int id-space. **This is the first go-live since the customer module.**

**Phase 3b — write-path (DANGEROUS, isolated, LAST)**
`commerce-order` (`ws_package_course_order`) + subscription **writes** + `ws_package_course_subscription_tracking`
+ `commerce-ebook-order` (`ws_ebook_order`/`ws_ebook_subscription` write) — driven by `verify.controller.ts`
(Razorpay). Build only after 3a + catalog flip are proven.

---

## ⚠️ SCHEMA-DRIFT FLAGS — already found via `DESCRIBE`, handle BEFORE coding each table

1. **`customer_id` dual representation:** `varchar(255)` in `ws_package_course_order` + `ws_ebook_order`
   (Mongo ObjectId-as-string) but **`int`** in `ws_package_course_subscription`. The order→subscription
   seam carries both — that's decision **C3**.
2. **Reserved-word columns → Prisma `@map`:** `ws_package_course_subscription_tracking.order`,
   `ws_video_category_relation.order`.
3. **`price.duration` is DAYS** (memory `project_plan_duration_unit`) — compute `endAt` via the planDuration
   helper with `setDate`, NEVER `setMonth`.
4. **`ws_course_educator` is a full entity** (email/password/about/view/last_seen_at) — was mis-grouped as a
   "catalog relation"; treat as a read-only master in 3a.
5. **Always, per table:** `DESCRIBE <table>` vs the Prisma model → check phantom columns, Int-vs-BigInt
   overflow (e.g. `tracking` bigint), NOT NULL cols Mongo omits, nullable mismatches. (This has bitten twice
   — address phone Int→BigInt, Package/Course nullable.)

---

## ✅ WHAT'S DONE (so the resume agent doesn't re-do it)

### Catalog — ALL BUILT, all flags OFF (flips with THIS wave)
| Sub-module | Key(s) | Tables | Flag |
|---|---|---|---|
| package | `catalog-package-type`, `catalog-package` | ws_package_type, ws_package | ⏸ OFF |
| course | `catalog-course` | ws_course, ws_course_subject_category | ⏸ OFF |
| video | `catalog-video` | ws_video, ws_video_category | ⏸ OFF (URL-encryption parity PASS) |

Schema fixes already applied: `Package.shareable_link` + `Course.image` → nullable. Video model clean.
Modules live in `src/modules/catalog-*`. Full detail: [`CATALOG_MODULE_SCOPE.md`](./CATALOG_MODULE_SCOPE.md) §7–8.

### Customer Module — COMPLETE
`customer-auth` ✅ live · `customer-lookups` ✅ live · `customer-address` / `customer-profile` /
`customer-bank-account` ⚪ OFF (code complete, **flip with this wave**). `offline-city` ✅ live.

### CMS group — ✅ all live
app-update, version, faq, banner-slider, testimonial, department, terms, popup.

**Currently ENABLED (11) in `MIGRATION_MYSQL_MODULES`:** the 8 CMS + customer-auth + customer-lookups + offline-city.

---

## 📐 ESTABLISHED PATTERN & RULES (do not reinvent)

- **Module shape:** `src/modules/<key>/` = `repository.ts` (Prisma) + `service.ts` (dual-path branch on
  `isMysqlModule("<key>")`) + `transformer.ts` (row → Mongo-shaped DTO) + `types.ts`.
- **Build-flag-OFF pattern:** when a module couples to unmigrated modules across the int-vs-ObjectId
  boundary, build dual-path but leave the flag OFF; **verify via live-DB `tsx` scripts**, not HTTP.
- **`tsx` verify scripts** go in `scripts/_tmp/`, then `rm -rf` after. Use
  `DATABASE_URL='mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging'`.
- **DB access (read live data):**
  `docker compose exec -T ws-mysql mysql -uroot -pwebsankul_dev websankul_staging -e "..."`
- **prisma generate:** `npx --yes prisma@5.22.0 generate` (PINNED — global npx grabs 7.x and errors).
  ⚠️ Running generate sometimes rewrites `package.json` carets `^5.22.0`→`5.22.0` on `@prisma/client`
  (line ~45) and `prisma` (line ~96) — if so, Edit them back to `^5.22.0` (do NOT `git checkout`, it wipes
  the `migration:api:*` scripts).
- **Standing rules (memory):** every route requires a Bearer token (admin + client); any video-URL response
  matches `/v1/lecture`'s `encryptVideoSource` shape (never reimplement encryption); `duration` = days.
- **live-course is Mongo-only** — there is NO `ws_live_course*` table in the dump. It is NOT part of this
  wave; it's a much-later, build-tables-from-scratch effort.

---

## 📋 PER-MODULE DOC PROTOCOL (user requirement — do for EACH module, per `MIGRATION_DOC_UPDATES.md` scenario A)

After building each module:
1. Add a `MIGRATED_REGISTRY` entry in `scripts/generate-migrated-modules.ts`.
2. Add status lines in `scripts/generate-schema-comparison.ts`.
3. Add api-tests dir under `docs/migration/api-tests/<module>/`; register in `run-all.ts`, `run-module.ts`,
   `modules.manifest.ts`; add a `migration:api:<module>` script to `package.json`.
4. Update `MIGRATION_TEST_LOG.md`, `MIGRATION_TRACKER.md` (+ changelog row), `README.md`.
5. Append a **newest-first** entry to `docs/MIGRATION_QUERY_CHANGES.md`.
6. Regenerate: `yarn docs:migrated-modules` / `yarn docs:schema-comparison` / `yarn docs:field-comparison`
   (run with the real `MIGRATION_MYSQL_MODULES` from `.env` so flag-OFF modules show `⏸ not in env`).
7. **Rules:** work only on `migration` branch; never merge to `main`; run tests + update logs after each module.

---

## 🗺️ WHERE THINGS LIVE

| Need | File |
|---|---|
| **This wave's full scope** | [`COMMERCE_WAVE_SCOPE.md`](./COMMERCE_WAVE_SCOPE.md) |
| Catalog scope + outcome | [`CATALOG_MODULE_SCOPE.md`](./CATALOG_MODULE_SCOPE.md) |
| Newest-first change log | [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md) |
| Phase/changelog/status | [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) |
| What was tested | [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) |
| Doc-update checklist | [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md) |
| Per-module registry | [`MIGRATED_MODULES.md`](./MIGRATED_MODULES.md) |
| Migration toggle | `src/config/migration.ts` (`isMysqlModule`, driven by `MIGRATION_MYSQL_MODULES` in `.env`) |
| Built modules | `src/modules/<key>/` |
| Commerce consumers | `src/client/{orders,promocode,payment,purchase-history,my-subscriptions,dashboard}/` |

---

## 📚 ORIENTATION — suggested reading order (for a cold start / new agent)

1. **`README.md`** — index + quick commands
2. **`MIGRATION_TRACKER.md`** — what's done / current phase
3. **`PRISMA_MODULE_FLOW.md`** — how Prisma + the module toggle work (flowcharts)
4. **`legacy_system_migration_strategy.md`** — the full 8-phase strategy
5. **`MIGRATED_MODULES.md`** — modules already on MySQL
6. **`testing-guide.md`** + **`MIGRATION_TEST_LOG.md`** — how to test and log results
7. **`MIGRATION_DOC_UPDATES.md`** — what to update when you change code

**To migrate the next module:** follow `PRISMA_MODULE_FLOW.md` — Prisma model → repository → service branch
→ transformer → add the key to `MIGRATION_MYSQL_MODULES` (only when flipping ON).

---

## 🧪 COMMANDS — API tests, smoke tests, generators

**Automated API tests** (migrated modules) — folder `docs/migration/api-tests/`
(details in its `README.md` + `API_COVERAGE.md`):
```bash
# Terminal 1
yarn dev
# Terminal 2
yarn migration:api            # all migrated modules
yarn migration:api:faq        # single module (swap faq for any key)
yarn migration:api:catalog    # catalog (flag-aware; MySQL assertions skip while OFF)
```

**Service-level smoke tests** (no server needed):
```bash
yarn db:test-cms-pilot        # app-update + version
yarn db:test-faq              # faq
```
Optional in `.env` for admin tests: `MIGRATION_TEST_ADMIN_EMAIL` / `MIGRATION_TEST_ADMIN_PASSWORD`
(tests fall back to a minted JWT if unset).

**Doc generators** (run after any schema/module change):
```bash
yarn docs:migrated-modules
yarn docs:schema-comparison
yarn docs:field-comparison
```

---

## 🚦 IMPORTANT RULES (standing — user requirement)

- Work **only on the `migration` branch** until the migration is finished.
- **Do NOT merge into `main`** before full migration + testing sign-off.
- After **each module:** run tests, update `MIGRATION_TEST_LOG.md` + `MIGRATION_TRACKER.md` per
  `MIGRATION_DOC_UPDATES.md`.
- If anything fails during setup/DB import: check **`phase-1-mysql.md`** (troubleshooting) or ask the user.

---

## ✅ FIRST 3 STEPS WHEN YOU COME BACK

1. Read this file, then [`COMMERCE_WAVE_SCOPE.md`](./COMMERCE_WAVE_SCOPE.md).
2. Confirm C1–C4 with the user (or accept "recommended defaults").
3. `DESCRIBE ws_package_course_ebook_price` vs a Prisma `PackageCourseEbookPrice` model, then build
   `src/modules/commerce-price/` dual-path (flag OFF) — `price` module first.
