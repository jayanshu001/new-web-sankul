# 🗺️ Mongo-Only → MySQL Migration Plan (RESUMABLE)

> **Created:** 2026-06-17 · **Owner doc for the FINAL push: convert every remaining MongoDB-only module to MySQL.**
> **This is the single resume point for the Mongo-only migration.** If a session is interrupted, READ §"Resume
> pointer" first — it always names the exact next action. Keep this doc updated after **every** wave/module
> (per [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md) Golden Rule #0). Do NOT delete this doc until
> the §"Done criteria" is fully met.
>
> **Companion docs:** live status [`RESUME_HERE.md`](./RESUME_HERE.md) · detailed change log
> [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md) · full Mongo inventory
> [`../MIGRATION_MONGO_REMAINING.md`](../MIGRATION_MONGO_REMAINING.md).

---

## ▶️ RESUME POINTER (update this every time)

> **WAVE 5 PROGRESS:** client cart ✅ + client educator ✅ done & verified. Client material/search/wishlist/
> folder/notes are BLOCKED (material entitlement needs LiveCourse + Mongo embeds; search includes LiveCourse;
> wishlist/folder/notes have no SQL tables). So the client-read slice is effectively DONE (only the blocked ones
> remain). The rest of Wave 5 is the **admin catalog CRUD** (~136 handlers) — build module-by-module.
> **NEXT ACTION:** admin CRUD cont. — `plan` ✅, master(3) ✅, `video` ✅, `videoCategory`(full) ✅. Next:
> **book** (`src/admin/book/` — books + orders + settings), **ebook** (`src/admin/ebook/` — ebooks + plans +
> subscriptions), **course** (`src/admin/course/` — large: courses + plans + materials + video-cats + relations),
> **package** (`src/admin/package/` — large), **material** (`src/admin/material/` — hierarchical). Each its own pass.
> ⚠ Mongo-only: master/packageCategory; videoCategory `duplicate` (DAG clone); wishlist/folder/notes/material-client/search.
> **Older NEXT (Wave 5 client reads, now resolved):**
> **material** (`src/client/material`: getCategoryContents/getMaterialDetail/trackDownload/getRecentMaterials),
> **educator** (`src/client/educator`: getEducatorWithCoursesHandler — composes commerce-educator+catalog-course+
> commerce-price+commerce-subscription), **search** (`src/client/search`: globalSearch). Then the big ADMIN
> catalog CRUD (course/ebook/book/package/video/videoCategory/material/master/pc-material/plan — ~136 handlers,
> module by module). ⚠ BLOCKED (no SQL tables, Mongo-only): wishlist, folder, lecture-note, lecture-audio-note,
> free-progress (LectureProgress) — defer (would need new tables). Plus the Wave-4 admin exam reads remainder.
> **Last completed:** ✅ **Wave 5 client CART** (`src/modules/client-cart/`). Wired all 5 cart handlers
> (addToCart/updateCartItemQty/removeCartItem/attachShippingToCart/getCart) on `isClientCartMysql()`. Mongo
> embeds items[] → SQL ws_book_cart + ws_book_cart_item (one active cart/customer; cart_id varchar business key
> generated). Reuses offline-city for shipping city resolution. Enabled `client-cart` in `.env`. Verified vs
> live DB (add/increment/get-with-totals/update/remove cycle). `tsc` clean. *(Wave 4 client exam done earlier;
> Wave-4 admin exam reads still a remainder.)*
> **Working branch:** `migration` (never merge to `main` until full sign-off)
> **Env flag list:** `.env` → `MIGRATION_MYSQL_MODULES` (now +`promoter-auth`, `promoter-data`, `referral`, `admin-rbac`, `client-exam`, `client-cart`)

---

## 0. Scope & baseline (2026-06-17)

A full code scan found **~90 files** still on MongoDB (Mongoose) with NO `isMysqlModule` branch:
**39 admin · 42 client · 9 other (educator/promoter/webhook).** They collapse into a small number of
dependency **clusters** — we migrate by cluster, not file-by-file.

**Already migrated (do NOT redo):** admin-auth (ws_users + administrator CRUD), admin customer CRUD, admin
master educators, educator-auth, customer-auth/profile/bank-account/lookups, all `src/modules/catalog-*`,
`commerce-*`, `offline-*`, `*-order`, `package-chat`.

**The hard blocker (design, not port):** **LiveCourse / LiveSession / LiveCourseSubscription have NO SQL
tables at all.** Every live-course endpoint + dashboard/categories/search/learning that joins them is blocked
until those tables are designed & created. This is Wave 6 and needs a schema-design sub-doc.

---

## 1. The established pattern (follow EXACTLY — see RESUME_HERE §4)

Per module `src/modules/<key>/`: `<key>.repository.ts` (Prisma reads) · `<key>.service.ts` (branch on
`isMysqlModule("<key>")`, export `is<X>Mysql()`/`parse<X>Id()`) · `<key>.transformer.ts` (SQL row → Mongo-shaped
DTO; ids→strings, customerId stays int). **Schema-drift check FIRST** (`DESCRIBE` vs Prisma: bigint overflow,
nullable mismatch, phantom cols, 0-sentinel, JSON, typos, name divergence). Verify via `tsx` against live DB.
Wire controller branch BEFORE the ObjectId guard. New token tables → additive DDL under `schema-changes/`.
Then the doc protocol (registry + regen 3 docs + this plan + changelog + tracker + test log).

**Auth modules** (promoter): mirror `educator-auth` — full entity table + new `ws_*_access_tokens` (DDL ADD) +
`verify<X>Password` supporting **MD5 + bcrypt** (legacy Laravel hashes), JWT/Redis unchanged.

---

## 2. WAVES (sequenced by dependency & risk — low-risk/self-contained first)

| Wave | Cluster | Files | New SQL tables? | Status |
|---:|---|---:|---|---|
| **1** | **Promoter side** (auth, dashboard, customers, promocode, subscription) | 5 | `ws_promoter_access_tokens` (DDL ADD) | ✅ **DONE 2026-06-17** |
| **2** | **Referral system** (client referral + content, admin referral + content, payout webhook) | ~6 | +2 cols + enum widen on ws_refferal_transaction | ✅ **DONE 2026-06-17** |
| **3** | **RBAC management** (admin role, permission, permissionCategory) | ~5 | none (spatie tables exist) | ✅ **DONE 2026-06-17** (permissionCategory stays Mongo) |
| **4** | **Exam** (client reads + scoring write + admin reads). ⚠ Test Series + ExamCountdown MONGO-ONLY | ~8 | none (ws_exam* exist; Exam.description→nullable) | ✅ **DONE 2026-06-17** (admin exam CRUD-writes deferred; getSolutionDownload PDF Mongo) |
| **5** | **Catalog admin CRUD + remaining client reads** (~156 migratable; 21 blocked on missing tables) | ~30 | mostly exist (reuse catalog-*/commerce-*) | 🔄 **client cart DONE; material/educator/search + admin CRUD pending** |
| **6** | **LiveCourse / LiveSession** (admin live-course ×6 + live/livepoll/livechat; client live-course/live/livechat/livepoll/live-reminder) ⚠ NEEDS SCHEMA DESIGN | ~16 | **CREATE ws_live_course*, ws_live_session*, subs, chat, poll** | ⬜ NOT STARTED (blocked on design) |
| **7** | **Aggregation/finalizers** (admin+client dashboard, categories, my-subscriptions, purchase-history, orders, payment ×8, verify, webhook, profile-dashboard, learning) | ~20 | none new (compose migrated modules) | ⬜ NOT STARTED (depends on 1–6) |
| **8** | **Misc / low-value** (notification, tracking/ActivityLog, inquiry, goal, wishlist, cms social-link/current-affair, offline admin CRUD) | ~12 | some new flat tables | ⬜ NOT STARTED |

> Counts are approximate and overlap (a controller can belong to two clusters); the per-wave checklists below
> are authoritative. Total target: every file in [`../MIGRATION_MONGO_REMAINING.md`](../MIGRATION_MONGO_REMAINING.md)
> + the admin inventory has a MySQL branch.

---

## 3. Per-wave checklists

### Wave 1 — Promoter side  🔄 (auth done; reads in progress)
SQL: `ws_promoter` (114, full entity w/ password) · `ws_promocode` (2) · subscriptions (already migrated reads).
- [x] **`promoter-auth`** ✅ DONE — login/refresh/logout/profile. NEW `ws_promoter_access_tokens` (DDL ADD). `verifyPromoterPassword` (MD5+bcrypt; role:"promoter" hardcoded, no spatie). Enabled in `.env`.
- [x] **promoter dashboard** ✅ (`src/promoter/dashboard/`) — getDashboard summary + getDashboardOverview (date-bucketed time-series) via `promoter-data` service. (overview `promocodeId` scope param not supported on SQL — documented.)
- [x] **promoter customers** ✅ (`src/promoter/customer/`) — list + detail; attribution via order JSON.
- [x] **promoter promocode** ✅ (`src/promoter/promocode/`) — list/detail + derived usage. appliesTo returns empty (SQL-faithful, like commerce-promocode).
- [x] **promoter subscription** ✅ (`src/promoter/subscription/`) — list (course/ebook) + report (byCourse/byMonth w/ commission).
- [x] Doc protocol + enabled `promoter-auth` + `promoter-data` in `.env` + updated §RESUME POINTER.

> **Wave 1 build notes:** shared module `src/modules/promoter-data/` (repository + service) does all
> attribution via **raw SQL on the order.promocode JSON snapshot** (no new columns; subscription tables lack
> promoter_id/percentage). `promoter-data` is a SEPARATE flag from `promoter-auth`. Verified all 5 surfaces vs
> live DB. Promocode `appliesTo` not representable from SQL (returns empty) — same accepted limitation as
> commerce-promocode.

> **🔑 KEY ARCHITECTURE FINDING (2026-06-17) — promoter attribution in SQL:** SQL subscription tables have NO
> `promoter_id`/`promocode_id`/`paid_amount`/`promoter_percentage` columns (Mongo denormalizes them per-sub).
> BUT `ws_package_course_order.promocode` (and `ws_ebook_order.promocode`) is a **JSON snapshot** of the whole
> promocode at purchase — it embeds `promoterId`, `promocode` string, and `promotedPackageCourseEbook[].promoterPercentage`/`customerPercentage`.
> So the entire promoter dataset is reconstructable WITHOUT new columns:
> - **attribution:** `order.promocode->>'$.promoterId'` (== this promoter)
> - **join to subscription:** `ws_package_course_order.id = ws_package_course_subscription.order_id` (NOT unique_id; unique_id is a nullable string key)
> - **paidAmount:** `subscription.amount`; **commission:** `amount * (promocode->'$.promotedPackageCourseEbook[0].promoterPercentage') / 100`
> - ebook side: `ws_ebook_order.id = ws_ebook_subscription.order_id`, `ws_ebook_subscription.price` for revenue
> Implement via a shared **`promoter-data` repository** using **raw SQL with JSON_EXTRACT / DATE_FORMAT** (Prisma
> can't express the JSON-path filter or the time-bucket grouping). Date-bucket units: today→hour, week/month→day,
> year/all→month, custom→derived (overview.service.ts `bucketFormatFor`). Verified the join yields 2 course subs.

### Wave 2 — Referral system  🔄 (client+webhook done; admin pending)
SQL: `ws_refferal_program` (1) · `ws_refferal_transaction` (0). Shared by client + admin + webhook.
- [x] **`referral`** module ✅ (`src/modules/referral/` repo + service).
- [x] client `referral.controller.ts` ✅ — rewards overview, transactions list/detail, generate-code, withdrawal (debit + RazorpayX payout + refund-on-failure, all DB writes on SQL). `content.controller.ts` getReferralStatus ✅; **getTerms/getFaqs STAY Mongo** (ws_referral_faq/_term don't exist in SQL).
- [x] `src/webhooks/razorpay-payout.controller.ts` ✅ — payout success/fail flips txn by provider_ref, refunds points on fail, idempotent.
- [x] DDL: `ws_refferal_transaction` += `provider_ref`, `failure_reason` cols + `status` enum widened to add `failed` (schema-changes/2026-06-17_*). Prisma RefferalTransaction + enum updated.
- [x] **admin `src/admin/referral/referral.service.ts`** ✅ — program CRUD, txn list (w/ customer), updateWithdrawalStatus, rejectWithdrawal+refund (atomic), withdrawalsReport + CSV (raw SQL JSON_EXTRACT over bank_account), adjustCustomerRewards (atomic), **listReferrers** per-customer rollup (raw SQL GROUP BY + HAVING). Branched on `isReferralMysql()` inside the service. ⚠ listReferrers `total` is approximated (GROUP BY/HAVING). FAQ/Term content stays Mongo (no SQL tables).
- [x] Doc protocol + update §RESUME POINTER.

> **Wave 2 admin notes:** the admin content controller is ENTIRELY FAQ/Term CRUD → all Mongo-only (no SQL
> tables), nothing migrated there. The service branches reuse the `referral` module repo (extended with admin
> ops). Verified vs live DB. listReferrers pagination total is a best-effort estimate (exact count over a
> GROUP BY/HAVING is a follow-up if a consumer needs precise totals).

> **Wave 2 notes:** mixed-backend withdrawal risk is gone — customer (customer-profile), bank account
> (customer-bank-account), and txn (referral) are all on SQL now, so the debit+create is one Prisma `$transaction`.
> Mongo-only audit fields `utr`/`providerPayload` from the webhook are NOT persisted on SQL (only provider_ref +
> failure_reason added) — they aren't in the API response contract. Verified the full cycle vs live DB.

### Wave 3 — RBAC management  ✅ DONE
SQL: spatie `ws_roles` / `ws_permissions` / `ws_role_has_permissions` / `ws_model_has_*` (admin-auth already READS these).
- [x] **`admin-rbac`** module ✅ (`src/modules/admin-rbac/` repo + service): role CRUD + pivot writes, permission CRUD, permission tree, getRolePermissions, syncRolePermissions, getRolesForPermission.
- [x] admin `role/role.controller.ts` ✅ (all 7 handlers branched) + `permission/permission.service.ts` ✅ (thin controller pass-through; branched in the service).
- [x] `permissionCategory/` — **STAYS Mongo** (no ws_permission_categories table; category derived from permission name prefix).
- [x] Doc protocol + update §RESUME POINTER.

> **Wave 3 notes:** Prisma — added created_at/updated_at to AdminRoleRow/AdminPermissionRow + new
> `AdminRoleHasPermission` (ws_role_has_permissions pivot). `category` is the permission name prefix (before
> first dot) — the tree groups by it; permissionCategory CRUD can't migrate (no SQL table). Role create/update/
> sync **write the pivot directly** (delete-all + insert in a $transaction); validate permission ids belong to
> the role's guard. **deleteRole cascades** the pivot + ws_model_has_roles (no DB FK cascade in the legacy
> schema). ids are bigint unsigned, surfaced as Number/String (small values, like commerce-educator). Verified
> vs live DB. `permissionCategory` + permission `category` object shape are the documented Mongo-only gaps.

### Wave 4 — Exam  🔄 (client reads done; admin + writes pending)
**Drift check result (2026-06-17):** ✅ exist: ws_exam, ws_exam_category, ws_exam_question, ws_exam_question_option,
ws_exam_result, ws_exam_result_detail, ws_exam_result_detail_analytics. ❌ MISSING (Mongo-only, EXCLUDED):
all ws_test_series*, ws_exam_countdown*. Result tables use the legacy `qresult_*` column prefix.
- [x] **`client-exam`** module ✅ (`src/modules/client-exam/` repo + service) — read-only.
- [x] Wired client reads `listExamsByCategory`, `getExamQuestions` (answer NOT leaked), `listMyResults`, `getSolutionByExam`, `getSolutionAnalyticsByExam`, `getDailyExams` drill-down. Schema fix: `Exam.description`→nullable. Enabled `client-exam`.
- [x] **WRITE: client `saveAnswers`** ✅ — scoring into ws_exam_result + ws_exam_result_detail + analytics recompute + rank. Verified exact (correct→+pos, wrong→−neg, skip→0; norm() answer match; "Skip" detection). SQL-side payload validation (numeric ids) since the Mongo zod schema enforces ObjectId.
- [x] Test Series + ExamCountdown: **stay Mongo** (no SQL tables; documented Mongo-only, like LiveCourse).
- [x] **ADMIN exam reads** ✅ (`src/modules/admin-exam/`) — getExams/getExamById/getQuestions/getQuestionById/getExamSubmissions/getExamAnalytics (raw SQL overall + per-question aggregates)/getResultById/getCustomerAnalytics + invalidateResult. Admin SEES the answer (unlike client). categories already on catalog-exam. Enabled `admin-exam`. Verified vs live DB.
- [ ] (deferred, low-value) admin exam/question **CRUD writes** + getSolutionDownloadByExam PDF — stay Mongo for now.
- [x] Doc protocol + update §RESUME POINTER.

> **Wave 4 write notes:** `getSolutionDownloadByExam` (PDF) left on Mongo — it calls the `generateExamSolutionPdf`
> lib which composes Mongo docs; defer with the admin reads. saveAnswers maps to the legacy `qresult_*` columns
> (no attemptNumber/inProgress/startedAt/submittedAt in SQL — those Mongo fields are dropped; qresult_attempt =
> attempt COUNT). Scoring + analytics recompute + rank verified exact vs live DB.

### Wave 5 — Catalog admin CRUD + remaining client reads  🔄 (cart done)
Reuse existing catalog-*/commerce-* modules; add admin WRITE paths + client read wiring.
**Inventory (2026-06-17):** 156 migratable handlers (10 admin CRUD modules + 5 client read modules); 21 BLOCKED
on missing tables. ⚠ **MONGO-ONLY (no SQL tables — defer; would need DDL + new models):** wishlist (ws_wishlist),
folder (ws_folder/_item), lecture-note (ws_lecture_note), lecture-audio-note (ws_lecture_audio_note), free-progress
(ws_lecture_progress).
- [x] **client cart** ✅ (`src/modules/client-cart/`) — add/update/remove/attach-shipping/get (ws_book_cart + ws_book_cart_item). Enabled `client-cart`.
- [x] **client educator** ✅ (`src/modules/client-educator/`) — getEducatorWithCoursesHandler (educator + courses + plans + per-course daysLeft + view bump). Enabled `client-educator`. Verified vs live DB (educator 20, 1 course, 5 plans).
- [~] client **material** — ⚠ BLOCKED: entitlement helper needs LiveCourse (no SQL table) + Mongo-only embedded materialCategories[]; ws_material has no isPaid/ancestors. Stays Mongo (same blocker as catalog-material item listing).
- [~] client **search** (globalSearch) — ⚠ BLOCKED: includes LiveCourse (no SQL table). Stays Mongo.
- [ ] ADMIN catalog CRUD (~136 handlers, module by module; all tables exist):
  - [x] **plan** ✅ (`src/modules/admin-plan/`) — 10 handlers: list/get/create/update/delete/toggle/markAsDefault/bulkStatus/bulkDelete/clone. Single-default-per-entity enforced; owner-id 0-or-null sentinel; delete blocked if subscribers + cascades promoted rows. Enabled `admin-plan`. Verified vs live DB.
  - [x] **pc-material + master sub-categories** ✅ (`src/modules/admin-master/`) — PackageCourseMaterial (pc-material + master/material; title-only), CourseSubjectCategory, VideoCategory (list w/ children via parent FK). ⚠ master/packageCategory = Mongo-only (no ws_package_category). Schema: added parent/educator_id/pdf to VideoCategory Prisma model (NOT NULL→default 0/""). Enabled `admin-master`. Verified vs live DB.
  - [x] **video** ✅ (`src/modules/admin-video/`) — 8 handlers: list/prereqs/get/create/update/delete/toggle/reorder. ws_video; platform youtube|vimeo|aws + matching *_id; slug auto-uniquify; category-exists check; prereqs has_children via parent FK. Enabled `admin-video`. Verified vs live DB (156 videos).
  - [x] **videoCategory (full)** ✅ (extends `src/modules/admin-master/`) — list(filters/educator)/prereqs/get/create/update/toggle/delete + courses-list + videos-list, on `isAdminMasterMysql()`. ⚠ Mongo `childCategoryIds[]` DAG → SQL single `parent` FK (children derived; childCategoryIds NOT writable). `duplicate` (BFS DAG clone + courseId/liveCourseId — no SQL cols) STAYS Mongo. Verified vs live DB (157 cats).
  - [ ] book, ebook, course, package, material.
- [ ] Doc protocol + update §RESUME POINTER.

> **Wave 5 cart notes:** Mongo `BookCart.items[]` embed → SQL split `ws_book_cart` (one active row/customer,
> active=status) + `ws_book_cart_item` (cartId→cart.id, bookId→item_id). `cart_id` is a NOT-NULL varchar
> business key — generated `cart-<base36>`. attach-shipping find-or-creates a `ws_customer_shipping` row (userId,
> phone BigInt, state, pincode Int) + city via offline-city. Verified add/increment/get-totals/update/remove.

### Wave 6 — LiveCourse / LiveSession  ⬜  ⚠ DESIGN FIRST
- [ ] Write `schema-changes/LIVE_COURSE_DESIGN.md` — design ws_live_course, ws_live_session, ws_live_course_plan, ws_live_course_subscription, ws_live_chat*, ws_live_poll*, attendance, reminders. Get user sign-off.
- [ ] Create tables (additive DDL) → Prisma models → modules → wire admin live-course ×6 + client live-course/live/livechat/livepoll/live-reminder.
- [ ] Doc protocol + update §RESUME POINTER.

### Wave 7 — Aggregation / finalizers  ⬜  (after 1–6)
- [ ] admin+client dashboard, categories, my-subscriptions, purchase-history (+receipts), orders, payment ×8 + verify, webhook, profile/dashboard, learning/progress, catalog, course progress.
- [ ] These COMPOSE already-migrated modules — no new tables; the work is wiring + aggregation parity.
- [ ] Doc protocol + update §RESUME POINTER.

### Wave 8 — Misc / low-value  ⬜
- [ ] notification (+ImageNotification), tracking (ActivityLog), inquiry, goal (Goal — Mongo-only, design), cms (SocialLink/CurrentAffair/LiveBannerSlider), offline admin CRUD, customer-master.
- [ ] Doc protocol + update §RESUME POINTER.

---

## 4. Done criteria (when this doc can be retired)

- [ ] Every file in [`../MIGRATION_MONGO_REMAINING.md`](../MIGRATION_MONGO_REMAINING.md) + the admin inventory has an `isMysqlModule` branch (or is documented as intentionally Mongo-only / decommissioned).
- [ ] All flags ON in `.env`; full `yarn migration:api` green.
- [ ] `grep -rl "from \"../../models/" src/admin src/client src/educator src/promoter` returns only files that ALSO have an `isMysqlModule` branch (dual-path) or are explicitly exempt.
- [ ] Mongo branches + the migration flag scheduled for deletion (final cleanup — separate task).

---

## 5. Change log (newest first — append per wave/module)

| Date | Wave | What |
|------|------|------|
| 2026-06-17 | 5 | **🔄 Wave 5 — admin `videoCategory` (full) CRUD done.** Extended `src/modules/admin-master/` with the full videoCategory controller: list(filters/educator)/prereqs(cats+educators)/get/create/update/toggle/delete + courses-list + videos-list, on `isAdminMasterMysql()`. ⚠ Mongo `childCategoryIds[]` DAG → SQL single `parent` FK: children DERIVED from parent; childCategoryIds NOT writable (single-parent). `duplicate` (BFS DAG clone + courseId/liveCourseId, no SQL cols) STAYS Mongo. Verified vs live DB (157 cats, 55 educators, relation lists, CRUD lifecycle + slug-dupe). `tsc` clean. |
| 2026-06-17 | 5 | **🔄 Wave 5 — admin `video` CRUD done.** New `src/modules/admin-video/` (repo + service). Wired all 8 video handlers (list/prereqs/get/create/update/delete/toggle/reorder) on `isAdminVideoMysql()`. ws_video; platform youtube|vimeo|aws with the matching *_id column; slug auto-uniquify (-2/-3…); category-exists validation; prereqs has_children via parent FK. Enabled `admin-video`. Verified vs live DB (156 videos; create aws, slug uniquify, update platform-switch clears old id, toggle, reorder, delete). `tsc` clean. |
| 2026-06-17 | 5 | **🔄 Wave 5 — admin master sub-catalog CRUD done.** New `src/modules/admin-master/` (repo + service). Wired pc-material (5) + master/material + master/subjectCategory + master/videoCategory on `isAdminMasterMysql()`. pc-material + master/material share ws_package_course_material (title-only; SQL has no image/isActive). VideoCategory list resolves child_categories via the `parent` self-FK. Schema: added parent/educator_id/pdf to VideoCategory Prisma model (all NOT NULL in DB w/ default 0/"" → coerce on write, never null). ⚠ master/packageCategory = Mongo-only (no ws_package_category table). Enabled `admin-master`. Verified vs live DB (all 4 CRUDs + cleanup). `tsc` clean. |
| 2026-06-17 | 5 | **🔄 Wave 5 — admin `plan` CRUD done (first admin module).** New `src/modules/admin-plan/` (repo + service). Wired all 10 plan handlers (list/get/create/update/delete/toggle/markAsDefault/bulkStatus/bulkDelete/clone) on `isAdminPlanMysql()`. Single-default-per-entity enforced (clearSiblingDefaults); owner ids use 0-or-null sentinel (treat NULL-or-0 as not-owned, write 0 on the unused two); delete blocked if subscribers + cascades ws_promoted_package_course_ebook. Enabled `admin-plan`. Verified vs live DB (1353 plans; create×2 default-flip, update, markDefault, toggle, clone, bulkDelete). `tsc` clean. |
| 2026-06-17 | 5 | **🔄 Wave 5 — client educator done; material/search BLOCKED.** New `src/modules/client-educator/` — wired getEducatorWithCoursesHandler (educator + courses + plans + daysLeft + view bump) on `isClientEducatorMysql()`; reuses ws_course_educator/ws_course/commerce-price/commerce-subscription. Enabled `client-educator`. Verified vs live DB. **Found BLOCKED (stay Mongo):** client material (entitlement → LiveCourse + Mongo embeds; ws_material has no isPaid/ancestors) and client search (includes LiveCourse — no SQL table). Client-read slice now effectively done; remaining Wave 5 = admin catalog CRUD (~136 handlers, module-by-module, starting with `plan`). `tsc` clean. |
| 2026-06-17 | 4 | **✅ Wave 4 FULLY COMPLETE — admin exam reads done.** New `src/modules/admin-exam/` (repo + service). Wired admin exam controller reads (getExams/getExamById/getQuestions/getQuestionById/getExamSubmissions/getExamAnalytics/getResultById/getCustomerAnalytics) + invalidateResult on `isAdminExamMysql()`. getExamAnalytics = raw SQL overall + per-question aggregates over qresult_* cols. Admin sees the question answer (vs client). Enabled `admin-exam` in `.env`. Verified vs live DB (1 exam, questions w/ answer, submissions, analytics 100% accuracy, result detail). `tsc` clean. Deferred: admin exam/question CRUD writes + getSolutionDownload PDF (stay Mongo). |
| 2026-06-17 | 5 | **🔄 Wave 5 START — client cart done.** Inventory: 156 migratable (10 admin CRUD + 5 client read modules); 21 blocked (wishlist/folder/notes/free-progress = Mongo-only, no SQL tables). New `src/modules/client-cart/` — wired all 5 cart handlers (add/update/remove/attach-shipping/get) on `isClientCartMysql()`. Mongo items[] embed → ws_book_cart + ws_book_cart_item; cart_id varchar generated; shipping via ws_customer_shipping + offline-city. Enabled `client-cart`. Verified vs live DB (add/increment/get-totals/update/remove). `tsc` clean. |
| 2026-06-17 | 4 | **✅ Wave 4 CLIENT exam COMPLETE (reads + scoring write).** Wired all client exam reads (list/questions/my-results/solution/solution-analytics/daily-drill-down) + the **saveAnswers scoring WRITE** (ws_exam_result + ws_exam_result_detail + analytics recompute + rank). SQL-side numeric-id payload validation (Mongo zod enforces ObjectId). Verified exact scoring vs live DB: correct→+1, wrong→−1, detail rows, analytics rollup, solution correct-marking, rank 1/2; test rows cleaned. getSolutionDownloadByExam (PDF) + admin exam reads stay pending. `tsc` clean. |
| 2026-06-17 | 4 | **🔄 Wave 4 client exam READS done.** Drift check: Test Series + ExamCountdown have NO SQL tables → Mongo-only, excluded; only EXAM migratable. New `src/modules/client-exam/` (repo + service, read-only). Wired client listExamsByCategory / getExamQuestions (answer NOT leaked) / listMyResults on `isClientExamMysql()`. Built (not wired) solution reads + getDailyExams drill-down (raw SQL YEAR/MONTH grouping). Schema fix: Exam.description→nullable (1 NULL row). Enabled `client-exam`. Verified vs live DB. `tsc` clean. **Admin exam reads + the saveAnswers scoring write still pending.** |
| 2026-06-17 | 3 | **✅ Wave 3 COMPLETE — RBAC management.** New `src/modules/admin-rbac/` (repo + service). Wired role controller (7 handlers) + permission service (7 ops) onto spatie ws_roles/ws_permissions/ws_role_has_permissions. Prisma: +created_at/updated_at on AdminRoleRow/AdminPermissionRow, new AdminRoleHasPermission pivot model. Role mutations write the pivot directly (delete+insert in $transaction, guard-validated); deleteRole cascades pivot + ws_model_has_roles. Permission `category` derived from name prefix; tree groups by it. permissionCategory CRUD + permission category-object shape STAY Mongo (no ws_permission_categories table). Enabled `admin-rbac` in `.env`. Verified vs live DB (29 roles, 108 perms, tree 30 cats, create/sync/delete + pivot cascade). `tsc` clean. |
| 2026-06-17 | 2 | **✅ Wave 2 COMPLETE — admin referral.** Branched `src/admin/referral/referral.service.ts` on `isReferralMysql()`: program CRUD, txn list (w/ customer), updateWithdrawalStatus, rejectWithdrawal+refund, withdrawalsReport + CSV (raw SQL JSON_EXTRACT over bank_account), adjustCustomerRewards (atomic), listReferrers per-customer rollup (raw SQL GROUP BY/HAVING). Extended the `referral` module repo with admin ops. Admin FAQ/Term content stays Mongo (no SQL tables). Verified vs live DB (program CRUD, reward-adjust→txn, txn list, referrers rollup, report+CSV). `tsc` clean. listReferrers total approximated. |
| 2026-06-17 | 2 | **🔄 Wave 2 client + webhook DONE.** New `src/modules/referral/` (repo + service). Wired client referral (rewards overview, transactions list/detail, generate-code, withdrawal) + getReferralStatus + RazorpayX payout webhook behind `isReferralMysql()`. DDL on `ws_refferal_transaction`: +`provider_ref` +`failure_reason` cols, `status` enum widened with `failed` (schema-changes/2026-06-17_extend + add_failed). getTerms/getFaqs stay Mongo (no SQL tables). Enabled `referral` in `.env`. Verified vs live DB (withdrawal debit→payout→success + fail→refund cycle, idempotent webhook, points math exact). `tsc` clean. **Admin referral service still pending.** |
| 2026-06-17 | 1 | **✅ Wave 1 COMPLETE — promoter reads.** Built shared `src/modules/promoter-data/` (repository + service) for customers/subscriptions/dashboard/promocode. Attribution derived from `ws_*_order.promocode` JSON snapshot (`$.promoterId`, `$.promotedPackageCourseEbook[0].promoterPercentage`) joined to subscriptions via `order.id = subscription.order_id` — raw SQL w/ JSON_EXTRACT + DATE_FORMAT (Prisma can't express these). Wired all 4 read controllers behind `isPromoterDataMysql()`; enabled `promoter-data` in `.env`. promocode appliesTo returns empty (SQL-faithful). Verified vs live DB (promoter 130: 2 subs/₹15300/commission ₹765/2 customers; report + overview buckets). `tsc` clean. |
| 2026-06-17 | 1 | **`promoter-auth` DONE** (login/refresh/logout/profile/change-pw on SQL). Created `ws_promoter_access_tokens` (DDL → `schema-changes/2026-06-17_create_ws_promoter_access_tokens.sql`). Extended Prisma `Promoter` (password + last_seen_at) + new `PromoterAccessToken` model; regenerated. `verifyPromoterPassword` (bcrypt+MD5; only 1/114 promoters has a pw). No last_login_* cols in SQL → touchLogin writes last_seen_at. Enabled `promoter-auth` in `.env`. Verified via live-DB tsx; `tsc` clean. Remaining Wave 1: dashboard/customers/promocode/subscription reads. |
| 2026-06-17 | — | Plan doc created. Baseline: ~90 Mongo-only files (39 admin / 42 client / 9 other). Verified promoter/referral SQL tables exist; `ws_promoter_access_tokens` missing (DDL ADD needed for Wave 1). Recommended start: Wave 1 (Promoter). |
