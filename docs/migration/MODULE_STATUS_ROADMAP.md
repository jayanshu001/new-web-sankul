# 📍 Module Status Roadmap — SQL vs MongoDB (as of 2026-06-19)

> **Purpose:** one clear list of every module/surface, marked **✅ on MySQL** or **🔴 still on Mongo**,
> so the path to zero-Mongo is obvious. Generated from the live `.env` flag list (**73 flags ON**) + a code
> audit of remaining Mongoose-only handlers (53 files). **`.env` reconciled with code 2026-06-19** — every
> built+verified flag is enabled; the only built flags NOT in `.env` are intentional (see note below).
>
> **Companion docs:** [`ZERO_MONGO_PLAN.md`](./ZERO_MONGO_PLAN.md) (the 8-cluster work plan + resume marker) ·
> [`MIGRATED_MODULES.md`](./MIGRATED_MODULES.md) (per-module detail) · [`../MIGRATION_QUERY_CHANGES.md`](../MIGRATION_QUERY_CHANGES.md) (change log).
>
> **How "on MySQL" is defined here:** the runtime read/write path executes Prisma/MySQL (flag ON in
> `MIGRATION_MYSQL_MODULES`, or migrated directly). "Still on Mongo" = the handler executes Mongoose with
> no SQL branch (or its SQL branch is intentionally gated OFF — noted as such).

---

## ✅ ON MYSQL — 83 module flags enabled (C1+C2+C3 done) (incl. lecture-progress hub LIVE)

### Catalog content graph (resolver backing live SQL paths)
`catalog-category-tree` (recursive-CTE DAG resolver — descendantsOf/ancestorsOf/reachableCategoryIds/resolveVideoScope/resolveVideoCourseId; backs `client-lecture` + `client-category-video`)

### CMS / config
`app-update` · `version` · `faq` · `banner-slider` · `testimonial` · `department` · `terms` · `popup` · `cms-extra` (social-link/current-affair/live-banner) · `inquiry`

### Customer
`customer-auth` · `customer-lookups` · `customer-profile` · `customer-bank-account` · `customer-address` · `customer-master` (state/district/education/goal admin) · `goal`

### Catalog (listings + nav + detail reads)
`catalog-package-type` · `catalog-course` · `catalog-video` · `catalog-ebook` · `catalog-exam` · `catalog-material` · `catalog-book` · `package-category` · `client-category-video` (video-by-category list + detail) · `client-lecture` (the `/lecture` video-URL endpoint)

### Commerce (reads + masters)
`commerce-price` · `commerce-subscription` · `commerce-ebook-sub` · `commerce-promoter` · `commerce-promocode` · `commerce-educator`

### Commerce / orders (WRITE paths)
`commerce-order` (course + package) · `ebook-order` · `book-order` · `package-order` · `live-course-order` · `test-series-order` · `offline-enquiry`

### Client library / activity
`client-cart` · `client-exam` · `client-educator` · `client-orders` · `client-purchase-history` · `client-my-subscriptions` · `client-folder` · `client-ebook-download` · `client-notification` · `client-lecture-progress` (free-video slice — see "gated" note below) · `client-lecture-note` (text + audio notes + saved-materials) · `tracking` (activity log)

### Live course
`live-course` (admin CRUD + chat/poll/reminder reads + client live reads)

### Offline
`offline-city` · `offline-batch` (center/batch/banner)

### Admin
`admin-auth` · `admin-rbac` · `admin-plan` · `admin-master` · `admin-video` · `admin-book` · `admin-ebook` · `admin-course` · `admin-package` · `admin-material` · `admin-exam` · `admin-subscription`

### Personas
`educator-auth` · `promoter-auth` · `promoter-data` · `referral`

### Mongo-only DATA tables migrated 2026-06-19 (net-new tables)
`exam-countdown` (+category) · `package-category` · ImageNotification (under `client-notification`)

---

## 🟢 NEWLY ACTIVATED (2026-06-19) — `lecture-progress-container` is now ON

