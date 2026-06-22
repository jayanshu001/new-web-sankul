> # ✅ MIGRATION COMPLETE — 2026-06-22 · running MySQL-only
>
> WebSankul now runs on **MySQL (Prisma) only**. Every admin + client + educator + promoter API, every write path, background job, and boot-time seeding serves from MySQL. **MongoDB is disconnected by default** (`MONGO_FALLBACK_ENABLED=false` → `connectDB()` is skipped at boot); the app boots and serves with **no Mongo connection** — empirically verified (22 endpoints returned 200, 0 Mongo calls at boot). `MONGODB_URI` is no longer required. Re-enabling Mongo is a single reversible flag.
>
> The remaining `src/models/**` + `mongoose` dependency is now **dormant dead code** (nothing connects to Mongo).
>
> **This document is retained for historical context.** The live source of truth for changes is `docs/MIGRATION_QUERY_CHANGES.md`. Anything below describing "pending / in-progress / flag OFF / blocker / Mongo fallback / remaining" reflects an earlier point in time and is **superseded** by the completed state above.

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

## ▶️ RESUME POINTER (update this every time) — ✅ DONE (superseded; see banner) · nothing left to resume, running MySQL-only

> **🎯 ZERO-MONGO PUSH (2026-06-19) — user wants EVERYTHING on MySQL. Canonical roadmap:
> [`MODULE_STATUS_ROADMAP.md`](./MODULE_STATUS_ROADMAP.md) + work plan [`ZERO_MONGO_PLAN.md`](./ZERO_MONGO_PLAN.md).**
> Beyond Waves 1–8: full audit found **53 runtime files still on Mongo**, grouped into 8 clusters (C1 catalog
> content-graph+detail, C2 lecture-progress activation, C3 dashboards, C4 testSeries/wishlist/misc, C5 promocode
> appliesTo, C6 embedded examCountdown populates, C7 realtime [DATA only — socket transport stays Mongo by user
> decision], C8 infra+final Mongo removal).
> **Done 2026-06-19 (73 flags ON, all verified, tsc clean):**
> ✅ `customer-address` (9/9). ✅ Mongo-only DATA tables created+backfilled+flipped: `ImageNotification`
> (`ws_image_notification`), `package-category` (`ws_package_category` + `ws_package.package_category_id` col, 11/11),
> `exam-countdown`(+category) (`ws_exam_countdown`(_category), 13/13). ✅ lecture-progress container heartbeats
> (video+live-session) + Resume/Learning read hub BUILT+verified (8/8+8/8) but GATED behind `lecture-progress-container`
> (OFF — coupled flip, waits on C1 detail badges). ✅ **C1 slices:** `client-lecture` (`/lecture` video-URL, 5/5),
> `client-category-video` (video-by-category list+detail, 8/8), `catalog-category-tree` (DAG resolver flag ON).
> ✅ lecture-note tables created (`ws_lecture_note`, `ws_lecture_audio_note`) + Prisma models — wiring PENDING.
> **▶ NEXT (C1, in progress):** lecture-note cluster — backfill (Mongo 4+2) + build `client-lecture-note` service +
> flip lecture-note/lecture-audio-note controllers + `resumeCard.ts`/`lectureRef.ts` (route resolveVideoCourseId→SQL).
> Then `buildCourseDetails` → catalog → material → search → live detail → enable `lecture-progress-container` (C2).
> DDL files: `schema-changes/2026-06-19_create_mongo_only_tail_tables.sql`, `..._create_lecture_note_tables.sql`.
> Backfills: `scripts/backfill-mongo-only-tail.ts`, `..._package-category-link.ts`.
>
> **🏁 WAVE 8 COMPLETE (2026-06-18).** All misc/low-value modules on SQL. No-DDL: ✅ `customer-master` (16h) ✅
> `ImageNotification` (4h, on `client-notification`) ✅ offline Center/Batch/Enquiry (12h, `offline-batch`+
> `offline-enquiry`) ✅ offline City (5h, `offline-city`). DDL batch (`2026-06-18_create_wave8_misc_tables.sql` — 5
> new tables + 2 ALTERs): ✅ `tracking`(ActivityLog) ✅ `goal` ✅ `cms-extra`(SocialLink+Type/CurrentAffair/
> LiveBannerSlider) ✅ `inquiry`(ALTER +customer_id/description/message/source) ✅ offline Banner(ALTER +order_by, on
> `offline-batch`). Verified 24/24 + 23/23 + 14/14 + 34/34; `tsc` clean; all flags ON.
> **🔧 VideoCategory DAG → SQL — RESOLVER BUILT + VERIFIED 13/13 (2026-06-18).** `src/modules/catalog-category-tree/`
> (recursive-CTE descendantsOf/ancestorsOf/reachableCategoryIds/resolveVideoScope/resolveVideoCourseId) is the SQL
> mirror of the Mongo category-tree walk. **DAG data already in SQL** — ws_video_category (157) + ws_video_category_relation
> (2456 edges); NO backfill needed (prior "empty table" notes were WRONG). Uses the multi-parent RELATION table, not the
> single `parent` col. **This UNBLOCKS the 6 DAG consumers** (catalog, course.service, progress heartbeat ×2, dashboard,
> free) — but each is a FULL Mongo→SQL consumer flip (they run in ObjectId space today, so the tree-walk can't be swapped
> in isolation; the whole handler flips so the resolver gets SQL int ids). Consumers flip ONE SLICE AT A TIME; flag
> `catalog-category-tree` goes ON with the first. **⏭️ REMAINING:** flip the 6 DAG consumers (cleanest first = container
> progress heartbeat, pairs with the ON `client-lecture-progress`); then profile-dashboard subscriptions/pastExams counts
> + the guarded `new ObjectId(userId)`. Genuinely Mongo-only (no clean slice): client/dashboard, recordingWebhook,
> ExamCountdown/PackageCategory (no table), admin exam/question CRUD writes.
>
> **🏁 WAVE 5 COMPLETE (2026-06-18).** All 9 admin catalog CRUD modules on SQL — `plan`, `master`, `video`,
> `videoCategory`(full), `book`, `ebook`, `course`, `package`, `material` — plus client `cart` + `educator`.
> **✅ WAVE 6 EFFECTIVELY DONE (2026-06-18).** All migratable live surfaces on the `live-course` flag (ON),
> verified vs live DB, `tsc` clean. `src/modules/admin-live-course/` covers: admin live-course CRUD/plans/subs/
> schedule + chat (admin+client) + poll (admin+client) + reminder (client reads) + **client live-course reads
> (listClient/upcoming-batches/sessions feeds/schedule-folder + SQL entitlement)**. The remaining live reads are
> intentionally deferred to Wave 7 (they're cross-store: subjects/folder-video, LectureProgress, educator populate,
> packageCategory, subscription-shaped my-lists).
> **✅ WAVE 7 + NET-NEW TABLES + CONSUMERS (2026-06-18). All aggregator/finalizer slices done; the 8 blocked tables
> CREATED + backfilled; test-series + ebook-download + folder fully migrated & ON; notification + lecture-progress
> code-complete (flag OFF — write subsystem / 14-file consumer breadth still Mongo).** Wave 7 = fat
> cross-collection aggregators + finalizers, done cleanest-slices-first per-handler.
> **Net-new-table consumer status (after creating the tables) — ⚠ HISTORICAL, see top banner for current:** ✅ `client-ebook-download` (ON, verified) ✅
> `client-folder` (ON, verified incl. content hydration — runtime refIds ARE SQL ints, only backfill stored 0)
> [SUPERSEDED→] ⏸️
> `client-notification` (reads code-complete + verified, flag OFF: admin dispatcher/scheduler/FCM/BullMQ write
> subsystem keyed by Mongo Customer ids must migrate first) ⏸️ `client-lecture-progress` (heartbeat upserts +
> rollups + count built, flag OFF: 14-file content-join hub — heartbeat's Mongo entitlement-reads + resume/learning
> reads must flip together). profile dashboard counts are flag-aware (folder/ebook/notification); its
> subscription/pastExams counts + the `new ObjectId(userId)` (guarded) still need a flip — they don't work under
> SQL-auth today.
> ✅ **purchase-history** (3 tabs, `client-purchase-history`) ✅ **admin-subscription** (reads + 4 reports,
> `admin-subscription`) ✅ **my-subscriptions** (course+ebook tabs, `client-my-subscriptions`; test_series stays
> Mongo) ✅ **categories** — `listVideoCategoryChildren` on `catalog-video` (children-nav trio now complete;
> REST of categories.controller stays Mongo — see below) ✅ **orders** — `listMyOrders` on `client-orders` ✅
> **payment** — course/ebook/book (prior `commerce-order`/`ebook-order`/`book-order`) + **live-course**
> (`live-course-order`) + **package** (`package-order`, added to commerce-order) all create-order + /verify on SQL ✅
> **webhook** — payment fulfillment for live-course + ebook on SQL. Verified end-to-end, `tsc` clean.
> **NET-NEW TABLES CREATED (2026-06-18, user-authorized "just create the tables"):** ws_lecture_progress,
> ws_notification, ws_folder(+_item), ws_ebook_download, ws_test_series(+_price/_order/_subscription) +
> ws_book_order.paid_at (DDL `2026-06-18_create_wave7_blocked_tables.sql`; 9 Prisma models; backfill
> `backfill-wave7-blocked-to-sql.ts`). ✅ **test-series FULLY MIGRATED** (`test-series-order`): payment
> apply-promo/create/verify + my-subs test_series tab + webhook; verified end-to-end. ✅ **webhook book + ebook
> fulfillment** flipped (AWB SQL-side, no Mongo Counter). ✅ **ebook-download** (`client-ebook-download`, ON,
> verified) ✅ **folder** (`client-folder`, ON, verified — incl. content hydration; the runtime refId IS a SQL int,
> so the join resolves; only the backfill stored 0).
>
> **⏭️ NEXT STEP — the 2 OFF consumers are BLOCKED on PREREQUISITE migrations (investigated 2026-06-18, code-backed;
> NOT just a wiring job — flipping either as-is BREAKS the live system). Do the prerequisite first, then flip.**
>   1. **`client-notification`** — ✅✅ **BOTH PREREQUISITES DONE + WRITE SUBSYSTEM MIGRATED (2026-06-18).**
>      ✅ (a) FCM multi-device tokens → `ws_customer_device_token` (table + backfill + repo rewire + flag-branched
>      `utils/fcm.ts` prune; legacy `device` column kept in sync). ✅ (b) Admin notification WRITE subsystem now has
>      a full SQL branch in `src/modules/admin-notification/admin-notification.service.ts` (audience resolver, FCM
>      dispatch, claim-lock via conditional updateMany, per-recipient fanout via createMany, scheduled/immediate
>      persistence, cancel/list/bulk-delete/delete). The 3 legacy files branch on `isAdminNotificationMysql()`:
>      `dispatcher.ts` (dispatchAudience + dispatchScheduledById), `scheduler.ts` (rehydrate reads SQL+Mongo;
>      worker failed-listener dual-reads), `notification.controller.ts` (all 6 handlers; ImageNotification 3 stay
>      Mongo — no SQL table). **CUTOVER = dual-read worker fallback:** the worker routes by id — numeric id with a
>      SQL row → SQL dispatch; non-numeric (legacy Mongo hex) or no SQL row → Mongo path. So in-flight Mongo-keyed
>      BullMQ jobs queued before the flip still fire; fallback self-retires once Redis drains. `tsc` clean.
>      ✅ **FLAG ON + VERIFIED END-TO-END (2026-06-18).** `client-notification` enabled in `.env`. Verification
>      harness `scripts/verify-notification-sql.ts` (reuses a live customer + throwaway device token, self-cleans):
>      **23/23 PASS** — audience (broadcast/targeted/token-gated), immediate send + per-recipient fanout, schedule→
>      claim→fire with claim-lock proven (double-fire no-op), dual-read routing (existsSql: SQL int vs Mongo hex vs
>      unknown), cancel, list (parent-rows-only), delete, bulk-delete. FCM disabled for the run (skipped sends).
>      Course-targeting uses ws_package_course_subscription.status=true (no payment_status col — documented drift).
>      **`client-notification` is DONE.**
>   2. **`client-lecture-progress`** — ✅ **FREE-VIDEO SLICE MIGRATED + flag ON (2026-06-18); container/DAG paths
>      stay Mongo.** The standalone free-video vertical needs NO content-graph, so it flipped cleanly:
>      `src/client/free/freeProgress.controller.ts` (both handlers) branches on `isLectureProgressMysql()` →
>      `client-lecture-progress.service.ts` (`upsertVideoProgress source:"free"`, new `listFreeResume` +
>      `findLiveVideo` for the 404/403 split; joins only ws_video + ws_video_category). Verified
>      `scripts/verify-free-progress-sql.ts` → **20/20 PASS** (heartbeat create/update/95%-complete/sticky/single-row,
>      guards, resume card shape, paid-exclusion, join correctness both ways incl. graceful null on staging's dangling
>      vcategory_id FK). `tsc` clean, flag `client-lecture-progress` ENABLED.
>      ⏸️ **STILL Mongo under this flag (needs the VideoCategory DAG SQL layer first — NOT yet built):** the 2
>      container heartbeats (`course/progress.controller.ts` reportLectureProgress gated by `scopeReachableCategories.ts`
>      walking `VideoCategory.childCategoryIds`; `learning/progress.controller.ts` reportLiveSessionProgress) and ALL
>      resume/learning READS (listMyLearningProgress, listMyCoursesForResume, `resumeCard.ts`, dashboard
>      getResumeDashboard — join Course/Package/LiveCourse/LiveSession/VideoCategory-tree/CourseEducator). They share
>      the SAME `ws_lecture_progress` table (free rows carry source=free; container rows carry pointers — disjoint), so
>      no data split: when they flip later they read consistently. **NEXT prerequisite = VideoCategory childCategoryIds
>      DAG → SQL (ws_video_category has only a single `parent` col, no descendant walk).**
>      (Entitlement subs ws_package_course_subscription/ws_live_course_subscription + ws_video ARE SQL — not the blocker.)
> The remaining prerequisite (VideoCategory content-graph) is a real multi-file effort, NOT a same-day wiring task.
> After it: flip the remaining profile-dashboard counts (subscriptions/pastExams) + remove the guarded `new ObjectId(userId)`.
>
> **⏸️ STAYS Mongo — genuinely no SQL home / no clean slice (NOT next-step work):**
> ⏸️ **profile getProfileDashboardCounts** — folder/ebook/notification counts already flag-aware; subscriptions +
> pastExams counts + the guarded `new ObjectId(userId)` still need their own flip.
> ⏸️ recordingWebhook (Json recordings + socket, Mongo-only). client/dashboard (no clean slice — see below).
> The orders 3 writes (placeCourseOrder/placeEbookOrder via /client/orders) stay Mongo — canonical purchase path is
> `/payment/*` (now on SQL). To unblock free-dashboard: migrate the 3 trending/free helpers first.
> ⏸️ **client/dashboard = BLOCKED (analyzed 2026-06-18, no clean slice):**
> `getResumeDashboard` is 10× LectureProgress (no SQL table); `getDashboard` is an atomic Promise.all bundling
> ExamCountdown + Notification (no SQL tables) + the Mongo-only trending helpers + banners/testimonials, returning one
> combined payload — no clean per-section flag boundary; `getFreeDashboard` is clean tables BUT its 3 data helpers
> (fetchTrendingBooksOnly/fetchTrendingEbooksOnly in book.controller, resolveFreeCategoryIds in free.controller) are
> raw Mongo. To unblock free-dashboard, migrate those 3 helpers first (own effort). banner-slider + testimonial SQL
> modules DO exist; ws_notification/ws_exam_countdown/ws_lecture_progress do NOT.
> ⚠ **learning/progress is fully blocked** (LectureProgress has no SQL table). Fold in the deferred Wave-6 live
> reads where their Mongo-only deps allow.
> ⚠ Deferred per-module: admin-subscription's 3 writes + 2 address handlers (→ payment wave). categories.controller
> STAYS Mongo for: 4 examCountdown* handlers (no SQL table), listPackageCategories/listPackagesByCategory
> (PackageCategory — no SQL table), listVideosByCategory/getVideoByCategory (LectureProgress + encryption),
> listMaterialsByCategory (paid-material entitlement gating).
> **⚠ UPDATE 2026-06-18: SQL tables now CREATED for** TestSeries(+price/order/subscription) [✅ fully migrated],
> LectureProgress, Notification, Folder(+item), EbookDownload. Of these only **test-series** has its consumers
> flipped; the rest are created+backfilled but consumers stay Mongo pending paired write-path/content-graph (see
> RESUME POINTER). **Still genuinely no SQL table:** ExamCountdown/ExamCountdownCategory, PackageCategory,
> ImageNotification, the Mongo Counter (sequential AWB — though book AWB is now allocated SQL-side in verify/webhook).
> **STAY Mongo (Wave 6 final):** reminder set/remove (Notification+BullMQ), livepoll updatePoll + vote-casting
> (socket), folder/video-in-folder + createLiveCourse Root-folder (no live_course_id on ws_video_category), the
> `src/admin/live/` realtime stack (StreamOS/recording-promote/socket), and the deferred client reads above.
> **⚠ Wave 5 documented Mongo-only gaps (per module):**
> - **book:** toggleBookTrending (no col), getBookById exam-countdown populates, order-status/tracking writes
>   (embedded tracking.history[]), getSettings/updateSettings (no ws_book_setting table).
> - **ebook:** toggleEbookTrending (no col), the BullMQ single-PDF upload pipeline (`POST /:id/pdf` + `/pdf-jobs`).
> - **course** (ws_video_category has no `course_id`): createCourse Root-folder automation skipped (folder=null);
>   course video-categories use the GLOBAL table (courseId dropped); deleteCourse skips courseId folder/relation cleanup.
> - **package:** listPromotedCodes (PromoCode.appliesTo) + listBooks (Book.packageIds) stay Mongo; ws_package
>   missing many fields (isPaid/smart/planner/subtitle/goal/packageCategory/examCountdown) → synthesized/dropped.
> - **material** (ws_material_category single-parent): ancestors[]/childCategoryIds[] DAG dropped; duplicateCategory
>   stays Mongo; ws_material minimal (description/thumbnail/fileSize/fileMime/language/isPreview/isPaid/downloadCount dropped).
> - **client material/search:** LiveCourse-blocked (Wave 6). **master/packageCategory; videoCategory `duplicate`.**
> - **No-SQL-table features (defer, need DDL):** wishlist, folder, lecture-note, lecture-audio-note, free-progress (LectureProgress).
> - **Wave-4 remainder:** admin exam/question CRUD writes + getSolutionDownload PDF.
> **Last completed (⚠ HISTORICAL — Wave 7 snapshot; current state is the top banner):** ✅ **Wave 7 net-new-table CONSUMERS** — built the consumer modules for the 8 created tables.
> ✅ `client-ebook-download` (ON, verified) + ✅ `client-folder` (ON, verified incl. content hydration). [SUPERSEDED→ both now flag ON] ⏸️
> `client-notification` (reads code-complete + verified, flag OFF — admin dispatcher/FCM/BullMQ write subsystem
> stays Mongo) + ⏸️ `client-lecture-progress` (heartbeat+rollups+count built, flag OFF — 14-file content-join hub).
> profile dashboard counts now flag-aware (folder/ebook/notification); `new ObjectId(userId)` guarded. `tsc` clean.
> *(earlier this wave: created the 8 tables + test-series fully + webhook book/ebook + all aggregators + full payment;
> Wave 6 before Wave 7.)*
> **Working branch:** `migration` (never merge to `main` until full sign-off)
> **Env flag list:** `.env` → `MIGRATION_MYSQL_MODULES` (now +`promoter-auth`, `promoter-data`, `referral`, `admin-rbac`, `client-exam`, `client-cart`, `admin-exam`, `client-educator`, `admin-plan`, `admin-master`, `admin-video`, `admin-book`, `admin-ebook`, `admin-course`, `admin-package`, `admin-material`, `live-course`, `client-purchase-history`, `admin-subscription`, `client-my-subscriptions`, `client-orders`, `live-course-order`, `package-order`, `test-series-order`, `client-ebook-download`, `client-folder`, `customer-profile`, `client-notification`, `client-lecture-progress`, `customer-master`, `offline-batch`, `offline-enquiry`, `tracking`, `goal`, `cms-extra`, `inquiry`) [`client-lecture-progress` = FREE-VIDEO slice only; container/DAG paths still Mongo under the same flag. `client-notification` also serves ImageNotification CRUD. `offline-batch` serves Center + Batch + Banner admin CRUD. `cms-extra` = SocialLink+Type/CurrentAffair/LiveBannerSlider.]

