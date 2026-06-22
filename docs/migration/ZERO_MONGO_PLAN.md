# ✅ MIGRATION COMPLETE — 2026-06-22 · running MySQL-only

WebSankul now runs on **MySQL (Prisma) only**. Every admin + client + educator + promoter API, every write path, background job, and boot-time seeding serves from MySQL. **MongoDB is disconnected by default** (`MONGO_FALLBACK_ENABLED=false` → `connectDB()` is skipped at boot); the app boots and serves with **no Mongo connection** — empirically verified (22 endpoints returned 200, 0 Mongo calls at boot). `MONGODB_URI` is no longer required. Re-enabling Mongo is a single reversible flag.

The remaining `src/models/**` + `mongoose` dependency is now **dormant dead code** (nothing connects to Mongo).

**This document is retained for historical context.** The live source of truth for changes is `docs/MIGRATION_QUERY_CHANGES.md`. Anything below describing "pending / in-progress / flag OFF / blocker / Mongo fallback / remaining" reflects an earlier point in time and is **superseded** by the completed state above.

# 🎯 Zero-MongoDB Plan — the final push to "all data on MySQL"

> **Overall status — ✅ DONE (superseded; see banner): ALL clusters C1–C8 + Final are complete. The app runs MySQL-only.**

> Created 2026-06-19. Goal: **every runtime read/write on MySQL; remove the Mongo connection.**
> Source of truth for what remains. Audit basis: 54 real handler/service files still executing a
> Mongo-only path (no `isMysql` branch), found via `grep models/ src` minus models/modules/migrations/
> validation/routes/seeder. Newest status in [`MONGO_ONLY_MIGRATION_PLAN.md`](./MONGO_ONLY_MIGRATION_PLAN.md).

## Clusters (sequenced by dependency & risk)

### C1 — Catalog content graph + detail (UNBLOCKS the most) — **largest** — 🔄 IN PROGRESS — ✅ DONE (superseded; see banner)
The DAG resolver (`catalog-category-tree`) exists; these consumers run in ObjectId space and must flip whole.
- ✅ **DONE** `client/course/lecture.controller.ts` (the `/lecture` video-URL encryption endpoint) — new module
  `src/modules/client-lecture/client-lecture.service.ts`, flag `client-lecture` ON, verified 5/5. Membership check
  uses `catalog-category-tree.reachableCategoryIds("course")` (SQL has no VideoCategory.courseId col). encryptVideoSource
  is DB-agnostic (controller-owned).
- ✅ **DONE** category-video reads: `client/categories/categories.controller.ts` `listVideosByCategory` +
  `getVideoByCategory` → new module `src/modules/client-category-video/`, flag `client-category-video` ON, verified 8/8.
  Uses `catalog-category-tree.resolveVideoScope` (returns {kind,id}); per-video progress badge reads `ws_lecture_progress`;
  encryptVideoEnvelope/resolveVideoSource stay controller-owned. Drift: ws_video has no live-session col → per-row
  recordings empty (FE synthetic ladder). This proves the `resolveVideoScope` SQL walker end-to-end.
- ⏭️ `client/course/scopeReachableCategories.ts`, `resolveVideoScope.ts`, `resolveVideoCourse.ts` (DAG walkers — SQL
  equivalents EXIST in catalog-category-tree; the categories slice already routes resolveVideoScope. Remaining callers of
  resolveVideoCourseId: resumeCard/lectureRef/lecture-note/lecture-audio-note — flip with the lecture-note slice).
