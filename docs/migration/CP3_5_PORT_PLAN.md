# CP3.5 — Mongo-Only Residue → MySQL/Prisma Porting Plan

Analysis-only plan (no code changed) for porting the last Mongo-only functions to Prisma so
nothing depends on Mongo. App is MySQL-only at runtime; Mongo is disconnected. Source list:
`scratchpad/MONGO_ONLY_RESIDUE.md`. Schema reference: `prisma/schema.prisma` (~121 `ws_*` models).

## TL;DR — key findings

- **No live SQL path (payment controllers or any SQL `*.service.ts`) calls any Mongo helper.**
  The `src/client/payment/*-payment.controller.ts` controllers import only SQL services
  (`modules/promo-code`, `modules/live-course-order`, `customer-address.repository`) plus the
  **pure, DB-agnostic** `computePromoDiscount`/`promoCovers` from `client/promocode/applies-to.ts`.
  The entitlement / wallet-debit / plan-link / order helpers are NOT reachable from checkout.
- **A large fraction of the residue is already superseded by live SQL twins** — porting many of
  these means *retire/delete the Mongo body + flip the caller*, not re-implement.
- **DDL is needed in only 5 places** (see NEEDS-DDL). Most "STAYS Mongo" comments are stale.
- **2 worklist flags were wrong:** `client/referral/referral.controller.ts` is already fully SQL
  (nothing to port); several `free.controller.ts` / exam `recomputeAnalytics` / `freeProductScope`
  helpers are dead code (delete, no port).

---

## Summary table