Container heartbeats (video + live-session) + Resume/Learning screens (`listMyLearningProgress`,
`listMyCoursesForResume`) + `lectureRef`/`resumeCard` builders are LIVE on SQL. Unblocked once the C1
catalog-detail/catalog/category-video "Continue" badges flipped to `ws_lecture_progress`. The only remaining
Mongo progress readers are `client/dashboard` (C3) and `listLiveCourseRecordings` (C7 realtime — Mongo videos +
Mongo progress, internally consistent, no split).

### Flags that exist in code but are intentionally NOT in `.env`
| Flag | Why excluded |
|---|---|
| `catalog-package` | Module reads were built (structural subset of Mongo) but never wired/consumed — `catalog-package-type` is the live one. Adding it would have no effect. |

---

## 🔴 STILL ON MONGO — needs migration (53 runtime files, grouped by cluster)

> Cluster IDs match [`ZERO_MONGO_PLAN.md`](./ZERO_MONGO_PLAN.md). 🔄 = in progress.

### C1 — Catalog content graph + detail ✅ DONE (largest; unblocked lecture-progress + dashboards)
| File | What | Note |
|---|---|---|
| ~~`client/course/course.service.ts`~~ | ✅ **DONE** `buildCourseDetails` — course detail + per-video progress badge | SQL builder `modules/catalog-course/course-detail.sql.ts`, branched in course.controller `getCourseByIdHandler`, `catalog-course` flag (already ON), 14/14. Materials/tests via pivots + recursive-CTE subtree counts; promos empty (appliesTo no SQL). **Per-video badge now reads ws_lecture_progress — a key C2 unblocker.** |
| ~~`client/catalog/catalog.controller.ts`~~ | ✅ **DONE** catalog tabs (videos/materials/tests) for course+package | `modules/client-catalog/`, flag `client-catalog` ON, 11/11. ⚠ `type=live-course` STAYS Mongo (ws_video_category has no live_course_id; LiveCourse has no material/exam pivots in SQL). Per-video badge reads ws_lecture_progress. |
| ~~`client/material/material.controller.ts` + `material/entitlement.ts`~~ | ✅ **DONE** paid-material listing + gating (4 handlers) | `modules/client-material/`, flag `client-material` ON, 13/13. **ALTER ws_material** +description/thumbnail/file_size/file_mime/language/is_preview/is_paid/download_count (226 rows defaulted). Entitlement: paid unlocked via course/package material-category pivot + ancestor CTE; LiveCourse material unlock not in SQL (drift). |
| ~~`client/search/search.controller.ts`~~ | ✅ **DONE** globalSearch (5 entity types) | `modules/client-search/`, flag `client-search` ON, 18/18. isPaid/plans/isNew + purchase state for course/package/live/book/ebook. |
| `client/live/live.controller.ts`, `client/live-course/entitlement.ts` + `promo.ts`, `listLiveCourseRecordings` | live session playback + entitlement + recordings | **→ C7.** 🔴 LiveSession/recording DATA MUST migrate to SQL (StreamOS/Socket.IO transport stays). The earlier "stays Mongo by decision" was corrected — see C7. |
| ~~`client/lecture-note/lecture-note.controller.ts`~~ | ✅ **DONE** text notes (6 handlers) | `ws_lecture_note`, flag `client-lecture-note` ON, 13/13 |
| ~~`client/lecture-audio-note/lecture-audio-note.controller.ts`~~ | ✅ **DONE** audio notes | `ws_lecture_audio_note`, same flag; S3 stays controller-owned |
| ~~`client/learning/resumeCard.ts`, `lectureRef.ts`~~ | ✅ **DONE** resume-card + lecture-ref builders (SQL branches in lecture-progress service) | gated on `client-lecture-note` OR `lecture-progress-container` |
| ~~`client/course/{scopeReachableCategories,resolveVideoScope,resolveVideoCourse}.ts`~~ | ✅ **DONE** DAG walkers (verified 2026-06-19) | SQL equivalents live in `catalog-category-tree` (`resolveVideoScope`/`resolveVideoCourseId`/`reachableCategoryIds`). All SQL-active callers already route to the SQL builders — `buildLectureRefSql`/`buildResumeNextCardSql` (`client-lecture-progress.service`) + `reportContainerProgress` (SQL heartbeat) + `scopeForCategory` (`client-category-video.service`). These three Mongo files now run **only on the Mongo fallback** (`lectureRef.ts:77`, `resumeCard.ts:163/170`, `progress.controller.ts:126` are all past the early-return SQL branch). **Keep them — they are the intact Mongo fallback.** |