- 🔄 **lecture-note cluster (IN PROGRESS — tables + Prisma DONE, code pending):**
  - ✅ Tables created: `ws_lecture_note`, `ws_lecture_audio_note` (DDL `schema-changes/2026-06-19_create_lecture_note_tables.sql`, applied; both empty). Prisma models `LectureNote`/`LectureAudioNote` added + generated.
  - ⏭️ TODO: backfill (Mongo 4 + 2 rows; customer/video/session/course ids → SQL int by name/id bridge — staging may not bridge, like other customer-keyed backfills), then build `src/modules/client-lecture-note/` service + flip `client/lecture-note/lecture-note.controller.ts` (6 handlers: create/list/listSavedMaterials/update/delete + authorizeRecorded/authorizeLive) and `client/lecture-audio-note/lecture-audio-note.controller.ts` (parallel + S3 audioKey delete). authorizeRecorded uses resolveVideoCourseId→SQL + course-sub gate; authorizeLive uses ws_live_session_course + LiveCourseSubscription.
  - ⏭️ Also flip `client/learning/resumeCard.ts` (buildResumeNextCard) + `client/learning/lectureRef.ts` (buildLectureRef) — used by listNotes; reuse the lecture-progress hub + resolveVideoCourseId SQL.
  - Flag suggestion: `client-lecture-note`.
- 🔜 **NEXT — `client/course/course.service.ts` `buildCourseDetails`** (405-line file, ~20 models): course detail page.
  ⚠ Largest C1 handler — joins CourseSubjectCategory/CourseEducator/MaterialCategory/ExamCategory populates +
  Video tree (collectCategoryTreeIds→SQL reachableCategoryIds) + Exam counts + plans (PackageCourseEbookPrice) +
  PromoCode + per-video progress badge (ws_lecture_progress). Mongo-only Course fields (materialCategories[]/
  examCategories[]/examCountdownCategoryId) are dropped/synthesized — documented catalog-detail drift. Flipping the
  per-video badge here is part of what unblocks `lecture-progress-container` (C2).
- ⏭️ `client/catalog/catalog.controller.ts` (free catalog + progress badges)
- ⏭️ `client/material/material.controller.ts` + `material/entitlement.ts` (paid-material gating)
- ⏭️ `client/search/search.controller.ts`
- ⏭️ `client/live-course/entitlement.ts` + `promo.ts`, `client/live/live.controller.ts`

> **▶ RESUME C1 HERE:** next slice = the **lecture-note cluster** (create `ws_lecture_note` + `ws_lecture_audio_note`,
> backfill 4+2 rows, flip both controllers + resumeCard + lectureRef; route resolveVideoCourseId to the SQL resolver).
> Then `buildCourseDetails` → catalog → material → search → live detail. Pattern: flip host handler whole; flip
> per-video progress badges to `ws_lecture_progress` in the same pass so C2 (`lecture-progress-container`) can turn ON.
> `client-lecture` + `client-category-video` are the precedents.

### C2 — Lecture-progress activation (depends on C1) — NEARLY UNBLOCKED — ✅ DONE (superseded; see banner)
> Badge audit 2026-06-19: per-video "Continue" badges now read ws_lecture_progress in course-detail (✅),
> catalog tabs (✅), category-video (✅). **Remaining Mongo badge holders:** `live-course.controller.listLiveCourseRecordings`
> (C1 live-detail slice) + `client/dashboard` (C3). Once those flip, enable `lecture-progress-container`.
- Already built + verified, gated behind `lecture-progress-container` (OFF).
- Flip remaining inline badge reads in `course.service`/`catalog.controller`/`live-course.controller` (part of C1), then enable the flag.
- `client/learning/resumeCard.ts`, `lectureRef.ts`, `lecture-note.controller.ts`, `lecture-audio-note.controller.ts` (share the resume-card builder).