| function | file | target table(s) | SCHEMA-OK / NEEDS-DDL | live-SQL caller? | complexity |
|---|---|---|---|---|---|
| processDueNotifications | admin/notification/dispatcher.ts | ws_notification | SCHEMA-OK | no (super­seded by sqlDispatchScheduledById) | trivial (retire) |
| resolveAudience | admin/notification/audience.ts | ws_customer, ws_package_course_subscription | SCHEMA-OK | no (SQL twin exists) | trivial (delete) |
| duplicateCategory | admin/material/material.controller.ts | ws_material_category, ws_material | SCHEMA-OK | no | hard (recursive clone, ancestors[]→parent) |
| createAdminUser | admin/auth/admin.auth.service.ts | ws_users (+AdminModelHasRole) | NEEDS-DDL: ws_users.deleted | no | moderate (AUTH) |
| countDocuments + token updateMany | admin/auth/admin.auth.routes.ts | ws_users, ws_admin_access_tokens | NEEDS-DDL: ws_users.deleted | no | moderate (AUTH; move to service) |
| updateOrderStatus / setOrderTracking / addOrderTrackingEvent | admin/book/book.controller.ts | ws_book_order, ws_book_tracking | NEEDS-DDL: order date cols + tracking-history table | no | hard |
| getFaqType / createFaqType / updateFaqType | admin/cms/cms.controller.ts | (ws_faq_type — absent) | NEEDS-DDL: new ws_faq_type table+model | partial (listFaqTypes already SQL) | moderate |
| createCourse / updateCourse | admin/course/course.service.ts | ws_course | SCHEMA-OK | already ported (Mongo fallback) | trivial (retire) |
| updateCourseSubscriptionDates | admin/customer/customer.controller.ts | ws_package_course_subscription | SCHEMA-OK | no | trivial |
| setEbookUploadStatus | admin/ebook/ebook.service.ts | ws_ebook | SCHEMA-OK (comment stale) | no | moderate (BullMQ writer) |
| toggleEbookTrending | admin/ebook/ebook.service.ts | ws_ebook | SCHEMA-OK (comment stale) | no | trivial |
| listBatchEnquiries / deleteBatchEnquiry | admin/offline/offline.controller.ts | ws_offline_enquiry | SCHEMA-OK (verify dataset) | partial (twin exists) | moderate |
| listBooks | admin/package/package.service.ts | ws_book | NEEDS-DDL: book↔package linkage | no | moderate-hard |
| maybeAutoPromoteRecording | admin/live/recording.promote.ts | live tables | SCHEMA-OK | no (sqlAuto twin live) | trivial (retire) |
| updatePoll | admin/livepoll/livepoll.controller.ts | ws_live_poll, ws_live_poll_option | SCHEMA-OK | partial (twin lacks options) | moderate (extend twin) |
| updateCourseSubscription / deleteCourseSubscription | admin/subscription/subscription.controller.ts | ws_package_course_subscription | SCHEMA-OK | no | trivial-moderate |
| duplicateVideoCategory | admin/videoCategory/videoCategory.controller.ts | ws_video_category | SCHEMA-OK | no | hard (DAG clone + slug) |
| buildOverview / buildPromoterOverview | promoter/dashboard/overview.service.ts | promoter tables | SCHEMA-OK | no (SQL twin live) | trivial (retire) |
| buildAllPromotersOverview | promoter/dashboard/overview.service.ts | promoter tables | SCHEMA-OK | **no twin, no consumer** | moderate (confirm still wanted) |
| hasAccessToAnyLiveCourse + days/map helpers | client/live-course/entitlement.ts | ws_live_course_subscription | SCHEMA-OK | already ported (liveSql twin live) | trivial (flip callers) |
| buildPurchaseOptions | client/live-course/entitlement.ts | ws_live_course, ws_live_course_plan | SCHEMA-OK | SQL twin buildPurchaseOptionsSql live | moderate (verify duration unit) |
| resolveLivePreviewState / getOrCreatePreview | client/live-course/entitlement.ts | ws_live_session_preview | SCHEMA-OK | no (SQL preview in live.controller) | moderate (Prisma upsert) |
| PREVIEW_SECONDS (const) | client/live-course/entitlement.ts | — | n/a | **LIVE** (live/live.controller.ts) | trivial (relocate const) |
| material entitlement (4 fns) | client/material/entitlement.ts | ws_material*, subscriptions | SCHEMA-OK | already re-impl in client-material.service | moderate (delete orig) |
| computePromoDiscount / promoCovers / resolvePlanDiscount | client/promocode/applies-to.ts | n/a (pure) | n/a | **LIVE** (payment controllers) | none (keep, no Mongo) |
| loadPlanDiscountMap / countPlanLinks | client/promocode/applies-to.ts | ws_promoted_package_course_ebook | SCHEMA-OK | no (SQL twins exist) | moderate |
| validateCoin / applyWalletDebit | client/referral/wallet-debit.ts | ws_customer, ws_refferal_transaction | SCHEMA-OK | **no importers (orphaned)** | moderate ($transaction) |
| resolveLivePromo (+resolveReferral) | client/live-course/promo.ts | ws_promocode, ws_customer, ws_refferal_program | SCHEMA-OK | only testSeries previewCheckout (Mongo branch) | hard |
| lookupBookThumbnails | client/purchase-history/receipts.controller.ts | ws_book | SCHEMA-OK | no (SQL receipt twin gated) | trivial |
| buildCourseDetails | client/course/course.service.ts | many ws_* | SCHEMA-OK | already ported (catalog-course/course-detail.sql) | hard (retire) |
| upsertCourseOrderShipping / getOrderDetailsForUser / getOrderForInvoice / normalizeShipping | client/course/course.service.ts | ws_customer_shipping, ws_customer_address, ws_package_course_order | SCHEMA-OK | no SQL twin yet | hard |
| resolveVideoCourseId | client/course/resolveVideoCourse.ts | ws_video_category*, ws_course | SCHEMA-OK | already ported (category-tree.service) | moderate (retire) |
| resolveVideoScope | client/course/resolveVideoScope.ts | ws_video_category*, ws_course, ws_package | SCHEMA-OK | SQL twin live (category-tree) | hard (verify parity) |
| scopeReachableCategories | client/course/scopeReachableCategories.ts | ws_video_category*, ws_package*, ws_lecture_progress | SCHEMA-OK | SQL path in category-tree.service | hard |
| purchasedPackageEndAtMap | client/package/package.controller.ts | ws_package_course_subscription | SCHEMA-OK | no (commerce-subscription.service alt) | moderate |
| previewCheckout | client/testSeries/testSeries.controller.ts | ws_test_series_price | SCHEMA-OK | no (depends on resolveLivePromo) | hard |
| listCities / listCentersByCity | client/offline/offline.controller.ts | ws_offline_city, ws_offline_center, ws_offline_batch | SCHEMA-OK | no (SQL svcs exist) | trivial/moderate |
| submitBatchEnquiry | client/offline/offline.controller.ts | ws_offline_enquiry | NEEDS-DDL: other_qualification col | no | moderate |
| resolveFinalPrice / placeCourseOrder / placeEbookOrder / verifyPayment | client/orders/orders.controller.ts | ws_package_course_subscription, ws_ebook_order, ws_ebook_subscription | NEEDS-DDL (payment cluster) | **LIVE routes /orders/\*** (but superseded by /payment/\*) | hard |
| listMySubscriptions | client/ebook/ebook.controller.ts | ws_ebook_subscription, ws_ebook | SCHEMA-OK | no | moderate |
| getSolutionDownloadByExam | client/exam/exam.controller.ts | (PDF lib) | SCHEMA-OK (fix ObjectId guard) | route live | moderate |
| listMyPastDailyResults | client/exam/exam.controller.ts | ws_exam_result, ws_exam | SCHEMA-OK | no | moderate |
| getMyOverallAnalytics | client/exam/exam.controller.ts | ws_exam_result_detail_analytics | SCHEMA-OK | no | trivial |
| rateExamResult | client/exam/exam.controller.ts | ws_exam_result | SCHEMA-OK (drop ObjectId guard) | no | trivial-moderate |
| recomputeAnalytics | client/exam/exam.controller.ts | — | n/a | **DEAD — delete** | delete |
| resolveFreeCategoryIds / resolveAssignedCategoryIds / enrichCoursesForList / enrichPackagesForList | client/free/free.controller.ts | — | n/a | **DEAD — reimpl in SQL** | delete |
| freeProductScope | client/free/freeProgress.controller.ts | — | n/a | **DEAD — never called** | delete |
| listMyUpcomingSessions | client/live-course/live-course.controller.ts | ws_live_course_subscription, ws_live_session, ws_live_session_course | SCHEMA-OK | no | moderate |
| setLiveSessionReminder / removeLiveSessionReminder | client/live-reminder/live-reminder.controller.ts | ws_live_session_reminder | SCHEMA-OK | service already SQL (controller re-reads Mongo) | moderate (fix inconsistency) |
| referral.controller.ts (all handlers) | client/referral/referral.controller.ts | modules/referral, customer-bank-account | already SQL | already migrated | none (false alarm) |