---

## 0. Scope & baseline (2026-06-17)

A full code scan found **~90 files** still on MongoDB (Mongoose) with NO `isMysqlModule` branch:
**39 admin · 42 client · 9 other (educator/promoter/webhook).** They collapse into a small number of
dependency **clusters** — we migrate by cluster, not file-by-file.

**Already migrated (do NOT redo):** admin-auth (ws_users + administrator CRUD), admin customer CRUD, admin
master educators, educator-auth, customer-auth/profile/bank-account/lookups, all `src/modules/catalog-*`,
`commerce-*`, `offline-*`, `*-order`, `package-chat`.

**The hard blocker (design, not port) — ✅ RESOLVED in Wave 6 (2026-06-18):** LiveCourse / LiveSession /
LiveCourseSubscription originally had NO SQL tables. Wave 6 designed (`schema-changes/LIVE_COURSE_DESIGN.md`) +
created 14 `ws_live_*` tables (DDL `schema-changes/2026-06-18_create_ws_live_course_tables.sql`) + backfilled the
Mongo data, then migrated the admin + chat/poll/reminder + client-read live surfaces. The dashboard/categories/
search/learning endpoints that *join* live-course remain for Wave 7 (aggregation).

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
| **5** | **Catalog admin CRUD + remaining client reads** (~156 migratable; 21 blocked on missing tables) | ~30 | mostly exist (reuse catalog-*/commerce-*) | ✅ **DONE 2026-06-18** — all 9 admin CRUD modules (plan/master/video/videoCategory/book/ebook/course/package/material) + client cart/educator on SQL; client material/search + 21 no-table features stay Mongo |
| **6** | **LiveCourse / LiveSession** (admin live-course ×6 + live/livepoll/livechat; client live-course/live/livechat/livepoll/live-reminder) | ~16 | ✅ **14 tables CREATED + backfilled** (ws_live_course/_plan/_subscription/_session(+course join)/_category/chat/poll(+option)/vote/attendance/reminder/preview) | ✅ **DONE 2026-06-18** — schema+backfill + admin live-course + chat/poll/reminder + client reads (Groups A+B). Cross-store reads (detail/recordings/lecture/my-lists/timetable) deferred to Wave 7 |
| **7** | **Aggregation/finalizers** (admin+client dashboard, categories, my-subscriptions, purchase-history, orders, payment ×8, verify, webhook, profile-dashboard, learning) | ~20 | **8 net-new tables CREATED + backfilled** (ws_lecture_progress, ws_notification, ws_folder(+_item), ws_ebook_download, ws_test_series(+_price/_order/_subscription)) + ws_book_order.paid_at | ✅ **DONE 2026-06-18** — all aggregators + full payment (course/ebook/book/live-course/package + test-series) + webhooks + categories + my-subs + orders migrated & verified; 8 blocked tables created; ebook-download + folder + test-series flags ON. ✅ `client-notification` now FULLY MIGRATED + flag ON (device-token table + admin write subsystem + dual-read BullMQ cutover; 2026-06-18). ✅ `client-lecture-progress` FREE-VIDEO slice migrated + flag ON; container/DAG paths still Mongo (need VideoCategory childCategoryIds DAG → SQL). No clean slice: client/dashboard, recordingWebhook, ExamCountdown/PackageCategory (no table) |
| **8** | **Misc / low-value** (notification, tracking/ActivityLog, inquiry, goal, cms social-link/current-affair/live-banner, offline admin CRUD) | ~12 | 5 new tables (ws_activity_log/ws_goal/ws_social_link(_type)/ws_current_affair/ws_live_banner_slider) + 2 ALTERs (inquiry +4 cols, offline banner +order_by) | ✅ **DONE 2026-06-18** — no-DDL: customer-master(16h)/ImageNotification(4h)/offline Center+Batch+Enquiry(12h)/offline City(5h); DDL batch: tracking/goal/cms-extra(SocialLink+Type/CurrentAffair/LiveBanner)/inquiry/offline-Banner. Flags ON: customer-master, offline-batch, offline-enquiry, offline-city, tracking, goal, cms-extra, inquiry. Verified 24/24 + 23/23 + 14/14 + 34/34. `tsc` clean |

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

