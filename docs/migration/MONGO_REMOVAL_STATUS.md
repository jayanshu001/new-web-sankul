# MongoDB Removal — Status & Checkpoints

**Goal:** Permanently remove MongoDB/Mongoose from the codebase. Every module must run
exclusively from MySQL (Prisma). No `isMysqlModule()` gate, no Mongo `else` fallback, no
`MIGRATION_MYSQL_MODULES` flag, no `src/models/**`, no `mongoose` dependency, no Mongo
connection. **No existing API behavior or response shape may change.**

## Why this is safe (the key invariant)

The app **already runs MySQL-only at runtime**:
- `isMysqlModule()` is hard-wired to return `true` (see `src/config/migration.ts`).
- `connectDB()` (Mongo) is gated behind `isMongoFallbackEnabled()`, which returns `false`,
  so Mongo is **never connected**.

Therefore every Mongo `else` branch and every ungated raw-Mongoose code path is
**unreachable dead code today**. Removing it cannot change the behavior of any working
endpoint. The only rules during cleanup:
1. **Never touch the SQL branch** — it is the live code.
2. **Preserve enum/type imports** that happen to come from `src/models/**` (repoint them).
3. `yarn typecheck` (the project's only gate) must stay green after every checkpoint.

## Scope (measured 2026-06-30)

- 119 files reference `isMysqlModule` (358 call sites) — gated services with dead Mongo else.
- 170 files import from `src/models/**`; 247 files import `mongoose`.
- 138 files import `models/` **without** an `isMysqlModule` gate — must be triaged into
  (a) enum/type-only imports → repoint, (b) genuine dead Mongoose query paths → remove.

## Checkpoints

| CP | Scope | Status |
|----|-------|--------|
| CP1 | Boot/config: unconditional Prisma, delete Mongo connect at boot + shutdown; neutralize migration gating | ✅ DONE (typecheck: 0 new errors vs 11-error baseline) |
| CP2 | Strip dead Mongo `else`-branches in the 119 `isMysqlModule`-gated files; drop the import | 🔄 wave 1 ✅ (95 `src/modules/*` services, 0 new typecheck errors). Note: most services were already SQL-only — live branching is controller-side via `is*Mysql()` helpers → folded into CP3. wave 2 (24 directly-gated controllers/utils/socket) pending |
| CP3 | Collapse `is*Mysql()`/`isMysqlModule()` branches in 159 controller/util/socket files | ✅ DONE — waves A (admin 65) + B (client 69) + C (educator/promoter/socket/utils/webhooks) + D (delegating controllers + missed `referral.controller.ts`). All branch call sites collapsed. Fixed 1 regression (`customer.service.ts` return-type widening). **Build = 1 error** (the pre-existing `credit-referrer` baseline; the other 10 baseline errors were in deleted dead payment Mongo). **0 net regressions.** Trivial leftovers for CP4: dead `cmsxOn` helper, always-true `client-cart.service.ts:136` guard. |
| **CP3.5** | **Port ALL Mongo-only functions to SQL** — user decision 2026-06-30. Plan: `docs/migration/CP3_5_PORT_PLAN.md`. Most are delete-dead-body + flip-to-existing-SQL-twin; only ~5 need DDL; no live SQL path depends on Mongo. **CP4 blocked until done.** | 🔄 Batch 0 ✅ · Batch 1 ✅ (exam reads, ebook subs, offline reads, purchasedPackageEndAtMap, updateCourseSubscriptionDates ported; entitlement.ts×2 + video-scope resolvers + buildCourseDetails deleted; PREVIEW_SECONDS relocated; green). Batch 2 🔄 dispatched (ebook writers, poll, sub update/delete, exam solution, live-reminder fix, duplicate clones). DDL-gated deferrals tracked below. |
| CP4 | Delete `src/models/**`, `src/config/db.ts`, `src/config/migration.ts`; remove `mongoose` dep + `connectDB` refs | PENDING |
| CP5 | Remove `MIGRATION_MYSQL_MODULES`/`MONGODB_URI` from env config + `.env.example`; final typecheck; update migration docs | PENDING |

## 🔑 CP3.5 — Mongo-only residue (CRITICAL, blocks CP4)

`MONGO_FALLBACK_ENABLED=false` in `.env` → Mongo is **not connected at runtime**, and
`mongoose.bufferCommands` is off → **every function below already throws at runtime today**
(or is unused). To reach "everything works from SQL, nothing breaks" each must be **ported to
SQL** or **confirmed dead and its route removed**. These all import `models/`, so `models/`
**cannot be deleted (CP4)** until they're resolved.

### Admin
- `notification/dispatcher.ts → processDueNotifications` (legacy cron, pure Mongo)
- `notification/audience.ts → resolveAudience` (whole file pure Mongo)
- `material/material.controller.ts → duplicateCategory`
- `auth/admin.auth.service.ts → createAdminUser` **(AUTH)**
- `auth/admin.auth.routes.ts →` bootstrap `AdminUser.countDocuments` + logout-all `AdminAccessToken.updateMany` **(AUTH)**
- `book/book.controller.ts → updateOrderStatus, setOrderTracking, addOrderTrackingEvent`
- `cms/cms.controller.ts → getFaqType, createFaqType, updateFaqType`
- `course/course.service.ts → createCourse, updateCourse`
- `customer/customer.controller.ts → updateCourseSubscriptionDates`
- `ebook/ebook.service.ts → setEbookUploadStatus, toggleEbookTrending`
- `offline/offline.controller.ts → listBatchEnquiries, deleteBatchEnquiry`
- `package/package.service.ts → listBooks`
- `live/recording.promote.ts → maybeAutoPromoteRecording`
- `livepoll/livepoll.controller.ts → updatePoll`
- `subscription/subscription.controller.ts → updateCourseSubscription, deleteCourseSubscription`
- `videoCategory/videoCategory.controller.ts → duplicateVideoCategory`

### Client
- `live-course/entitlement.ts` — **whole file** (live-course access checks) **HIGH IMPACT**
- `material/entitlement.ts` — **whole file** (material access checks) **HIGH IMPACT**
- `course/course.service.ts → buildCourseDetails, upsertCourseOrderShipping, getOrderDetailsForUser, getOrderForInvoice, normalizeShipping` (order/invoice flow)
- `course/resolveVideoCourse.ts, resolveVideoScope.ts, scopeReachableCategories.ts` (video-scope resolvers)
- `orders/orders.controller.ts → resolveFinalPrice, placeCourseOrder, placeEbookOrder, verifyPayment` (order placement/verify)
- `testSeries/testSeries.controller.ts → previewCheckout`
- `exam/exam.controller.ts → getSolutionDownloadByExam, listMyPastDailyResults, getMyOverallAnalytics, rateExamResult`
- `ebook/ebook.controller.ts → listMySubscriptions`
- `free/free.controller.ts → resolveFreeCategoryIds, resolveAssignedCategoryIds, enrichCoursesForList, enrichPackagesForList`
- `free/freeProgress.controller.ts → freeProductScope`
- `offline/offline.controller.ts → listCities, listCentersByCity, submitBatchEnquiry`
- `package/package.controller.ts → purchasedPackageEndAtMap`
- `promocode/applies-to.ts → loadPlanDiscountMap, countPlanLinks`
- `referral/wallet-debit.ts → validateCoin, applyWalletDebit`
- `purchase-history/receipts.controller.ts → lookupBookThumbnails`
- `live-course/promo.ts` (whole file pure Mongo)
- `live-course/live-course.controller.ts → listMyUpcomingSessions`
- `live-reminder/live-reminder.controller.ts → setLiveSessionReminder, removeLiveSessionReminder` (INCONSISTENCY: Mongo re-read vs SQL service)

### Promoter
- `dashboard/overview.service.ts → buildOverview, buildPromoterOverview, buildAllPromotersOverview`

> Plus: many CP3 files now hold ORPHANED Mongo helpers (callers deleted) still importing `models/`;
> CP4 deletes those once CP3.5 is settled.

## Verification gate (run after every checkpoint)

```bash
yarn typecheck   # MUST be green
```

## ⛔ Current blocker (2026-06-30)

CP3 wave A (admin controllers) was dispatched to 8 agents; **all 8 hit the account
monthly spend limit and died mid-edit**, leaving 39 admin files partially transformed
(build went to 155 errors). Recovery performed:
- Reverted all 39 broken admin files to HEAD via `git checkout HEAD -- <files>`.
- **Preserved** the 2 files that had pre-existing uncommitted work: `src/admin/live/live.controller.ts`
  and `src/admin/live/streamos.service.ts` (verified intact — the dying agent never wrote to them).
- Build is GREEN again: 11 errors = the pre-existing baseline. CP1 + CP2 fully intact.

**To resume:** raise the spend limit, then re-run CP3 from `scratchpad/cp3_worklist.txt`
(159 files) in waves, typecheck after each wave (compare with coords stripped, since payment
controllers shift line numbers). Then CP4 (delete `src/models/**`, `db.ts`, `migration.ts`,
relocate enums out of `models/enums.ts`, drop `mongoose`) and CP5 (env cleanup).

## Verified progress (safe, committed-quality)
- **CP1 DONE** — boot/shutdown Mongo-free.
- **CP2 DONE** — all 95 `src/modules/*` services Mongo-free; live branching is controller-side
  via `is*Mysql()` helpers (now return `true`), to be removed in CP3.

## Change log (newest first)

- 2026-06-30 — CP3 wave A reverted after spend-limit interruption; build restored to green
  (11 baseline). CP3 not started. CP1+CP2 verified intact.

- 2026-06-30 — CP2 wave 1 dispatched: 95 `src/modules/*` services (8 parallel agents).
- 2026-06-30 — CP1 done: `index.ts` connects Prisma unconditionally; `gracefulShutdown.ts`
  closes Prisma+Redis only; removed `connectDB`/`mongoose`/`isMongoFallbackEnabled` from boot.
  Typecheck: 11 pre-existing errors, 0 introduced.
- 2026-06-30 — Doc created; CP1 started. Baseline typecheck = 11 pre-existing errors
  (payment `result.promo` null-checks + `credit-referrer` type) — unrelated to this work.
</content>
</invoke>