---

## NEEDS-DDL section (human must author SQL + backfill)

Only **5** items need schema changes. Everything else is code-only porting.

1. **`ws_faq_type`** — table does not exist; no `FaqType` Prisma model.
   Needed by `admin/cms/cms.controller.ts` `getFaqType` / `createFaqType` / `updateFaqType`.
   Create `ws_faq_type` (id, name/title, status, timestamps) + add `FaqType` model + transformer.
   (`listFaqTypes` already has a SQL service, so the read shape exists to mirror.)

2. **`ws_users.deleted`** — soft-delete boolean column absent.
   Needed by `admin/auth/admin.auth.service.ts createAdminUser` (uniqueness check) and
   `admin/auth/admin.auth.routes.ts` super-admin bootstrap count.
   Note: admin **role is not a column** — assign via existing `AdminModelHasRole` pivot.

3. **`ws_book_order`** — add `shipped_at`, `delivered_at`, `cancelled_at` (DateTime, nullable).
   Needed by `admin/book/book.controller.ts updateOrderStatus`.

4. **Book-order tracking-history table** (e.g. `ws_book_order_tracking_event`:
   id, order_id, status, location, remarks, timestamp). `ws_book_tracking` holds only a single
   current status, not the Mongo embedded `tracking.history[]` array.
   Needed by `setOrderTracking` / `addOrderTrackingEvent`.

5. **Book ↔ package linkage** — `ws_book` has no package relation (Mongo `Book.packageIds[]`).
   Add `ws_book.package_ids` (JSON) **or** a `ws_package_book` join table.
   Needed by `admin/package/package.service.ts listBooks`.

6. **`ws_offline_enquiry.other_qualification`** (VARCHAR NULL) — only if `submitBatchEnquiry` is
   routed through the existing `ws_offline_enquiry` table (Mongo `OfflineBatchEnquiry` carries
   `otherQualification` + a constrained qualification enum). Alternative: dedicated
   `ws_offline_batch_enquiry` table. Also note `submitBatchEnquiry` still validates a 24-hex
   ObjectId `batchId` — id-space must convert to int.