### Wave 5 — Catalog admin CRUD + remaining client reads  ✅ DONE 2026-06-18
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
  - [x] **book** ✅ (`src/modules/admin-book/`) — 9 handlers: books getBooks/getBookById/create/update/delete/toggleStatus/reorder + orders getOrders/getOrderById, on `isAdminBookMysql()`. Reuses ws_book + ws_book_order(_item) + ws_customer_shipping; no DDL. ⚠ ws_book MISSING cols (isTrending/publication/deliveryEta/termsAndConditions/demoFileName/bookFileName/bookUrl/examCountdown*/packageIds) → DTO synthesizes, write drops them. **STAY Mongo:** toggleBookTrending (no col), getBookById countdown populates (no SQL ExamCountdown), updateOrderStatus/setOrderTracking/addOrderTrackingEvent (embedded tracking.history[] — ws_book_tracking is 1 flat varchar(10) row), getSettings/updateSettings (NO ws_book_setting table). Order items hydrate from order_items JSON (child table near-empty). Enabled `admin-book`. Verified vs live DB (10 books, 6 orders).
  - [x] **ebook** ✅ (`src/modules/admin-ebook/`) — 3 surfaces, 17 handlers: ebooks (list/get/create/update/delete-cascades-plans/reorder), plans (list/create/get/update/delete + prices-for-subscription; ebook-owned ws_package_course_ebook_price), subscriptions (list/get/create-backend-grant/update-verify-or-toggle/delete). Branches `ebook.service.ts` (thin-controller delegation) + `ebook-subscription.controller.ts` on `isAdminEbookMysql()`. No DDL. ⚠ ws_ebook MISSING cols (isTrending/PDF-upload-status/examCountdown*) → DTO synthesizes, write drops them + NOT-NULL sentinels. **STAY Mongo:** toggleEbookTrending (no col), the BullMQ single-PDF upload pipeline (writes Mongo upload-status fields), updateEbook S3 cleanup. Backend grant = 1 txn (order COMPLETE + sub); endAt via planDuration(asDays). ⚠ ws_ebook_order.plan_id NOT NULL → 0 sentinel; customer_id varchar (Prisma Int casts). SQL numeric-id validation (reorder + sub-create). Enabled `admin-ebook`. Verified vs live DB (2 ebooks, plans active-filter, sub grant 30d/90d + toggle + delete).
  - [x] **course** ✅ (`src/modules/admin-course/`) — full surface (~24 handlers): course CRUD + popular toggle + plans (single-default) + materials (pc-material, title-only) + video-categories + video-category-relations + pre-requisites. Mongo embedded materialCategories[]/examCategories[] → SQL pivot tables ws_material_category_course / ws_exam_category_course (create writes in-txn, update replaces). Branches course.service.ts + course.controller.ts create/update on `isAdminCourseMysql()`. No DDL. ⚠ USER-APPROVED: ws_video_category has NO course_id → createCourse Root-folder automation skipped (folder=null), course video-cats operate on the global table (courseId dropped), deleteCourse skips courseId-scoped folder/relation cleanup. SQL enums is_featured/purchase → isPopular/isPaid; with_material/level VARCHAR; course_category_id/educator_id 0 sentinel. SQL numeric-id validation (create/update). Enabled `admin-course`. Verified vs live DB (1 course w/ pivots, create/update/delete cascade, plan single-default).
  - [x] **package** ✅ (`src/modules/admin-package/`) — full surface (~22 handlers): types CRUD + packages CRUD/status/reorder + embedded reorders + plans (attach/list/detach) + subscribers + video-relations (set + BFS expand). Mongo embedded specificSubjects[]/materialCategories[]/examCategories[] → SQL pivots ws_package_specific_subject / ws_material_category_package / ws_exam_category_package (create in-txn, update replaces). Branches package.service.ts on `isAdminPackageMysql()`. Schema: added nullable educator_id to Package model (DB col existed, unmapped). ⚠ ws_package MISSING cols (isPaid/isSmartCourse/isPlannerCourse/subtitle/notificationTopic/packageCategoryId/goalId/goalLabelId/examCountdown*) → DTO synthesizes, write drops; package_type_id→1 / exam_id→0 sentinels. **STAY Mongo:** listPromotedCodes (PromoCode.appliesTo — no SQL linkage), listBooks (Book.packageIds — no SQL col); chat already on SQL (package-chat). Enabled `admin-package`. Verified vs live DB (5 packages w/ embeds, type+package CRUD, attach/detach, subscribers, setVideoRelations + BFS expand).
  - [x] **material** ✅ (`src/modules/admin-material/`) — both surfaces (~19 handlers): categories (list/tree/getById/create/update/delete/toggle/reorder/courses/materials) + leaf materials (list/get/create/update/delete/toggle/reorder/bulk-status/bulk-delete). Branches material.controller.ts on `isAdminMaterialMysql()`. No DDL. ⚠ USER-APPROVED: ws_material_category is single-parent only (parent 0=root) — ancestors[]/childCategoryIds[] DAG dropped; duplicateCategory STAYS Mongo (BFS clone depends on ancestors[], like videoCategory duplicate). ws_material minimal (title/direct_link/file/order_by/status) — description/thumbnail/fileSize/fileMime/language/isPreview/isPaid/downloadCount dropped+synthesized. Enabled `admin-material`. Verified vs live DB (5 categories list/tree/CRUD, 226 materials CRUD + bulk).
