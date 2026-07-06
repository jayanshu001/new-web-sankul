# ✅ MIGRATION COMPLETE — 2026-06-22 · running MySQL-only

WebSankul now runs on **MySQL (Prisma) only**. Every admin + client + educator + promoter API, every write path, background job, and boot-time seeding serves from MySQL. **MongoDB is disconnected by default** (`MONGO_FALLBACK_ENABLED=false` → `connectDB()` is skipped at boot); the app boots and serves with **no Mongo connection** — empirically verified (22 endpoints returned 200, 0 Mongo calls at boot). `MONGODB_URI` is no longer required. Re-enabling Mongo is a single reversible flag.

The remaining `src/models/**` + `mongoose` dependency is now **dormant dead code** (nothing connects to Mongo).

**This document is retained for historical context.** The live source of truth for changes is `docs/MIGRATION_QUERY_CHANGES.md`. Anything below describing "pending / in-progress / flag OFF / blocker / Mongo fallback / remaining" reflects an earlier point in time and is **superseded** by the completed state above.

# C4 — Remaining Blockers & Schema Decisions (as of 2026-06-19) — ✅ DONE (superseded; see banner)

> **UPDATE 2026-06-19 — C4 is CODE COMPLETE.** Every decision below was resolved as recommended and implemented:
> testseries detail+papers (new tables), wishlist (new table), goals (label ids on `ws_goal.labels`), book/course
> receipts (accepted drift), credit-referrer (ported). All branches typecheck; Mongo fallback intact. What remains is
> **deploy-only** (no code): apply `schema-changes/2026-06-19_create_c4_tables.sql`, run the backfills specced below,
> `yarn migration:api`, then flip flags `client-wishlist` + `client-testseries`. (Goals also needs a one-time label-id
> backfill for existing `ws_goal` rows + a remap of existing `ws_customer.goal` selections.) Original analysis kept below.


> Everything left in **C4** is gated on a schema or data-model decision — not a plain port.
> Collected here so the table/DDL choices can be made in one pass instead of one-off.
> Companion: [`MODULE_STATUS_ROADMAP.md`](./MODULE_STATUS_ROADMAP.md) · [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md).

## Already shipped in C4 (no decision needed)
- ✅ `listTestSeries`, `listMySubscriptions`, **`getTestSeriesDetail`** (`client-testseries`) — flag pending verify.
- ✅ client tracking write (`createActivity`, `tracking` flag ON) — live.
- ✅ eBook receipt (`getEbookReceiptMysql`, `client-purchase-history` ON).
- ✅ **Wishlist — full port** (`modules/client-wishlist`, all 4 handlers) — flag `client-wishlist` pending.
- ✅ **DDL + Prisma models written** for `ws_test_series_content_category`, `ws_test_series_exam`, `ws_wishlist`
  (`schema-changes/2026-06-19_create_c4_tables.sql`). NOT applied to DB yet.

## Deploy steps to activate the above (require live DBs — not done headless)
1. Apply `schema-changes/2026-06-19_create_c4_tables.sql` to staging/prod.
2. `yarn prisma:generate` (models already in `schema.prisma`).
3. Backfill (scripts NOT written — need Mongo→SQL id maps; see spec below).
4. `yarn migration:api` smoke test, then add `client-wishlist` + `client-testseries` to `.env` `MIGRATION_MYSQL_MODULES`.

## Backfill scripts — WRITTEN 2026-06-19 (`scripts/backfill-c4-*.ts`)
- `backfill-c4-wishlist.ts`, `backfill-c4-testseries.ts`, `backfill-c4-goal-label-ids.ts`.
- Natural-key joins (TestSeries/Exam by title, Customer by phone, items/labels by name); SKIP unmappable rows; idempotent.
- Run each with `DATABASE_URL=... MONGODB_URI=... npx tsx scripts/backfill-c4-<name>.ts`. Goal script: pass A (assign
  label ids) is safe/standalone; pass B (remap customer selections) is best-effort. Verify the natural-key field names
  against prod data before relying on the match counts (staging is largely disjoint → expect few matches).