7. **Payment cluster (orders.controller writes)** — `placeCourseOrder` / `placeEbookOrder` /
   `verifyPayment` / `resolveFinalPrice` depend on the deferred payment-wave structures:
   `PromoCode.appliesTo` per-plan link discount (the tracked `ws_promoted_package_course_ebook`
   `plan_kind` ALTER) and `ReferralProgram` config usage. Verify these before porting — but see
   note below: these `/orders/*` routes appear **superseded** by `/payment/*`, so the likely
   action is **retire, not port**.

**No DDL needed** for the two "duplicate" clones — Mongo `ancestors[]` (material) and
`childCategoryIds[]` (videoCategory DAG) are materialized-path/DAG structures that rebuild from
the existing SQL `parent` adjacency column at clone time.

---

## Shared helpers called by live SQL paths (the critical risk) — CLEARED

**Result: none of the Mongo helpers are reachable from a live SQL path.** Verified per helper by
grepping all importers in `src/`:

- `client/payment/*-payment.controller.ts` + `verify.controller.ts` import **only**:
  - SQL functions from `modules/promo-code/promo-code.service.ts`
    (`resolvePromoForPlanSql`, `addressBelongsToCustomerSql`, `findActiveByCode`, `promoCovers`,
    `loadLivePlanDiscountsSql`, `loadTestSeriesPlanDiscountsSql`),
  - the **pure** `computePromoDiscount` from `client/promocode/applies-to.ts` (no Mongoose — keep as is),
  - `modules/live-course-order/live-course-order.service.ts` (SQL) and `customer-address.repository.ts` (SQL).
- `client/live-course/entitlement.ts` → Mongo `loadPlanDiscountMap`/`countPlanLinks` → **no** payment caller.
- `client/material/entitlement.ts` → **no** payment caller (re-implemented in
  `modules/client-material/client-material.service.ts`).
- `client/referral/wallet-debit.ts` (`validateCoin`, `applyWalletDebit`) → **ZERO importers
  anywhere** — fully orphaned.
- `client/live-course/promo.ts` (`resolveLivePromo`) → only caller is the **Mongo branch** of
  `client/testSeries/testSeries.controller.ts previewCheckout`.

**The only live import of any residue file** is the constant `PREVIEW_SECONDS` (=180) from
`client/live-course/entitlement.ts`, imported by `client/live/live.controller.ts:8`. When the
Mongo entitlement file is deleted, **relocate this constant** (e.g. into the live SQL module) so
the live preview path keeps compiling.

Helpers whose logic already lives in SQL twins (port = delete original + flip the remaining Mongo
caller, not re-implement):
- `modules/admin-live-course/admin-live-course.service.ts` — live-course entitlement + purchase options
- `modules/client-material/client-material.service.ts` — material entitlement
- `modules/promo-code/promo-code.service.ts` — promo / plan-discount SQL
- `modules/catalog-course/course-detail.sql.ts` — `buildCourseDetails`
- `modules/catalog-category-tree/category-tree.service.ts` — video-scope resolvers
- `modules/promoter-data/promoter-data.service.ts` — promoter overview/dashboard
- `modules/admin-notification/admin-notification.service.ts` — `resolveAudience` + scheduled dispatch

---

## Two inconsistencies / bugs to resolve in this checkpoint

1. **live-reminder Mongo re-read (flagged bug).** `client/live-reminder/live-reminder.controller.ts`
   service + 3 read handlers are SQL, but `setLiveSessionReminder` re-reads the just-written row via
   `LiveSessionReminder.findById(result.reminder._id).populate("liveSessionId")` then shapes it with
   Mongo `publicReminder()`. With a SQL int `_id`, the Mongo `findById` returns null → response loses
   the nested `session` object, diverging from the SQL read handlers. `removeLiveSessionReminder` also
   gates on `Types.ObjectId.isValid(liveSessionId)`, which rejects SQL int ids outright. Fix: drop the
   Mongo re-read, reshape via the SQL `sqlReminderToPublic`, and replace the ObjectId guard with
   `liveSql.parseLiveId`. (BullMQ/notification provisioning in the service stays — transport, not data.)