- [x] Doc protocol + update §RESUME POINTER. ✅ **Wave 5 catalog CRUD COMPLETE.**

> **Wave 5 cart notes:** Mongo `BookCart.items[]` embed → SQL split `ws_book_cart` (one active row/customer,
> active=status) + `ws_book_cart_item` (cartId→cart.id, bookId→item_id). `cart_id` is a NOT-NULL varchar
> business key — generated `cart-<base36>`. attach-shipping find-or-creates a `ws_customer_shipping` row (userId,
> phone BigInt, state, pincode Int) + city via offline-city. Verified add/increment/get-totals/update/remove.

### Wave 6 — LiveCourse / LiveSession  ✅ DONE 2026-06-18 (cross-store reads deferred to Wave 7)
- [x] **Design** `schema-changes/LIVE_COURSE_DESIGN.md` — ✅ signed off (all 6 §6 decisions + backfill approved).
- [x] **Create tables** (additive DDL `2026-06-18_create_ws_live_course_tables.sql`, **14 tables**) → **Prisma models** (14, appended) → `prisma generate`. ✅ ObjectId→INT; embeds→JSON; poll options[]→child; sessions↔courses many-to-many join; plan duration in MONTHS; chat/polls keyed by string live_class_id. `tsc` clean.
- [x] **Backfill** existing Mongo rows → SQL (`scripts/backfill-live-course-to-sql.ts`). ✅ Verified counts match Mongo (4 courses/4 plans/10 subs/51 sessions/53 links/9 polls+33 options/11 votes/52 chat/195 attendance/9 reminders/4 previews). Customer phone-bridge 14/267 on staging (test users; prod bridges better); unbridgeable educator/category refs = 0/null.
- [x] **Admin module** ✅ `src/modules/admin-live-course/` (repo + service) — branches live-course core service + plan/subscription controllers on `isLiveCourseMysql()`. Wired: course CRUD/popular/sessions-list + plans (single-default) + subscriptions (list/get/update/delete/grant) + schedule folders/entries (JSON, synthetic ids). ⚠ folder/video-in-folder + Root-folder automation STAY Mongo (no live_course_id on ws_video_category). plan.duration=DAYS. Enabled `live-course`. Verified vs live DB (flag ON): 4 courses, schedule folder addressable, 15 sessions via join, grant +90d, full CRUD. `tsc` clean.
- [x] **livechat / livepoll / live-reminder** ✅ — extended `admin-live-course` module (repo+service) + branched the chat/poll/reminder controllers (admin + client) on `live-course`. livechat: client history/ban-status + admin send/history/delete(soft)/ban/unban/listBans (socket side-effects preserved; global ban → "" live_class_id sentinel). livepoll: client active-poll(+myVote) + admin create(close-existing)/list/results/close/delete (options in ws_live_poll_option child). live-reminder: client list/get reads. ⚠ STAY Mongo: reminder set/remove (provisions Notification + BullMQ job), livepoll updatePoll (option-replace 0-votes guard) + vote casting (socket), chat includeDeleted history. Verified vs live DB. `tsc` clean.
- [~] **Client live-course reads** → ported entitlement.ts to SQL + wired the high-traffic reads: listLiveCoursesForClient, listUpcomingLiveBatches, listSessionsForCourseClient, listAllUpcomingSessions, listLiveNowSessions, getMyScheduleFolder (on `live-course`). ⚠ STAY Mongo (Wave 7): getLiveCourseForClient detail (subjects count + packageCategory populate), recordings/lecture/session-recordings (folder/video + LectureProgress + AES), getLiveCourseSchedule/listMyScheduleByCategory (session-timetable + educator populate), listMyLiveCourses/listMyUpcomingSessions (subscription-shaped "my" lists w/ status filter). PackageCategory tab bar emits id+count only (no SQL table). Verified vs live DB. `tsc` clean.
- [x] Doc protocol + update §RESUME POINTER. ✅ **Wave 6 DONE** (all migratable live surfaces on SQL; cross-store reads → Wave 7).
- [x] **Tooling:** added a `Stop` hook in `.claude/settings.json` that nags if `src/` changed but `docs/MIGRATION_QUERY_CHANGES.md` didn't — enforces this doc protocol automatically (activate via `/hooks` or restart).

