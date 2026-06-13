# 🔖 RESUME HERE — MySQL Migration Checkpoint (read this FIRST)

> **Purpose:** Cold-start context so any session can resume **exactly** here without losing flow, behaviour,
> or any established rule. This is THE single source of truth for "where we are."
> **Last updated:** 2026-06-13 · **Branch:** `migration` (NEVER merge to `main` until full sign-off)
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

**34 modules built, all verified (tsx, flag OFF), repo typechecks clean. Commit only when the user asks.**
We just finished **`package-chat`** — the LAST 3b write path — and paused to maintain this checkpoint.

### ✅ 0 MODULES LEFT TO MIGRATE
**Every read module and every write module is built + wired (all flag OFF).** There is **no remaining
read/write module to build.** The read side AND the Phase 3b write side are DONE. 🎉
What is left is NOT module migration — it is: **(a) THE FLIP** (go-live: turn the flags ON), **(b) the
LiveCourse architectural design** (Mongo-only, no SQL tables exist), and **(c)** optional low-value flat
tables + D2 join tables that ride the flip. See §8 for the exhaustive list and §10 for first steps.

**`package-chat` (built 2026-06-13, flag OFF) — ⚠ FIRST SCHEMA ADD:** package announcement chat (client read
+ admin write/delete) wired behind `isPackageChatMysql()`. `ws_package_chat` was a STUB (message only) that
couldn't represent the Mongo PackageChat → **EXTENDED** via additive ALTER (media_url, media_type, sender_type,
sender_id VARCHAR, push_sent) — see [`schema-changes/2026-06-13_extend_ws_package_chat.sql`](./schema-changes/2026-06-13_extend_ws_package_chat.sql)
(prod-safe, run once). Prisma stub `chat`→`PackageChat` + enums. message↔text; sender_id holds the admin
ObjectId (admin auth stays Mongo); list `id desc` tiebreak; read gates via commerce-subscription. tsx 21/21.

**`catalog-book` WIRED (2026-06-13, flag OFF):** `GET /client/books` + `/books/:id` branch on `isBookMysql()`.
catalog-book supplies book DATA + computed fields; the controller composes per-customer cart qty/cartId +
isPurchased via NEW book-order read helpers (`getActiveCartState` / `getPurchasedBookIdSet`). Pure wiring (no
new module) — `book-order` migrating the order/cart tables is what unblocked it. tsx 12/12.

**`book-order` (built 2026-06-13, flag OFF):** book cart checkout — a DIFFERENT shape (5 tables, line items,
courier AWB). Signed off in [`BOOK_ORDER_SCOPE.md`](./BOOK_ORDER_SCOPE.md). create-order (2-phase: preview cart
→ Razorpay → txn writes `ws_book_order` + `ws_book_order_item`); verify (txn: insert `ws_book_tracking` whose
bigint AUTO_INCREMENT is the AWB → order→verified + tracking_id → deactivate cart). **Read-breaking SCHEMA FIX:**
tracking_id BIGINT Int→BigInt (both BookTracking + BookOrder), regenerated. customer_id is INT here. Tracking
history synthesized in the DTO (SQL lacks the columns). tsx 25/25. **This UNBLOCKS catalog-book wiring.**

**`ebook-order` (built 2026-06-13, flag OFF):** ebook write path, rides the commerce-order pattern.
`create-order/ebook` writes `ws_ebook_order` (pending); verify's ebook branch runs ONE `$transaction`
(order→complete + extend-or-create `ws_ebook_subscription`). NO tracking table (2 tables, not 3). The verify
ebook branch returns the ORDER (`data.order`), not the sub. Drift: customer_id VARCHAR/INT split; **NO
ebook_id on the order table** (re-derived from the plan); status enum strings identical (no translation);
duration=DAYS. Dual-read fallback in verify. tsx 28/28. *(Note: `git status` showed CLEAN at this session's start, not the ~79
uncommitted the prior checkpoint expected — the earlier migration work appears to have been committed since.
Confirm the tree base before the next build.)*

**`commerce-order` (built 2026-06-13, flag OFF):** course write path across BOTH endpoints. `create-order/course`
writes `ws_package_course_order` (pending); verify's course branch runs ONE `$transaction` (order→complete +
extend-or-create `ws_package_course_subscription` + `_subscription_tracking`). Resolves the one-doc→three-
tables mismatch by merging order payment + subscription entitlement fields into the Mongo-shaped
`data.subscription`. **Dual-read fallback** in verify (MySQL first, fall through to Mongo on miss) = the
rollback safety net. Drift handled: customer_id VARCHAR/INT split, BigInt tracking, tracking.order→order.id,
DAYS endAt. tsx **28/28**. See [`WRITE_PATH_SCOPE.md`](./WRITE_PATH_SCOPE.md) + changelog top entry.