## Backfill spec (the part that needs a verified Mongo→SQL id map)
The blocker: `ws_test_series` / `ws_exam` / `ws_course|package|ebook|book` already exist in SQL
independently of Mongo, so backfilling the link/wishlist rows needs a join key to map a Mongo
`_id` → the existing SQL int id. Confirm how those tables were originally populated, then:
- **wishlist:** for each Mongo `Wishlist{customerId,itemType,itemId}`, map `customerId`→ws_customer id,
  `itemId`→the SQL id of that entity (per itemType). Skip rows whose entity didn't migrate.
- **test_series_content_category:** insert fresh per Mongo doc; build `String(_id)→newSqlId` map.
- **test_series_exam:** map `testSeriesId`→ws_test_series id, `contentCategoryId`→the map from the
  step above, `examId`→ws_exam id. Honour the UNIQUE(test_series_id, exam_id).

---

## C5 — Promocode appliesTo (DECISION MADE + foundation laid 2026-06-19; full port PENDING)
**Decision:** the C5 files use the NEW admin-UI `PromoCode` model (Mongo `ws_promo_codes`, with `appliesTo {type,ids[]}`
+ `discountType`/`discountValue`) — a system DISTINCT from the legacy `ws_promocode` (already on SQL). It had NO SQL table.
Created net-new **`ws_promo_code`** (`schema-changes/2026-06-19_create_promo_code.sql`) + Prisma model `PromoCodeRule`,
storing appliesTo as `applies_to_type` + `applies_to_ids` JSON (codebase-standard embedded-array pattern). Generated + typechecked.

**Remaining port (LARGE, payment-adjacent — not yet built):**
- New module (e.g. `modules/promo-code/`) gated on a new `promo-code` flag.
- **Admin CRUD** (`admin/promocode/promocode.controller.ts`): list/get/create/update/delete/toggle/bulk. The hard parts:
  - `assertAppliesToExists` + `populateAppliesTo` across **5 entity tables** (package/course/liveCourse/ebook/testSeries →
    ws_package/ws_course/ws_live_course/ws_ebook/ws_test_series; testSeries display = `title`→normalise to `name`).
  - `loadPlansForEntities` / `loadPlanLinks` / `getPromocodePlans` across **4 plan tables**
    (PackageCourseEbookPrice, LiveCoursePlan, EbookPrice, TestSeriesPrice) + Goal-label exam-type grouping.
  - `syncPlanLinks` writes the per-plan promoter/customer split — overlaps the `ws_promoted_package_course_ebook`
    commission table; reconcile its `planKind`/`pcb_price_id` columns first.
- **Client apply** (`client/promocode/promocode.controller.ts` + `applies-to.ts`): `promoCovers` (pure, DB-agnostic) +
  `computePromoDiscount`; the SQL path reads `appliesToType`/`appliesToIds` and matches the cart's SQL entity id.
- **Backfill** `ws_promo_codes` → `ws_promo_code`, translating `appliesTo.ids` per type via natural key (entity title/name
  → SQL id). Plan-link percentages are a second backfill once syncPlanLinks lands.

**Why paused here:** this is the largest, most-coupled, discount-computing module in the migration. Recommend building it
against a DB where the accumulated C4+C6+C5 DDL/backfills have been applied + verified, rather than stacking unverifiable
payment logic on un-applied schema. Foundation (table) is safe and committed.

## 1. TestSeries detail + papers — needs 2 net-new tables
**Endpoints blocked:** `GET /client/test-series/:id` (`getTestSeriesDetail`), `GET /client/test-series/:id/papers` (`listSeriesPapers`).