### C2 — Lecture-progress activation
- Enable `lecture-progress-container` once C1 badges are on SQL. (Code already built + verified.)

### C3 — Dashboards
| File | What |
|---|---|
| ~~`client/dashboard/dashboard.controller.ts`~~ | ✅ **DONE** getDashboard / getResumeDashboard / getFreeDashboard — `modules/client-dashboard/` + `client-trending/`, flags `client-dashboard`+`client-trending` ON, 8/8. ALTER ws_book/ws_ebook +is_trending. Resume reuses the LIVE lecture-progress hub; trending/free-cats SQL; banners/testimonials/exam-countdown/notification all SQL. Drift: ws_package no isPaid→all-active; Course free=purchase='no'. |
| ~~`admin/dashboard/dashboard.controller.ts`~~ | ✅ **DONE** revenue cards + totals + time-series + recent lists + counters | `modules/admin-dashboard/`, flag `admin-dashboard` ON, 12/12. Drift: subscription revenue=`amount` (not paidAmount); IST buckets via raw SQL CONVERT_TZ + HOUR/DAYOFMONTH. |
| ~~`educator/dashboard.controller.ts`~~ ✅ DONE (`educator-dashboard` ON, 10/10) · ~~`educator/course.controller.ts`, `educator/package.controller.ts`~~ ✅ DONE (`educator-portal` ON, 9/9 — 8 handlers) | educator portal | dashboard summary done; course/package controllers still Mongo |
| ~~`promoter/dashboard`~~ | ✅ ALREADY DONE | both handlers branch on `isPromoterDataMysql()` (getDashboard + getDashboardOverview→buildPromoterOverviewSql); overview.service.ts is the Mongo fallback only |
| ~~profile-dashboard~~ | ✅ **DONE** subscriptions/pastExams/savedAddresses counts on SQL (`modules/customer-profile/profile-dashboard.sql.ts`, rides `customer-profile` flag, 5/5). Drift: ws_exam_result has no inProgress/submittedAt → pastExams = daily-exam result rows. |