**The read-side migration is DONE; ALL write paths (Phase 3b) are DONE.** What remains (NOT module work):
1. **Write paths (Phase 3b) — ✅ COMPLETE.** course (`commerce-order`) · ebook (`ebook-order`) · books
   (`book-order`) · offline-enquiry · package-chat — all built + wired, flag OFF. live-course/test-series
   verify branches stay deferred (NO SQL tables).
2. **THE FLIP** — turn ON the flags for everything already built (one consistent int id-space).
3. **Mongo-only architecture tail** — LiveCourse/LiveSession (NO SQL tables exist), Goal labels, PromoCode
   appliesTo, embedded arrays — needs a **design**, not a migration.

### ➡ RECOMMENDED NEXT STEP
**THE FLIP** (go-live) — the read + write modules are all built and dual-path-verified, flag OFF. The
remaining high-value work is turning the flags ON as one consistent int id-space cluster (catalog + commerce
reads + the order/chat writes + the D2 join tables ride along). This needs a **flip plan** (sequencing,
the one schema ADD to run on prod — `ws_package_chat`, rollback story) before flipping — scope it like the
write paths. *(Alternatives: scope the LiveCourse/dashboard design — the last Mongo-only architecture piece;
or pick off the low-value flat tables — ws_tag, ws_dynamic_image, etc.)*

**Note on the schema add:** package-chat introduced the FIRST additive ALTER (`ws_package_chat`). The flip
plan must include running [`schema-changes/2026-06-13_extend_ws_package_chat.sql`](./schema-changes/2026-06-13_extend_ws_package_chat.sql)
on prod before enabling the `package-chat` flag.

---

## 2. 🟢 CURRENTLY ENABLED (live on MySQL) — 11 modules

`.env` → `MIGRATION_MYSQL_MODULES`:
```
app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth,customer-lookups,offline-city
```
Everything else built is **flag OFF** (dual-path code present, dormant, tsx-verified). Flipping a key = add
it to this list.

---

## 3. 📦 ALL 34 BUILT MODULES (`src/modules/<key>/`)

**CMS (8, LIVE):** app-update · version · faq · banner-slider · testimonial · department · terms · popup
**Customer (6):** customer-auth (LIVE) · customer-lookups (LIVE) · offline-city (LIVE) · customer-address ·
customer-profile · customer-bank-account *(last 3 flag OFF)*
**Catalog (7, flag OFF):** catalog-package · catalog-course *(listing wired)* · catalog-video · catalog-ebook
*(listing+detail wired)* · catalog-material *(nav wired)* · catalog-exam *(nav wired)* · catalog-book
*(listing+detail WIRED — composes book-order cart/purchase state)*
**Commerce reads (6, flag OFF):** commerce-price · commerce-subscription · commerce-ebook-sub ·
commerce-promoter · commerce-promocode · commerce-educator
**Offline (1, flag OFF):** offline-batch *(center/batch browse reads wired)*
**Commerce/Order WRITE (3, flag OFF):** **commerce-order** *(course)* · **ebook-order** *(ebook)* ·
**book-order** *(book cart checkout — 5 tables, courier AWB)* — all: create-order + verify branch wired
with dual-read fallback
**Offline WRITE (1, flag OFF):** **offline-enquiry** *(lead-capture; POST /client/offline/enquiry wired,
anonymous-allowed)*
**Package WRITE (1, flag OFF):** **package-chat** *(announcement chat READ+WRITE; ws_package_chat EXTENDED;
client read + admin write/delete wired)*

### Endpoints WIRED to a MySQL branch (behind their flag, still OFF)
- `POST /client/payment/create-order/course` + course branch of `POST /client/payment/verify` (commerce-order
  write path: pending order → `$transaction` extend-or-create subscription + tracking; dual-read fallback)
- `POST /client/payment/create-order/ebook` + ebook branch of `POST /client/payment/verify` (ebook-order
  write path: pending order → `$transaction` extend-or-create subscription; dual-read fallback)
- `POST /client/payment/create-order` (book cart) + book branch of `POST /client/payment/verify` (book-order
  write path: preview cart → order + item rows → `$transaction` AWB tracking + verified + cart off; dual-read)
- `GET /client/books` + `GET /client/books/:id` (catalog-book data + computed fields, composing book-order
  cart qty/cartId + isPurchased; branches before the ObjectId guard)
- `POST /client/offline/enquiry` (offline-enquiry write: bigint mobile, anon→0 sentinel, remarks dropped;
  branches before the ObjectId parse)
- `GET /client/package/:packageId/chat` (package-chat read, subscription-gated via commerce-subscription) +
  `POST`/`DELETE /admin/package/.../chat` (package-chat admin write/delete; ws_package_chat EXTENDED)
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