### Wave 7 — Aggregation / finalizers  ✅ DONE 2026-06-18 (2 consumers code-complete behind OFF flags — see note)
> **✅ Wave 7 complete.** All aggregator/finalizer slices migrated + verified; the 8 previously-blocked tables
> CREATED + backfilled; test-series + ebook-download + folder fully migrated & flags ON. **⚠ SUPERSEDED (see top
> banner): both `client-notification` (FULLY migrated + flag ON, 2026-06-18) and `client-lecture-progress`
> (free-video slice migrated + flag ON; container/DAG paths still Mongo) have since advanced past the flag-OFF state
> described below.** *(historical:)* the two consumers were CODE-COMPLETE but flag-OFF — notification's
> write path is a Mongo subsystem (admin dispatcher/scheduler/FCM/BullMQ) and lecture-progress is a 14-file
> content-join hub; both flip once their paired write/consumer surface migrates. Everything that could be flipped
> without split-brain IS flipped. Genuinely never had a SQL table / no clean slice: ExamCountdown, PackageCategory,
> ImageNotification, client/dashboard, recordingWebhook.
These are fat cross-collection aggregators (one handler reads 5–12 collections). Compose already-migrated modules;
no new tables. **Strategy: cleanest slices first, per-handler.** ⚠ Several have hard Mongo-only slices with NO
SQL table (confirmed missing): **TestSeries / TestSeriesSubscription, LectureProgress, ExamCountdown,
Notification** — those slices stay Mongo.
- [x] **purchase-history** ✅ (`src/modules/client-purchase-history/`) — 3 tabs (subscriptions/books/ebooks) on `client-purchase-history`. Pure compose of migrated tables. ⚠ no payment_status col → status=true; SQL package_id=package (Mongo inverts pkg/target); ebook via plan→ebook hop; book items from order_items JSON, AWB-only tracking. Receipt (receipts.controller) stays Mongo. Verified vs live DB. `tsc` clean.
- [x] **admin/subscription** ✅ (`src/modules/admin-subscription/`) — reads + reports on `admin-subscription`: listCourseSubscriptions (+cross-table search) / getById / listPlansForTarget / listEbookSubscriptions + 4 reports (summary/by-course/by-ebook/book-orders via groupBy). ⚠ STAY Mongo: the 3 subscription writes (Mongo-only fields + grant-extend → payment wave) + 2 address handlers (CustomerAddress held OFF). SQL package_id=package; no payment_status (status conveys active). Verified vs live DB. `tsc` clean.
- [x] **my-subscriptions** ✅ (`src/modules/client-my-subscriptions/`) — `type=course` (course+package) + `type=ebook` tabs on `client-my-subscriptions`. Active-only cards (status=true && endAt>now), deduped per target, same Card envelope. ⚠ `type=test_series` STAYS Mongo (no ws_test_series* table; also returns empty for SQL-auth customers — keyed by Mongo ObjectId). no payment_status→status=true; package_id=package. Verified vs live DB (seeded future sub: pkg 'CCE'/badge/30d, ebook/30d). `tsc` clean.
- [ ] **client/dashboard** — home screen (12+ collections); ⚠ ExamCountdown section blocked; rest (catalog) migratable.
- [x] **categories** ✅ (partial) — `listVideoCategoryChildren` on `catalog-video` (children-nav trio complete: video+material+exam). ⚠ STAYS Mongo: 4 examCountdown* handlers (ExamCountdown — no SQL table), listPackageCategories/listPackagesByCategory (PackageCategory — no SQL table), listVideosByCategory/getVideoByCategory (LectureProgress + encryption), listMaterialsByCategory (paid-material gating). Verified vs live DB.
- [⏸️] **client/dashboard** — BLOCKED (no clean slice, analyzed 2026-06-18). getResumeDashboard=10× LectureProgress (no SQL table); getDashboard=atomic Promise.all bundling ExamCountdown+Notification (no SQL tables)+Mongo-only trending helpers+banners/testimonials; getFreeDashboard=clean tables but 3 raw-Mongo cross-controller helpers (fetchTrendingBooksOnly/fetchTrendingEbooksOnly/resolveFreeCategoryIds). Unblock free-dashboard by migrating those 3 helpers first. banner-slider+testimonial SQL modules exist; notification/examCountdown/lectureProgress don't.
- [x] **orders** ✅ (partial) — `listMyOrders` on `client-orders` (course/pkg + ebook subs + book orders read). ⚠ STAYS Mongo: placeCourseOrder/placeEbookOrder/verifyPayment (payment-write path: Razorpay + grant + PromoCode.appliesTo + ReferralProgram) → payment wave. Verified vs live DB.
- [x] **payment — live-course** ✅ (`src/modules/live-course-order/`) — create-order + /verify + webhook on `live-course-order`. Single-table SQL sub (payment + entitlement), DAYS duration, fold-or-fresh, dual-read fallback. First full payment-WRITE vertical on SQL. Verified end-to-end vs live DB.
- [x] **payment — package** ✅ create-order + verify added to `commerce-order` (flag `package-order`; 3-table; plan must be a package plan; sub sets package_id/course_id null; DAYS; fold-or-fresh). Verified end-to-end vs live DB (sub.amount accumulated 6500→13000 on fold).
- [x] **webhook — ebook** ✅ `fulfillEbookWebhookMysql` on `ebook-order` (keyed by razorpayOrderId alone; idempotent; dual-read). Verified end-to-end.
- [⏸️] **payment — test-series** (BLOCKED — no ws_test_series*), **webhook — book** (needs paidAt/tracking/Counter schema), **recordingWebhook** (Json recordings + socket, Mongo-only).
- [⏸️] **profile/dashboard** `getProfileDashboardCounts` — BLOCKED (5/7 counts: Notification/FolderItem×2/EbookDownload no SQL table; PackageCourseSub no payment_status/targetPackageId; ExamResult no inProgress/submittedAt). profile READS already on customer-profile.
- [ ] **learning/progress** — ⚠ BLOCKED: LectureProgress has no SQL table (whole feature is Mongo-only).
- [ ] Fold in the deferred Wave-6 live reads (detail/recordings/lecture/timetable/my-lists) where their Mongo-only deps allow.
- [ ] Doc protocol + update §RESUME POINTER.

### Wave 8 — Misc / low-value  ✅ DONE 2026-06-18
- [x] **customer-master** ✅ — State/District/Education/TargetGoal CRUD (16 handlers) on SQL, no DDL; flag
  `customer-master` ON. Verified 24/24 (`scripts/verify-wave8-sql.ts`).