### C4 — TestSeries reads + Wishlist + misc client ✅ CODE COMPLETE (deploy: apply DDL + backfills + flip flags)
| File | What | Note |
|---|---|---|
| ~~`client/testSeries/testSeries.controller.ts`~~ (4/4) , ~~`admin/testSeries/testSeries.controller.ts`~~ | ✅ **DONE** test-series client + **admin** | client `client-testseries` (4/4). Admin: `modules/admin-testseries` (flag `admin-testseries`), all 20 handlers (CRUD + content-cat + exam-link + price + subscription + orders). |
| ~~`client/wishlist/wishlist.controller.ts`~~ | ✅ **DONE** wishlist (4 handlers) | `modules/client-wishlist` (`ws_wishlist` created in DDL). Flag `client-wishlist` pending DDL-apply + backfill + verify. |
| ~~`client/goal/goal.client.service.ts`~~ | ✅ **DONE** client goals (4 handlers) | Branched on `isGoalMysql()`. `modules/goal` now assigns stable label ids in `ws_goal.labels`; selection stored on `ws_customer.goal` JSON. **Activation needs** a label-id backfill for existing goals + selection remap (else historical selections won't resolve). |
| ~~`client/tracking/tracking.controller.ts`~~ | ✅ **DONE** client activity-log write | `createActivity` added to `modules/tracking` (`ws_activity_log`, flag `tracking` already ON); `trackEvent` branched. Closes the admin(SQL)/client(Mongo) write split. |
| ~~`client/purchase-history/receipts.controller.ts`~~ (3/3) | ✅ **DONE** receipts | eBook + **book + course** on SQL (`get{Ebook,Book,Course}ReceiptMysql`, `client-purchase-history` ON). Accepted drift: book totals = `amount` only; course `paidAt`=null, razorpay via `ws_package_course_order` hop. |
| ~~`client/referral/credit-referrer.ts`~~ | ✅ **DONE** referral credit on purchase | Branched on `isReferralMysql()`. Atomic `creditReferralReward` (points + CREDIT ledger), idempotent on `(orderId, referrerId)`. |

### C5 — Promocode appliesTo 🟡 DECISION MADE + foundation laid (full port pending — large, payment-adjacent)
> Net-new `ws_promo_code` table (`PromoCodeRule` Prisma model) created for the admin-UI PromoCode system (separate from
> legacy `ws_promocode`). Full module port (5 entity types × 4 plan tables + plan-link % + client apply) specced in
> [`C4_BLOCKERS_DECISIONS.md`](./C4_BLOCKERS_DECISIONS.md). Recommend applying the C4+C6+C5 DDL/backfill batch first.

| File | What |
|---|---|
| ~~`client/promocode/promocode.controller.ts`~~ + applies-to.ts | ✅ **DONE** apply-promo on SQL (appliesTo + discount) |
| ~~`admin/promocode/promocode.controller.ts`~~ | ✅ **DONE** CRUD + **plan-links** on SQL (`modules/promo-code`). `ws_promoted_package_course_ebook.plan_kind` ALTER added (holds livePlan/testSeries plan ids). Drift: picker exam-type grouping empty (ws_package no goalLabelId). |

### C6 — Embedded examCountdown populates ✅ CODE COMPLETE (deploy: apply ALTER + backfill)
| File | What |
|---|---|
| ~~book/ebook/course detail populates~~ | ✅ **DONE** — `ws_{book,course,ebook}` got `exam_countdown_ids`+`exam_countdown_category_ids` JSON cols (mirrors ws_live_course). Resolver `populateExamCountdowns` in `modules/exam-countdown`; stored on admin write + populated on admin detail (all 3) + client course detail. Client book/ebook detail never surfaced these (contract). Backfill `scripts/backfill-c6-examcountdown-cols.ts`. |

### C7 — Realtime / streaming — **DATA MUST migrate to SQL (goal: drop the Mongo connection)**
> ⚠️ CORRECTION 2026-06-19: the earlier "transport stays Mongo by design / your decision" note was WRONG and is
> removed. The goal is FULL Mongo removal. The real distinction: the **transport** (Socket.IO pub/sub, WebSocket
> frames, StreamOS video, BullMQ jobs) runs on **Redis / StreamOS — never Mongo**, so it needs no migration and does
> not block dropping `connectMongo`. But the **DATA** these handlers persist (LiveSession, chat logs, reminders,
> recording metadata) IS in Mongo (every file below imports `models/`) and **MUST be migrated to SQL** — add tables
> where none exist.
| File | What | Plan |
|---|---|---|
| ~~`admin/live/live.controller.ts`, `live.guards.ts`, `recording.promote.ts`~~ | ✅ **DONE** live class control + **recording→video promotion** on SQL (`modules/admin-live`, flag `admin-live`) — `ws_live_session`(+_course/_attendance), promotion uses `ws_video.live_session_id` + `ws_video_category.subject_key`. StreamOS/socket unchanged. |
| ~~`admin/live-course/live-course.folder.controller.ts`, `live-course.video.controller.ts`~~ | ✅ **DONE** folders/videos (`modules/admin-live-course`, flag `admin-live-course`) — ws_video/ws_video_category(+relation)/ws_live_course | folder-tree via catalog-category-tree DAG |
| ~~`client/live-reminder/live-reminder.service.ts`~~ | ✅ **DONE** reminders (`modules/client-live-reminder`, flag `client-live-reminder`) — ws_live_session_reminder + ws_notification | BullMQ (Redis) stays |
| ~~`admin/pdfUpload/pdfUpload.controller.ts` + `pdfUpload.scheduler.ts`~~ | ✅ **DONE** job lifecycle + **ebook URL/status write** on SQL (`modules/pdf-upload`, flag `pdf-upload`) — net-new `ws_pdf_upload_job`, ws_ebook upload cols. BullMQ/Socket.io stay. |
| ~~`socket/livechat.socket.ts`, `socket/camera-ingest.ts`~~, `socket/pdf-progress.socket.ts` | ✅ **DONE** chat/ban/poll/attendance + camera session lookup on SQL (reuse `live-course`/`admin-live` flags). `pdf-progress.socket` has no DB ops. WS/Redis transport unchanged. |

### C8 — Infra / cross-cutting (some need NEW tables / decisions)
| File | What | Note |
|---|---|---|
| ~~`admin/permissionCategory/permissionCategory.controller.ts`~~ | ✅ **DONE** permission category | net-new `ws_permission_category` + `ws_permissions.category_id` ALTER; `modules/permission-category`; backfill written. ✅ `permission/catalog.controller.ts` also migrated (`modules/permission-catalog`, flag `permission-catalog`). ✅ `notification/audience.ts` was already SQL-routed via `admin-notification` (no change). |
| ~~`admin/referral/content.controller.ts`~~ | ✅ **DONE** referral FAQ/terms | net-new `ws_refferal_term`+`ws_refferal_faq`; `modules/referral-content` (flag `referral-content`); backfill `scripts/backfill-c8-referral-content.ts`. |
| ~~`admin/promoter/promoter.controller.ts`~~ | ✅ **DONE** all handlers on SQL (`modules/admin-promoter`) — CRUD + subscriptions + promocodes + dashboards. `ws_package_course_subscription` got promoter_id/%/paid_amount ALTER. Drift: no promocode_id col → scope filter ignored. |
| `admin/notification/audience.ts` | audience resolution (residual) | mostly SQL already |
| `utils/crm.ts`, ~~`utils/pdfCourseReceipt.ts`~~, ~~`libs/core/generate.ts`~~ | CRM/receipt/PDF | ✅ crm.ts = no-DB stub; ✅ pdfCourseReceipt (`pdf-course-receipt`); ✅ generate **all** receipts on SQL — course (`course-receipt`), book (`book-receipt`), ebook (`ebook-receipt`), exam-solution (`exam-solution`). |

### Final step — ZERO-MONGO (drop `connectMongo`)
> Adding SQL branches is NOT sufficient. ~167 `src/` files still import a `models/` (Mongo) model — most are
> migrated-with-fallback (the isMysql-gated dual paths). To drop the Mongo connection ENTIRELY:
> 1. Migrate every genuinely-Mongo-only handler (C5 plan-links, ALL C7 persistence, C8 residual, admin testSeries,
>    educator course/package, catalog live-course tab) — add tables/ALTERs where none exist, port the queries.
> 2. Apply all DDL + run all backfills + flip every flag permanently ON.
> 3. **Delete the Mongo fallback branches** and the `models/` imports across all ~167 files; delete `src/models/**`.
> 4. Confirm zero executing `models/` imports → drop `connectMongo` from `src/index.ts` + remove mongoose dep.

---

## Net-new tables this push still needs
- ✅ `ws_lecture_note`, `ws_lecture_audio_note` (created; wiring pending)
- 🟡 `ws_wishlist`, `ws_test_series_content_category`, `ws_test_series_exam` (C4) — **DDL + Prisma models written** (`schema-changes/2026-06-19_create_c4_tables.sql`); NOT yet applied to DB + backfill pending
- ⏭️ permission-category, referral FAQ/terms tables (C8) — or a decision to drop
- 🟡 examCountdown join columns on ws_book/ws_course/ws_ebook (C6) — **DDL + Prisma + backfill written** (`schema-changes/2026-06-19_add_examcountdown_cols_catalog.sql`); apply + backfill pending

## Suggested order (dependency-driven)
**C1 → C2 → C3 → C4 → C6 → C5 → C8 → C7 → remove Mongo.**
(C1 unblocks the most; realtime C7 last since it's riskiest and transport stays Mongo anyway.)
