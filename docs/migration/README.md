# Migration documentation

All Web Sankul **MySQL migration** docs for `new-web-sankul` live in this folder.

**After any migration change →** [**MIGRATION_DOC_UPDATES.md**](./MIGRATION_DOC_UPDATES.md) (which files to update + PR checklist).

---

## Documents

| Document | Purpose |
|----------|---------|
| [**PRISMA_MODULE_FLOW.md**](./PRISMA_MODULE_FLOW.md) | **Flowcharts:** Prisma boot, request path, how to migrate a module |
| [**MIGRATION_DOC_UPDATES.md**](./MIGRATION_DOC_UPDATES.md) | **Checklist:** what to update after code/schema/test changes |
| [**api-tests/**](./api-tests/README.md) | **HTTP tests** against local `yarn dev` (per migrated module) |
| [**MIGRATION_TRACKER.md**](./MIGRATION_TRACKER.md) | What was built, phase status, changelog |
| [**MIGRATION_TEST_LOG.md**](./MIGRATION_TEST_LOG.md) | What you tested (Pass/Fail) — update as you go |
| [**testing-guide.md**](./testing-guide.md) | How to validate each phase and module |
| [**SCHEMA_COMPARISON.md**](./SCHEMA_COMPARISON.md) | Legacy MySQL vs Mongo vs post-migration (table inventory) |
| [**MIGRATED_MODULES.md**](./MIGRATED_MODULES.md) | **Only** modules on MySQL/Prisma (Phase 2+) |
| [**FIELD_COMPARISON.md**](./FIELD_COMPARISON.md) | Module-by-module column/field + constraints matrix |
| [**phase-1-mysql.md**](./phase-1-mysql.md) | Phase 1: Docker MySQL, import dump, Prisma setup |
| [**legacy_system_migration_strategy.md**](./legacy_system_migration_strategy.md) | Full 8-phase migration strategy (architecture & phases) |

---

## Quick commands

```powershell
cd D:\Projects\web-sankul\new-web-sankul

yarn db:up              # start MySQL container
yarn db:import          # import websankul_staging.sql
yarn db:verify          # Phase 1 check
yarn db:test-cms-pilot  # Phase 2 CMS pilot check
yarn db:test-faq        # Phase 2 FAQ check
yarn docs:schema-comparison  # Regenerate SCHEMA_COMPARISON.md
yarn docs:field-comparison   # Regenerate FIELD_COMPARISON.md
yarn docs:migrated-modules   # Regenerate MIGRATED_MODULES.md
yarn migration:api           # HTTP API tests (yarn dev must be running)
yarn migration:api:faq       # HTTP tests for one module
yarn prisma:generate
yarn dev
```

---

## Workflow

```txt
1. Read MIGRATION_TRACKER.md        → know current phase
2. Do migration work (code / Prisma / env)
3. Follow MIGRATION_DOC_UPDATES.md  → update the right docs & run yarn docs:*
4. Follow testing-guide.md          → run tests for that step
5. Update MIGRATION_TEST_LOG.md     → mark ✅ / ❌ before next module
6. Update MIGRATION_TRACKER.md      → changelog when step is done
```

---

## Current status (summary)

> **✅ 2026-06-13 — 0 MODULES LEFT TO MIGRATE.** All 34 read+write modules are built + wired, **all flag OFF**
> (11 enabled, the rest dual-path dormant). The read side AND the Phase 3b write side are DONE. What remains is
> **THE FLIP** (go-live: turn flags ON) + the **LiveCourse design** (Mongo-only, no SQL tables) + optional
> low-value flat/D2 tables. **`RESUME_HERE.md` is the live single source of truth** — read it first. The
> per-module detail below is the historical wave-by-wave record (newest waves at the bottom of this list).
>
> **Phase 3b write cluster (COMPLETE, flag OFF):**
> - `commerce-order` — course purchase (order + subscription + tracking; dual-read fallback). tsx 28/28.
> - `ebook-order` — ebook purchase (order + subscription; no tracking). tsx 28/28.
> - `book-order` — book cart checkout (5 tables, line items, courier AWB via bigint AUTO_INCREMENT). tsx 25/25.
> - `offline-enquiry` — lead-capture write (bigint mobile, anon→0 sentinel). tsx 10/10.
> - `package-chat` — announcement chat READ+WRITE. **⚠ First additive schema ALTER** (`ws_package_chat`
>   extended with media/sender/push — see `schema-changes/2026-06-13_extend_ws_package_chat.sql`). tsx 21/21.
> - `catalog-book` — now **WIRED** (`GET /client/books` + `/books/:id`), unblocked by `book-order` migrating
>   the cart/order tables it composes. tsx 12/12.
>
> All write paths use the **dual-read fallback in verify** (check MySQL first, fall through to Mongo on miss)
> so a flag flip between create-order and verify can't orphan a payment.

- **Phase 1:** MySQL + dump + Prisma — done  
- **Phase 2:** CMS group (app-update, version, faq, banner-slider, testimonial, department, terms, popup) + **Customer Module** on MySQL.  
  - **Enabled (11):** the CMS group + `customer-auth` + `customer-lookups` + `offline-city`.  
  - **Code-complete, flags OFF:** `customer-address`, `customer-profile`, `customer-bank-account`. Address is coupled to cart/course/shipping (still Mongo) — its **flip is deferred to the commerce wave** (enable together for a consistent id space). Code is done + verified; only the enable waits.  
- **Phase 3 (catalog):** read backbone **built dual-path, all 4 flags OFF** — `catalog-package-type`, `catalog-package` (`ws_package`/`ws_package_type`), `catalog-course` (`ws_course`/`ws_course_subject_category`), `catalog-video` (`ws_video`/`ws_video_category`).  
  - **Video URL-encryption parity PASS** (fixed-token MySQL===Mongo URL, decrypt===aws_id; the module feeds the shared `encryptVideoSource` — encryption is never reimplemented).  
  - Schema fixes: `Package.shareable_link` + `Course.image` → nullable. D2: video-category relation tables **deferred**. All paths verified vs live DB via `tsx`; api-test `yarn migration:api:catalog`.  
  - The whole catalog id-space (int vs ObjectId) is joined by still-Mongo commerce/dashboard consumers, so **all 4 keys flip together with the commerce wave** — none can flip standalone.  
- **Phase 3a (commerce — IN PROGRESS):** read-only modules built dual-path, **flag OFF**, to flip together with catalog.  
  - `commerce-price` (`ws_package_course_ebook_price`, 1353) — pure plan/pricing lookup, **built + verified**. Prisma model is a faithful 1:1 (no schema fix). **Drift handled:** owner ids use `0` as the "not this owner" sentinel (not only NULL) → coalesced to null; exactly-one-owner invariant verified; `duration` is **DAYS** (the `"12 Month"` row = 365); `material_price` null → 0. Verified vs live DB via `tsx`; api-test `yarn migration:api:commerce-price`.  
  - `commerce-subscription` **(READ)** (`ws_package_course_subscription`, 2) — the **entitlement source of truth**, **built + verified**. Read-only; writes are 3b. **Schema fix:** `tracking` is `bigint` (both rows ~1.19e11, overflow Int32) — Prisma `trackingId Int?→BigInt?` + the FK target `…Tracking.id Int→BigInt`; without it reads throw. **Name map:** SQL `package_id`→Mongo `targetPackageId`, SQL `pcb_id`→Mongo `packageId`. **C3:** `customer_id` is int (migrated id-space). Verified vs live DB via `tsx`; api-test `yarn migration:api:commerce-subscription`.  
  - `commerce-ebook-sub` **(READ)** (`ws_ebook_subscription`, 1) — the **ebook entitlement source of truth**, **built + verified**. Read-only; writes are 3b. **Schema fix:** the Prisma model was **missing `status`** (the entitlement flag) **+ `payment_type`** — added; `start_at`/`end_at` `DateTime`→`DateTime?` (DDL nullable). Active = `status≠false && end_at>now`. **C3:** `customer_id` int. Verified vs live DB via `tsx`; api-test `yarn migration:api:commerce-ebook-sub`.  
  - `commerce-promoter` **(READ)** (`ws_promoter`, 114) — promocode owner master, **built + verified**. `password` on the row but **never surfaced**. Schema fix: full_name/email/phone → nullable. Verified vs live DB via `tsx`; api-test `yarn migration:api:commerce-promoter`.  
  - `commerce-promocode` **(READ, SQL-faithful)** (`ws_promocode`, 2 + `ws_promoted_package_course_ebook`, 5) — **built + verified**. **⚠ Cannot serve the client `applyPromocode` contract** — the Mongo model uses `appliesTo`/`discountValue` while SQL uses a per-plan promoter%/customer% split; built SQL-faithful reads only, flag OFF (user decision). Schema fix: promocode/promo_start_at/promo_expire_at → nullable. Verified vs live DB via `tsx`; api-test `yarn migration:api:commerce-promocode`.  
  - `commerce-educator` **(READ)** (`ws_course_educator`, 56) — full-entity educator master, **built + verified**. **FINAL 3a read module.** `password` (NOT NULL) on the row but **never surfaced**; ref projection `{_id,name,image}`. **⚠ Latent:** `id` is `bigint unsigned` mapped `Int` (ids 20–85, no overflow; not changed — would ripple into Course FK). Verified vs live DB via `tsx`; api-test `yarn migration:api:commerce-educator`.  
- **✅ Phase 3a READS COMPLETE** (price · subscription · ebook-sub · promoter · promocode · educator — all flag OFF).  
- **Wiring (IN PROGRESS):** the commerce reads exist to let the catalog/dashboard endpoints serve from MySQL — but those handlers join still-Mongo collections, so they must be **wired** (controller branches on the new modules) before any flip is meaningful. An audit (`FLIP_SCOPE.md`) found 40/41 client handlers blocked on unmigrated collections (Course, Ebook, Goal, Material, Exam, …).  
  - ✅ **Course LISTING wired** (`catalog-course` extended): `GET /client/courses` + `/courses/category/:id` now compose catalog-course + commerce-price + commerce-subscription (plans split by material + per-customer purchase state), behind `isCourseMysql()` (flag OFF). Schema fix: `ws_course.is_featured`/`purchase` enum('0','1') → Mongo `isPopular`/`isPaid`. Verified via `tsx` (17 checks).  
  - ✅ **eBook surface wired** (`catalog-ebook` built): `GET /client/ebooks` + `/ebooks/:id` compose catalog-ebook (`ws_ebook`) + commerce-price + commerce-ebook-sub, behind `isEbookMysql()` (flag OFF). **No separate ebook-price module** — pricing is in the shared `ws_package_course_ebook_price` (commerce-price). `isPaid` derived from plans. Verified via `tsx` (19 checks).  
  - ✅ **Material category NAVIGATION wired** (`catalog-material` built): `GET /client/material-categories/:id/children` from `ws_material_category` (children via SQL `parent` self-FK) + `ws_material` (counts), behind `isMaterialMysql()` (flag OFF). Verified via `tsx`. **Scope:** material *item listing* stays blocked (entitlement joins LiveCourse + Mongo-only `materialCategories[]` embeds).  
  - ✅ **Exam category NAVIGATION wired** (`catalog-exam` built): `GET /client/exam-categories/:id/children` from `ws_exam_category` (children via SQL `parent_id` self-FK, active=status&&!deleted) + `ws_exam` (unconditional count), behind `isExamMysql()` (flag OFF). Mirrors material. Verified via `tsx`.  
  - 🧱 **Book store DATA reads built** (`catalog-book`): `ws_book` (10) catalogue + computed fields (isPaid/key/daysLeft/isNew). **NOT wired** (like catalog-package) — listBooks/getBookDetail enrich with cart qty + isPurchased from the unmigrated `ws_book_order`/`ws_book_cart` (int-vs-ObjectId); flips with the book-order/cart wave. Verified via `tsx`.  
  - ✅ **Offline center/batch browse reads wired** (`offline-batch` built): `GET /client/offline/{centers,batches}(/:id)` from `ws_offline_center`+`ws_offline_batch` (+city), behind `isOfflineBatchMysql()` (flag OFF, public routes). Schema fixes: phone Int→BigInt (overflow), removed phantom `status` (no SQL column). Dashboard stays Mongo (banner); enquiry is a write (deferred). Verified via `tsx`.  
  - ⏭ **`pendrive-course` SKIPPED** — decommissioned feature (7 tables), out of migration scope per product decision.  
  - ⏭ **`Goal` deferred** — Mongo-only architecture (`ws_goals` with embedded `labels[]` has NO SQL table; only flat `ws_customer_target_goal`). `listPackagesByGoal` not reproducible from SQL. Documented; reconciliation is a later effort.  
  - **Next:** the remaining client surface (Course/package **detail**, **dashboard**, video browse, item listings) is increasingly **Mongo-only architecture** — it needs **LiveCourse/LiveSession** (entirely unmigrated) + the embedded `materialCategories[]`/`examCategories[]`/`appliesTo`/`childCategoryIds[]` arrays + entitlement composition. That's a *reconciliation design* effort, not flat-table migration — worth scoping deliberately as its own phase.  
- **THE FLIP** (after a cluster is fully wired): turn that cluster's keys ON **together** (one consistent int id-space) — HTTP-verify, instant env-var rollback. Then **3b** write-path (`commerce-order`, subscription writes, Razorpay) — **isolated, last**.  

See [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md) for details and [MIGRATED_MODULES.md](./MIGRATED_MODULES.md) for the per-module registry.