- [x] **ImageNotification** ✅ — 4 handlers on SQL (same `client-notification` flag); completes the notification cluster.
- [x] **offline admin CRUD (Center/Batch/Enquiry)** ✅ — 12 handlers on SQL, no DDL; flags `offline-batch` +
  `offline-enquiry` ON. Center+Batch admin writes added to `offline-batch` module; Enquiry admin list+delete to
  `offline-enquiry`. Verified 23/23 (`scripts/verify-offline-admin-sql.ts`) incl. cascade/409 guards + JSON/BigInt
  drifts. (Banner = OfflineBannerSlider + City admin still Mongo — City has own module; Banner separate.)
- [x] **offline City admin writes — ✅ DONE (2026-06-18), NO DDL:** added admin CRUD (5 handlers) to `offline-city`
  module (flag already ON). `stateId` filter/populate dropped (no SQL col — Mongo optional). Verified 14/14
  (`scripts/verify-offline-city-admin-sql.ts`) incl. center-FK 409 guard.
- [x] **DDL batch — ✅ DONE 2026-06-18** (DDL `2026-06-18_create_wave8_misc_tables.sql`; verified 34/34
  `scripts/verify-wave8-ddl-sql.ts`):
  - **tracking** (ActivityLog) — new `ws_activity_log`; flag `tracking` ON; list + summary (groupBy + raw-SQL dailyCount).
  - **goal** — new `ws_goal` (labels JSON); flag `goal` ON; branched in `goal.admin.service.ts` (keeps shared cache+S3).
  - **cms-extra** — new `ws_social_link(_type)`/`ws_current_affair`/`ws_live_banner_slider`; flag `cms-extra` ON; 16
    cms.controller handlers dual-pathed; SocialLinkType in-use→409; LiveBanner order_by reorder.
  - **inquiry** — `ws_website_inquiry` ALTERed (+customer_id/description/message/source; name/mobile/email/city →
    nullable); flag `inquiry` ON; admin list/get/delete + client submit; customer-populate from ws_customer.
  - **offline Banner** — `ws_offline_banner_slider` ALTERed (+order_by); added to `offline-batch` module; CRUD+reorder.
