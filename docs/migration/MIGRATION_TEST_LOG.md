# ✅ MIGRATION COMPLETE — 2026-06-22 · running MySQL-only

WebSankul now runs on **MySQL (Prisma) only**. Every admin + client + educator + promoter API, every write path, background job, and boot-time seeding serves from MySQL. **MongoDB is disconnected by default** (`MONGO_FALLBACK_ENABLED=false` → `connectDB()` is skipped at boot); the app boots and serves with **no Mongo connection** — empirically verified (22 endpoints returned 200, 0 Mongo calls at boot). `MONGODB_URI` is no longer required. Re-enabling Mongo is a single reversible flag.

The remaining `src/models/**` + `mongoose` dependency is now **dormant dead code** (nothing connects to Mongo).

**This document is retained for historical context.** The live source of truth for changes is `docs/MIGRATION_QUERY_CHANGES.md`. Anything below describing "pending / in-progress / flag OFF / blocker / Mongo fallback / remaining" reflects an earlier point in time and is **superseded** by the completed state above.

---

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
| CP3.5 Batch 1 — port reads/listings + flip-to-twin (exam/ebook/offline/live/course) | ✅ | 2026-06-30 | `yarn typecheck` (1 pre-existing error, 0 introduced); `listBatchEnquiries` deferred NEEDS-DDL |
| CP3.5 Batch 0 — delete dead/superseded Mongo code (client + admin/promoter) | ✅ | 2026-06-30 | `yarn typecheck` (1 pre-existing error, 0 introduced) |
| CP3 — remove all `isMysqlModule()` fallback branches (159 files) | ✅ | 2026-06-30 | `yarn typecheck` (1 pre-existing error, 0 introduced) |
| admin-video + administrator validation (numeric id accept; role required) | ✅ | 2026-06-23 | `yarn typecheck` (validation-only fix) |
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
| Phase 2 — `customer-lookups` | ✅ | 2026-06-10 | Live-DB data path verified (12 states / 10 educations, exact DTO shapes); api-test authored + wired (`yarn migration:api:customer-lookups`). HTTP run pending live `yarn dev`. |
| Phase 2 — `customer-address` | 🟡 | 2026-06-10 | Code complete, **flag OFF** (cityId→OfflineCity/cart). Live-DB repo CRUD verified (create→list→setDefault→update→delete, BigInt phone). No API test (Mongo still serves). |
| Phase 2 — `customer-profile` | 🟡 | 2026-06-10 | Code complete, **flag OFF** (dashboard cross-module deps). Live-DB service verified (name split/join, goal hydration, derived isProfileCompleted). No API test (Mongo still serves). |
| Phase 2 — `customer-bank-account` | 🟡 | 2026-06-10 | Code complete, **flag OFF** (referral withdrawal Mongo-coupled). Live-DB repo CRUD verified. No API test (Mongo still serves). |
| Phase 2 — `offline-city` | ✅ | 2026-06-10 | **Enabled.** Cities-only (unblocks customer-address). Added `status`/`order` cols via DDL. Live-DB verified (2 cities; address cityId=2→"Ahmedabad" end-to-end through cart). api-test wired (`yarn migration:api:offline-city`); HTTP run pending live `yarn dev`. |
| Phase 3 — `catalog-package-type` | 🟡 | 2026-06-11 | Code complete, **flag OFF** (int-vs-ObjectId type-id coupling across still-Mongo consumers). Live-DB tsx verified (6 types, synthesized order:0/active:true). `listPackageTypes` branched. api-test wired (`yarn migration:api:catalog`). |
| Phase 3 — `catalog-package` | 🟡 | 2026-06-11 | Code complete, **flag OFF** (ws_package is a subset of Mongo + commerce-wave joins). Schema fix `shareable_link`→nullable. Live-DB tsx verified (4 packages, findById/byType). |
| Phase 3 — `catalog-course` | 🟡 | 2026-06-11 | Code complete, **flag OFF** (id coupling + commerce joins). Schema fix `Course.image`→nullable. Live-DB tsx verified (1 course + 1 category w/ groupBy count). `listCourseCategoriesHandler` branched. |
| Phase 3 — `catalog-video` | 🟡 | 2026-06-11 | Code complete, **flag OFF** (id coupling; lecture needs Mongo-only VideoCategory.courseId + commerce subs). `Video` model CLEAN. **URL-encryption parity PASS** (fixed-token MySQL===Mongo, decrypt===aws_id). D2: relation tables deferred. Live-DB tsx verified (152 active cats, 5 vids/cat 3105). |
| Phase 3a — `commerce-price` | 🟡 | 2026-06-12 | Code complete, **flag OFF** (read-only plan lookup; consumers join int catalog + ObjectId subscription/order rows). `PackageCourseEbookPrice` model CLEAN (1:1, no schema fix). **DRIFT handled:** owner ids use `0` sentinel (not only NULL) → coalesced to null; exactly-one-owner invariant verified; `duration`=DAYS ('12 Month'→365); material_price null→0. Live-DB tsx verified (1353 rows; findById/byIds/by-owner active lists duration-asc). api-test wired (`yarn migration:api:commerce-price`). |
| Phase 3a — `commerce-subscription` (READ) | 🟡 | 2026-06-12 | Code complete, **flag OFF**, **read-only** (entitlement source of truth; writes are 3b). **SCHEMA FIX:** `tracking` is bigint (~1.19e11, both rows overflow Int32) — Prisma `trackingId Int?→BigInt?` + tracking-table `id Int→BigInt`; without it **reads throw**. Transformer coerces bigint→number (lossless). **Name map:** SQL `package_id`→Mongo `targetPackageId`, SQL `pcb_id`→Mongo `packageId`. C3: `customer_id` int (migrated id-space). Live-DB tsx verified (2 rows; read no-throw, active/expired boundary, name mapping, count). api-test wired (`yarn migration:api:commerce-subscription`). |
| Phase 3a — `commerce-ebook-sub` (READ) | 🟡 | 2026-06-12 | Code complete, **flag OFF**, **read-only** (ebook entitlement source of truth; writes are 3b). **SCHEMA FIX:** Prisma model was MISSING `status` (entitlement flag) + `payment_type` — added; `start_at`/`end_at` `DateTime`→`DateTime?` (DDL nullable). Active = status≠false (NULL=active) && end_at>now, latest endAt wins. C3: `customer_id` int. Live-DB tsx verified (1 row; status/payment_type read, active/expired boundary, byOrder, count). api-test wired (`yarn migration:api:commerce-ebook-sub`). |
| Phase 3a — `commerce-promoter` (READ) | 🟡 | 2026-06-12 | Code complete, **flag OFF**, **read-only** (promocode owner master, 114). **SECURITY:** `password` on the row but NEVER surfaced (Mongo select:false). **SCHEMA FIX:** full_name/email/phone `String`→`String?` (DDL nullable). camelCase (fullName/isDelete); active = status&&!isDelete. Live-DB tsx verified. api-test wired (`yarn migration:api:commerce-promoter`). |
| Phase 3a — `commerce-promocode` (READ) | 🟡 | 2026-06-12 | Code complete, **flag OFF**, **SQL-faithful** (`ws_promocode` 2 + `ws_promoted_package_course_ebook` 5). **⚠ Cannot serve client applyPromocode** — Mongo uses appliesTo/discountValue; SQL uses per-plan promoter%/customer% split → SQL-faithful reads only (user decision). **SCHEMA FIX:** promocode/promo_start_at/promo_expire_at →nullable. Valid = status && start<now<expire; promoted plans on detail read. Live-DB tsx verified (POLICE60→5 plans, window-bounded code lookup). api-test wired (`yarn migration:api:commerce-promocode`). |
| Phase 3a — `commerce-educator` (READ) | 🟡 | 2026-06-12 | Code complete, **flag OFF**, **read-only** (full-entity educator master, 56). **FINAL 3a read module.** **SECURITY:** `password` (NOT NULL) on the row but NEVER surfaced (single/list/ref). **⚠ LATENT:** `id` is `bigint unsigned` mapped `Int` — ids 20–85, no overflow; NOT changed (would ripple into Course FK + catalog-course). `image` nullable; no SQL `deleted` flag → active=status. Ref projection `{_id,name,image}`. Live-DB tsx verified. api-test wired (`yarn migration:api:commerce-educator`). |
| **✅ PHASE 3a READS COMPLETE** — next is THE FLIP (3a + catalog + address/profile/bank ON together; first go-live since customer module), then 3b write-path | ⬜ | — | — |
| Wiring — Offline center/batch (`offline-batch`) | 🟡 | 2026-06-12 | **5th wired vertical (reads).** `GET /client/offline/{centers,batches}(/:id)` from `ws_offline_center`+`ws_offline_batch` (+city). **2 schema fixes:** phone Int→BigInt (9099665555 overflows; →string), removed phantom `status` (no SQL col on batch/center → all active). image JSON→images[]; `discription`→`description`. Dashboard stays Mongo (banner); enquiry is a write (deferred). Wired behind `isOfflineBatchMysql()`. Live-DB tsx verified (read no-throw on phone, JSON images, relations, filters, dashboard grouping). HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:offline-batch`. |
| Catalog — Book store reads (`catalog-book`) | 🟡 | 2026-06-12 | **Data reads, flag OFF, NOT wired.** `ws_book` (10) catalogue + computed fields (isPaid, key, daysLeft=null, isNew). NOT wired (like catalog-package): listBooks/getBookDetail need cart+order state from unmigrated ws_book_order/cart (int-vs-ObjectId) → flips with the book-order wave. **Schema fix:** order_by → nullable. Live-DB tsx verified (18 checks: computed fields, ordering, filters, search, bulk). api-test: `yarn migration:api:catalog-book`. |
| Wiring — Exam category nav (`catalog-exam`) | 🟡 | 2026-06-12 | **4th wired vertical (nav only).** `GET /client/exam-categories/:id/children` = `ws_exam_category` (children via SQL `parent_id` self-FK, active=status&&!deleted) + `ws_exam` (UNCONDITIONAL count). **Schema fix:** ExamCategory name/image → nullable. Display field `name` (DTO carries title+name). Wired behind `isExamMysql()`. Live-DB tsx verified (cat 86→13 children, deleted excluded, havingChildDirectory, unconditional count). HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:catalog-exam`. |
| Wiring — Material category nav (`catalog-material`) | 🟡 | 2026-06-12 | **3rd wired vertical (nav only).** `GET /client/material-categories/:id/children` = `ws_material_category` (children via SQL `parent` self-FK) + `ws_material` (per-child count). Clean Prisma (no schema fix). **Goal deferred** (Mongo-only, no SQL table). Item listing stays blocked (entitlement+LiveCourse+Mongo embeds). Wired behind `isMaterialMysql()`. Live-DB tsx verified (cat 270→child 1867, count/havingChildDirectory). HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:catalog-material`. |
| Wiring — eBook surface (`catalog-ebook`) | 🟡 | 2026-06-12 | **2nd wired vertical.** `GET /client/ebooks` + `/ebooks/:id` compose catalog-ebook (`ws_ebook`) + commerce-price (shared price table) + commerce-ebook-sub. No separate ebook-price module (no `ws_ebook_price` table). **Schema fix:** description/author → nullable. isPaid price-derived; isTrending false. Wired behind `isEbookMysql()` (before ObjectId guards). Live-DB tsx verified (19 checks: plans, isPaid, ordering, language filter, search, purchase-state). HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:catalog-ebook`. |
| Wiring — Course LISTING (`catalog-course` extended) | 🟡 | 2026-06-12 | **First commerce-consuming endpoint composed + wired (flag OFF).** `listCoursesWithPlans` = catalog-course + commerce-price (plans/material) + commerce-subscription (purchase state, lifetime-aware). **SCHEMA FIX:** `is_featured`/`purchase` enum('0','1') → Prisma `CourseFlag01` → Mongo `isPopular`/`isPaid`. Wired `listCoursesHandler` + `listCoursesByCategoryHandler` on `isCourseMysql()` (before ObjectId guards). Live-DB tsx verified (17 checks: enum→bool, plans buckets, refs, pagination, isPopular filter, search, purchase=false). HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:catalog`. |
| Wave 7 — new-table consumers (ebook-download, folder ON; notification, lecture-progress OFF) | ✅ | 2026-06-18 | **Wired the consumer modules for the 8 created tables.** ✅ `client-ebook-download` (flag ON) — src/modules/client-ebook-download branches all 4 handlers of ebook-downloads.controller.ts + countActiveEbookDownloads. Everything SQL at runtime (customer-auth int + catalog-ebook + commerce-ebook-sub; no content bridge needed). Live-DB tsx: hasActiveSub→recordDownload→listDownloads (ebook 'Super Six' hydrated)→count 1→idempotent re-record (still 1)→removeDownload→0. ✅ `client-folder` (flag ON) — src/modules/client-folder branches all 8 handlers ×2 types + ensureDefaultFolders + countSavedItems. Live-DB tsx: ensureDefault (My Videos), create, dup-reject (✓), addItem + dedup, detail with CONTENT HYDRATION (real ws_video refId 33089 → 'Lecture 37 …'), countSavedItems 1, removeFolder. KEY FINDING: runtime refId is a genuine SQL int → refId→ws_video/ws_material join RESOLVES (the 'Mongo content≠SQL' worry only affected the backfill which stored 0). ⏸️ `client-notification` (FLAG OFF, code-complete) — src/modules/client-notification branches list/markRead/markAll + profile unread count. Reads verified vs live DB (10 visible broadcasts, visibility = customer OR broadcast, unread same filter, markRead resolves). OFF because the WRITE path is a Mongo subsystem (admin dispatcher + scheduler/BullMQ job keyed by Mongo _id + FCM fan-out + per-recipient insertMany keyed by Mongo Customer ObjectIds) — flip reads alone = stale feed. ⏸️ `client-lecture-progress` (FLAG OFF, code-complete) — src/modules/client-lecture-progress: upsertVideoProgress / upsertLiveSessionProgress (per (customer,video)/(customer,liveSession), additive container pointers, sticky completed) + rollupByContainer + completedCountInContainer + completedLectureCount. OFF because it's a 14-file content-join hub: the heartbeat is preceded by Mongo entitlement/reachability validation + resume/learning reads join Video/Course/Package/LiveSession across many files — heartbeat + reads must flip together. profile getProfileDashboardCounts: folder/ebook/notification counts now flag-aware; guarded `new ObjectId(userId)` (would throw on numeric SQL id under customer-auth — pre-existing latent bug); subscription + pastExams counts still Mongo (need own flip — don't function under SQL-auth today). `tsc` clean. |
| Wave 7 — `test-series-order` + 8 net-new tables | ✅ | 2026-06-18 | **Created the 8 previously-blocked SQL tables + migrated test-series fully + webhook book/ebook. flag `test-series-order` ON.** DDL (2026-06-18_create_wave7_blocked_tables.sql, run on live staging): ws_lecture_progress, ws_notification, ws_folder, ws_folder_item, ws_ebook_download, ws_test_series, ws_test_series_price, ws_test_series_order, ws_test_series_subscription + ws_book_order.paid_at. 9 Prisma models appended (INT PK, scalar FKs, JSON for exam_category_ids/audience/data) + BookOrder.paidAt; `prisma generate` OK; all 9 round-trip-verified via tsx (write/update/delete, unique indexes, Decimal, JSON). Backfill `backfill-wave7-blocked-to-sql.ts`: customer phone-bridge (Mongo ObjectId→ws_customers.phone→ws_customer.id) + test-series intra-family id maps. Staging: notification 22/24 (2 unbridged), test_series 2/2, test_series_price 3/3; lecture_progress 15/folders 8/folder_items 7/downloads 2/ts subs+orders mostly skipped (customer not in SQL dump — same Wave-6 artifact; production bridges far better); content refs (video/ebook/course/refId) stored 0/null (no Mongo→SQL bridge). ✅ TEST-SERIES vertical (test-series-order module): applyTestSeriesPromo + createTestSeriesOrderPayment (numeric planId schema, computeBreakdown reused) + verify.controller test-series branch (fold-or-fresh, dual-read) + my-subscriptions test_series tab (now SQL — was empty for SQL-auth customers) + webhook fulfillment. Live-DB tsx end-to-end: plan 1 (series 1, 60d, ₹399) → create order → verify fresh grant (sub 1, start 2026-06-18 → end 2026-08-17 = +60 DAYS ✓, price 476) → idempotent re-verify (same sub) → my-subs card ('Online Mock Test 2026', kind test_series, daysLeft 60) → 2nd purchase webhook fold (sub 1, end → 2026-10-16, price 476→952 ✓). ✅ WEBHOOK book + ebook: fulfillBookWebhookMysql (razorpayOrderId-only; AWB allocated SQL-side in verifyBookOrderMysql txn — no Mongo Counter) + fulfillEbookWebhookMysql; branched webhook.controller.ts (SQL-first, dual-read). `tsc` clean. ⏸️ lecture-progress/notification/folder/ebook-download: tables+Prisma+backfill DONE + production-ready, consumers stay Mongo (content-join hub w/ unbridged refs; Mongo dispatcher/FCM/BullMQ write path; polymorphic/unbridged refIds) — flipping reads alone = split-brain/stale-feed. |
| Wave 7 — `package-order` + webhook-ebook (payment) | ✅ | 2026-06-18 | **Package payment + webhook ebook fulfillment on SQL. flags ON (package-order new; ebook-order already on).** PACKAGE create-order + verify added to existing `commerce-order` module (same tables/repo/transformer as course — no new module): findPackagePlanForOrder/createPackageOrderMysql/findPackageOrderForVerify/verifyPackageOrderMysql (service) + findActivePackageSub/verifyPackageTx (repo). Toggled by SEPARATE `package-order` flag. Branched package-payment.controller.ts createPackageOrderPayment (numeric planId schema, customerShippingId validated vs Mongo, promo re-validated) + verify.controller.ts (package branch after course, dual-read). 3-table pattern (pending ws_package_course_order → sub+tracking at verify, one tx). ⚠ plan must be PACKAGE plan (packageId set, courseId null); fulfilled sub sets package_id with course_id NULL (Mongo targetPackageId set, courseId unset); DAYS duration; PackageCourseOrder.customer_id is `userId Int` (not varchar — earlier spec wrong). WEBHOOK ebook: fulfillEbookWebhookMysql added to ebook-order (keyed by razorpayOrderId ALONE — webhook has no customer) + findOrderByRazorpayOnly repo method; branched webhook.controller.ts paymentWebhook ebook section (SQL-first, dual-read); reuses verifyEbookOrderMysql (idempotent). Live-DB tsx end-to-end — PACKAGE: plan 102 (pkg 4, ₹6500, 180d) → create pending order 526145 → verify fresh grant (sub _id 15, targetPackageId 4, courseId null ✓, plan(pcb) 102, verified, start 2026-06-18 → end 2026-12-15 = +180 DAYS ✓) → idempotent re-verify (same sub 15) → 2nd purchase folded onto sub 15 (end → 2027-06-13, sub.amount column accumulated 6500→13000 ✓). EBOOK WEBHOOK: pending order → fulfill (order→complete, sub created ebookId 2, +180d → 2026-12-15) → idempotent re-fulfill (still 1 sub) → unknown order id → null. `tsc` clean. ⏸️ Still deferred (blocks): test-series payment (no ws_test_series* table), webhook book branch (needs paidAt/tracking/Counter schema), recordingWebhook (Json recordings + socket), profile getProfileDashboardCounts (5/7 counts no SQL table), client/dashboard (no clean slice). |
| Wave 7 — `live-course-order` (payment create+verify+webhook) | ✅ | 2026-06-18 | **Live-course payment write path on SQL. flag ON.** New `src/modules/live-course-order/`. Branches createLiveCourseOrderPayment (live-course-payment.controller.ts) + verifyPayment (verify.controller.ts) + paymentWebhook (webhook.controller.ts) on `live-course-order`. FIRST full payment-WRITE vertical on SQL. Single-table design: ws_live_course_subscription carries BOTH razorpay ids/payment_status AND start/end/status — no separate order table. createPending writes a pending row; verify/webhook flip to verified (fresh grant: start=now, end=now+durationDays) OR fold onto an existing active sub (extendEndAt DAYS, sum paid) + retire pending row (status=false, verified). ⚠ duration=DAYS (computeEndAt asDays:true — matches admin-live-course grant + Mongo controllers; the prisma schema 'MONTHS' comment is STALE). withMaterial/customerShippingId Mongo-only (no SQL column); promocodeId coerced to int; LiveCourse title still read from Mongo. Dual-read fallback in verify + webhook (SQL first, Mongo on miss). Live-DB tsx end-to-end (seed plan ₹1999/3d → create pending (status true, pending, endAt null, paid 1999) → findForVerify → verify fresh grant (verified, start 2026-06-18 → end 2026-06-21 = +3 DAYS ✓, payId set) → idempotent re-verify (no change) → 2nd create + webhook fulfill (folded onto sub id 13, end → 2026-06-24, paid 1999→3998 ✓, 2nd row retired status=false/verified) → cleanup). `tsc` clean. ⏸️ Deferred (analyzed): package-payment + webhook-ebook (doable batch next); BLOCKED: test-series payment (no ws_test_series* table), webhook book branch (needs paidAt/tracking/Counter schema), profile getProfileDashboardCounts (5/7 counts: Notification/FolderItem×2/EbookDownload no SQL table, PackageCourseSub no payment_status/targetPackageId, ExamResult no inProgress/submittedAt), recordingWebhook (Json recordings + socket). |
| Wave 7 — `client-orders` (listMyOrders) | ✅ | 2026-06-18 | **Client orders: listMyOrders on SQL. flag ON.** New `src/modules/client-orders/`. Branches listMyOrders in orders.controller.ts on `client-orders`. Read-aggregation: a customer's course/package subs + ebook subs + book orders (unfiltered, newest-first), matches Mongo `{ courseSubscriptions, ebookSubscriptions, bookOrders }`. No new tables. ⚠ Mongo populates courseId→{name,thumbnail}/packageId→price doc; SQL maps Course.image→thumbnail, resolves package_id directly, hydrates plan via planId (packageId field=plan DTO). ws_book_order: items from order_items JSON, AWB from tracking_id (BIGINT), customer keyed by user_id (→customer_id), withMaterial from pc_material_id. ⚠ STAYS Mongo: placeCourseOrder/placeEbookOrder/verifyPayment (payment-write path: Razorpay order+verify + subscription grant + PromoCode.appliesTo + ReferralProgram → payment wave). Live-DB tsx — cust 472341 → 1 package sub (plan 88/90d/₹7500/courseId null→packageId carries plan) + 4 book orders (items parsed, AWB 1194006930xx, verified/pending), cust 472335 → 1 course sub + 1 ebook ('test'/₹0) + 1 book order. `tsc` clean. ⏸️ client/dashboard analyzed & deferred: no clean slice (getResumeDashboard=10× LectureProgress; getDashboard=atomic Promise.all bundling ExamCountdown+Notification+Mongo-only trending helpers+banners/testimonials; getFreeDashboard=clean tables but raw-Mongo cross-controller helpers fetchTrendingBooksOnly/fetchTrendingEbooksOnly/resolveFreeCategoryIds). ws_notification/ws_exam_countdown/ws_lecture_progress don't exist; banner-slider+testimonial SQL modules do. |
| Wave 7 — `categories` (listVideoCategoryChildren) | ✅ | 2026-06-18 | **Client categories: video-category children-nav on SQL. (catalog-video flag, already ON.)** Wired listVideoCategoryChildren in categories.controller.ts onto getVideoCategoryChildren — completing the children-nav trio (material + exam children already migrated). Added to src/modules/catalog-video/: getVideoCategoryChildren (service) + findCategoryByIdAny (parent, no status gate) / listActiveChildren (children via `parent` self-FK + title contains) / parentsWithChildren (distinct-parent probe for havingChildDirectory). Shape { parent, list[].category{ ...VideoCategoryDto, count, havingChildDirectory } }, order_by-sorted. No new flag/tables. ⚠ Mongo childCategoryIds[] DAG → SQL `parent` FK (admin-master parity); root parent=0 sentinel (not a row) → null/404; parent fetched without status gate (matches Mongo findById). ⚠ REST of categories.controller STAYS Mongo: 4 examCountdown* (ExamCountdown/ExamCountdownCategory — no SQL table), listPackageCategories/listPackagesByCategory (PackageCategory — no SQL table), listVideosByCategory/getVideoByCategory (LectureProgress + encryption), listMaterialsByCategory (paid-material entitlement gating). Live-DB tsx — cat 295 'Old courses' → 18 children (matches raw active count), cat 8 'Clerk' → 3 (Junior/Senior/S Clerk), order-sorted with video counts + havingChildDirectory; missing parent (298 orphan ref / 99999999) → null/404; search filters subset. `tsc` clean. |
| Wave 7 — `client-my-subscriptions` (course + ebook tabs) | ✅ | 2026-06-18 | **Client my-subscriptions library on SQL. flag ON.** New `src/modules/client-my-subscriptions/`. Branches type=course (course+package) / type=ebook tabs of my-subscriptions.controller.ts on `client-my-subscriptions`. Active-only cards (status=true && endAt>now), deduped to furthest endAt per target, soonest-first, same Card envelope (title/author/thumbnail/badge/daysLeft/action.kind/meta). No new tables. ⚠ type=test_series STAYS Mongo (no ws_test_series* table; pre-existing: returns empty for SQL-auth customers since keyed by Mongo ObjectId). no payment_status→status=true; package_id=package (Mongo inverts pkg/target); course.author=null. Live-DB tsx — real endAt>now filter returns 0 (staging subs past-dated, correct); seeded future-dated pkg+ebook sub → course/pkg card (CCE, badge 'Recorded Course', kind package, 30d, pkgId 3), ebook card ('Super Six', kind ebook, 30d, ebookId 18); dedup+hydration+shape correct; seed cleaned. `tsc` clean. |
| Wave 7 — `admin-subscription` (reads + reports) | ✅ | 2026-06-18 | **Admin subscription reads + reports on SQL. flag ON.** New `src/modules/admin-subscription/`. Branches the read/report handlers of subscription.controller.ts on `admin-subscription`. 8 handlers: listCourseSubscriptions (filters + cross-table customer/course/package search) / getById / listPlansForTarget / listEbookSubscriptions + reportSummary / reportByCourse / reportByEbook / reportBookOrders (Prisma groupBy/aggregate). Read+report aggregation over migrated tables, no new tables. ⚠ ws_package_course_subscription has no payment_status/paid_amount/razorpay/target_package_id → package_id=package (Mongo inverts pkg/target → resolve directly), amount=paidAmount, payment_type~method, withMaterial from pc_material_id. ⚠ STAY Mongo: 3 subscription writes (Mongo-only fields + grant-extend → payment wave) + 2 address handlers (CustomerAddress OFF). Live-DB tsx — 2 course/pkg subs hydrated (Piyush/CCE/₹7800/withMat, Kishan/DySO/₹7500), plans-for-pkg (5), ebook subs (1), reportSummary (course 2/2, ebook 1/1, book 6 total/4 verified/₹905, totalRevenue 905), reportByEbook (ebook 45), reportBookOrders (verified:4/₹905, pending:2/₹460). `tsc` clean. |
| Wave 7 — `client-purchase-history` (aggregation) | ✅ | 2026-06-18 | **Client purchase-history 3 tabs on SQL. flag ON.** New `src/modules/client-purchase-history/`. Branches purchase-history.controller.ts on `client-purchase-history`. subscriptions/books/ebooks tabs — read-only compose of migrated tables (ws_package_course_subscription / ws_book_order / ws_ebook_order + course/package/type/book/ebook/price), no new tables. ⚠ no payment_status col → status=true; SQL package_id=package (Mongo inverts pkg/target → resolve directly); ws_ebook_order no ebook_id → plan→ebook hop; book items from order_items JSON; AWB-only tracking (no courier). Receipt path stays Mongo. Live-DB tsx — subscriptions (pkg 'DySO I STI I GPSC', badge 'Recorded Course', ₹7500, plan 1293/target 88), books (order + AWB 119400693001, 1 item), ebooks ('E-Book: test' via plan→ebook hop, author/ebookId 45). `tsc` clean. **Wave 7 START.** |
| Mongo-only Wave 5 — `admin-material` (categories + leaf materials) — **Wave 5 COMPLETE** | ✅ | 2026-06-18 | **Admin material both surfaces on SQL (LAST admin CRUD module). flag ON.** New `src/modules/admin-material/`. Branches material.controller.ts on `isAdminMaterialMysql()`. ~19 handlers: categories (list/tree/getById/create/update/delete/toggle/reorder/courses/materials) + leaf materials (list/get/create/update/delete/toggle/reorder/bulk-status/bulk-delete). Reuses ws_material_category + ws_material (+ ws_material_category_course); no DDL. ⚠ USER-APPROVED: ws_material_category single-parent only (parent 0=root) — ancestors[]/childCategoryIds[] DAG dropped (synthesized []); duplicateCategory STAYS Mongo (BFS clone needs ancestors[]). ws_material minimal — description/thumbnail/fileSize/fileMime/language/isPreview/isPaid/downloadCount dropped+synthesized; list language/isPreview filters no-op. Numeric ids (parseMaterialId). Live-DB tsx — 5 categories (list + tree=4 roots w/ nesting + getById parent→string/root→null), category CRUD (create root+child, update slug-regen, toggle, reorder, delete blocked when has-children → succeeds after child deleted), category→courses/→materials sub-resources, 226 materials (list w/ category populated, getById synthesized fields), material CRUD + toggle + reorder + bulkStatus + bulkDelete. `tsc` clean. **→ Wave 5 catalog CRUD DONE: plan/master/video/videoCategory/book/ebook/course/package/material + client cart/educator all on SQL.** |
| Mongo-only Wave 5 — `admin-package` (CRUD + types + plans + relations) | ✅ | 2026-06-18 | **Admin package full surface on SQL (large module). flag ON.** New `src/modules/admin-package/`. Branches package.service.ts on `isAdminPackageMysql()`. ~22 handlers: types CRUD + packages CRUD/status/reorder + embedded reorders + plans (attach/list/detach) + subscribers + video-relations (set + BFS expand). Mongo embedded specificSubjects[]/materialCategories[]/examCategories[] → SQL pivots ws_package_specific_subject / ws_material_category_package / ws_exam_category_package (create in-txn, update replaces; getPackageById populates subject→{_id,title,image}/material+exam→{_id,title(=name),image}). Reuses ws_package + ws_package_type + pivots + price + subscription + ws_video_category_package_relation. Schema: +nullable educator_id on Package (DB col existed, unmapped). ⚠ ws_package MISSING cols (isPaid/smart/planner/subtitle/notificationTopic/packageCategoryId/goalId/goalLabelId/examCountdown*) → synthesized + dropped; package_type_id NOT NULL→1, exam_id NOT NULL→0; with_material/without_material = descriptive text. STAY Mongo: listPromotedCodes (PromoCode.appliesTo no SQL linkage), listBooks (Book.packageIds no SQL col); chat already on SQL (package-chat). Live-DB tsx — 6 types, 5 packages (list w/ plan buckets, getById CCE 55 subj/2 mat/35 exam embeds populated; subjectId 121→'Environment - Jay Dobariya'), type CRUD, package create+embeds→update replace-embeds→toggle→reorder→delete cascade, plan attach/list/detach (soft), 1 subscriber (Piyush/CCE), setVideoRelations 2 + BFS expand=94. `tsc` clean. |
| Mongo-only Wave 5 — `admin-course` (CRUD + plans + masters) | ✅ | 2026-06-18 | **Admin course full surface on SQL (largest module). flag ON.** New `src/modules/admin-course/`. Branches course.service.ts (thin controllers) + course.controller.ts create/update on `isAdminCourseMysql()`. ~24 handlers: course CRUD/popular + plans (single-default) + materials (pc-material) + video-categories + vcat-relations + pre-requisites. Mongo embedded materialCategories[]/examCategories[] → SQL pivots ws_material_category_course / ws_exam_category_course (create in-txn, update replaces; getCourseById populates material→{_id,title,image}/exam→{_id,name,image}). Reuses ws_course + price + pivots + ws_video_category(_relation) + pc-material; no DDL. is_featured/purchase enums→isPopular/isPaid; with_material/level VARCHAR; course_category_id/educator_id 0 sentinel. ⚠ USER-APPROVED: ws_video_category has NO course_id → createCourse Root-folder skipped (folder=null), course video-cats use global table (courseId dropped), deleteCourse skips courseId folder/relation cleanup (counts 0). SQL numeric-id validation (createCourseSqlSchema + ref parser). Live-DB tsx — pre-reqs (55 edu/1 subj/152 vcat/1 mat), 1 course list+get (5 plans, both pivots populated: matcat 270/examcat 16), create+pivots, update replace-pivots→empty + popular flip, plan create×2 default→single-default invariant (defaults=1), plan update/delete, delete course cascade (4 plans), vcats 152/relations 2456/materials lists. `tsc` clean. |
| Mongo-only Wave 5 — `admin-ebook` (CRUD + plans + subs) | ✅ | 2026-06-18 | **Admin ebook 3 surfaces on SQL. flag ON.** New `src/modules/admin-ebook/`. Branches ebook.service.ts (thin controllers) + ebook-subscription.controller.ts on `isAdminEbookMysql()`. 17 handlers: ebooks (list/get+plans/create/update/delete-cascade/reorder), plans (list/create/get/update/delete + prices-for-sub, ebook-owned ws_package_course_ebook_price), subs (list+search/get/create-backend-grant/update-verify-or-toggle/delete). Reuses ws_ebook + price + ws_ebook_subscription + ws_ebook_order; no DDL. ⚠ ws_ebook MISSING cols (isTrending/PDF-upload-status/examCountdown*) → synthesized + NOT-NULL "" sentinels. STAY Mongo: toggleEbookTrending, BullMQ PDF-upload pipeline, updateEbook S3 cleanup. ⚠ ws_ebook_order.plan_id NOT NULL → 0 sentinel; customer_id varchar (Prisma Int casts); SQL numeric-id validation. Live-DB tsx — 2 ebooks (create→update→reorder→delete cascade), plan CRUD + active-only prices filter (inactive→dropped), 1 sub (list w/ customer/ebook/plan/order + get), backend grant durationInDays=30→endAt+30d AND planId→90d, toggle (status false+remarks), delete sub + order + ebook cleanup. `tsc` clean. |
| Mongo-only Wave 5 — `admin-book` (CRUD + order reads) | ✅ | 2026-06-18 | **Admin book CRUD + order reads on SQL. flag ON.** New `src/modules/admin-book/`. 9 handlers (books list/get/create/update/delete/toggleStatus/reorder + orders list/get) on `isAdminBookMysql()`. Reuses ws_book + ws_book_order(_item) + ws_customer_shipping; no DDL. ⚠ ws_book MISSING cols (isTrending/publication/deliveryEta/termsAndConditions/demoFileName/bookFileName/bookUrl/examCountdown*/packageIds) → DTO synthesizes (mirrors catalog-book), write drops them; NOT-NULL no-default cols get sentinels. **STAY Mongo:** toggleBookTrending (no col), getBookById countdown populates (no SQL ExamCountdown), updateOrderStatus/setOrderTracking/addOrderTrackingEvent (embedded tracking.history[]; ws_book_tracking 1 flat varchar(10) row), getSettings/updateSettings (NO ws_book_setting table). Order items hydrate from order_items JSON snapshot (child table near-empty); book-name search = child rows + raw order_items LIKE. Live-DB tsx — 10 books (list/search 'culture'/filters/get + create→update→toggle→reorder→delete lifecycle), 6 orders (list w/ customer(full_name split)+shipping+items hydrated from JSON, get-by-id, status filter, customer 'Piyush' + book 'Science' search). `tsc` clean. |
| Mongo-only Wave 5 — `videoCategory` full (CRUD) | ✅ | 2026-06-17 | **Full admin videoCategory on SQL (extends admin-master). flag ON.** list/prereqs/get/create/update/toggle/delete + courses-list + videos-list. ⚠ childCategoryIds[] DAG → single `parent` FK (children derived, not writable); `duplicate` stays Mongo. Live-DB tsx — 157 cats, 55 educators, relation lists (cat 2926→6 videos), create/slug-dupe/update(educator)/toggle/delete + cleanup. `tsc` clean. |
| Mongo-only Wave 5 — `admin-video` (CRUD) | ✅ | 2026-06-17 | **Admin video CRUD on SQL. flag ON.** New `src/modules/admin-video/`. All 8 handlers (list/prereqs/get/create/update/delete/toggle/reorder). ws_video; platform youtube|vimeo|aws + matching *_id; slug auto-uniquify; category-exists check; prereqs has_children via parent FK. Live-DB tsx — 156 videos; create (aws), slug uniquify (zz-vid→zz-vid-2), update aws→youtube (clears awsId), toggle, reorder (→99), delete + cleanup. `tsc` clean. |
| Mongo-only Wave 5 — `admin-master` (sub-catalog CRUD) | ✅ | 2026-06-17 | **pc-material + master/material/subjectCategory/videoCategory on SQL. flag ON.** New `src/modules/admin-master/`. pc-material + master/material share ws_package_course_material (title-only). VideoCategory list resolves children via parent FK. Schema: added parent/educator_id/pdf to VideoCategory model (NOT NULL→coerce 0/""). master/packageCategory Mongo-only (no SQL table). Live-DB tsx — all 4 CRUD lifecycles (create/update/delete) + vc children resolution + cleanup. `tsc` clean. |
| Mongo-only Wave 5 — `admin-plan` (CRUD) | ✅ | 2026-06-17 | **Admin plan CRUD on SQL. flag ON.** New `src/modules/admin-plan/`. All 10 handlers (list/get/create/update/delete/toggle/markAsDefault/bulkStatus/bulkDelete/clone). ws_package_course_ebook_price; single-default-per-entity enforced; owner-id 0-or-null sentinel; delete blocked if subscribers + cascades promoted. Live-DB tsx — 1353 plans; create×2 default both → first flips false (invariant), update price/material, markDefault flips sibling, toggle, clone (default forced false), bulkDelete 3 + cleanup. `tsc` clean. |
| Mongo-only Wave 5 — `client-educator` | ✅ | 2026-06-17 | **Client educator detail on SQL. flag ON.** New `src/modules/client-educator/`. Wired getEducatorWithCoursesHandler (educator + active courses + plans split with/withoutMaterial + per-course daysLeft + view bump). Composes ws_course_educator/ws_course/commerce-price/commerce-subscription. Live-DB tsx — educator 20 (Priyanka Soni), 1 course, 5 plans, share link. `tsc` clean. ⚠ client material + search stay Mongo (LiveCourse + entitlement embeds). |
| Mongo-only Wave 4 — `admin-exam` (reads) | ✅ | 2026-06-17 | **Admin exam reads on SQL. flag ON.** New `src/modules/admin-exam/`. Wired getExams/getExamById/getQuestions/getQuestionById/getExamSubmissions/getExamAnalytics/getResultById/getCustomerAnalytics + invalidateResult. getExamAnalytics = raw SQL overall + per-question aggregates (qresult_*). Admin sees answer. Live-DB tsx — 1 exam w/ category, question+answer+5 opts, submission (Sanjay/score 1), analytics (1 candidate/100% accuracy)+per-question, result detail, customer-analytics null. `tsc` clean. Deferred: admin exam/question CRUD + getSolutionDownload PDF. **Wave 4 fully done.** |
| Mongo-only Wave 5 — `client-cart` | ✅ | 2026-06-17 | **Client book-cart on SQL. flag ON.** New `src/modules/client-cart/`. Wired add/update/remove/attach-shipping/get. Mongo items[] → ws_book_cart + ws_book_cart_item; cart_id varchar generated; shipping via ws_customer_shipping + offline-city. Live-DB tsx — add (new line) → add 2nd → add same (increments) → getCart (items/itemCount/totals) → updateQty → remove. Test cart cleaned. `tsc` clean. ⚠ wishlist/folder/notes/free-progress remain Mongo-only (no SQL tables). |
| Mongo-only Wave 4 — `client-exam` (scoring write) | ✅ | 2026-06-17 | **saveAnswers scoring WRITE + solution/daily reads on SQL.** Wired saveAnswers (ws_exam_result + ws_exam_result_detail + analytics recompute + rank), getSolutionByExam, getSolutionAnalyticsByExam, getDailyExams drill-down. SQL-side numeric-id validation. Live-DB tsx — correct→score +1 (1/1, rank 1/2), wrong→−1, 2 result + 2 detail rows, analytics rollup (exams=1,success=1,score=0), solution marks correct option. Test rows rolled back. getSolutionDownloadByExam PDF stays Mongo. `tsc` clean. **CLIENT exam done; admin exam reads pending.** |
| Mongo-only Wave 4 — `client-exam` (reads) | ✅ | 2026-06-17 | **Client exam READS on SQL. flag ON.** New `src/modules/client-exam/` (read-only). Wired listExamsByCategory / getExamQuestions (answer NOT leaked) / listMyResults. Built (not wired) solution reads + getDailyExams drill-down. Schema fix: Exam.description→nullable. ⚠ Test Series + ExamCountdown MONGO-ONLY (no SQL tables). Live-DB tsx — 1 exam/1 q/5 opts, answer-not-leaked confirmed, isCompleted deco, results 1/1, daily years. `tsc` clean. **Admin reads + saveAnswers write pending.** |
| Mongo-only Wave 3 — `admin-rbac` (roles/permissions) | ✅ | 2026-06-17 | **RBAC management on SQL. flag ON.** New `src/modules/admin-rbac/`. Role controller (7 handlers) + permission service (7 ops) on ws_roles/ws_permissions/ws_role_has_permissions. Prisma: +created_at/updated_at + new AdminRoleHasPermission pivot. Role mutations write pivot directly (guard-validated $transaction); deleteRole cascades pivot. `category` derived from name prefix. permissionCategory CRUD stays Mongo (no SQL table). Live-DB tsx — 29 roles, 108 perms, tree (30 cats), assigned/unassigned, create→sync→delete lifecycle + pivot cascade verified. Orphan rows cleaned. `tsc` clean. |
| Mongo-only Wave 2 — `referral` admin | ✅ | 2026-06-17 | **Admin referral on SQL. flag ON (shared `referral`).** Branched `src/admin/referral/referral.service.ts`: program CRUD, txn list (w/ customer), updateWithdrawalStatus, rejectWithdrawal+refund, withdrawalsReport + CSV (raw SQL JSON_EXTRACT), adjustCustomerRewards, listReferrers rollup (GROUP BY/HAVING). Admin FAQ/Term CRUD stays Mongo (no SQL tables). Live-DB tsx — program create/update/delete + name-exists; adjustRewards credit→successful txn (0→50); txn list w/ customer; referrers rollup; report+CSV. Cleaned + restored. `tsc` clean. listReferrers total approximated. **Wave 2 fully done.** |
| Mongo-only Wave 2 — `referral` client + webhook | ✅ | 2026-06-17 | **Referral client surface + payout webhook on SQL. flag ON.** New `src/modules/referral/`. rewards overview/transactions/generate-code/withdrawal + getReferralStatus + RazorpayX payout webhook. DDL: `ws_refferal_transaction` +provider_ref +failure_reason + `failed` enum. getTerms/getFaqs stay Mongo (no SQL tables). Live-DB tsx — withdrawal debit (1000→400), webhook success→successful + idempotent replay (already), 2nd withdrawal fail→refund (→400)+failed+reason, txn list. Test rows cleaned + customer restored. `tsc` clean. **Admin referral service pending.** |
| Mongo-only Wave 1 — `promoter-auth` (ws_promoter) | ✅ | 2026-06-17 | **Promoter login on SQL. flag ON.** login/refresh/logout/profile/change-pw. New `ws_promoter_access_tokens` (DDL ADD). Extended Prisma Promoter (password + last_seen_at). `verifyPromoterPassword` bcrypt+MD5 (only 1/114 promoters has a pw). No last_login_* cols → touchLogin = last_seen_at. Live-DB tsx: dual-hash verify, login lookup, DTO, token round-trip, profile. `tsc` clean. |
| Mongo-only Wave 1 — `promoter-data` (analytics) | ✅ | 2026-06-17 | **Promoter customers/subscriptions/dashboard/promocode on SQL. flag ON.** Shared `src/modules/promoter-data/`. ⚠ Attribution via `ws_*_order.promocode` JSON snapshot (`$.promoterId` + promoterPercentage) joined `order.id = subscription.order_id` — raw SQL JSON_EXTRACT + DATE_FORMAT. revenue=amount/price; commission=amount*pct/100. promocode appliesTo→empty (SQL-faithful); overview promocodeId scope ignored on SQL. Live-DB tsx — promoter 130: 2 subs, ₹15,300, commission ₹765, 2 customers; report byCourse/byMonth; overview buckets; promocode usage. `tsc` clean. |
| Admin/Educator — `admin-auth` (ws_users) | ✅ | 2026-06-17 | **Admin login + administrator CRUD on SQL. flag ON.** Login authenticates against `ws_users` (Laravel `$2y$` bcrypt verifies as-is); roles/permissions from spatie pivots (`ws_model_has_roles`→`ws_roles`, model_type `App\Models\User`); `role` derived from names. New `ws_admin_access_tokens` table (DDL ADD) + Prisma models; `status`/`is_dark` enum('0','1')→Prisma enums; no `deleted` col → delete=status='0'+revoke. Administrator CRUD list/get/create/update/delete/toggle/pre-requisites. Live-DB tsx (lifecycle, pivot role resolution, token round-trip, $2y verify) + **live HTTP login** (it@websankul.com → role=super_admin after granting Super Admin role). `tsc` clean. |
| Admin/Educator — `customer-admin-crud` (ws_customer) | ✅ | 2026-06-17 | **Admin customer CRUD on SQL. flag ON (via `customer-auth`).** `/admin/customers` list/get/create/update/delete/toggle + pre-requisites/districts. `full_name` compose/split; state/district NOT NULL → 0 sentinel; numeric FK ids (validation relaxed); subscription/order/address aggregates return empty (models unmigrated). Live-DB tsx (27 customers, full lifecycle, uniqueness, soft delete). `tsc` clean. |
| Admin/Educator — `educator-auth` (ws_course_educator) | ✅ | 2026-06-17 | **Educator login + admin educator master CRUD on SQL. flag ON.** ⚠ **MIXED hashes**: 40 MD5 / 16 bcrypt → `verifyEducatorPassword` (bcrypt then md5). New `ws_educator_access_tokens` (DDL ADD). Admin `/admin/master/educators` list (+**`id` sort tiebreaker**, 37/56 NULL updated_at)/create/update/delete/details; no `deleted` col → delete=status false+revoke; password optional→"". Image-clear PUT accepts `image:null` (additive). Live-DB tsx (dual-hash verify, token round-trip, 56-row list, CRUD) + **live HTTP** (56 educators, 6 pages, sorted, drift-free). `tsc` clean. |
| Flip — `customer-profile` + `customer-bank-account` | ✅ | 2026-06-17 | **Flipped ON** (were code-complete flag OFF). Live-DB tsx verified before flip (profile getProfile → hydrated DTO + goals; bank-account list). `customer-address` held OFF (offline-city dep). |
| Phase 3b WRITE — `package-chat` (announcement chat) | 🟡 | 2026-06-13 | **LAST 3b write path (READ+WRITE). ⚠ FIRST SCHEMA ADD. flag OFF.** Client read (subscription-gated) + admin write/delete wired behind `isPackageChatMysql()`. **SCHEMA:** ws_package_chat was a stub → EXTENDED (media_url/media_type/sender_type/sender_id/push_sent) to match Mongo PackageChat (see schema-changes/2026-06-13_extend_ws_package_chat.sql); Prisma `chat`→`PackageChat`+enums, regenerated. message↔text (NOT NULL→"" media-only); sender_id VARCHAR (admin ObjectId); list `id desc` tiebreak; read gates via commerce-subscription (int ids). Live-DB tsx **21/21** (existence, post text/media/system, paginated newest-first, delete, mapping); staging restored to 0; `tsc` clean. HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:package-chat`. **3b write cluster COMPLETE.** |
| Phase 3b WRITE — `offline-enquiry` (lead capture) | 🟡 | 2026-06-13 | **Small single-table write. flag OFF.** Wired `POST /client/offline/enquiry` behind `isOfflineEnquiryMysql()` (anonymous-allowed). No schema change. **DRIFT:** mobile BIGINT (string↔BigInt, overflow-safe); anon vs NOT NULL customer_id → 0 sentinel (DTO 0→null); no remarks col (dropped); batch_id INT (existence via offline-batch, before ObjectId parse). Live-DB tsx **10/10** (batch guard, authed + anon writes, BigInt round-trip, cleanup); staging restored to 4; `tsc` clean. HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:offline-enquiry`. |
| Wiring — Book listing + detail (`catalog-book`) | 🟡 | 2026-06-13 | **catalog-book WIRED (unblocked by book-order). flag OFF.** `GET /client/books` + `/books/:id` branch on `isBookMysql()`. catalog-book supplies book DATA + computed fields; the controller composes per-customer cart qty/cartId (ws_book_cart*) + isPurchased (ws_book_order* by verified/shipped/delivered) via NEW book-order read helpers (getActiveCartState / getPurchasedBookIdSet). Was blocked on those tables being Mongo-only — now migrated. C3 coercion; detail branches before the ObjectId guard. Live-DB tsx **12/12** (data + computed fields, real active cart merge, isPurchased proven by seed+cleanup, detail composition true/false). HTTP run pending flip + `yarn dev`. api-test: `yarn migration:api:catalog-book`. |
| Phase 3b WRITE — `book-order` (book cart checkout) | 🟡 | 2026-06-13 | **THIRD write path — different shape (5 tables, line items, courier AWB). flag OFF.** Scoped in BOOK_ORDER_SCOPE.md. Wired `POST /client/payment/create-order` (book cart) + verify book branch behind `isBookOrderMysql()`. **⚠ SCHEMA FIX:** tracking_id BIGINT (AWB, overflow Int32) Int→BigInt on BookTracking + BookOrder; regenerated. create-order (2-phase): preview cart → Razorpay → txn writes order + item rows (+ JSON blob, free-shipping=500 from ws_termsandcondition). verify: txn inserts ws_book_tracking (bigint AUTO_INCREMENT = AWB) → order→verified + tracking_id → cart status=0 (cart_item kept). customer_id INT. Tracking history synthesized in DTO (SQL lacks cols); varchar(10) status → 'verified'. Dual-read fallback. **Unblocks catalog-book wiring.** Live-DB tsx **25/25** (create+items, AWB + BigInt no-overflow + tracking FK + cart off + history, idempotent no-2nd-AWB); created rows cleaned up (staging 6/1/2/2/3 restored); `tsc` clean. HTTP run pending flip + `yarn dev`. **Go-live needs separate sign-off.** |
| Phase 3b WRITE — `ebook-order` (ebook purchase) | 🟡 | 2026-06-13 | **SECOND write path (rides commerce-order). flag OFF.** Wired `POST /client/payment/create-order/ebook` (writes `ws_ebook_order` pending, unique_id=receipt) + the ebook branch of `POST /client/payment/verify` (ONE `$transaction`: order→complete + extend-or-create `ws_ebook_subscription`) behind `isEbookOrderMysql()`. **DRIFT (no schema change):** customer_id VARCHAR/INT split (C3); NO ebook_id on order table → re-derived from plan; status enum strings identical (no translation); order_price=paid; duration=DAYS. ONE-DOC→TWO-TABLES (no tracking). **Upsert-extend** (repoint sub at latest order) + idempotent re-verify. **Dual-read fallback** in verify. Live-DB tsx **28/28** (round-trip, owner-lookup miss→null, fresh grant 180d, ebook_id re-derive, idempotency, upsert-extend); created rows cleaned up (staging 2/1 restored); `tsc` clean. HTTP run pending flip + `yarn dev`. **Go-live needs separate sign-off.** |
| Phase 3b WRITE — `commerce-order` (course purchase) | 🟡 | 2026-06-13 | **FIRST write path. flag OFF.** Wired `POST /client/payment/create-order/course` (writes `ws_package_course_order` pending) + the course branch of `POST /client/payment/verify` (ONE `$transaction`: order→complete + extend-or-create `ws_package_course_subscription` + `_subscription_tracking`) behind `isCommerceOrderMysql()`. **DRIFT (no schema change):** customer_id VARCHAR(order)/INT(sub) split (C3 coercion); tracking + tracking.id BIGINT→number; tracking.order FKs order.id; order.status enum↔paymentStatus; duration=DAYS. **Upsert-extend** + idempotent re-verify reproduced. **Dual-read fallback** in verify (MySQL first, Mongo on miss) = rollback safety. Live-DB tsx **28/28** (round-trip, owner-lookup miss→null, fresh grant, idempotency, upsert-extend +90d, BigInt, tracking FK); created rows cleaned up (staging restored 3/2/3); `tsc` clean. HTTP run pending flip + `yarn dev`. **Go-live needs separate sign-off.** |

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

### 2026-06-10 — Customer Module completion (lookups, address, profile, bank-account)

Built the **remaining Customer Module** sub-modules. One enabled, three code-complete with flags OFF (each gated by a non-customer dependency, not by unbuilt code).

- **`customer-lookups`** ✅ **enabled.** Wired `getStates`/`getEducations`/`getCharacteristic` (in `address.controller.ts`) to the previously-dead `customer-lookups.service`. Live-DB data path verified: **12 active states / 10 active educations**, exact DTO shapes (`{_id,name,stateCode}` / `{_id,name}`), no `active`/`status` leak. API test authored + wired (`yarn migration:api:customer-lookups`); HTTP run pending a live `yarn dev` (not bootable here — partial `node_modules`).
- **`customer-address`** 🟡 **flag OFF** — `cityId` → OfflineCity (Mongo) + cart checkout resolve it; enable after OfflineCity/cart migrate. Live-DB repo CRUD verified (create→list→setDefault→update→delete for customer 472341; BigInt phone `9664796376` round-trips). Schema fixes: phone `Int`→`BigInt`; kept `label`/`is_default`/`city_id` to match live DB; `city` (NOT NULL) added to input/DTO.
- **`customer-profile`** 🟡 **flag OFF** — dashboard aggregates non-customer collections; enable after those migrate (dashboard left on Mongo). Live-DB service verified (customer 472347): `"DIXIT PATEL"`→`["DIXIT","","PATEL"]`, goals `[7,8,12,13,14]`→named DTOs, `isProfileCompleted` derived, `facebook_id` not leaked. Decisions: split full_name; single `device` token; derived complete-flag; `facebookId` read-only.
- **`customer-bank-account`** 🟡 **flag OFF** — referral `requestWithdrawal` embeds the bank account + reward-points txn (Mongo); enable after the withdrawal flow migrates. Live-DB repo CRUD verified (customer 472347). 4 CRUD handlers branched in `referral.controller.ts`.
- **Shipping**: assessed as **not standalone** — `CustomerShipping` is a checkout snapshot inside cart/course-order flows; migrates with cart/orders. Prisma model (BigInt phones) is ready.
- Docs: registry (`generate-migrated-modules.ts`) + schema-comparison generator updated and regenerated; `MIGRATED_MODULES.md` now shows 13 modules (lookups ✅ enabled, address/profile/bank ⏸ not in env).
- **Note on verification:** a full `yarn typecheck` / `yarn migration:api` HTTP run wasn't possible in this environment (`node_modules` is partial; the dev server can't boot). All MySQL paths were instead verified directly against the live DB via `tsx` repo/service tests. Recommend running `yarn install && yarn typecheck && yarn dev` + `yarn migration:api:customer-lookups` to complete HTTP sign-off.

### 2026-06-10 (cont.) — offline-city (unblocking address)

- Migrated **`offline-city`** (cities only) to unblock `customer-address`. **D1:** added `status TINYINT DEFAULT 1` + `order INT DEFAULT 0` to `ws_offline_city` via DDL (preserve Mongo active-gating/ordering); Prisma `OfflineCity` updated + regenerated. **D2:** cities only (centers/batches/admin stay Mongo).
- Wired `listCities` (`address.controller.ts`) + the cart `cityId`→name resolution (`cart.controller.ts`) on `isOfflineCityMysql()`. **Enabled** in env.
- Live-DB verified: 2 cities (Ahmedabad/Gandhinagar), correct order/status; **end-to-end** a MySQL address `cityId=2` resolves to `"Ahmedabad"` through the cart path.
- **D3 revised — `customer-address` stays OFF.** Found the cart (`cart.controller.ts:177`) and course-order (`course.service.ts:306`) still **read** `CustomerAddress` via Mongoose with ObjectId `addressId`. Flipping address ON (int ids, MySQL store) would break checkout. **Next step to flip address:** branch those 2 address reads on `isAddressMysql()`, then enable `customer-address`.
- **Verification caveat:** HTTP `migration:api:offline-city` pending live `yarn dev` (partial `node_modules`); data path verified via `tsx`.

*After each test session, update **Summary** at the top and add a row to [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) §16 Changelog if the module is signed off.*