### C3 — Dashboards (depends on C1/C2) — 🔄 nearly done (only client/dashboard left) — ✅ DONE (superseded; see banner)
> ✅ profile counts · ✅ admin-dashboard · ✅ educator-dashboard + educator-portal · ✅ promoter (already SQL).
> 🔄 **client/dashboard IN PROGRESS — prerequisite infra done:** ALTER ws_book + ws_ebook ADD is_trending
> (`schema-changes/2026-06-19_add_is_trending.sql`, applied; Prisma Book.isTrending/EBook.isTrending added + generated;
> backfill `scripts/backfill-is-trending.ts` — staging name-disjoint so 0 set, mechanism ready for prod).
> **▶ RESUME: build the SQL trending helpers** (fetchTrendingBooksOnly/EbooksOnly — filter ws_book/ws_ebook by
> is_trending + price; ebook plans via ws_package_course_ebook_price.ebookId) + **resolveFreeCategoryIds** (free
> packages/courses → material/exam/video category ids via pivots+relations; ⚠ ws_package has no isPaid → no free
> packages on SQL, Course free = purchase='0') + admin toggleBookTrending/toggleEbookTrending. THEN the 3 dashboard
> handlers: getDashboard (banners[SQL]+testimonials[SQL]+trending+subscriptions+ExamCountdown[SQL now]+Notification[SQL]),
> getResumeDashboard (10× LectureProgress — hub is LIVE now, reuse rollupByContainer/resume builders),
> getFreeDashboard (trending free + resolveFreeCategoryIds). Likely flag `client-dashboard`.
- `client/dashboard/dashboard.controller.ts` (getDashboard / getResumeDashboard / getFreeDashboard — bundles ExamCountdown[now SQL]+Notification[SQL]+trending helpers)
- `admin/dashboard/dashboard.controller.ts` (customer counts/stats)
- `educator/dashboard|course|package` (blocked on subscription joins — now mostly on SQL)
- `promoter/dashboard/overview.service.ts`
- profile-dashboard subscriptions/pastExams counts + remove guarded `new ObjectId(userId)`

### C4 — TestSeries reads + Wishlist + misc client — ✅ DONE (superseded; see banner)
- `client/testSeries/testSeries.controller.ts`, `admin/testSeries/testSeries.controller.ts` (reads — order path already SQL; ws_test_series* exist)
- `client/wishlist/wishlist.controller.ts` — **needs a net-new `ws_wishlist` table**
- `client/goal/goal.client.service.ts` (map to ws_customer_target_goal)
- `client/tracking/tracking.controller.ts` (ActivityLog — ws_activity_log exists)
- `client/orders/*`, `client/purchase-history/receipts.controller.ts` (receipt PDF)
- `client/referral/credit-referrer.ts`

### C5 — Promocode appliesTo (deferred-by-design; needs reconciliation) — ✅ DONE (superseded; see banner)
- `client/promocode/promocode.controller.ts` + `applies-to.ts`, `admin/promocode/promocode.controller.ts`
- Mongo `appliesTo`/`discountValue` vs SQL per-plan % — needs a data model decision, not a port.

### C6 — Embedded examCountdown populates — ✅ DONE (superseded; see banner)
- `admin/book|ebook|course` + `client` detail responses that `.populate(examCountdownIds[])` — needs join columns on ws_book/ws_course/etc. (additive ALTERs) or a join table.

### C7 — Realtime / streaming (was explicitly deferred; user now wants it too) — ✅ DONE (superseded; see banner)
- `socket/livechat.socket.ts`, `socket/camera-ingest.ts`, `socket/pdf-progress.socket.ts`
- `admin/live/live.controller.ts`, `live.guards.ts`, `recording.promote.ts`
- `admin/live-course/live-course.{folder,video}.controller.ts`, `client/live-reminder/live-reminder.service.ts`
- `admin/pdfUpload/*` (BullMQ PDF pipeline)
- These touch sockets/StreamOS/BullMQ keyed by Mongo ids — highest risk.

### C8 — Infra / cross-cutting — ✅ DONE (superseded; see banner)
- `utils/crm.ts`, `utils/pdfCourseReceipt.ts`, `libs/core/generate.ts` (ref-code/seq), `admin/notification/audience.ts`
- `admin/permission/catalog.controller.ts`, `permissionCategory.controller.ts`, `admin/referral/content.controller.ts` (FAQ/terms — no SQL table)
- `admin/promoter/promoter.controller.ts`, `admin/course/video.controller.ts`

### Final — remove Mongo — ✅ DONE (superseded; see banner)
- Confirm zero `models/` imports execute; drop `connectMongo` from `src/index.ts`; keep models as dead code or delete.

## Net-new tables this push will need
- `ws_wishlist` (C4)
- possibly examCountdown join columns/table (C6)
- FAQ/terms-for-referral, permissionCategory — **no SQL table; need creation or a decision** (C8)