- [x] Doc protocol + update §RESUME POINTER (kept current per-slice; RESUME POINTER has the Wave 8 banner).

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
| 2026-06-18 | 7 | **🔎 Wave 7 follow-up — investigated flipping the 2 OFF consumers; both confirmed BLOCKED on prerequisite migrations (code-backed), flags stay OFF, no code changed.** `client-notification`: FCM delivery needs multi-device tokens but ws_customer has only a single `firebaseToken @map("device")` (Mongo has `firebaseTokens[]` + `$pull` pruning) → needs a `ws_customer_device_token` table + backfill first; AND scheduled-send BullMQ jobs are keyed by Mongo `_id` → needs a drain/cutover. `client-lecture-progress`: recorded-video heartbeat gated by `scopeReachableCategories` walking the Mongo `VideoCategory.childCategoryIds` DAG (no SQL hierarchy nav) + resume reads join Mongo-only content (Course/Package/LiveCourse/LiveSession/VideoCategory/CourseEducator) → needs the content-graph SQL layer first. Both verified via code (objectId.parse guards, fcm.ts array pruning, audience.ts). Honored "nothing breaks" → left OFF. SQL modules stay code-complete + ready. |
| 2026-06-18 | 7 | **🔌 Wave 7 — wired the new-table consumers.** ✅ `client-ebook-download` (ON, verified: record/list/count/remove) + ✅ `client-folder` (ON, verified: 8 handlers ×2 types + ensureDefault + counts + content hydration). ⏸️ `client-notification` (client reads + markRead/markAll code-complete + verified, FLAG OFF — admin dispatcher/scheduler/FCM/BullMQ write subsystem keyed by Mongo Customer ids stays Mongo) + ⏸️ `client-lecture-progress` (heartbeat upserts + rollups + completedLectureCount built, FLAG OFF — 14-file content-join hub: heartbeat's Mongo entitlement reads + resume/learning reads must flip together). KEY FINDING: runtime ids ARE SQL (customer-auth + catalog-*), so content joins resolve live (folder proved it) — the "Mongo content≠SQL" issue only affected backfill. profile dashboard counts flag-aware (folder/ebook/notification); `new ObjectId(userId)` guarded (latent crash under SQL-auth). `tsc` clean. |
| 2026-06-18 | 7 | **🆕 Wave 7 — created the 8 blocked SQL tables + test-series vertical + webhook book/ebook.** DDL (`2026-06-18_create_wave7_blocked_tables.sql`): ws_lecture_progress, ws_notification, ws_folder(+_item), ws_ebook_download, ws_test_series(+_price/_order/_subscription) + ws_book_order.paid_at. 9 Prisma models + backfill (`backfill-wave7-blocked-to-sql.ts`; customer phone-bridge + test-series intra-family: notification 22/24, test_series 2+3 prices; customer-keyed rows mostly skipped on staging — test users not in SQL dump). ✅ test-series FULLY migrated (`test-series-order`: apply-promo/create/verify/my-subs-tab/webhook, verified end-to-end +60d/fold). ✅ webhook book+ebook fulfillment flipped (AWB SQL-side). ⏸️ lecture-progress (content-join hub, refs unbridged), notification (Mongo dispatcher/FCM/BullMQ write path), folder/folder-item (polymorphic refId unbridged), ebook-download (ebookId unbridged) — tables+backfill DONE + production-ready, consumers stay Mongo pending paired write/content-graph. `tsc` clean. |
| 2026-06-18 | 7 | **💳 Wave 7 — package payment + webhook-ebook on SQL (payment surface closed).** PACKAGE create-order + verify added to existing `commerce-order` (flag `package-order`; same tables as course): findPackagePlanForOrder/createPackageOrderMysql/findPackageOrderForVerify/verifyPackageOrderMysql + repo findActivePackageSub/verifyPackageTx; branched package-payment.controller.ts + verify.controller.ts. 3-table, DAYS, fold-or-fresh; plan must be package (packageId set, courseId null), sub sets package_id/course_id null. PackageCourseOrder.customer_id is `userId Int` (NOT varchar). WEBHOOK ebook: fulfillEbookWebhookMysql added to ebook-order (keyed by razorpayOrderId alone) + repo findOrderByRazorpayOnly; branched webhook.controller.ts. Verified end-to-end vs live DB (pkg: +180d, fold sub.amount 6500→13000; ebook webhook: order complete + sub +180d, idempotent). `tsc` clean. ⏸️ Remaining = documented blocks: test-series (no SQL table), webhook-book (paidAt/tracking/Counter schema), recordingWebhook (Json+socket), profile-dashboard (5/7 counts no SQL table), client/dashboard. |
| 2026-06-18 | 7 | **💳 Wave 7 — live-course payment write path on SQL (create + verify + webhook).** New `src/modules/live-course-order/`, branches createLiveCourseOrderPayment + verify.controller.ts + webhook.controller.ts paymentWebhook on `live-course-order`. FIRST full payment-WRITE vertical on SQL. Single-table (ws_live_course_subscription carries payment + entitlement; no order table): createPending → pending row; verify/webhook → fresh grant OR fold onto existing active sub (extend endAt, sum paid) + retire pending row. ⚠ duration=DAYS (asDays:true; schema "MONTHS" comment stale); withMaterial/customerShippingId Mongo-only; LiveCourse title read from Mongo; dual-read fallback (SQL first). Verified end-to-end vs live DB (plan ₹1999/3d: create→verify +3d→idempotent→webhook fold +3d more, paid 1999→3998). `tsc` clean. ⏸️ Deferred (analyzed): package-payment (doable next), webhook-ebook (doable batch); BLOCKED: test-series (no SQL table), webhook-book (schema), profile-dashboard (5/7 counts no SQL), recordingWebhook (Json+socket). |
| 2026-06-18 | 7 | **🧾 Wave 7 — client orders: listMyOrders on SQL (+ client/dashboard analyzed & deferred).** New `src/modules/client-orders/` (repo + service), branches listMyOrders in orders.controller.ts on `client-orders`. Read-aggregation (course/pkg + ebook subs + book orders for a customer, newest-first); matches Mongo `{ courseSubscriptions, ebookSubscriptions, bookOrders }`. No new tables. ⚠ Course.image→thumbnail, package_id resolved directly, packageId field=plan DTO via planId; book items from order_items JSON, AWB from tracking_id, customer keyed by user_id. ⚠ STAYS Mongo: placeCourseOrder/placeEbookOrder/verifyPayment (payment-write path → payment wave). Verified vs live DB (cust 472341→1 pkg sub+4 book orders, 472335→1+1+1). `tsc` clean. ⏸️ client/dashboard analyzed & deferred — no clean slice (getResumeDashboard=LectureProgress; getDashboard=atomic bundle w/ ExamCountdown+Notification; getFreeDashboard=raw-Mongo trending/free helpers). No SQL table for notification/examCountdown/lectureProgress. |
| 2026-06-18 | 7 | **🗂️ Wave 7 — client categories: listVideoCategoryChildren on SQL (children-nav trio complete).** Wired listVideoCategoryChildren in categories.controller.ts onto the already-on `catalog-video` flag. Added to `src/modules/catalog-video/`: getVideoCategoryChildren (service) + findCategoryByIdAny / listActiveChildren / parentsWithChildren (repo). Mirrors catalog-material/exam getCategoryChildren. No new flag, no new tables. ⚠ children via `parent` self-FK (Mongo childCategoryIds[] DAG dropped); parent=0 sentinel → null/404; parent fetched without status gate (matches Mongo findById). ⚠ REST of categories.controller STAYS Mongo: 4 examCountdown* (ExamCountdown no SQL table), listPackageCategories/listPackagesByCategory (PackageCategory no SQL table), listVideosByCategory/getVideoByCategory (LectureProgress + encryption), listMaterialsByCategory (paid-material gating). Verified vs live DB (cat 295→18 children, cat 8→3, missing→404, search). `tsc` clean. |
| 2026-06-18 | 7 | **📚 Wave 7 — client my-subscriptions library (course + ebook tabs) on SQL.** New `src/modules/client-my-subscriptions/` (repo + service), branches the `type=course`/`type=ebook` tabs of my-subscriptions.controller.ts on `client-my-subscriptions`. Active-only cards (status=true && endAt>now), deduped to furthest endAt per target, same Card envelope. No new tables. ⚠ `type=test_series` STAYS Mongo (no ws_test_series* table; also returns empty for SQL-auth customers since keyed by Mongo ObjectId — pre-existing gap). no payment_status→status=true; package_id=package (Mongo inverts pkg/target); course.author=null. Verified vs live DB (real endAt>now filter returns 0 for past-dated staging subs; seeded future sub → pkg card 'CCE'/badge 'Recorded Course'/30d, ebook 'Super Six'/30d). `tsc` clean. |
| 2026-06-18 | 7 | **📊 Wave 7 — admin subscription reads + reports (aggregation) on SQL.** New `src/modules/admin-subscription/` (repo + service), branches the read/report handlers of subscription.controller.ts on `admin-subscription`. 8 handlers: listCourseSubscriptions (+filters+cross-table search) / getById / listPlansForTarget / listEbookSubscriptions + 4 reports (summary/by-course/by-ebook/book-orders via Prisma groupBy/aggregate). No new tables. ⚠ Drift: no payment_status/paid_amount/razorpay/target_package_id on ws_package_course_subscription → package_id=package (Mongo inverts pkg/target), amount=paidAmount, payment_type~method, withMaterial from pc_material_id. ⚠ STAY Mongo: 3 subscription writes (Mongo-only fields + grant-extend → payment wave) + 2 address handlers (CustomerAddress held OFF). Verified vs live DB (2 subs hydrated, reportSummary ₹905/6 orders, by-ebook + book-orders groupBy). `tsc` clean. |
| 2026-06-18 | 7 | **📜 Wave 7 START — client purchase-history (aggregation) on SQL.** New `src/modules/client-purchase-history/` (repo + service), branches purchase-history.controller.ts on `client-purchase-history`. 3 tabs (subscriptions/books/ebooks) — read-only compose of migrated tables, no new tables. ⚠ Drift: ws_package_course_subscription has no payment_status → status=true; SQL package_id=package (Mongo inverts pkg/target, resolve directly); ws_ebook_order has no ebook_id → plan→ebook hop; book items from order_items JSON, AWB-only tracking (no courier). Receipt path stays Mongo. Verified vs live DB (sub badge 'Recorded Course'/7500, book AWB, ebook via plan hop). `tsc` clean. **Classified the wave:** TestSeries/LectureProgress/ExamCountdown/Notification confirmed NO SQL table → those slices stay Mongo. Next slices: admin/subscription, my-subscriptions (TestSeries partial), dashboard (ExamCountdown partial). |
| 2026-06-18 | 6 | **✅ Wave 6 marked DONE + doc sync + doc-protocol hook.** Reconciled status markers (wave table row, §3 header, §0 baseline "hard blocker" note all now ✅; doc-protocol checkbox checked). Added a `Stop` hook to `.claude/settings.json` that warns when `src/` is modified but `docs/MIGRATION_QUERY_CHANGES.md` isn't — automates the per-module doc protocol so it no longer needs a manual reminder (activate via `/hooks` or restart). **Next = Wave 7 (aggregation/finalizers).** |
| 2026-06-18 | 6 | **🎥 Wave 6 — client live-course reads (Groups A+B) on SQL.** Ported entitlement.ts → SQL (hasAccessToAnyLiveCourse/getDaysLeftMap/getOwnedCourseIds/getPurchaseCounts; all on migrated sub/plan/course tables). Wired client reads on `live-course`: listLiveCoursesForClient (courses+plans+daysLeft+isPurchased+hero ranking), listUpcomingLiveBatches (category tab counts — ⚠ PackageCategory no SQL table → id+count only), listSessionsForCourseClient + listAllUpcomingSessions + listLiveNowSessions (via ws_live_session_course join, per-row `subscribed`; live-now=CREATED), getMyScheduleFolder (entitlement-gated JSON folder read). ⚠ STAY Mongo (Wave 7): getLiveCourseForClient detail (subjects+packageCategory), recordings/lecture (folder/video+LectureProgress+AES), getLiveCourseSchedule/listMyScheduleByCategory (timetable+educator populate), listMyLiveCourses/listMyUpcomingSessions (subscription-shaped my-lists). Verified vs live DB (incl. seeded real sub: access/daysLeft 30/my-courses/purchase-count). `tsc` clean. |
| 2026-06-18 | 6 | **🎥 Wave 6 — livechat / livepoll / live-reminder on SQL (admin + client).** Extended `admin-live-course` module (repo+service) + branched the chat/poll/reminder controllers on `live-course`. livechat (client history/ban-status; admin send/history/delete-soft/ban/unban/listBans — socket emits preserved, global ban="" sentinel); livepoll (client active+myVote; admin create-closes-existing/list/results/close/delete — options in ws_live_poll_option child); live-reminder (client list/get reads). ⚠ STAY Mongo: reminder set/remove (provisions Notification+BullMQ), livepoll updatePoll + vote-casting (socket), chat includeDeleted. Verified vs live DB (flag ON): chat 5-chrono, polls+options+results, create/close/delete + send/soft-delete lifecycles. `tsc` clean. **Client live-course reads (14 handlers) still pending — entangled w/ entitlement + Mongo folder/video + LectureProgress.** |
| 2026-06-18 | 6 | **🎥 Wave 6 — admin live-course module on SQL.** New `src/modules/admin-live-course/` (repo + service). Branches live-course core service + plan/subscription controllers on `isLiveCourseMysql()` (`live-course` flag, ON). Admin surface: course CRUD/popular/sessions-list (ws_live_session_course join) + plans (single-default) + subscriptions (list/get/update/delete/grant-extend) + schedule folders/entries (JSON cols, synthetic f-/e- ids; backfilled folders keep Mongo _id). plan.duration=DAYS (computeEndAt asDays). ⚠ STAY Mongo: folder/video-in-folder controllers + createLiveCourse Root-folder (no live_course_id on ws_video_category); admin/live realtime stack (StreamOS/socket). SQL numeric-id validation (create/update/grant). Verified vs live DB flag-ON (4 courses, schedule folder addressable, 15 sessions, grant +90d, CRUD, invalid→422). `tsc` clean. **Client live reads + livechat/livepoll/live-reminder pending (entangled w/ Mongo folder/video + LectureProgress).** |
| 2026-06-18 | 6 | **🎥 Wave 6 START — CREATE LiveCourse SQL tables + backfill (first wave that creates net-new tables).** Design signed off (`schema-changes/LIVE_COURSE_DESIGN.md`). DDL `2026-06-18_create_ws_live_course_tables.sql` → **14 tables** (ws_live_course/_plan/_subscription/_session + _session_course join/_category/_chat_message/_chat_ban/_poll/_poll_option/_poll_vote/_attendance/_reminder/_preview). 14 Prisma models appended; `prisma generate`; `tsc` clean. ObjectId→INT; embeds (schedule/recordings/hlsUrls/timetable/examCountdown)→JSON; poll options[]→child; sessions↔courses many-to-many join; ⚠ plan duration in MONTHS (not DAYS); chat/polls keyed by string live_class_id. **Backfilled** existing Mongo rows (`scripts/backfill-live-course-to-sql.ts`) — counts match Mongo (4/4/10/51/53/9+33/11/52/195/9/4). Customer phone-bridge 14/267 staging (prod better); unbridgeable educator/category refs 0/null. **Modules NOT built yet** (flag OFF). |
| 2026-06-18 | 5 | **🏁 Wave 5 COMPLETE — admin `material` categories + leaf materials done (last admin CRUD module).** New `src/modules/admin-material/` (repo + service). Branches material.controller.ts on `isAdminMaterialMysql()`. ~19 handlers: categories (list/tree/getById/create/update/delete/toggle/reorder/courses/materials) + leaf materials (list/get/create/update/delete/toggle/reorder/bulk-status/bulk-delete). Reuses ws_material_category + ws_material (+ ws_material_category_course for courses sub-resource); no DDL. ⚠ USER-APPROVED: ws_material_category single-parent only (parent 0=root) — ancestors[]/childCategoryIds[] DAG dropped (synthesized []); duplicateCategory STAYS Mongo (BFS clone needs ancestors[]). ws_material minimal — description/thumbnail/fileSize/fileMime/language/isPreview/isPaid/downloadCount dropped+synthesized; list language/isPreview filters no-op. Numeric ids (parseMaterialId replaces ObjectId guards). Enabled `admin-material`. Verified vs live DB (5 categories list/tree=4-roots/CRUD + delete-blocked-when-children, 226 materials CRUD + toggle/reorder/bulk). `tsc` clean. **→ Wave 5 catalog CRUD fully done: plan/master/video/videoCategory/book/ebook/course/package/material + client cart/educator all on SQL.** |
| 2026-06-18 | 5 | **📦 Wave 5 — admin `package` CRUD + types + plans + relations done (large module).** New `src/modules/admin-package/` (repo + service). Branches package.service.ts on `isAdminPackageMysql()`. ~22 handlers: types CRUD + packages CRUD/status/reorder + embedded reorders + plans (attach/list/detach soft) + subscribers + video-relations (set + BFS expand). Mongo embedded specificSubjects[]/materialCategories[]/examCategories[] → SQL pivots ws_package_specific_subject / ws_material_category_package / ws_exam_category_package (create in-txn, update replaces; getPackageById populates subject→{_id,title,image}/material+exam→{_id,title(=name),image}). Reuses ws_package + ws_package_type + pivots + price + subscription + ws_video_category_package_relation. **Schema:** +nullable educator_id on Package model (DB col existed, unmapped). ⚠ ws_package MISSING cols (isPaid/isSmartCourse/isPlannerCourse/subtitle/notificationTopic/packageCategoryId/goalId/goalLabelId/examCountdown*) → DTO synthesizes, write drops; package_type_id NOT NULL→1, exam_id NOT NULL→0 sentinels; with_material/without_material = descriptive *Text. **STAY Mongo:** listPromotedCodes (PromoCode.appliesTo no SQL linkage), listBooks (Book.packageIds no SQL col); chat already on SQL (package-chat). Enabled `admin-package`. Verified vs live DB (6 types, 5 packages w/ embeds e.g. CCE 55/2/35, type+package CRUD lifecycle, attach/detach, 1 subscriber, setVideoRelations + BFS expand=94). `tsc` clean. |
| 2026-06-18 | 5 | **🎓 Wave 5 — admin `course` CRUD + plans + masters done (largest module).** New `src/modules/admin-course/` (repo + service). Branches course.service.ts (thin controllers) + course.controller.ts create/update on `isAdminCourseMysql()`. ~24 handlers: course CRUD/popular + plans (single-default) + materials (pc-material) + video-categories + vcat-relations + pre-requisites. Mongo embedded materialCategories[]/examCategories[] → SQL pivots ws_material_category_course / ws_exam_category_course (create in-txn, update replaces; getCourseById populates material→{_id,title,image}/exam→{_id,name,image}). Reuses ws_course + price + pivots + ws_video_category(_relation) + pc-material; **no DDL**. SQL enums is_featured/purchase→isPopular/isPaid; with_material/without_material/level VARCHAR; course_category_id/educator_id NOT NULL → 0 sentinel. ⚠ **USER-APPROVED:** ws_video_category has NO course_id → createCourse Root-folder automation SKIPPED (folder=null), course video-cats operate on the global table (courseId dropped), deleteCourse skips courseId-scoped folder/relation cleanup (counts=0). SQL numeric-id validation (createCourseSqlSchema + numeric ref parser). Enabled `admin-course`. Verified vs live DB (1 course list/get w/ pivots + 5 plans, create+pivots, update replace-pivots, popular toggle, plan single-default 2→1, delete cascade 4 plans, vcats 152/relations 2456/materials). `tsc` clean. |
| 2026-06-18 | 5 | **📖 Wave 5 — admin `ebook` CRUD + plans + subscriptions done.** New `src/modules/admin-ebook/` (repo + service). Branches `ebook.service.ts` (thin controllers) + `ebook-subscription.controller.ts` on `isAdminEbookMysql()`. 3 surfaces, 17 handlers. Reuses ws_ebook + ws_package_course_ebook_price (shared w/ admin-plan) + ws_ebook_subscription + ws_ebook_order; **no DDL**. ⚠ ws_ebook MISSING cols (isTrending/PDF-upload-status/examCountdown*) → DTO synthesizes, write drops + NOT-NULL "" sentinels. **STAY Mongo:** toggleEbookTrending (no col), BullMQ single-PDF upload pipeline (Mongo upload-status fields), updateEbook S3 cleanup. Backend grant = 1 txn (ws_ebook_order COMPLETE + sub); endAt via planDuration computeEndAt(asDays) — duration is DAYS. ⚠ ws_ebook_order.plan_id NOT NULL → 0 sentinel; customer_id varchar(255) (Prisma Int casts). SQL numeric-id validation (reorder + sub-create) since Mongo zod enforces ObjectId. Enabled `admin-ebook`. Verified vs live DB (2 ebooks full lifecycle, plans + active-filter, sub list/get + backend-grant 30d/90d + toggle + delete). `tsc` clean. |
| 2026-06-18 | 5 | **📚 Wave 5 — admin `book` CRUD + order reads done.** New `src/modules/admin-book/` (repo + service). Wired 9 handlers (books list/get/create/update/delete/toggleStatus/reorder + orders list/get) on `isAdminBookMysql()`. Reuses ws_book + ws_book_order(_item) + ws_customer_shipping; **no DDL**. ⚠ ws_book MISSING cols (isTrending/publication/deliveryEta/termsAndConditions/demoFileName/bookFileName/bookUrl/examCountdown*/packageIds) → DTO synthesizes (mirrors catalog-book), write drops them; NOT-NULL no-default cols get sentinels. **STAY Mongo:** toggleBookTrending (no col), getBookById countdown populates (no SQL ExamCountdown), updateOrderStatus/setOrderTracking/addOrderTrackingEvent (embedded tracking.history[]; ws_book_tracking = 1 flat varchar(10) row), getSettings/updateSettings (**NO ws_book_setting table**). Order items hydrate from the order_items JSON snapshot (child table near-empty); book-name search scans child rows + raw `order_items LIKE`. Enabled `admin-book`. Verified vs live DB (10 books full CRUD lifecycle, 6 orders w/ items+customer+shipping). `tsc` clean. |
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
