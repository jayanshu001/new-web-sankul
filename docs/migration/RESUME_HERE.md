# 🔖 RESUME HERE — MySQL Migration Checkpoint (read this FIRST)

> **Purpose:** Cold-start context so any session can resume **exactly** here without losing flow, behaviour,
> or any established rule. This is THE single source of truth for "where we are."
> **Last updated:** 2026-06-12 · **Branch:** `migration` (NEVER merge to `main` until full sign-off)
> **Working dir:** `/Users/pratikzankat/new-web-sankul`
> **On resume:** UPDATE THIS FILE as you go (don't create a new one). Pair it with the newest-first detailed
> log [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md) — that log is the history; this file
> is the orientation + next-step. The pattern/rules below are established — follow them, don't reinvent.

---

## 0. THE GOAL (what this whole effort is)

Migrate the backend **from MongoDB (Mongoose) → MySQL (Prisma)**, module-by-module, **without breaking any
API response contract** and **without losing production data**. Production DB is and stays **MySQL**; the
Mongo work was a detour being unwound. Strategy: [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md).
**End state:** every API on MySQL; the migration flag + Mongo branches get deleted. Until then the flag is
the safety mechanism (gradual enable + instant rollback) the strategy doc requires.

---

## 1. ⏸ WHERE WE ARE RIGHT NOW (the pause point)

**29 modules built, all verified (tsx, flag OFF), repo typechecks clean. ~79 files uncommitted in the
working tree — intentional (this whole migration has run uncommitted; commit only when the user asks).**
We just finished `offline-batch` and paused to maintain this checkpoint.

**The clean read-side / flat-table migration is essentially DONE.** What remains is three kinds of work,
none of which is "migrate another simple read table":
1. **Write paths (Phase 3b)** — `commerce-order` (Razorpay `verify.controller.ts`), book-order/cart,
   ebook-order, offline-enquiry, package-chat. **Highest-leverage remaining work — the gate to a go-live.**
2. **THE FLIP** — turn ON the flags for everything already built (one consistent int id-space). Nothing
   built is live except the 11 enabled modules.
3. **Mongo-only architecture tail** — LiveCourse/LiveSession (NO SQL tables exist), Goal labels, PromoCode
   appliesTo, embedded arrays — needs a **design**, not a migration.

### ➡ RECOMMENDED NEXT STEP (agreed direction, not yet started)
**Scope the write-path (3b)** → write `WRITE_PATH_SCOPE.md`: analyse `verify.controller.ts` (569 lines,
Razorpay), order/subscription writes, how flag-gating a *write* differs from a read, rollback story. Get
sign-off, THEN build. **Do NOT write write-path code without the plan.**
*(Alternatives the user may pick: build a smaller write path — book-order (would let catalog-book WIRE) or
referral; or scope the LiveCourse/dashboard design; or fix the MIGRATED_MODULES.md generator quirk — §7.)*

---

## 2. 🟢 CURRENTLY ENABLED (live on MySQL) — 11 modules

`.env` → `MIGRATION_MYSQL_MODULES`:
```
app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth,customer-lookups,offline-city
```
Everything else built is **flag OFF** (dual-path code present, dormant, tsx-verified). Flipping a key = add
it to this list.

---

## 3. 📦 ALL 29 BUILT MODULES (`src/modules/<key>/`)

**CMS (8, LIVE):** app-update · version · faq · banner-slider · testimonial · department · terms · popup
**Customer (6):** customer-auth (LIVE) · customer-lookups (LIVE) · offline-city (LIVE) · customer-address ·
customer-profile · customer-bank-account *(last 3 flag OFF)*
**Catalog (7, flag OFF):** catalog-package · catalog-course *(listing wired)* · catalog-video · catalog-ebook
*(listing+detail wired)* · catalog-material *(nav wired)* · catalog-exam *(nav wired)* · catalog-book
*(reads built, NOT wired)*
**Commerce reads (6, flag OFF):** commerce-price · commerce-subscription · commerce-ebook-sub ·
commerce-promoter · commerce-promocode · commerce-educator
**Offline (1, flag OFF):** offline-batch *(center/batch browse reads wired)*

### Endpoints WIRED to a MySQL branch (behind their flag, still OFF)
- `GET /client/courses` + `/courses/category/:id` (catalog-course composition: rows + price + subscription)
- `GET /client/courses/categories` · `GET /client/packages/types`
- `GET /client/ebooks` + `/ebooks/:id` (catalog-ebook composition)
- `GET /client/material-categories/:id/children` · `GET /client/exam-categories/:id/children` (nav)
- `GET /client/offline/{centers,batches}` + `/{centers,batches}/:id`
- customer-address/profile/bank handlers (wired earlier)

---

## 4. 🧱 THE ESTABLISHED PATTERN (do EXACTLY this — do not reinvent)

**Per module** (`src/modules/<key>/`, file naming = `<key>.<layer>.ts`):
- `<key>.repository.ts` — Prisma reads only
- `<key>.service.ts` — dual-path: branch on `isMysqlModule("<key>")` (`src/config/migration.ts`); export an
  `is<X>Mysql()` helper + `parse<X>Id()`
- `<key>.transformer.ts` — SQL row → Mongo-shaped DTO (ids → strings; `customerId` stays **int**)
- `<key>.types.ts` — DTO interfaces + a SCOPE/DRIFT doc-comment block

**Build → verify → (maybe wire) → document:**
1. **Schema-drift check FIRST:** `DESCRIBE <table>` vs the Prisma model. Check bigint-vs-Int overflow,
   nullable mismatches, phantom columns, `0`-sentinel vs NULL, JSON columns, column typos, Mongo↔SQL name
   divergence. **This step has caught a read-breaking bug in almost every commerce/offline module — never skip it.**
2. **Build** the 4 files. Schema fix needed? Edit `prisma/schema.prisma`, regenerate (§5).
3. **Verify via a tsx script** in `scripts/_tmp/` (NOT HTTP — modules are flag OFF). Run with live DB URL
   (§5). Assert shapes, drift handling, computed fields, relations. Then `rm -rf scripts/_tmp`.
4. **Wire** the consuming controller ONLY if every collection it touches has a MySQL module: put
   `if (is<X>Mysql()) { return mysqlBranch }` **before** the Mongo `ObjectId.isValid` guards (a MySQL id is
   an int). Response must stay byte-identical. If a handler joins an unmigrated collection or a Mongo-only
   field → DON'T wire; build dual-path flag-OFF + document why (e.g. catalog-package, catalog-book).
5. **Typecheck:** `npx tsc --noEmit -p tsconfig.json` — clean except the 2 KNOWN pre-existing failing files
   (`src/admin/material/material.controller.ts`, `src/modules/faq/faq.service.ts`). Grep those out.
6. **Per-module doc protocol (do ALL):** registry in `scripts/generate-migrated-modules.ts` · status line(s)
   in `scripts/generate-schema-comparison.ts` · api-test dir `docs/migration/api-tests/<key>/` (flag-aware) +
   register in `run-all.ts`/`run-module.ts`/`modules.manifest.ts` + `migration:api:<key>` script in
   `package.json` · **newest-first** entry atop `../MIGRATION_QUERY_CHANGES.md` · rows in
   `MIGRATION_TRACKER.md` + `MIGRATION_TEST_LOG.md` · update `README.md` · regenerate the 3 docs (§5).

---

## 5. 🛠 COMMANDS / ENV (exact, copy-paste)

```bash
# DB access (read live data)
docker compose exec -T ws-mysql mysql -uroot -pwebsankul_dev websankul_staging -e "DESCRIBE ws_x;"

# Prisma generate — PINNED (global npx grabs 7.x and errors)
DATABASE_URL='mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging' npx --yes prisma@5.22.0 generate
#   ⚠ generate SOMETIMES rewrites package.json carets ^5.22.0 → 5.22.0 on "@prisma/client" + "prisma".
#     If so, Edit them BACK to ^5.22.0 (do NOT `git checkout` — it wipes the migration:api:* scripts).
#     ALWAYS re-check after generate: grep -n '"@prisma/client"\|"prisma":' package.json

# tsx verify script (flag-OFF verification)
DATABASE_URL='mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging' npx tsx scripts/_tmp/verify-x.ts

# typecheck (ignore the 2 known pre-existing failing files) — want 0
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "material.controller.ts\|faq.service.ts" | grep -c "error TS"

# doc generators (run after every module)
yarn docs:migrated-modules && yarn docs:schema-comparison && yarn docs:field-comparison

# API tests (need `yarn dev` in another terminal)
yarn migration:api            # all
yarn migration:api:<key>      # one module
```

---

## 6. ⚠️ STANDING RULES & HARD-WON GOTCHAS (violating these breaks things)

- **Work only on `migration` branch. NEVER merge to `main` until full migration + sign-off.** Don't commit
  unless the user explicitly asks (the tree is intentionally uncommitted).
- **Every route requires a Bearer token** (admin + client) — never default a route to public *unless the
  existing route already is* (e.g. offline browse is public by design).
- **`customerId` is an INT in the migrated id-space** (decision C3). Subscription/enquiry `customer_id` is
  int; order tables use varchar ObjectId. Modules take/return int customerId; string→int at the boundary.
- **`duration` on price rows = DAYS** (not months). planDuration helper with `asDays:true`/`setDate`, NEVER
  `setMonth`. (The helper's header comment says "months" — stale; the data is days.)
- **Video-URL responses** must match `/v1/lecture`'s `encryptVideoSource` shape — never reimplement encryption.
- **Recurring schema-drift classes that THROW on read if not fixed** (check EVERY table):
  - **bigint → Int overflow** (commerce-subscription `tracking`; commerce-educator `id` kept Int, ids tiny,
    LATENT risk logged; offline-center `phone`; offline-enquiry `mobile`) → `BigInt`, surface as number/string.
  - **phantom column** — Prisma field mapping a non-existent SQL column (offline `status`; ebook-sub was
    missing `status`/`payment_type`) → add the real column or remove the phantom field.
  - **`0`-sentinel vs NULL** — owner ids (`package_id`/`course_id`/`ebook_id`) use `0` for "not this owner",
    not NULL (commerce-price) → coalesce `0`/null → null.
  - **nullable mismatch** — DDL nullable but Prisma non-null → relax to optional (Package.shareable_link,
    Course.image, ebook description/author, book order_by, exam-category name/image, promoter/promocode fields).
  - **JSON column** (offline-center `image` → `images[]`), **column typos** (offline batch `discription`
    → `description`).
- **Mongo↔SQL name divergence:** commerce-subscription — Mongo `packageId`=plan=SQL `pcb_id`; Mongo
  `targetPackageId`=package=SQL `package_id`. catalog-course — SQL `is_featured`/`purchase` enum('0','1') →
  Mongo `isPopular`/`isPaid`.
- **`paymentStatus:"verified"`** Mongo filter has NO SQL column → collapses to `status=true`.

---

## 7. 🚫 OUT OF SCOPE / DEFERRED (don't re-investigate — decisions already made)

- **`pendrive-course` (7 tables `ws_pendrive_course*`)** — DECOMMISSIONED by user. Skip entirely.
- **Laravel admin/RBAC** — `ws_users`, `ws_roles`, `ws_permissions`, `ws_model_has_*`, `ws_role_has_*`,
  `ws_password_resets`, `ws_personal_access_tokens`. New app uses Mongo for admin auth; legacy Laravel infra.
- **Laravel internals** — `ws_migrations`, `ws_failed_jobs` (not app data).
- **`Goal`** — Mongo `ws_goals` has embedded `labels[]`; NO SQL table (only flat `ws_customer_target_goal`).
  `listPackagesByGoal` not reproducible from SQL → deferred (reconciliation design).
- **PromoCode `appliesTo`** — Mongo uses `appliesTo`/`discountValue`; SQL uses per-plan %. commerce-promocode
  is SQL-faithful only; can't serve the client `applyPromocode` contract → deferred.
- **LiveCourse / LiveSession / LiveCourseSubscription** — NO SQL tables exist at all. Mongo-only; "build
  tables from scratch" effort. Blocks dashboard + course/material detail + entitlement.
- **Generator quirk (cosmetic, unfixed):** `MIGRATED_MODULES.md` summary labels flag-OFF modules as
  "✅ enabled" when generated with the full registry (detail sections correctly say flag OFF). Offered to fix
  the generator to reflect real `.env` flags; user hasn't requested it yet.

---

## 8. 📋 THE REMAINING WORK — definitive (from the schema-comparison audit)

**Write paths (the 3b cluster):** `ws_package_course_order` + `ws_package_course_subscription_tracking`
(Razorpay `verify.controller.ts`) · `ws_ebook_order` · `ws_book_order(_item)` + `ws_book_cart(_item)` +
`ws_book_tracking` (would let catalog-book WIRE) · `ws_offline_enquiry` · `ws_package_chat`
**Exam item/attempt:** `ws_exam_question(_option)` · `ws_exam_result(_detail)(_analytics)`
**D2 join tables (ride the flip):** `ws_package_specific_subject` · `ws_package_course_material` ·
`ws_material_category_course/package` · `ws_exam_category_course/package` · `ws_video_category_relation(+_package)`
**Referral:** `ws_refferal_program` · `ws_refferal_transaction`
**Small flat (low value):** `ws_tag` · `ws_dynamic_image` · `ws_image_notification` ·
`ws_offline_banner_slider` · `ws_user_inquiry` · `ws_website_inquiry`
**Mongo-only (design needed):** LiveCourse/LiveSession · Goal · PromoCode appliesTo

**Reality:** what's left is overwhelmingly **writes + the go-live flip + one architectural design
(LiveCourse)**. The easy read-side migration is done.

---

## 9. 🗺 WHERE THINGS LIVE

| Need | File |
|---|---|
| **This checkpoint (update on resume)** | `docs/migration/RESUME_HERE.md` (this file) |
| Newest-first detailed change log | [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md) |
| Commerce wave scope + C1–C4 decisions | [`COMMERCE_WAVE_SCOPE.md`](./COMMERCE_WAVE_SCOPE.md) |
| Catalog scope + outcome | [`CATALOG_MODULE_SCOPE.md`](./CATALOG_MODULE_SCOPE.md) |
| Flip audit (40/41 handlers blocked) | [`FLIP_SCOPE.md`](./FLIP_SCOPE.md) |
| Phase/changelog/status | [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) |
| What was tested | [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) |
| Doc-update checklist | [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md) |
| Per-module registry (generated) | [`MIGRATED_MODULES.md`](./MIGRATED_MODULES.md) |
| Table-by-table status (generated) | [`SCHEMA_COMPARISON.md`](./SCHEMA_COMPARISON.md) |
| Strategy doc | [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md) |
| Migration toggle | `src/config/migration.ts` (`isMysqlModule`, driven by `.env`) |
| Built modules | `src/modules/<key>/` |
| Commerce/catalog consumers | `src/client/{course,ebook,package,categories,offline,promocode,payment,purchase-history,my-subscriptions,dashboard}/` |

---

## 10. ✅ FIRST STEPS WHEN YOU COME BACK

1. Read this file top-to-bottom, then skim the top entries of [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md).
2. Confirm state:
   - `git status --short` → expect ~79 uncommitted
   - `grep MIGRATION_MYSQL_MODULES .env` → expect the 11 (§2)
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "material.controller\|faq.service" | grep -c "error TS"` → expect 0
3. Ask the user which direction (or proceed with the agreed one): **scope the write-path (3b)** is the
   recommended next step — write `WRITE_PATH_SCOPE.md` first, get sign-off, then build. Don't write
   write-path code blind.
4. For any NEW module: follow §4 EXACTLY (schema-drift check FIRST, tsx verify, full doc protocol).
5. **After doing work: UPDATE THIS FILE** (§1 where-we-are, §3 module list, §8 remaining) + append a
   newest-first entry to `../MIGRATION_QUERY_CHANGES.md`.

---

## 11. 📚 ORIENTATION — suggested reading order + full command reference

### Suggested reading order (cold start / new agent)
1. [`README.md`](./README.md) — index + quick commands
2. [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) — what's done / current phase
3. [`PRISMA_MODULE_FLOW.md`](./PRISMA_MODULE_FLOW.md) — how Prisma + the module toggle work (with flowcharts)
4. [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md) — the full 8-phase strategy
5. [`MIGRATED_MODULES.md`](./MIGRATED_MODULES.md) — modules already on MySQL
6. [`testing-guide.md`](./testing-guide.md) + [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) — how to test and log results
7. [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md) — what to update when you change code

**To migrate the next module:** follow [`PRISMA_MODULE_FLOW.md`](./PRISMA_MODULE_FLOW.md) — Prisma model →
repository → service branch → transformer → add the key to `MIGRATION_MYSQL_MODULES` (only when flipping ON).
(See §4 for the exact build→verify→wire→document steps this project uses.)

### Automated API tests (migrated modules)
Folder: [`api-tests/`](./api-tests/) · details in [`api-tests/README.md`](./api-tests/README.md) +
[`api-tests/API_COVERAGE.md`](./api-tests/API_COVERAGE.md)
```bash
# Terminal 1
yarn dev
# Terminal 2
yarn migration:api            # all migrated modules
yarn migration:api:faq        # single module (swap faq for any key)
yarn db:test-cms-pilot        # service-level smoke (app-update + version, no server needed)
yarn db:test-faq              # service-level smoke (faq, no server needed)
```
Optional in `.env` for admin tests: `MIGRATION_TEST_ADMIN_EMAIL` / `MIGRATION_TEST_ADMIN_PASSWORD`
(tests fall back to a minted JWT if unset).

### Doc generators (after any schema/module change)
```bash
yarn docs:migrated-modules
yarn docs:schema-comparison
yarn docs:field-comparison
```

### Important rules (standing — user requirement)
- Work **only on the `migration` branch** until migration is finished.
- **Do NOT merge into `main`** before full migration + testing sign-off.
- After **each module:** run tests, update [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md) +
  [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) per [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md).
- If anything fails during setup/DB import: check [`phase-1-mysql.md`](./phase-1-mysql.md) (troubleshooting)
  or ask the user.