**Missing tables (Mongoose-only today):**
- `ws_test_series_content_category` — from `TestSeriesContentCategory.model.ts` (`{ testSeriesId, name, icon, orderBy, status }`).
- `ws_test_series_exam` — series→exam link from `TestSeriesExam.model.ts` (`{ testSeriesId, contentCategoryId, examId, orderBy, status }`).

**Decision:** author DDL for both (+ Prisma models + `db:pull`/`generate`) and a Mongo→SQL backfill, OR leave detail/papers on Mongo indefinitely.
**Recommendation:** create both tables — they're small ref/link tables and unblock the two endpoints cleanly (Exam/ExamResult already on SQL).

## 2. Wishlist — needs 1 net-new table
**Blocked:** `client/wishlist/wishlist.controller.ts`.
**Missing table:** `ws_wishlist` (no equivalent exists). Shape ≈ `{ id, customer_id, entity_type, entity_id, created_at }`.
**Decision:** design + create `ws_wishlist` (+ backfill from the Mongo wishlist), or leave Mongo.
**Recommendation:** create it; net-new, additive, no drift risk.

## 3. Goals — data-model mismatch (no clean mapping)
**Blocked:** `client/goal/goal.client.service.ts` (`getActiveGoals`, `updateMyGoals`, `getGoalsWithSelection`, `getMySelectedGoals`).
**Problem:** roadmap said "map to `ws_customer_target_goal`", but that table is a flat `{name, image, active}` master — NOT the
client goal/labels model. The real read maps to `ws_goal` (already wrapped by `modules/goal` for admin). Per-customer selection
has a home (`Customer.goal` JSON column exists), BUT `ws_goal.labels` is stored as `[{name}]` **without ids**, while the client
selects by **label id** (`Customer.goals` = array of label `_id`s; `getMySelectedGoals` filters `labels._id ∈ ids`).
**Decision needed:** either (a) add stable ids to `ws_goal.labels` JSON (and backfill the Mongo label `_id`s so existing
`Customer.goals` selections still resolve), or (b) change the selection model to select-by-name / select-whole-goal.
**Recommendation:** (a) — preserves existing customer selections; (b) silently invalidates them.

## 4. Book + course receipts — column gaps (money-facing drift)
**Blocked:** `getBookReceipt`, `getCourseReceipt` in `receipts.controller.ts` (eBook already done).
**Gaps:**
- `ws_book_order`: only `order_price` — no `total_discounted_price` / `total_shipping_price` / `total_list_price` → the
  `subTotal`/`shipping`/`discount` breakdown can't be reproduced. Item names live in the `order_items` JSON.
- `ws_package_course_subscription`: no `paid_at`; no razorpay order/payment columns (on `ws_package_course_order` via `order_id`).
**Decision:** (a) ALTER the order tables to add the missing breakdown/paid_at/razorpay columns (+ backfill), or (b) accept the
drift (breakdown collapses to `grandTotal`, `paidAt` null, razorpay ids via the order hop where possible).
**Recommendation:** (b) for course (hop to `ws_package_course_order` for razorpay ids + `paid_at`; breakdown is single-line
anyway), and (b) for book with a documented note that the discount/shipping split is unavailable on SQL — avoid ALTERs unless
the receipt UI actually renders the split.

## 5. credit-referrer — payment-flow write (not a schema blocker)
**File:** `client/referral/credit-referrer.ts`. Idempotent reward credit on the verify path (`Customer.rewardPoints` +
`ws_refferal_transaction`). SQL tables exist. **Needs explicit go-ahead** (per "ask before payment flows"), not a schema change.

---

## Suggested batched order
1. Create `ws_test_series_content_category`, `ws_test_series_exam`, `ws_wishlist` in one schema-changes SQL + backfill pass.
2. Decide goals label-id strategy (recommend: add ids + backfill).
3. Finish course/book receipts as accepted-drift ports (no ALTER) unless the UI needs the breakdown.
4. Confirm credit-referrer, then port the reward write.