2. **orders.controller writes are LIVE but superseded.** `orders.routes.ts` is mounted at
   `/api/v1/client/orders`; `placeCourseOrder` (`/orders/course`), `placeEbookOrder` (`/orders/ebook`),
   `verifyPayment` (`/orders/verify-payment`) are reachable Mongo handlers. The newer
   `client/payment/payment.routes.ts` offers the canonical SQL `/payment/create-order/*` + `/payment/verify`.
   **Confirm with product whether the FE still calls `/orders/*` writes.** If `/payment/*` is canonical,
   retire these three handlers rather than port. Do not silently delete — they are still wired.

---

## Dead code (delete, no port)

- `client/exam/exam.controller.ts recomputeAnalytics` — never called (SQL `repo.recomputeAnalytics`
  runs inside `svcSaveAnswers`/`svcSubmitAttempt`).
- `client/free/freeProgress.controller.ts freeProductScope` — never called (`sqlListFreeResume` used).
- `client/free/free.controller.ts`: `resolveFreeCategoryIds`, `resolveAssignedCategoryIds`,
  `enrichCoursesForList`, `enrichPackagesForList` — no live importer; reimplemented in
  `modules/client-free` / `modules/client-trending`.
- `admin/notification/audience.ts resolveAudience`, `admin/notification/dispatcher.ts
  processDueNotifications`, `admin/live/recording.promote.ts maybeAutoPromoteRecording`,
  promoter `buildOverview`/`buildPromoterOverview`, Mongo `createCourse`/`updateCourse` bodies —
  all superseded by wired SQL twins.
- `client/referral/referral.controller.ts` — already fully SQL; worklist flag was wrong.

---

## Recommended batch order

**Batch 0 — delete dead code** (no port, no risk): the Dead-code list above. Relocate
`PREVIEW_SECONDS` before deleting `live-course/entitlement.ts`.

**Batch 1 — reads / listings (trivial-moderate, SCHEMA-OK):**
`getMyOverallAnalytics`, `rateExamResult` (drop ObjectId guard), `listMySubscriptions`,
`listCities`/`listCentersByCity`, `listMyPastDailyResults`, `listMyUpcomingSessions`,
`lookupBookThumbnails`, `updateCourseSubscriptionDates`, `purchasedPackageEndAtMap`,
`listBatchEnquiries`/`deleteBatchEnquiry`. Plus flip the already-ported callers
(live-course entitlement, material entitlement, course-detail, video-scope resolvers,
promoter overview, createCourse/updateCourse fallback) to retire their Mongo bodies.

**Batch 2 — admin CRUD + live/exam (moderate):**
`toggleEbookTrending`, `setEbookUploadStatus` (BullMQ writer — careful), `updatePoll`
(extend SQL twin to handle options), `updateCourseSubscription`/`deleteCourseSubscription`,
`getSolutionDownloadByExam` (fix id guard), `resolveLivePreviewState`/`getOrCreatePreview`,
the live-reminder inconsistency fix. DDL-gated here: `getFaqType`/`createFaqType`/`updateFaqType`
(needs `ws_faq_type`), `listBooks` (needs book↔package linkage), `duplicateCategory` /
`duplicateVideoCategory` (hard recursive clones, no DDL).

**Batch 3 — orders / checkout / promo / wallet (hard):**
`loadPlanDiscountMap`/`countPlanLinks`, `validateCoin`/`applyWalletDebit` (wire into SQL verify
with Prisma `$transaction`), `resolveLivePromo` + testSeries `previewCheckout` (together),
`upsertCourseOrderShipping`/`getOrderDetailsForUser`/`getOrderForInvoice`/`normalizeShipping`,
book-order tracking (`updateOrderStatus`/`setOrderTracking`/`addOrderTrackingEvent` — DDL),
`submitBatchEnquiry` (DDL), and the `/orders/*` write handlers (likely retire — confirm first).

**Batch 4 — payment-verify + auth last (highest blast radius):**
`createAdminUser` + `admin.auth.routes.ts` count/token teardown (needs `ws_users.deleted`;
move DB calls out of the route file into the service). Treat the remaining payment-cluster
write path here. Auth and payment changes per CLAUDE.md require explicit confirmation before edits.

---

*Generated as analysis only — no source or schema was modified. Log actual query/schema changes in
`docs/MIGRATION_QUERY_CHANGES.md` (newest first) as each port lands.*