**Write paths (the 3b cluster):** ✅ `ws_package_course_order` + `_subscription` + `_subscription_tracking`
(course; `commerce-order`). ✅ `ws_ebook_order` + `ws_ebook_subscription` (ebook; `ebook-order`). ✅
`ws_book_order(_item)` + `ws_book_cart(_item)` + `ws_book_tracking` (books; `book-order` — unblocks
catalog-book WIRE). ✅ `ws_offline_enquiry` (lead capture; `offline-enquiry`). ✅ `ws_package_chat`
(announcement chat READ+WRITE; `package-chat` — table EXTENDED). **🎉 3b WRITE CLUSTER COMPLETE** — all
built + wired, flag OFF.
**Exam item/attempt:** `ws_exam_question(_option)` · `ws_exam_result(_detail)(_analytics)`
**D2 join tables (ride the flip):** `ws_package_specific_subject` · `ws_package_course_material` ·
`ws_material_category_course/package` · `ws_exam_category_course/package` · `ws_video_category_relation(+_package)`
**Referral:** `ws_refferal_program` · `ws_refferal_transaction`
**Small flat (low value):** `ws_tag` · `ws_dynamic_image` · `ws_image_notification` ·
`ws_offline_banner_slider` · `ws_user_inquiry` · `ws_website_inquiry`
**Mongo-only (design needed):** LiveCourse/LiveSession · Goal · PromoCode appliesTo

**Reality:** the read side AND the write side (Phase 3b) are now DONE. What's left is **THE FLIP (go-live)**
+ one architectural design (**LiveCourse**) + the Mongo-only tail (Goal, PromoCode appliesTo) + a handful of
low-value flat tables. No core read/write module migration remains.

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

**Where we are: 0 modules left to migrate.** All 34 read+write modules are built + wired, flag OFF. Don't go
looking for "the next module to migrate" — there isn't one. The work now is THE FLIP and the LiveCourse design.

1. Read this file top-to-bottom, then skim the top entries of [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md)
   (newest = `package-chat`, the last write path).
2. Confirm state:
   - `grep MIGRATION_MYSQL_MODULES .env` → expect the 11 enabled (§2); everything else built is flag OFF
   - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "material.controller\|faq.service" | grep -c "error TS"` → expect 0
   - `for m in commerce-order ebook-order book-order offline-enquiry package-chat; do ls src/modules/$m >/dev/null && echo "$m ✓"; done` → all 5 write modules present
   - *(git note: the tree was CLEAN at the last session start — the earlier "~79 uncommitted" from the
     original checkpoint no longer holds; the prior work was committed. Confirm `git status --short` before
     any commit, and commit ONLY when the user asks.)*
3. **Pick the direction with the user** (no module build remains). In recommended order:
   - **THE FLIP (go-live)** — scope a flip plan FIRST (like the write paths): sequencing of the
     catalog+commerce+order+chat cluster onto one int id-space, the D2 join tables that ride along, the ONE
     prod schema ALTER to run (`schema-changes/2026-06-13_extend_ws_package_chat.sql`), and the rollback
     story. See [`FLIP_SCOPE.md`](./FLIP_SCOPE.md) (the earlier 40/41-blocked audit — now unblocked). Get
     sign-off, flip incrementally, verify each step via HTTP (`yarn dev` + `yarn migration:api`).
   - **LiveCourse / LiveSession design** — the last Mongo-only architecture piece (NO SQL tables exist;
     blocks dashboard + course/material detail + entitlement). Needs a schema-design doc, not a migration.
   - **Low-value tail** (optional) — flat tables (`ws_tag`, `ws_dynamic_image`, `ws_image_notification`,
     `ws_offline_banner_slider`, `ws_user_inquiry`, `ws_website_inquiry`), exam item/attempt, referral.
4. If the user DOES ask for a new table/module anyway: follow §4 EXACTLY (schema-drift check FIRST, tsx
   verify, full doc protocol). Note `package-chat` set the precedent that an additive ALTER is allowed when
   a legacy table is a stub — capture any such ALTER under `schema-changes/` for prod.
5. **After doing work: UPDATE THIS FILE** (§1 where-we-are, §3 module list, §8 remaining) + append a
   newest-first entry to [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md) + run the doc
   protocol (§4.6).

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

**There is no "next module" to migrate** — all 34 are built (§1). The flow doc
[`PRISMA_MODULE_FLOW.md`](./PRISMA_MODULE_FLOW.md) (Prisma model → repository → service branch → transformer)
remains the reference IF a new table is ever requested, and §4 has the exact build→verify→wire→document steps.
Otherwise the live work is **THE FLIP** — flip a fully-wired cluster's keys ON **together** by adding them to
`MIGRATION_MYSQL_MODULES` (§2), HTTP-verify, instant env-var rollback.

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
