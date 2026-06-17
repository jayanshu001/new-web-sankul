# Migration Query / Schema / Index Changes

> Append-only log of query, schema, index, and migration changes. **Newest first.**

---

## 2026-06-17 — 🎞 Wave 5: admin `videoCategory` (full) CRUD on SQL

**What:** The full admin videoCategory controller (`src/admin/videoCategory/`, distinct from the simpler master
one) on SQL — implemented by extending `src/modules/admin-master/` (repo + service); branches on the existing
`isAdminMasterMysql()` flag. No DDL (the parent/educator_id fields were added with the earlier admin-master work).

**Wired (9 of 10 handlers):** list (search/status/educator filters, paginated, child_categories + educator
populated), pre-requisites (categories + active educators), get, create, update, toggle, delete (blocked if
videos or child categories reference it), listVideoCategoryCourses, listVideoCategoryVideos.

**⚠ Architectural divergence (user-approved):** Mongo `VideoCategory.childCategoryIds[]` is a DAG (a category
can have many children AND be a child of multiple parents) + a `courseId/liveCourseId` field; SQL
`ws_video_category` has only a SINGLE `parent` self-FK and no course/liveCourse columns. So on the SQL branch:
children are DERIVED from each child's `parent`; **childCategoryIds is NOT a writable field** (single-parent
model — create/update ignore it). The **`duplicate` handler (BFS DAG clone) STAYS on Mongo** — it can't be
reproduced from a single-parent schema.

**Verified (tsx vs live DB):** list 157 categories, prereqs (157 cats + 55 educators), relation lists
(category 2926 → 6 videos), create/slug-dupe-reject/update(educator attach)/toggle/delete. `fullVcGet` correctly
returns null for an orphaned parent ref. Cleanup clean. `tsc` clean.

**Next:** admin book, ebook, course, package, material.

---

## 2026-06-17 — 🎬 Wave 5: admin `video` CRUD on SQL

**What:** Admin video management via new module `src/modules/admin-video/` (repo + service); branches on
`isMysqlModule("admin-video")`; enabled in `.env`. No DDL (the Video model is clean).

**Wired (all 8 handlers):** listVideos (search/status/type/platform/category filters, paginated, populated
category, toItem shape), getVideoPreRequisites (active categories + has_children + types + platforms), getVideo,
createVideo, updateVideo, deleteVideo, toggleVideoStatus, reorderVideos.

**Logic mirrored:** platform = youtube|vimeo|aws with only the matching `*_id` column populated (the other two
nulled on create / platform-switch); **slug auto-uniquify** (append -2/-3/… until free, never 409); video-category
existence validated on create + re-link; prereqs `has_children` derived from the VideoCategory `parent` self-FK;
the `toItem` response shape (id/name/slug/order/topic/type/status/video_category/platform/{youtube,vimeo,aws}+ids)
matches the Mongo branch exactly. SQL-side numeric category ids.

**Verified (tsx vs live DB, rolled back):** list 156 videos + prereqs (152 cats); create (aws, awsId set); a 2nd
video with the same slug → uniquified to `zz-vid-2`; update switching aws→youtube (youtubeId set, awsId cleared);
toggle; reorder (order→99); delete. Cleanup clean. `tsc` clean.

**Next:** admin videoCategory (full), book, ebook, course, package, material.

---

## 2026-06-17 — 🗂 Wave 5: admin master sub-catalog CRUD on SQL

**What:** Second admin catalog CRUD increment — the small "master" lookup CRUDs via new module
`src/modules/admin-master/` (repo + service); branches on `isMysqlModule("admin-master")`; enabled in `.env`.

**Wired:** `src/admin/pc-material/` (5 handlers) + `src/admin/master/material.controller.ts` +
`src/admin/master/subjectCategory.controller.ts` + `src/admin/master/videoCategory.controller.ts`.
- **PackageCourseMaterial** (ws_package_course_material) — pc-material AND master/material share this table;
  it's TITLE-ONLY in SQL (id/title), so master/material's `image`/`isActive` fields are dropped on the SQL branch.
- **CourseSubjectCategory** (ws_course_subject_category) — title/slug/image/parent/order/status CRUD.
- **VideoCategory** (ws_video_category) — list resolves `child_categories` + `hasChildren` from the `parent`
  self-FK (Mongo populated `childCategoryIds`); CRUD.

**Schema (Prisma only):** added `parent`/`educatorId`(@map educator_id)/`pdf` to the VideoCategory model (were
absent/commented). All three are **NOT NULL with default 0/'' in the DB** → the service coerces to 0/"" on write
(never sends null) to avoid constraint violations. Regenerated client. The existing catalog-video reads are
unaffected (additive nullable fields).

**⚠ Mongo-only (no SQL table):** `master/packageCategory` — `ws_package_category` does not exist; stays Mongo
(documented, like the other table-less features). VideoCategory delete's `ws_video_category_relation` (D2)
cleanup is deferred (relations not migrated).

**Verified (tsx vs live DB):** pc-material create/update/delete; subjectCategory create(order)/update/delete;
videoCategory list (157, 5 parents w/ children) + create (educator_id/parent default 0) /update/delete. Cleanup
clean. `tsc` clean.

**Next:** admin video, videoCategory (full), book, ebook, course, package, material.

---

## 2026-06-17 — 💲 Wave 5: admin `plan` CRUD on SQL (first admin catalog module)

**What:** First admin catalog CRUD module — plan management (`ws_package_course_ebook_price`) via new module
`src/modules/admin-plan/` (repo + service); branches on `isMysqlModule("admin-plan")`; enabled in `.env`. No DDL.

**Wired (all 10 handlers):** listPlans (filters: entityType/owner/status/isDefault/withMaterial/search, paginated,
populated owner refs), getPlanById (+promotedCount/subscriberCount), createPlan, updatePlan (re-link),
deletePlan, togglePlanStatus, markAsDefault, bulkStatus, bulkDelete, clonePlan.

**Drift handled:** a plan is owned by exactly ONE of course/package/ebook; unused owner ids are stored as
**EITHER NULL or 0** (legacy mix — verified 330 null + 542 zero on course_id) → treat NULL-or-0 as "not owned",
and on write set the chosen owner + **0** the other two. The **single-default-per-entity** invariant is enforced
by `clearSiblingDefaults` (flip all other plans of the same owner to isDefault=false) after any create/update/
markAsDefault that sets default. delete is blocked when the plan has subscribers + cascades the
`ws_promoted_package_course_ebook` rows (planId = pcb_price_id).

**Verified (tsx vs live DB):** 1353 plans listed; create two ebook plans both isDefault → the **first flips to
false** when the second is created (invariant holds); update price/withMaterial; markAsDefault flips the sibling;
toggle; clone (isDefault forced false); bulkDelete 3 + cleanup clean. `tsc` clean.

**Next:** continue admin catalog CRUD — pc-material, master sub-categories, video, videoCategory, book, ebook,
course, package, material.

---

## 2026-06-17 — 🧑‍🏫 Wave 5: client educator on SQL (+ material/search found Mongo-only)

**What:** Migrated the client educator-detail endpoint via new module `src/modules/client-educator/`; branches on
`isMysqlModule("client-educator")`; enabled in `.env`. Composes already-migrated tables — no new tables/DDL.

**Wired:** `getEducatorWithCoursesHandler` (GET /client/educators/:id) — educator profile (ws_course_educator) +
their active courses (ws_course) + per-course plans split with/withoutMaterial (ws_package_course_ebook_price) +
per-course daysLeft from active subscriptions (ws_package_course_subscription, lifetime-aware: null endAt beats
dated, latest wins) + fire-and-forget view-counter bump. Course relation fields: `educator`/`subject`
(CourseSubjectCategory uses `title`, not name).

**Found BLOCKED (documented Mongo-only, NOT migrated):**
- client **material** (getCategoryContents/getMaterialDetail/trackDownload/getRecentMaterials) — the entitlement
  helper joins LiveCourse (no SQL table) + Mongo-only embedded `materialCategories[].category`; `ws_material` has
  no `isPaid`/`ancestors`. Same blocker catalog-material flagged for item listing.
- client **search** (globalSearch) — searches across LiveCourse (no SQL table) among others.

So the Wave-5 client-read slice is effectively complete (cart ✅, educator ✅; material/search/wishlist/folder/
notes blocked). Remaining Wave 5 = the **admin catalog CRUD** (~136 handlers), to be built module-by-module
starting with `plan`.

**Verified (tsx vs live DB):** educator 20 (Priyanka Soni) → 1 course ("test") with 5 plans, correct share link.
`tsc` clean.

---

## 2026-06-17 — 📝 Wave 4 COMPLETE: admin exam reads on SQL

**What:** Closed out Wave 4 by migrating the admin exam READ surface via new module `src/modules/admin-exam/`
(repo + service); branches on `isMysqlModule("admin-exam")`; enabled in `.env`. No DDL (reuses the ws_exam*
tables + Exam.description→nullable fix from the client-exam slice).

**Wired (admin exam controller):** getExams (filters: search/category/type/status/isPaid, paginated, populated
category), getExamById (+actualQuestionCount), getQuestions (+options — admin SEES the `answer`, unlike the
client attempt view), getQuestionById, getExamSubmissions (populated customer, score-ranked), getExamAnalytics
(raw SQL: overall avg/max/min/accuracy + per-question correct/wrong/skip/accuracy aggregates over the qresult_*
columns), getResultById (+details), getCustomerAnalytics, and invalidateResult (status=false, score=0).

**Verified (tsx vs live DB):** 1 exam listed w/ category; question with answer + 5 options; submission (Sanjay,
score 1); analytics overall (1 candidate, accuracy 100%) + per-question; customer analytics null when no row.
`tsc` clean.

**Deferred (low-value, stay Mongo):** admin exam/question **CRUD writes** + `getSolutionDownloadByExam` (PDF via
generateExamSolutionPdf). Test Series + ExamCountdown remain Mongo-only (no SQL tables).

**Wave 4 is now fully complete** (client reads + scoring write + admin reads). Back to Wave 5.

---

## 2026-06-17 — 🛒 Wave 5 START: client book-cart on SQL

**What:** First slice of Wave 5 (catalog admin CRUD + remaining client reads). Migrated the client book-cart via
new module `src/modules/client-cart/` (repo + service); branches on `isMysqlModule("client-cart")`; enabled in
`.env`. Inventory: **156 migratable handlers** (10 admin CRUD + 5 client read modules) + **21 BLOCKED** on missing
SQL tables (wishlist/folder/lecture-note/lecture-audio-note/free-progress — Mongo-only, no tables; deferred).

**Wired (all 5 cart handlers, behind isClientCartMysql):** addToCart, updateCartItemQty, removeCartItem,
attachShippingToCart, getCart (with totals summary).

**Shape translation:** Mongo `BookCart` embeds `items[]`; SQL splits into `ws_book_cart` (one active row per
customer, `active`=status column) + `ws_book_cart_item` (cartId→cart.id, bookId→`item_id`). `cart_id` is a
NOT-NULL VARCHAR business key → generated `cart-<base36>` (matches existing rows). attach-shipping find-or-creates
a `ws_customer_shipping` row (userId, phone BigInt, state Int, pincode Int, address_2/email/city NOT NULL) and
resolves the city via the offline-city module. Reuses the BookCart/BookCartItem Prisma models the book-order
module already uses (no schema change).

**Verified (tsx vs live DB, rolled back):** add (new line) → add 2nd book → add same book again (increments, not
duplicated) → getCart (items, itemCount, totals) → updateCartItemQty → removeCartItem. Test cart cleaned up.
`tsc` clean.

**Next:** client material/educator/search reads, then the admin catalog CRUD modules.

---

## 2026-06-17 — 📝 Wave 4 (Exam) CLIENT complete: reads + the saveAnswers scoring WRITE

**What:** Finished the client exam surface on SQL (`src/modules/client-exam/`, behind `isClientExamMysql()`).
Builds on the earlier reads slice; this adds the solution reads, the daily drill-down, and — the important one —
the **`saveAnswers` quiz-submission scoring write**.

**Wired:** client reads `listExamsByCategory`, `getExamQuestions`, `listMyResults`, `getSolutionByExam`,
`getSolutionAnalyticsByExam`, `getDailyExams` (year→month→week→tests drill-down, raw SQL grouping); and the
WRITE `saveAnswers`.

**saveAnswers scoring (the delicate part — verified exact):** for each answer, resolve question+option, compare
`norm(option.name) === norm(question.answer)` → true/false, `"skip"` → skip; point = +positive_marks / −|negative_marks| / 0.
Aggregate total/attempt/skip/success/failed/score → insert `ws_exam_result` + `ws_exam_result_detail` rows in one
`$transaction`, recompute `ws_exam_result_detail_analytics` (upsert), compute rank by best-score-per-customer.
SQL-side numeric-id payload validation (the Mongo zod schema enforces 24-hex ObjectId, which would reject SQL ids).

**Drift / scope:** result tables use the legacy `qresult_*` columns; Mongo-only `attemptNumber`/`inProgress`/
`startedAt`/`submittedAt` are dropped (no SQL columns; `qresult_attempt` = attempt COUNT). `getSolutionDownloadByExam`
(PDF) stays Mongo (composes Mongo docs via generateExamSolutionPdf). The `answer` field is never surfaced to the
client during an attempt.

**Verified (tsx vs live DB, then rolled back):** correct answer → score +1 (success 1/1, rank 1/2); wrong → −1
(failed 1/1); 2 result + 2 detail rows; analytics rollup exams=1/success=1/score=0; solution marks the correct
option. Test rows deleted, customer restored. `tsc` clean.

**Wave 4 remainder:** admin exam reads (`src/admin/exam`) + admin exam/question CRUD — admin-only, deferred.
Test Series + ExamCountdown remain Mongo-only (no SQL tables).

---

## 2026-06-17 — 📝 Wave 4 (Exam) client READS on SQL

**Drift check first (per protocol):** ✅ exam tables exist (ws_exam, ws_exam_category, ws_exam_question,
ws_exam_question_option, ws_exam_result, ws_exam_result_detail, ws_exam_result_detail_analytics). ❌ **Test
Series (all ws_test_series*) and ExamCountdown (ws_exam_countdown*) have NO SQL tables → MONGO-ONLY, excluded
from this wave** (like LiveCourse). Result tables use the legacy `qresult_*` column prefix.

**What:** Migrated the client exam READ surface via new module `src/modules/client-exam/` (repo + service,
read-only). Branches on `isMysqlModule("client-exam")`; enabled in `.env`. Wave 4 of
[`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md).

**Schema fix:** `Exam.description` String → String? (1 NULL row in ws_exam would throw on read). No DDL.

**Wired (behind isClientExamMysql):** `listExamsByCategory` (subjects + published exams w/ window filter +
per-customer isCompleted/lastResult), `getExamQuestions` (questions + options; the `answer` field is NEVER
surfaced during an attempt), `listMyResults` (paginated, w/ exam title). Built but NOT yet wired: solution
reads + `getDailyExams` drill-down (raw SQL YEAR/MONTH grouping + JS week bucketing).

**Verified (tsx vs live DB):** 1 exam ("test") / 1 question / 5 options; answer-not-leaked confirmed;
isCompleted decoration true; listMyResults 2 results w/ score 1/1; daily years drill-down. `tsc` clean.

**Next (Wave 4 cont.):** wire client solution + daily endpoints, admin exam reads, then the `saveAnswers`
scoring WRITE (qresult_* tables + analytics recompute) + admin exam/question CRUD.

---

## 2026-06-17 — 🔐 Wave 3 (RBAC management) on SQL (spatie tables)

**What:** Migrated admin role + permission management off MongoDB onto the spatie SQL tables (`ws_roles`,
`ws_permissions`, `ws_role_has_permissions`) that admin-auth already reads. New module `src/modules/admin-rbac/`
(repo + service); branches on `isMysqlModule("admin-rbac")`. Enabled in `.env`. Wave 3 of
[`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md).

**Schema (Prisma only — no DDL; tables already existed):**
- `AdminRoleRow` / `AdminPermissionRow`: added `created_at` / `updated_at` (the role API returns them).
- New `AdminRoleHasPermission` model → `@@map("ws_role_has_permissions")` (composite PK permission_id+role_id).
- Regenerated client.

**Wired:**
- `src/admin/role/role.controller.ts` — all 7 handlers (list/get/create/update/delete/getRolePermissions/
  syncRolePermissions). Role mutations **write the pivot directly** (delete-all + insert in a `$transaction`,
  validating permission ids belong to the role's guard). `deleteRole` **cascades** the pivot + ws_model_has_roles
  (no DB FK cascade in the legacy schema). roleInUse checks ws_model_has_roles.
- `src/admin/permission/permission.service.ts` — list/get/create/update/delete/getRolesForPermission/tree
  (thin controller → branched in the service). `category` is **derived from the permission name prefix**
  (`bannerslider.create` → `bannerslider`); the tree groups by it.

**Mongo-only gaps (documented):** `ws_permission_categories` has NO SQL table → the **permissionCategory CRUD
controller stays Mongo**, and the Mongo permission `category` object shape (`{id,title,slug}`) becomes a plain
derived string on SQL. Permission create/update ignore `category_id` on SQL (nothing to write).

**Verified (tsx vs live DB):** 29 web roles, role 8 (Super Admin, 16 perms), 108 permissions w/ derived
categories, tree (30 categories), assigned/unassigned split, and a create→sync→delete role lifecycle incl.
**pivot cascade on delete**. Orphan test rows cleaned. `tsc` clean.

**Next:** Wave 4 — Exam / Test Series.

---

## 2026-06-17 — 🎁 Wave 2 (Referral) COMPLETE: admin referral on SQL

**What:** Finished Wave 2 by branching the **admin referral service** (`src/admin/referral/referral.service.ts`)
on `isReferralMysql()`, reusing the `src/modules/referral/` repo (extended with admin ops). No new tables/DDL.

**Branched admin functions:** `listPrograms`/`getProgramById`/`createProgram`/`updateProgram`/`deleteProgram`
(ws_refferal_program CRUD, name-uniqueness), `listTransactions` (w/ customer join), `updateWithdrawalStatus`
(debit-only), `rejectWithdrawal` (atomic refund + delete), `getWithdrawalsReport` + `buildWithdrawalsCsv` (raw
SQL JSON_EXTRACT over `bank_account` + customer search), `adjustCustomerRewards` (atomic inc/dec + successful
txn), `listReferrers` (raw SQL per-customer GROUP BY rollup: totalEarned/Withdrawn/pending/failed/successful).

**Drift / notes:** The admin **content controller is entirely FAQ/Term CRUD → stays Mongo** (ws_referral_faq/
ws_referral_term have no SQL tables). `listReferrers` pagination `total` is approximated (exact count over a
GROUP BY/HAVING is a follow-up if needed). Program write maps Mongo-style body (referralDiscount/referralReward)
→ SQL cols (refferal_discount/refferal_reward).

**Verified (tsx vs live DB):** program create/update/delete + name-exists; adjustRewards credit → successful txn,
points 0→50; admin txn list w/ customer populated; referrers rollup (ran clean, empty in staging);
withdrawals report + CSV header. Test rows cleaned + customer restored. `tsc` clean.

**Wave 2 fully done** (client + webhook + admin). Next: Wave 3 — RBAC management (role/permission CRUD onto the
spatie tables admin-auth already reads).

---

## 2026-06-17 — 🎁 Wave 2 (Referral) client + webhook on SQL

**What:** Migrated the client referral surface + the RazorpayX payout webhook off MongoDB onto SQL via new
module `src/modules/referral/` (repo + service). Branches on `isMysqlModule("referral")`; enabled in `.env`.
Wave 2 of [`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md) (admin referral
service still pending).

**Schema (DDL on `ws_refferal_transaction`, additive, prod-safe):**
- `+ provider_ref VARCHAR(255) NULL`, `+ failure_reason VARCHAR(500) NULL`
  ([schema-changes/2026-06-17_extend_ws_refferal_transaction.sql](./migration/schema-changes/2026-06-17_extend_ws_refferal_transaction.sql))
- widened `status` enum `('pending','successful')` → add `'failed'`
  ([schema-changes/2026-06-17_add_failed_to_refferal_status.sql](./migration/schema-changes/2026-06-17_add_failed_to_refferal_status.sql))
- Prisma `RefferalTransaction` (+ `providerRef`/`failureReason`) and `RefferalTransactionStatus` enum (+ `failed`) updated; regenerated.

**Wired (all behind isReferralMysql):**
- client `referral.controller.ts`: getRewardsOverview (ws_customer + ws_refferal_program), getMyTransactions /
  getTransactionById (ws_refferal_transaction), generateReferralCode (sets ws_customer.referral_code + zeroes
  reward_points), requestWithdrawal (atomic `$transaction`: decrement reward_points + create pending DEBIT txn →
  RazorpayX payout → refund + mark `failed` on payout error).
- content `getReferralStatus` (ws_refferal_program). **getTerms/getFaqs STAY Mongo** — `ws_referral_faq`/`_term`
  don't exist in SQL (Mongo-only content, like Goal/social-link).
- `webhooks/razorpay-payout.controller.ts`: flips a pending withdrawal by `provider_ref` → successful, or refunds
  points (DEBIT) + marks `failed`; idempotent (skips non-pending).

**Drift:** Mongo-only `utr`/`providerPayload` webhook audit fields are NOT persisted on SQL (not in the response
contract; only provider_ref + failure_reason added). Mixed-backend risk eliminated — customer + bank account +
txn are all SQL now, so the debit+create is one Prisma transaction.

**Verified (tsx vs live DB):** referralStatus; rewards overview; withdrawal debit (points 1000→400); webhook
success → `successful` + idempotent replay (`already`); 2nd withdrawal → fail webhook → refund (points→400) +
`failed`+reason; transaction list. Test rows cleaned up, customer restored. `tsc` clean.

**Next:** Wave 2 cont. — admin referral service (program CRUD, withdrawals report, listReferrers rollup) +
admin FAQ/Term CRUD (Mongo-only).

---

## 2026-06-17 — 📣 Wave 1 (Promoter) COMPLETE: `promoter-data` reads on SQL

**What:** Migrated the 4 promoter read controllers off MongoDB (`src/promoter/{dashboard,customer,promocode,subscription}/`)
onto SQL via a new shared module `src/modules/promoter-data/` (repository + service). Branches on
`isMysqlModule("promoter-data")` (a separate flag from `promoter-auth`). Enabled `promoter-data` in `.env`.
Completes Wave 1 of [`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md).

**🔑 Attribution model (the crux — differs from Mongo):** SQL subscription tables have **no `promoter_id`,
`promoter_percentage`, or `paid_amount`** columns (Mongo denormalizes them per-subscription). Instead,
`ws_package_course_order.promocode` / `ws_ebook_order.promocode` is a **JSON snapshot** of the whole promocode
at purchase, embedding `promoterId`, `promocode`, and `promotedPackageCourseEbook[0].promoterPercentage`. So:
- **attribution:** `JSON_EXTRACT(order.promocode,'$.promoterId') = :promoterId`
- **order→subscription join:** `order.id = subscription.order_id` (NOT `unique_id` — that's a nullable string key)
- **revenue:** `subscription.amount` (course) / `subscription.price` (ebook)
- **commission:** `amount * JSON_EXTRACT(...promoterPercentage) / 100`
- **time series:** `DATE_FORMAT(created_at, fmt)` grouping (today→hour, week/month→day, year/all→month, custom→derived)

All implemented as **raw SQL** (`prisma.$queryRawUnsafe` with bound params) because Prisma can't express the
JSON-path filter or DATE_FORMAT grouping. No new tables, no schema change.

**Surfaces wired:** promoter customers (list + detail), subscriptions (course/ebook list + byCourse/byMonth
report w/ commission), dashboard (summary + date-range overview), promocodes (list/detail + derived usage).
**Limitation (documented):** promocode `appliesTo` is not representable from SQL (same as commerce-promocode) →
returned empty; dashboard overview's `promocodeId` scope param is ignored on SQL.

**Verified (tsx vs live DB):** promoter 130 → 2 course subs, ₹15,300 revenue, **commission ₹765** (5% of each),
2 unique customers; report byCourse/byMonth; overview totals + chart buckets; promocode PIYUSH50 usage=2/₹15,300.
`tsc` clean.

**Next:** Wave 2 — Referral system (`ws_refferal_program` + `ws_refferal_transaction`; client + admin + webhook).

---

## 2026-06-17 — 📣 Wave 1 (Promoter) START: `promoter-auth` on SQL (`ws_promoter`)

**Context:** First wave of the FINAL Mongo-only→SQL push, tracked in
[`migration/MONGO_ONLY_MIGRATION_PLAN.md`](./migration/MONGO_ONLY_MIGRATION_PLAN.md) (the resumable plan — read
its RESUME POINTER to continue). ~90 Mongo-only files remain (39 admin / 42 client / 9 other); migrated by
dependency cluster. Wave 1 = promoter side (self-contained).

**What:** Promoter login flow (`src/promoter/auth/promoter.auth.service.ts`) migrated off MongoDB onto SQL,
mirroring educator-auth. All 6 functions branch on `isMysqlModule("promoter-auth")` (login, refresh, logout,
change-password, update-profile, get-profile). Mongo retained as fallback. Enabled `promoter-auth` in `.env`.

**Schema:**
- DDL ADD: `ws_promoter_access_tokens` (mirrors admin/educator token tables) →
  [`migration/schema-changes/2026-06-17_create_ws_promoter_access_tokens.sql`](./migration/schema-changes/2026-06-17_create_ws_promoter_access_tokens.sql)
  (additive, prod-safe, run once).
- Extended Prisma `Promoter`: added `password` + `lastSeenAt` (`@map("last_seen_at")`) + `accessTokens`
  relation; new `PromoterAccessToken` model. Regenerated client. (commerce-promoter READ transformer explicitly
  excludes password — safe.)

**Drift handled:** ws_promoter has **no `last_login_date`/`last_login_ip`** columns (the Mongo model wrote them)
→ `touchLogin` updates `last_seen_at` instead. Password verify = `verifyPromoterPassword` (bcrypt then 32-hex
MD5, like educator) — though only **1 of 114** promoters has a password (the rest are admin-created, no login).
JWT `{id,email,role:"promoter",type:"promoter"}` + Redis `promoter_session:{id}` unchanged; numeric id stringified.

**Verified (tsx against live DB):** dual-hash verify (bcrypt/MD5/empty); login lookup + DTO (promoter 2 GPSC
ONLINE); token create/refresh-lookup/deactivate; profile update; touchLogin. Data restored. `tsc` clean.

**Next (Wave 1 cont.):** promoter dashboard/customers/promocode/subscription reads (aggregations over
already-migrated tables — no new SQL).

---

## 2026-06-17 — 🎓 admin educator MASTER CRUD migrated to MySQL (ws_course_educator)

**What:** Migrated the admin educator master endpoints (`src/admin/master/educator.controller.ts`,
mounted at `/api/v1/admin/master/educators`) off MongoDB onto SQL. This is the listing/CRUD admins see — separate
from the educator login flow migrated earlier today. Gated by the existing `educator-auth` flag (already ON).
No schema/DDL change.

**Branched handlers (Mongo retained as fallback):** `getEducators` (list w/ search + status + sortBy
[createdAt/updatedAt/name/email] + sortOrder, paginated), `createEducator`, `updateEducator`,
`getEducatorDetails`, `deleteEducator`.

**Schema realities handled:**
- `ws_course_educator` has **no `deleted` column** → "delete" = `status=false` + revoke tokens (row retained, so
  course/live-course `courseEducatorId` refs still resolve). List shows all rows; callers filter by status.
- `password` is **NOT NULL** but the create validation makes it optional → store `""` when absent (no-login
  educator, matching the existing empty-MD5 rows); hash with bcrypt when provided.
- `id` is numeric (not ObjectId); DTO returns `_id` as the stringified int + status + timestamps; password omitted.
- `getEducatorDetails` associations (courses/live-courses/packages/sessions/subscriptions) return empty on SQL —
  those models aren't migrated yet.

**Reused:** extended `src/modules/educator-auth/educator-auth.{repository,transformer}.ts` with admin
list/CRUD ops + `toEducatorListDto`.

**Verified (tsx against live DB):** the exact failing query (page=1, limit=10, sortBy=updatedAt, sortOrder=desc)
→ 56 educators, sorted correctly; search+status filter; create (password→""), email-uniqueness excl. self,
update, disable (row retained). Throwaway row cleaned up. `tsc --noEmit` clean.

---

## 2026-06-17 — 🎓 educator-auth migrated to MySQL (ws_course_educator) + MD5/bcrypt password support

**What:** Migrated the educator auth flow (`src/educator/auth/educator.auth.service.ts`) off MongoDB onto MySQL,
following the admin-auth pattern. Added `educator-auth` to `.env` `MIGRATION_MYSQL_MODULES`. Mongo retained as
fallback.

**Schema (`prisma/schema.prisma`):**
- Extended `CourseEducator` (`@@map("ws_course_educator")`): made `image` nullable (matches DB), added
  `last_seen_at`/`email_verified_at` (Date) and the `accessTokens` relation.
- Added `EducatorAccessToken` → `@@map("ws_educator_access_tokens")` (new table) mirroring the admin/customer
  token tables.

**DDL (applied to `websankul_staging`):** created `ws_educator_access_tokens`
`(id INT PK AI, educator_id BIGINT UNSIGNED, token TEXT, refresh_token TEXT NULL, active TINYINT(1),
deleted TINYINT(1), created_at DATETIME, expires_at DATETIME, updated_at TIMESTAMP, INDEX educator_id,
INDEX (active,deleted))`.

**⚠️ Password formats (key finding):** `ws_course_educator.password` is MIXED — 40 rows are legacy 32-char
**MD5** hashes, 16 are **bcrypt** (`$2`). The Mongo branch only did `bcrypt.compare` (would fail the MD5 rows).
New `verifyEducatorPassword` (in the transformer) tries bcrypt first, then falls back to `md5(input)===stored`
for 32-char-hex hashes. Empty-string MD5 (`d41d8cd9…`, = "no password") never matches a non-empty input.
Password **changes** always write bcrypt (legacy MD5 upgrades on next change). No bulk re-hash performed.

**New module:** `src/modules/educator-auth/{educator-auth.repository.ts, educator-auth.transformer.ts}`.
Service branches added to login, refresh, logout, change-password, update-profile, get-profile. JWT payload
unchanged (`{id, email, role:"educator", type:"educator"}`); Redis `educator_session:{id}` and the
middleware 1-device rule unchanged. DTO matches the Mongo `buildProfile` shape (id as stringified int).

**Verified (tsx against live DB, 56 educators):** verifyEducatorPassword for MD5/bcrypt/$2y/empty-md5; login
lookup + verify (educator 20); DTO shape; token create/refresh-lookup/deactivate; profile update. Original
data restored, none left modified. `tsc --noEmit` clean.

**NOT migrated yet (still Mongo):** educator dashboard/course/package controllers (read Course/Package/
PackageCourseSubscription/Customer — depend on subscription models not yet on SQL). Tracked in
`docs/MIGRATION_MONGO_REMAINING.md`.

---

## 2026-06-17 — 🔀 enabled customer-profile + customer-bank-account on MySQL (config flip)

**What:** Added `customer-profile` and `customer-bank-account` to `.env` `MIGRATION_MYSQL_MODULES`. Both modules'
SQL branches were already fully built (repository + transformer + service, no TODOs/fallthrough) — this is a
config flip only, no code/schema change.

**Verified (tsx against live DB):** `customer-profile.getProfile` returns a complete DTO with hydrated goals
(`ws_customer` + `ws_customer_target_goal`); `customer-bank-account` service loads and lists from
`ws_customer_bank_account`. `tsc --noEmit` clean.

**Held back:** `customer-address` NOT enabled — its SQL branch is complete but depends on the `offline-city`
id-space (cityId ↔ OfflineCity), and offline-city is not yet enabled. Enable together once offline-city lands.

**Note on "SQL-only" goal:** the app is still hybrid. See `docs/MIGRATION_MONGO_REMAINING.md` for the full
inventory of endpoints/files that still read MongoDB with **no SQL branch** (client referral/cart/goals/orders,
admin dashboard/notifications/livechat, educator + promoter modules, FCM/sockets/webhooks). Those require new
SQL branches, not just a flag flip.

---

## 2026-06-17 — 🧑‍🤝‍🧑 admin customer CRUD/list migrated to MySQL (ws_customer)

**What:** Migrated the admin-side customer management endpoints
(`src/admin/customer/customer.controller.ts`) off MongoDB onto MySQL `ws_customer`. Gated by the existing
`customer-auth` flag (already ON in `.env`) — so admin customer management flips together with customer auth.
No schema/DDL change (all tables already introspected).

**Branched handlers (Mongo retained as fallback):** `getCustomers` (list w/ search + status + state/district +
date-range filters, paginated), `getCustomerById`, `getCustomerPreRequisites` (states + educations from
ws_customer_state/_education), `getDistrictsByState` (ws_customer_distict), `createCustomer`, `updateCustomer`,
`deleteCustomer` (soft delete), `toggleCustomerStatus`. The subscription/order/address aggregate handlers
(`getCustomerCourseSubscriptions`, `getCustomerEbookSubscriptions`, `getCustomerAddresses`,
`getCustomerDetails`) return empty/zeroed payloads on the SQL branch — their underlying models
(PackageCourseSubscription/EbookSubscription/CustomerAddress/orders) are not yet on SQL.

**New files:** `src/modules/admin-customer/{admin-customer.repository.ts, admin-customer.service.ts,
admin-customer.transformer.ts}`.

**Schema realities handled:**
- `ws_customer` stores a **single `full_name`** — the API contract exposes firstName/middleName/lastName.
  Compose on write (`composeFullName`), best-effort split on read (`splitFullName`: 1 token→first; 2→first+last;
  3+→first + middle(joined) + last).
- **`state` and `district` are NOT NULL** in MySQL (no default) → cleared/absent values write **0** (the legacy
  dump sentinel, matching customer-auth `createStub`), never NULL. `education_id` is nullable. Create uses the
  Prisma **unchecked** input to set raw FK columns.
- FK ids are **Int** (not ObjectId) → list filters + create/update accept numeric ids; lookups returned with
  `_id` as the stringified int. Column maps: `dob`→birthDate, `profile_picture`, `phone_2`→phone2,
  `goal` (JSON) ← goals[].
- Changing phone resets `is_phone_verified` (matches Mongo).

**Validation (`customer.validation.ts`):** state/district/education id fields + `goals[]` now accept a numeric
MySQL id alongside the 24-hex Mongo ObjectId.

**Verified (tsx against live `websankul_staging`, 27 customers):** list, filters, get, prereqs (states/educations),
districts-by-state (Gujarat→33), full create (full_name composed, state/district/education connected, goals JSON),
phone/email uniqueness excl. self, update (name recomposed, education→NULL, phone-verify reset), toggle, soft
delete (row retained, hidden from reads). Throwaway row cleaned up. `tsc --noEmit` clean project-wide.

---

## 2026-06-17 — 👥 administrator CRUD/list migrated to MySQL (ws_users) — completes admin-auth flip

**What:** Migrated all administrator CRUD/list endpoints
(`src/admin/administrator/administrator.controller.ts`) off MongoDB onto MySQL `ws_users`, gated by the same
`isMysqlModule("admin-auth")` flag added earlier today. Every handler — list, get-by-id, pre-requisites
(roles dropdown), create, update, delete, toggle-status — now has a MySQL branch (Mongo path retained as
fallback).

**New files:**
- `src/modules/admin-auth/administrator.service.ts` — SQL CRUD service (list w/ search+status+role filter,
  get, create, update, disable, toggle, assignable-roles, role-exists). `ADMIN_MODEL_TYPE = "App\\Models\\User"`
  (verified against existing `ws_model_has_roles` rows).
- Extended `admin-auth.repository.ts` with admin CRUD + spatie role-pivot writes, and `admin-auth.transformer.ts`
  with `toAdminListDto` (mirrors the Mongo `PUBLIC_FIELDS` projection: `_id`, status, timestamps).

**Schema realities handled (no DDL this entry):**
- `ws_users` has **no `deleted` column** → "delete" = set `status='0'` (inactive) + revoke tokens; the row is
  retained. List/detail show all rows; callers filter by `status`.
- `image` is **NOT NULL** → create defaults to `""`.
- **No `role` column** → built-in enum roles (super_admin/admin/editor) are not persistable on SQL; a numeric
  spatie role id (ws_roles.id) is written to the `ws_model_has_roles` pivot and `role` is derived on read from
  role names (super→super_admin, editor→editor, else admin).
- Pagination/search via Prisma (`firstName/lastName/email contains`, `orderBy createdAt desc`).

**Validation (`administrator.validation.ts`):** `roleField` now also accepts a numeric string id (MySQL spatie
role id) alongside the 24-hex Mongo ObjectId form.

**Verified (tsx against live `websankul_staging`):** full lifecycle — list (3 admins, derived role+status),
role-filter, get, 31-row roles dropdown, create (+spatie pivot write `role=1 type=App\\Models\\User`),
email-uniqueness (excludes self), update (incl. lastName→null), toggle, disable (row retained). Throwaway row
cleaned up; no test data left behind. `tsc --noEmit` clean project-wide.

---

## 2026-06-17 — 🔐 admin-auth (ws_users) migrated to MySQL — admin login reads from SQL

**What:** Migrated the administrator login/auth flow off MongoDB onto MySQL `ws_users`, following the
established `isMysqlModule("admin-auth")` branch pattern. Added module `admin-auth` to `.env`
`MIGRATION_MYSQL_MODULES`.

**Schema (`prisma/schema.prisma`):** Added models:
- `AdminUser` → `@@map("ws_users")`. Laravel snake_case columns; `status` and `is_dark` are
  `enum('0','1')` in MySQL, modeled as Prisma enums `AdminStatusFlag {inactive=0, active=1}` and
  `AdminDarkFlag {light=0, dark=1}`. **No `role`/`deleted` columns exist** on this table.
- `AdminAccessToken` → `@@map("ws_admin_access_tokens")` (new table, see DDL below) mirroring
  `ws_customer_access_token`.
- `AdminRoleRow`/`AdminPermissionRow` → `ws_roles`/`ws_permissions`; `AdminModelHasRole`/
  `AdminModelHasPermission` → spatie pivots `ws_model_has_roles`/`ws_model_has_permissions`
  (read-only role/permission resolution for the login response).

**DDL (applied to `websankul_staging`):** created `ws_admin_access_tokens`
`(id INT PK AI, admin_user_id BIGINT UNSIGNED, token TEXT, refresh_token TEXT NULL, active TINYINT(1),
deleted TINYINT(1), created_at DATETIME, expires_at DATETIME, updated_at TIMESTAMP, INDEX on admin_user_id,
INDEX on (active,deleted))`.

**Service (`src/admin/auth/admin.auth.service.ts`):** Added MySQL branches to `adminLogin`,
`changeAdminPassword`, `refreshAdminToken`, `logoutAdmin`, `updateAdminProfile`. New repository
`src/modules/admin-auth/admin-auth.repository.ts` + transformer `admin-auth.transformer.ts` (returns the
**same admin DTO shape** as the Mongo branch: `id, firstName, lastName, email, role, roles[], permissions[],
image, isDark`). `role` is derived from spatie role names (super_admin/editor/admin). JWT payload uses the
numeric `ws_users.id` as a string; Redis `admin_session:{id}` caching unchanged.

**Verified:** repository lookup + pivot role resolution (`it@websankul.com` → role `admin`, guard `web`),
token write/read/delete round-trip, and bcrypt compare — including that **legacy Laravel `$2y$10$` hashes
verify with `bcryptjs`**, so all existing admins log in with current passwords. `tsc --noEmit` clean.

---

## 2026-06-15 — 🚀 FULL FLIP enabled in this env (all 30 module keys ON) + full HTTP suite green

**What:** Turned ON every built module flag in `.env` `MIGRATION_MYSQL_MODULES` (was 12, now all 30:
added `catalog-course,catalog-video,catalog-ebook,catalog-exam,catalog-material,catalog-book,offline-batch,
commerce-price,commerce-subscription,commerce-ebook-sub,commerce-promoter,commerce-promocode,commerce-educator,
commerce-order,ebook-order,book-order,offline-enquiry,package-chat`). Restarted `yarn dev`, ran `yarn migration:api`.

**Result:** **All suites passed — zero fallout.** Every previously flag-gated `skip: !xMysql` test now runs +
passes. The 13 remaining SKIPs are all hardcoded `skip: true` placeholders with **no HTTP endpoint** (catalog-video
URL encryption; commerce-price/subscription/ebook-sub/promoter/promocode/educator READ masters returned only nested;
commerce-order/ebook-order/book-order write-paths needing a real Razorpay callback; offline-enquiry/package-chat
writes) — not flag-controllable; data paths already proven via tsx. They stay skipped by design.

**No schema/query change** — this is a config flip only. Earlier this session: regenerated Prisma client (fixed
93 stale `@prisma/client` typecheck errors), added the api-tests **mock-JWT store** (`_lib/token-store.ts`,
`mint-jwt.ts`, `yarn migration:api:auth`) + **auto API-doc-on-pass** (`_lib/capture.ts`, `_lib/doc-writer.ts` →
`api-tests/<module>/API_DOC.md`), and attached `getCustomerToken()` to the offline-batch/offline-city/customer-lookups
client tests that were 401ing (their routes now require a Bearer token).

**⚠ Prod caveat:** this `.env` must NOT ship to production as-is until the `ws_package_chat` ALTER
(`migration/schema-changes/2026-06-13_extend_ws_package_chat.sql`) is run on the prod DB. Rollback = remove keys + restart.

---

## 2026-06-13 — `package-chat` BUILT + WIRED (READ + WRITE, Phase 3b) — flag OFF · ⚠ FIRST SCHEMA ADD

**What:** The LAST 3b write path. Package announcement chat (admin/system posts; subscription-gated client
read). Wired the client READ + the admin WRITE behind `isPackageChatMysql()` (flag OFF):
`GET /client/package/:packageId/chat` · `POST /admin/package/:id/chat` · `DELETE /admin/package/chat/:messageId`.

### ⚠ SCHEMA CHANGE (the first additive ALTER in this migration)
`ws_package_chat` was a legacy **STUB** (`id, package_id, message, timestamps`) — it could NOT represent the
live Mongo PackageChat (media + sender + push), so migrating against it would have silently broken the chat
response. Per sign-off, the table was **EXTENDED** (additive only, prod-safe):
```
ALTER TABLE ws_package_chat ADD media_url VARCHAR(1000) NULL,
  ADD media_type ENUM('image','video','pdf','audio','other') NULL DEFAULT 'other',
  ADD sender_type ENUM('admin','system') NOT NULL DEFAULT 'admin',
  ADD sender_id VARCHAR(255) NULL, ADD push_sent TINYINT(1) NOT NULL DEFAULT 0;
```
The statement is captured in [`migration/schema-changes/2026-06-13_extend_ws_package_chat.sql`](migration/schema-changes/2026-06-13_extend_ws_package_chat.sql)
(run once on prod — project uses manual ALTER + `prisma db pull`, no Prisma Migrate). Prisma: the stub `chat`
model → **`PackageChat`** + enums `PackageChatMediaType`/`PackageChatSenderType`; Package back-relation
`chat chat[]` → `chat PackageChat[]`; regenerated (pinned 5.22.0, carets re-checked intact).

### Field mapping / drift
- SQL `message` ↔ Mongo `text` (Mongo defaults text to ""; message is NOT NULL → store "" for media-only).
- `sender_id` is **VARCHAR** — holds the admin ObjectId (admin auth stays Mongo), so string|null, not int.
- `media_type`/`sender_type` modeled as Prisma enums. `push_sent` Boolean. `package_id` INT.
- **list ordering:** Mongo sorts by `createdAt desc`; SQL `created_at` is second-granularity `datetime`, so
  same-second posts tie → added `id desc` tiebreaker to preserve true insertion order (caught in tsx).
- **subscription gate (client read):** the MySQL branch gates via commerce-subscription's
  `hasActivePackageSubscription` (int ids) instead of the Mongo gate; branches before the ObjectId guard.

### Verification
tsx (`scripts/_tmp/verify-package-chat.ts`, flag OFF, live DB, package 3): **21/21 passed** — package
existence guard, post (text / media-only→message="" / system sender), paginated list (newest-first +
tiebreak) + total, delete (+ missing→false), field mapping. Created rows cleaned up; staging restored to 0.
Typecheck 0 errors (ex 2 known). **Flag OFF — the 3b write cluster is now COMPLETE.**

---

## 2026-06-13 — `offline-enquiry` BUILT + WIRED (lead-capture write, Phase 3b) — flag OFF

**What:** Small single-table write module `src/modules/offline-enquiry/` (batch enquiry). **Wired** behind
`isOfflineEnquiryMysql()` (flag OFF): `POST /client/offline/enquiry`. No schema change — `OfflineEnquiry`
model already existed (its `mobile` Int→BigInt fix landed in the offline-batch pass).

### Drift handled
- **`mobile` BIGINT:** input is a string; digits parsed → BigInt for the column, surfaced back as a string
  in the DTO (Mongo shape). 12-digit numbers (e.g. with country code) overflow Int32 → BigInt required.
- **anonymous vs NOT NULL customer_id:** the route is anonymous-allowed (best-effort auth; userId may be
  null) but `ws_offline_enquiry.customer_id` is INT NOT NULL. Store the **`0` sentinel** for anonymous (no FK
  enforced); the DTO maps 0 → null to keep the Mongo shape.
- **no `remarks` column:** the Mongo enquiry accepts an optional `remarks`; SQL has no column. The validator
  still accepts it (contract-stable) but it's DROPPED on the SQL write (documented gap — lead-capture sink).
- **`batch_id` INT:** MySQL branch validates an int batch id + checks existence via offline-batch's table.
  Wired before the ObjectId schema parse (MySQL batch id is an int).

### Verification
tsx (`scripts/_tmp/verify-offline-enquiry.ts`, flag OFF, live DB): **10/10 passed** — batch existence guard,
authenticated write (BigInt mobile round-trip incl. 12-digit overflow case), anonymous write (0-sentinel ↔
null), cleanup. Staging restored to 4 rows. Typecheck 0 errors (ex 2 known). **Flag OFF.**

---

## 2026-06-13 — `catalog-book` WIRED (book listing + detail) — flag OFF

**What:** Wired the two book read endpoints that were built-but-blocked. `GET /client/books` (listBooks) +
`GET /client/books/:id` (getBookDetail) now branch on `isBookMysql()`. No new module, no schema change — a
pure wiring pass enabled by `book-order` landing (it migrated the order/cart tables the enrichment needs).

### Why it was blocked, and why it's unblocked now
listBooks/getBookDetail enrich each book with per-customer **cart qty/cartId** (ws_book_cart*) +
**isPurchased** (ws_book_order* by fulfilled status). Those tables were Mongo-only until `book-order` (Phase
3b) migrated them — now the int book id-space matches and the joins work.

### Composition (catalog-book DATA + book-order STATE)
- catalog-book `listBooksData`/`getBookById` supply the book data + data-only computed fields (isPaid, key,
  daysLeft=null, isNew, shareableLink via callback).
- NEW book-order read helpers compose the per-customer state: `getActiveCartState` (cartId = ws_book_cart
  .cart_id + a bookId→qty map from ws_book_cart_item) and `getPurchasedBookIdSet` (ws_book_order_item book
  ids joined to orders in verified/shipped/delivered). Repo reads added to book-order (it owns those tables).
- Controller merges `qty` + `isPurchased` onto each book; response byte-identical to the Mongo branch.

### Drift / parity notes
- **status set:** purchased = order status in (verified, shipped, delivered) — same strings on SQL + Mongo.
- **C3 seam:** customerId coerced `Number(req.user.id)`. Detail branches BEFORE the ObjectId guard (MySQL
  book id is an int). `pages` already a number in the DTO (Mongo did `pages ?? 0`).

### Verification
tsx (`scripts/_tmp/verify-catalog-book-wired.ts`, flag OFF, live DB): **12/12 passed** — listBooksData (10
books, computed fields, shareableLink), real active cart (customer 472339, book 7 qty=1) merge, isPurchased
proven by seeding a verified order+item then cleaning up, detail composition (purchased true for buyer, false
for non-buyer). Staging restored to 6/1. Typecheck 0 errors (ex 2 known). Registry + schema-comparison
regenerated. **catalog-book flag still OFF** — flips with the catalog/commerce/order cluster.

---

## 2026-06-13 — `book-order` BUILT + WIRED (book cart-checkout write path, Phase 3b) — flag OFF

**What:** Third write-path module `src/modules/book-order/` — a DIFFERENT shape (cart checkout → **5 tables**,
line items, courier AWB counter). Scoped + signed off in [`migration/BOOK_ORDER_SCOPE.md`](migration/BOOK_ORDER_SCOPE.md).
**Wired** behind `isBookOrderMysql()` (flag OFF): `POST /client/payment/create-order` (book cart) + the
**book branch** of `POST /client/payment/verify`.

### ⚠ SCHEMA FIX (read-breaking BigInt drift)
`ws_book_tracking.tracking_id` + `ws_book_order.tracking_id` are **BIGINT** (the courier AWB, ~1.19e11 —
overflows Int32) but Prisma mapped them **`Int`** → reads THREW. Fixed `BookTracking.tracking_id Int→BigInt`,
`BookOrder.trackingId Int?→BigInt?`, regenerated (pinned 5.22.0; carets re-checked, intact). Surfaced as number.

### The 5-table fan-out
- **create-order (2 phases):** preview the cart (`ws_book_cart` + `ws_book_cart_item` child rows → totals
  with the `ws_termsandcondition` module='book' free-shipping threshold = 500) → create Razorpay → ONE `$transaction`
  writes `ws_book_order` (pending; `order_items` TEXT blob + cart_id + razorpay payload, all NOT NULL) **+
  `ws_book_order_item` rows** (FK `order_id` = the VARCHAR business key).
- **verify:** ONE `$transaction` — insert `ws_book_tracking` (bigint **AUTO_INCREMENT** = the AWB; live base
  119400693004, no Counter needed) → flip order→verified + tracking_id + gateway_transaction_id → **deactivate
  the cart** (`ws_book_cart.status=0`, matching user+shipping; cart_item rows kept, Mongo parity).

### Drift handled
- **customer_id is INT** on ws_book_order (NOT the VARCHAR split of course/ebook). order_id is the VARCHAR
  business key (≠ int PK); item + tracking FK on the string.
- **Embedded → child:** Mongo BookOrder.items[] → order_item rows (+ denormalized order_items JSON blob).
- **Tracking history LOSS (signed-off D-B3):** `ws_book_tracking` is `{tracking_id,order_id,status}` — no
  history/note/location. Persist the flat row; the DTO **synthesizes** the single verify entry
  `[{status:'Order Placed', note:'Payment received', at}]`. Multi-step timeline = noted fidelity gap.
- **varchar(10) status (caught in tsx):** "Order Placed" (12) overflows `ws_book_tracking.status` → store
  short code "verified"; DTO carries the human text.

### Dual-read fallback + verification
verify checks MySQL first, falls through to the Mongo fan-out on miss. tsx (`scripts/_tmp/verify-book-order.ts`,
flag OFF, live DB, seeded cart): **25/25 passed** — create→items snapshot, owner-lookup miss→null, verify
(AWB allocation, BigInt no-overflow, tracking.order_id=VARCHAR key, cart deactivation, cart_item kept,
synthesized history), idempotent re-verify (no second AWB). Created rows cleaned up; staging restored to
6/1/2/2/3. Typecheck 0 errors (ex 2 known).

### Scope
book-order only (signed off); **wiring catalog-book is a clean follow-up** (its reads are built, were blocked
on order/cart deps — now unblocked). **Flag OFF** — go-live needs separate sign-off.

---

## 2026-06-13 — `ebook-order` BUILT + WIRED (ebook write path, Phase 3b) — flag OFF

**What:** Second write-path module `src/modules/ebook-order/` (ebook purchase). Rides the commerce-order
pattern. **Wired** behind `isEbookOrderMysql()` (flag OFF): `POST /client/payment/create-order/ebook` +
the **ebook branch** of `POST /client/payment/verify`. No schema change — `EBookOrder`/`EBookSubscription`
Prisma models already existed and passed the drift check.

### The split (one-doc → TWO tables — simpler than course, no tracking)
- **create-order** writes **`ws_ebook_order`** only (status=pending). `unique_id` (NOT NULL) = the receipt id.
- **verify** runs ONE `$transaction`: flip order→complete + razorpay_payment_id; then extend an active
  `ws_ebook_subscription` (fold endAt +DAYS, sum price, repoint at the latest order) OR create a fresh one.
- The verify ebook branch returns `data:{kind:"ebook", order}` — the ORDER, not the subscription — so the
  DTO mirrors the Mongo EbookOrder doc.

### Drift handled (verified vs live DDL + real rows)
- **customer_id TYPE SPLIT:** order VARCHAR / subscription INT (C3 coercion `Number(req.user.id)`).
- **NO `ebook_id` on the order table** — only `plan_id`; the ebook is **re-derived from the plan** at verify
  + in the DTO (Mongo's EbookOrder carries ebookId; SQL doesn't).
- **status enum IDENTICAL strings** ('pending'|'complete'|'cancel') on SQL + Mongo — no translation (unlike
  course's paymentStatus map).
- **`order_price`** is the paid amount (no separate discount col). **`duration` = DAYS**. **`payment_type`**
  enum('online','backend') → 'online'.

### Dual-read fallback (rollback safety)
verify checks MySQL for the ebook order FIRST when flag ON; on miss falls through to the Mongo fan-out.

### Verification
tsx (`scripts/_tmp/verify-ebook-order.ts`, flag OFF, live DB, plan 1 / ebook 1 / 180 DAYS): **28/28 passed** —
create→verify round-trip, owner-lookup miss→null, fresh grant (180-DAY endAt, ebook_id re-derived, order FK),
idempotent re-verify (no dup sub), upsert-extend (reuses sub, +180 days, repoints at latest order, exactly 1
active row). Created rows cleaned up; staging restored to 2 orders / 1 sub. Typecheck 0 errors (ex 2 known).

### Scope
EBOOK after COURSE (signed off). book-order next; live-course/test-series deferred (no SQL tables).
**Flag OFF** — go-live needs separate sign-off.

---

## 2026-06-13 — `commerce-order` BUILT + WIRED (course write path, Phase 3b) — flag OFF

**What:** Built the first **write-path** module `src/modules/commerce-order/` (course purchase) and
**wired** both endpoints behind `isCommerceOrderMysql()` (flag OFF): `POST /client/payment/create-order/course`
and the **course branch** of `POST /client/payment/verify`. No schema change needed — the 3 Prisma models
(`PackageCourseOrder`, `PackageCourseSubscription`, `PackageCourseSubscriptionTracking`) already existed and
passed the drift check.

### The one-doc → three-tables write
Mongo writes one `PackageCourseSubscription` doc (order + entitlement). SQL splits it:
- **create-order** writes **`ws_package_course_order`** only (status=pending).
- **verify** runs ONE `$transaction`: flip order→complete + razorpay_payment_id; then EITHER extend an
  existing active course sub (fold endAt via DAYS planDuration + sum amount, no new row) OR create
  `ws_package_course_subscription` + `ws_package_course_subscription_tracking`. The verify response merges
  order payment fields + subscription entitlement fields into the Mongo-shaped `data.subscription`.

### Drift handled (verified vs live DDL + real rows)
- **customer_id TYPE SPLIT:** order table VARCHAR, subscription table INT — same logical id. Cast int→string
  at the order boundary, int on the subscription. C3 seam coercion (`Number(req.user.id)`) at both controllers.
- **`tracking` / tracking.id BIGINT** (~1.19e11, overflow Int32) — Prisma `BigInt`, surfaced as number.
- **`tracking.order` FKs order.id**, not subscription.id (confirmed in tx + tsx).
- **order.status enum ↔ Mongo paymentStatus:** pending↔pending, complete↔verified, cancel↔failed.
- **Mongo↔SQL names:** Mongo `packageId`=plan=SQL `pcb_id`; `targetPackageId`=package=SQL `package_id`.
- **`duration` = DAYS** — endAt via planDuration `asDays:true`.

### Dual-read fallback (rollback safety, WRITE_PATH_SCOPE §3.2)
verify checks MySQL for the course order FIRST when the flag is ON; on miss it **falls through to the Mongo
fan-out**. So a flag flip between create-order and verify (or a pre-flip Mongo order) can't orphan a payment.

### Verification
tsx (`scripts/_tmp/verify-commerce-order.ts`, flag OFF, live DB): **28/28 passed** — create→verify round-trip,
owner lookup + miss→null, fresh grant (DAYS endAt, BigInt tracking, tracking.order=order.id), idempotent
re-verify (no dup sub), upsert-extend (reuses sub _id, +90 days, second order makes no new sub). All created
rows cleaned up; staging restored to 3 orders / 2 subs / 3 tracking. Typecheck 0 errors (ex 2 known files).

### Scope (signed off)
COURSE only; ebook/book ride the same pattern next. live-course/test-series stay deferred (no SQL tables).
**Flag stays OFF** — NOT added to `MIGRATION_MYSQL_MODULES` until a separate go-live sign-off.

---

## 2026-06-13 — Write-path (Phase 3b) SCOPED + signed off — no code yet

**What:** Read the real 569-line `src/client/payment/verify.controller.ts` and the live SQL
write tables; wrote [`migration/WRITE_PATH_SCOPE.md`](migration/WRITE_PATH_SCOPE.md) and got sign-off.
**No write-path code written** (satisfies RESUME_HERE §1 "don't write write-path code without the plan").

### Findings (correct the checkpoint's summary)
- `verify` is a **5-way fulfillment dispatch** (book · course · ebook · live-course · test-series),
  not "Razorpay + subscription". live-course & test-series hit **Mongo-only collections with NO SQL
  tables** → stay deferred (§7). Real 3b target = **course** (ebook adjacent next).
- **One-doc-vs-three-tables impedance mismatch:** Mongo `PackageCourseSubscription` carries order +
  entitlement in one doc; SQL splits to `ws_package_course_order` → `ws_package_course_subscription`
  → `ws_package_course_subscription_tracking`.
- **Schema trap:** `ws_package_course_order.customer_id` is **VARCHAR(ObjectId)** but
  `ws_package_course_subscription.customer_id` is **INT** — same logical id, two types across the two
  tables in one write. Plus `subscription.tracking` + `tracking.id` are **BIGINT** (overflow class).
- `tracking.order` column FKs **order.id**, not subscription.id.

### Sign-off decisions
- **Scope:** course path **ONLY** first (ebook/book ride the same pattern later).
- **Flag:** `commerce-order`, gates create-order + verify end-to-end; **NOT** added to
  `MIGRATION_MYSQL_MODULES` until a separate go-live sign-off.
- **Rollback safety:** verify uses a **dual-read fallback** (query flagged store, fall back to the
  other on miss) so a flag flip between create-order and verify can't orphan an in-flight payment.
- create-order writes the `order` row only; verify writes `subscription`+`tracking` in one
  `$transaction`; upsert-extend reproduced in SQL with the **DAYS** planDuration helper.

### Next
Build per WRITE_PATH_SCOPE §5: Prisma-model the 3 tables (varchar/int customer_id split, BigInt
tracking, status/payment_type enums) → `src/modules/commerce-order/` → tsx verify (flag OFF) → wire
behind `isMysqlModule("commerce-order")` with dual-read fallback → typecheck → full doc protocol.

---

## 2026-06-12 — Offline center/batch browse reads wired (`offline-batch` built) — flag OFF

**What:** Built `offline-batch` (`ws_offline_center` + `ws_offline_batch`) and **wired** the offline browse reads behind `isOfflineBatchMysql()` (flag OFF): `GET /client/offline/centers`, `/batches`, `/centers/:id`, `/batches/:id` (all PUBLIC routes). Cities come from the already-migrated `offline-city`.

### ⚠ TWO schema fixes (both would otherwise break reads)
1. **bigint overflow:** `OfflineCenter.phone` was Prisma `Int` but the DDL is `bigint` — center 3's phone `9099665555` **overflows Int32** → read throws. Fixed to `BigInt`; the DTO surfaces it as a **string** (the Mongo model stores phone as a string). Also fixed `OfflineEnquiry.mobile Int→BigInt` (+ added its `created_at`) for the future write path.
2. **phantom column:** there is **NO `status` column** on `ws_offline_batch` OR `ws_offline_center`, yet every Mongo handler filters `{status:true}` and Prisma `OfflineBatch.status` was a phantom field (mapped nothing) → **removed**. The MySQL branch drops the status filter (all rows active) and synthesizes `status: true` in the DTO to keep the response shape stable.

### Field mapping
- `ws_offline_center.image` is a **JSON column** (array of URLs) → Mongo `images: string[]`.
- SQL column **typo**: batch `discription` → Mongo `description`.
- center→city and batch→center→city relations populated (Mongo `.populate` parity).

### Scope (deferred)
- `getOfflineDashboard` stays on Mongo — it also reads the unmigrated `OfflineBannerSlider`. `submitEnquiry` (POST → `ws_offline_enquiry`) is a **WRITE path**, not built.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-offline-batch.ts` (run, passed, removed): 3 centers + 3 batches, **read did not throw** on bigint phone; phone→string, `images[]` from JSON, status synth true, city ref resolved; city/center filters + search; center detail with nested batches; batch→center→city populated; `discription`→`description`; upcoming filter respects a real `1899` sentinel start_at edge; dashboard centers-by-city grouping. **ALL CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — `pendrive-course` SKIPPED (decommissioned feature) — will NOT be migrated

**Decision (user, 2026-06-12):** the entire pendrive-course surface is **no longer useful** and is **out of migration scope**. Do NOT build modules for it. Tables to ignore: `ws_pendrive_course`, `ws_pendrive_course_cart`, `ws_pendrive_course_cart_item`, `ws_pendrive_course_order`, `ws_pendrive_course_storage_device`, `ws_pendrive_course_tag`, `ws_pendrive_course_tracking` (7 tables). They stay in the DB for data preservation but get no read/write path. Removes 7 tables from the "remaining" count.

---

## 2026-06-12 — Book store DATA reads built (`catalog-book`) — flag OFF, NOT wired

**What:** Built `catalog-book` (`ws_book`, 10 rows) — the physical-book store catalogue reads. Dual-path, **flag OFF**, and **NOT wired** (same pattern as catalog-package).

### Why not wired
- The client `listBooks`/`getBookDetail` handlers enrich each book with per-customer **cart `qty`** (`ws_book_cart*`) and **`isPurchased`** (`ws_book_order*` by order status). Those order/cart tables are **NOT migrated**, and with book on MySQL (int ids) but orders/cart still on Mongo (ObjectIds), the purchased/cart keys wouldn't match the int book ids. So the module supplies the book DATA + the data-only computed fields, and flips with the **book-order/cart wave**.

### What the module produces (verified)
- Book rows + the computed fields reproducible from the row alone: **`isPaid`** (discountedPrice > 0), **`key`** (isCombo ? "combo" : "individual"), **`daysLeft`** (null — one-time purchase), **`isNew`** (createdAt window), and the per-request deep link via a `buildShareLink` callback. The order/cart-derived `qty` + `isPurchased` are left to the caller.
- **Schema fix:** `ws_book.order_by` nullable in the DDL but Prisma typed non-null → relaxed to `Int?`.
- **Mongo-only fields absent from `ws_book`:** `packageIds[]` (embedded M:N for the package-detail material(Book) tab — appliesTo-style, not reproducible), `examCountdownCategoryId`, `termsAndConditions`, `bookUrl`, `publication`, `deliveryEta`, `isTrending`. `isTrending` synthesized false; `publication`/`deliveryEta` synthesized to the Mongo defaults so the response shape stays stable.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-catalog-book.ts` (run, passed, removed): 10 books; book 10 'Computer' → key 'individual', isPaid true (price 200), daysLeft null, isTrending false + publication/deliveryEta defaults, shareableLink from callback; listing ordered by order_by asc, all active, computed fields on every item; language filter; name search; findByIds bulk + empty guard. **ALL 18 CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — Exam category NAVIGATION wired to MySQL (`catalog-exam` built) — flag OFF

**What:** Built `catalog-exam` (`ws_exam` + `ws_exam_category`) and **wired** `GET /client/exam-categories/:id/children` behind `isExamMysql()` (flag OFF). Mirrors `catalog-material` — category navigation only.

### Schema + differences vs material
- **Schema fix:** `ws_exam_category.name`/`image` nullable in the DDL but Prisma typed non-null → relaxed to `String?` (no NULLs today).
- **Display field is `name`** (not `title`): the DTO sets BOTH `title` + `name` to the column value (the Mongo handler does `title: cat.name`).
- **`ws_exam_category` has a `deleted` flag** (material category had none) → active = `status = true AND deleted = false`.
- **Per-child exam count is UNCONDITIONAL** (`Exam.countDocuments({categoryId})` with no status filter) — matches the Mongo handler exactly (material filtered active).

### Structural translation (same as material)
- Mongo `ExamCategory.childCategoryIds[]` embed → SQL `parent_id` self-FK (children = `WHERE parent_id = id`). `havingChildDirectory` via one distinct query. Wired **before** the ObjectId guard (MySQL id is int).

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-catalog-exam.ts` (run, passed, removed): 121 categories; category 86 → 13 active children (excludes deleted/inactive, == direct active count); `title` mirrors `name`; category 124 has children → `havingChildDirectory=true`, leaf 88 → false; per-child `count` equals an **unconditional** Exam count (no status filter). **ALL CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — Material category NAVIGATION wired to MySQL (`catalog-material` built) — flag OFF

**What:** Built `catalog-material` (`ws_material` + `ws_material_category`) and **wired** `GET /client/material-categories/:id/children` behind `isMaterialMysql()` (flag OFF). Scoped to **category navigation** — the genuinely-wirable subset of the material surface.

### ⚠ SCOPE — material ITEM listing stays BLOCKED (intentionally not built)
- `listMaterialsByCategory` gates each item via `getPurchasedMaterialIds` (`src/client/material/entitlement.ts`), which joins **LiveCourse + LiveCourseSubscription** (unmigrated) and reads the **Mongo-only embedded `materialCategories.category[]`** arrays on Course/Package/LiveCourse. Also `ws_material` has **no `isPaid` column** (the item filter is Mongo-only). Not reproducible from SQL this pass — only the category tree is.

### STRUCTURAL TRANSLATION — embedded ids → parent self-FK
- The Mongo `MaterialCategory.childCategoryIds[]` embed has **no SQL column**. Children resolve via the SQL `ws_material_category.parent` self-FK: children of X = `WHERE parent = X`. `havingChildDirectory` = "≥1 row with `parent = this.id`" — computed in **one distinct query** for the whole page, not N. Prisma Material + MaterialCategory models are clean (no schema fix).

### Composition
- `getCategoryChildren(parentId, search)`: parent category + active children (order_by) + per-child active-material count + `havingChildDirectory`. Wired **before** the ObjectId guard (a MySQL category id is an int).

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-catalog-material.ts` (run, passed, removed): category 270 (root) → 1 active child (1867 'test'), child `count=0` + `havingChildDirectory=false`; `title` mapped from the `title` column; missing parent → null. Plus a direct check: `parentsWithChildren([270,1867])` → `[270]` (270 has a child, 1867 doesn't) confirming the `havingChildDirectory` logic. **ALL CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — `Goal` is NOT migratable (Mongo-only architecture) — investigated, deferred (no code)

**Finding:** The audit listed `Goal` as a blocker for the package listing/filter handlers. Investigation shows it **cannot be migrated as a flat module** — it's a new-architecture Mongo-only entity, same class as the promocode `appliesTo` divergence:

- **Mongo `Goal`** (collection `ws_goals`) = `{ title, labels: [{_id, name}], isActive }` with **embedded labels**. `listPackagesByGoal` filters `Goal.find({"labels._id": {$in}})` and `Package.goalLabelId`; the `goalId` query param on `listPackages` filters the same structure.
- **There is NO `ws_goals` table in MySQL.** The only goal table is **`ws_customer_target_goal`** (Prisma `CustomerTargetGoal`) — a **flat** master `{id, name, image, active}` with **no `labels`, no `title`**. It is a structurally different, pre-redesign entity; `Package.goalId` references it.

So building reads off `ws_customer_target_goal` would yield a flat goal master that **no handler consumes in that shape** (inert code), and `listPackagesByGoal` **cannot be reproduced from SQL**. **Decision: DEFER Goal** — it's a Mongo-only architecture concern (the `ws_goals`→`ws_customer_target_goal` reconciliation is a separate, later effort), NOT a migration this wave.

**Silver lining (re-scopes the package surface):** while tracing this, confirmed **`enrichPackages`** (the helper every package listing uses) touches ONLY `PackageCourseEbookPrice` + `PackageCourseSubscription` — **both already built** — and does **NOT** touch Goal. So the core package listings are blocked on the `Package` module being unwired + the Mongo-only filter fields (`isSmartCourse`/`isPlannerCourse`), **not** on Goal. Only the goal-specific filters (`listPackagesByGoal`, `goalId` param) are Goal-blocked, and those are Mongo-only anyway.

**Next instead:** `Material` + `Exam` — real flat SQL tables (`ws_material` 226 rows, `ws_exam` 1 row, both with Prisma models), blocking category browse + course/package detail. The genuinely-migratable next targets.

---

## 2026-06-12 — eBook surface wired to MySQL (`catalog-ebook` built) — listing + detail composed, flag OFF

**What:** Built `catalog-ebook` (`ws_ebook`) and **wired** `GET /client/ebooks` (listing) + `GET /client/ebooks/:id` (detail) behind `isEbookMysql()` (flag OFF). Second wired vertical after course listing. Composes three modules: `catalog-ebook` (rows) + `commerce-price` (plans) + `commerce-ebook-sub` (entitlement).

### Key finding — NO separate ebook-price module needed
- The audit listed `EbookPrice` as a blocker, but investigation showed: the Mongo `EbookPrice` binds to `ws_ebook_prices`, **which does not exist in MySQL**. Ebook pricing actually lives in the **shared `ws_package_course_ebook_price`** (214 ebook-owned rows) — already covered by **`commerce-price`**. Added `commerce-price.listActivePricesByEbooks` (plural) and reused it. So the ebook vertical needed only ONE new module (`catalog-ebook`), not two.

### Schema + field handling
- **Schema fix:** `ws_ebook.description` + `author` are nullable in the DDL but Prisma typed them non-nullable → relaxed to optional (non-breaking; no other Prisma EBook consumer).
- **Mongo-only fields absent from `ws_ebook`:** `isTrending`/`isPaid`/`examCountdownCategoryId`/`demoFileName`/`bookFileName`. **`isPaid` is DERIVED from the plans** (paid when ≥1 active plan price > 0) — which is exactly the controller's documented fallback when the Mongo `isPaid` field is absent (always, for SQL rows) → faithful. `isTrending` synthesized `false`. Field renames: `terms_and_conditions`→`termsAndConditions`, `order_by`→`order`, `demo_url`→`demoUrl`, `book_url`→`bookUrl`.

### Composition
- **`listEbooksWithPlans` / `getEbookDetailWithPlans`:** active ebooks (name/author search + language filter) + active plans (commerce-price) + per-customer access window (commerce-ebook-sub `listActiveByCustomerForEbooks`, strict `status:true` + `endAt>now`, latest wins). Computed `details[]`/`isNew`/`isPurchased`/`daysLeft`. The **per-request deep link** is supplied by a `buildShareLink(ebookId)` callback so the HTTP concern stays in the controller. `availablePromoCode` always `[]` (ebooks aren't in the promo `appliesTo` model).
- Wired **before** the ObjectId guards (a MySQL ebook/customer id is an int). C3: customerId resolved to int at the boundary.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-ebook-listing.ts` (run, passed, removed): 2 ebooks; single read + `isTrending=false`; listing with ebook 18 (2 plans) + 45 (3 plans), both `isPaid=true` (price-derived); `details[]` shape; `shareableLink` from the callback; ordered by `order_by` asc; purchase-state false for the expired sub (no active window → null endAt/daysLeft); language filter (Gujarati=2, English=0); name search. **ALL 19 CHECKS PASSED.** `tsc` clean repo-wide.

---

## 2026-06-12 — Course LISTING wired to MySQL (`catalog-course` extended) — first commerce-consuming endpoint composed + wired, flag OFF

**What:** Extended `catalog-course` so the course **listing** endpoints (`GET /client/courses`, `GET /client/courses/category/:id`) can serve from MySQL, and **wired** them behind `isCourseMysql()` (flag still OFF). This is the **first endpoint that actually consumes the commerce reads** — it composes three migrated modules: `catalog-course` (rows) + `commerce-price` (plans) + `commerce-subscription` (ownership). Motivated by an audit (`docs/migration/FLIP_SCOPE.md`) showing 40/41 client handlers were blocked on unmigrated collections; `listCoursesHandler` was the first fully-coverable one once commerce-price/-subscription existed.

### ⚠ SCHEMA CHANGE — surface ws_course enum flags
- `ws_course.is_featured` + `purchase` are MySQL `enum('0','1')` that existed in the DDL but were **absent from the Prisma `Course` model** (the old scope note said "SQL enums not surfaced"). The listing **filters on `isPopular`** and returns `isPaid`, so they're now required. Added a Prisma enum **`CourseFlag01 { no @map("0"), yes @map("1") }`** (Prisma identifiers can't start with a digit) and mapped `Course.purchase`/`is_featured` to it, plus `featured_order Int?`. Regenerated v5.22.0.
- Transformer mapping: **`isPopular = is_featured === '1'`** (Mongo default false); **`isPaid = purchase !== '0'`** — i.e. NULL/'1' → true (honouring the Mongo `default: true`), only explicit '0' → false. `isPopular` is now a real filterable SQL column. Non-breaking (only added nullable fields; grep-verified no other Prisma Course consumer).

### The composition (MySQL equivalent of Mongo `paginateCoursesWithPlans`)
- **`listCoursesWithPlans(opts)`** in the service: paginated active courses (isPopular filter + name/desc search + sort + category restriction), each enriched with active plans **split by material** (commerce-price `listActivePricesByCourses`) and per-customer **purchase state** (commerce-subscription).
- **`daysLeft` rule ported exactly:** longest-lived active sub for the course wins; a **lifetime grant (endAt null) beats any dated sub**; a sub matches by `courseId` OR via one of the course's `planId`s. Added `commerce-subscription.listActiveForCoursesOrPlans` (includes lifetime; the prior `listActiveByCustomer` used `endAt > now` which **excluded lifetime** — wrong for this path).
- **C3:** `customerId` resolved to int at the controller boundary (parsed defensively while OFF). **paymentStatus divergence:** the Mongo query filters `paymentStatus:"verified"`, but the SQL subscription table has no such column (it collapses into `status`) — so `status=true` is the entitlement gate (documented).
- Populated refs match Mongo `.populate()`: educator `{_id,name}`, subject/video-category `{_id,title}` replace the scalar id strings on list items.

### Wiring
- `listCoursesHandler` + `listCoursesByCategoryHandler` branch on `isCourseMysql()` **before** the Mongo ObjectId guards (a MySQL categoryId is an int). Same `{success, data, pagination}` contract. Flag OFF → Mongo path unchanged.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-course-listing.ts` (run, passed, removed): is_featured='1'→isPopular true, purchase='0'→isPaid false; `{data,pagination}` + totalPages; course 75's 5 plans all land in `withoutMaterial`; educator/subject refs are `{_id,name}`/`{_id,title}`; isPurchased false (no sub) with + without a customer; `isPopular` filter includes/excludes correctly; name search hits. **ALL 17 CHECKS PASSED.** `tsc` clean repo-wide. (daysLeft/lifetime logic is a faithful port of the verified Mongo logic — not exercisable on staging, which has no course subs.)

---

## 2026-06-12 — Commerce · Educator READ built (`commerce-educator`) — Phase 3a, flag OFF — **3a READS COMPLETE**

**Module:** Phase 3a module 6 (C1 order) and the **FINAL 3a read module**. Table `ws_course_educator` (56 rows) — a **full entity** (email/password/about/view/last_seen_at), NOT a join table (it was mis-grouped as a "catalog relation" earlier). Built **READ-ONLY** dual-path (`src/modules/commerce-educator/`), **flag OFF**, as the public educator master + a lightweight `{_id,name,image}` ref for embedding in course listings.

### Security + drift
- **`password` is NEVER surfaced** — the client educator path does `.select('-password')`. The DTO excludes it; the ref projection is `{_id,name,image}` only. Verified by explicit test assertions on the single, list, and ref read shapes.
- **⚠ LATENT RISK (logged, deliberately NOT fixed):** `id` is **`bigint unsigned`** but the Prisma model maps it as **`Int`**. Current ids are **20–85** (56 rows) → no overflow. Changing to `BigInt` would ripple into the `Course.courseEducatorId` FK and the already-built/verified `catalog-course` module for **zero present benefit** — revisit (educator + Course FK together) only if ids ever approach 2³¹. (Contrast the subscription `tracking` bigint, which DID overflow and HAD to be fixed.)
- **`image`** nullable in the DDL but Prisma non-nullable `String` → DTO surfaces `image: string | null` defensively (no NULLs in data; Mongo marks `image` required so real embeds always have it). **No SQL `deleted` flag** (the Mongo soft-delete has no SQL counterpart) → active = `status = true` is the sole visibility gate. `last_seen_at`/`email_verified_at` omitted (not needed for the public master). No schema change this module.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-commerce-educator.ts` (run, passed, removed): 56 rows; `password` absent from single/list/ref DTOs; `view` numeric; `listActive` returns only `status=true`, name-ordered; ref projection is exactly `{_id,name,image}`; `findByIds` bulk + empty guard. **ALL CHECKS PASSED.** Module `tsc` clean repo-wide.

### Reads exposed
`findById` / `findActiveById` / `findByIds` (bulk course-educator hydration) / `listActive` (name search) / `findRefById` (`{_id,name,image}` embed).

### ✅ PHASE 3a READS COMPLETE
All six 3a read modules are built + verified, flag OFF: `commerce-price`, `commerce-subscription`, `commerce-ebook-sub`, `commerce-promoter`, `commerce-promocode`, `commerce-educator`. **Next: THE FLIP** — turn 3a + catalog (4 keys) + customer-address/profile/bank ON together (one consistent int id-space; first go-live since the customer module), plus the D2 catalog relations. Then **3b** (write-path, Razorpay, isolated, last).

---

## 2026-06-12 — Commerce · Promoter + Promocode READ built (`commerce-promoter`, `commerce-promocode`) — Phase 3a, flag OFF

**Modules:** Phase 3a modules 4 & 5 (C1 order — the promocode group). `commerce-promoter` (`ws_promoter`, 114 — the promocode owner master) + `commerce-promocode` (`ws_promocode`, 2 + `ws_promoted_package_course_ebook`, 5). Both **READ-ONLY** dual-path, **flag OFF**.

### ⚠ DECISION — promocode is SQL-faithful, NOT the client appliesTo contract
- The live Mongo `PromoCode` model (collection `ws_promo_codes`) uses a **newer discount mechanism**: `discountType` (flat|percentage) + `discountValue` + `appliesTo: {type: package|course|liveCourse, ids[]}`. The client `applyPromocode`/`listPromocodes` paths read **that** shape (via `promoCovers`/`computePromoDiscount`).
- The SQL tables have **none** of those fields — the discount is a **per-plan** `promoter_percentage` + `customer_percentage` split in `ws_promoted_package_course_ebook` (keyed by `pcb_price_id` = the plan). So the **client promocode contract CANNOT be reproduced from SQL**. **Decision (user-confirmed 2026-06-12):** build **SQL-faithful reads only**, flag OFF (same pattern as catalog-package); the `appliesTo` reconciliation is a separate, later effort.

### Schema fixes (nullable drift — DDL vs Prisma)
- **Promoter:** `full_name`/`email`/`phone` are nullable in the DDL but Prisma typed them non-nullable `String` → relaxed to `String?` (no NULLs in current data; guards a future NULL).
- **Promocode:** `promocode`/`promo_start_at`/`promo_expire_at` nullable in the DDL but Prisma non-nullable → relaxed to optional. (`title`/`description` are NOT NULL in DDL but Prisma optional — safe direction.) Regenerated client v5.22.0; non-breaking (no other code reads these Prisma models — grep-verified).

### Read semantics + security
- **Promoter:** `password` exists on the row (full entity, like `ws_course_educator`) but is **NEVER surfaced** in the DTO (Mongo marks it `select:false`). camelCase mapping (`full_name`→`fullName`, `is_delete`→`isDelete`). Active = `status=true AND is_delete=false`.
- **Promocode:** valid = `status=true AND promo_start_at < now < promo_expire_at`; public listings add `type='public'`, soonest-to-expire first; code lookup uppercases (Mongo parity). Promoted-plan rows (per-plan %) included on single-promocode reads. Owner `0` sentinel → null.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-promocode-group.ts` (run, passed, removed): promoter 114 rows, `password` absent from DTO, camelCase + active filter; promocode 2 + promoted 5, `POLICE60` resolves its 5 promoted plans with correct per-plan %, case-insensitive window-bounded `findValidByCode` (in-window match / out-window null), `listActivePublic` + `countActivePublic` agree. **ALL CHECKS PASSED.** Modules `tsc` clean repo-wide.

### Reads exposed
- **promoter:** `findById` / `findActiveById` / `findByIds` (bulk owner hydration) / `listActive` (name+email search).
- **promocode:** `findById` (w/ plans) / `findValidByCode` / `listActivePublic` + `countActivePublic` (paginated) / `listPromotedPlans`.

---

## 2026-06-12 — Commerce · eBook Subscription READ built (`commerce-ebook-sub`) — Phase 3a, flag OFF + **Prisma schema fix (missing cols)**

**Module:** Phase 3a module 3 (C1 order). Table `ws_ebook_subscription` (1 row) — the **ebook entitlement source of truth** (a customer can download/read an ebook iff an active, unexpired row exists). Built **READ-ONLY** dual-path (`src/modules/commerce-ebook-sub/`). **Writes (create on payment) are Phase 3b.** **Flag NOT enabled** — flips with catalog + the rest of 3a (joined on int catalog ebook + int customer id-space).

### ⚠ SCHEMA CHANGE — Prisma model was missing the entitlement flag
- The DDL has **`status`** (tinyint, the active-entitlement flag) + **`payment_type`** (enum), both **ABSENT from the Prisma `EBookSubscription` model**. The read contract is impossible without `status`. **Added** `status Boolean?` + `payment_type PackageCourseEbookPaymentType` (reused the existing enum).
- **`start_at`/`end_at` nullable:** DDL marks both `Null: YES`; Prisma typed them non-nullable `DateTime`. **Relaxed** to `DateTime?` so a NULL-dated row can't crash a read (the single staging row has both set). Regenerated client v5.22.0. No existing code reads these Prisma fields (grep-verified), so non-breaking; `tsc` clean repo-wide.

### Read semantics
- **Active = `status ≠ false` AND `end_at > now`**, latest `endAt` wins. `status` is nullable (default 1) → NULL treated as **active** (matches column default + Mongo default); the repository active filters use `status: {not: false}` to stay consistent with the transformer's NULL→true coercion.
- `price` Decimal → number. Owner `0` sentinel → null. **C3:** `customer_id` is **int** (same as package subscription) → module takes/returns int `customerId`.
- Mongo-only promo fields (`promocodeId`/`promoterId`/`referrerId`) are NOT columns here (order row / 3b) → not produced.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-commerce-ebook-sub.ts` (run, passed, removed): read did not throw (status/payment_type/nullable dates resolve); `status` + `payment_type` surface; price Decimal→number; active check true before `endAt` / false after; `findByOrderId`; `listByCustomer` scoping; `countActiveByEbook`. **ALL CHECKS PASSED.** Module `tsc` clean.

### Reads exposed
`hasActiveEbookSubscription` + `getActive…` (access gate) · `findById` · `findByOrderId` · `list{,Active}EbookSubscriptionsByCustomer` · `countActiveByEbook` — mirror `findOne({customerId, ebookId, status:true, endAt:{$gt:now}})`.

---

## 2026-06-12 — Commerce · Subscription READ built (`commerce-subscription`) — Phase 3a, flag OFF + **Prisma schema fix (bigint)**

**Module:** Phase 3a module 2 (C1 order). Table `ws_package_course_subscription` (2 rows) — the **entitlement source of truth** (a customer owns a course/package iff an active, unexpired row exists). Built **READ-ONLY** dual-path (`src/modules/commerce-subscription/`). **Writes (create/extend on payment) are Phase 3b** (verify.controller / webhook) — NOT in this module. **Flag NOT enabled** — flips with catalog + the rest of 3a (rows are joined on the int catalog + int customer id-space and read by still-Mongo consumers).

### ⚠ SCHEMA CHANGE — `tracking` Int → BigInt (would otherwise THROW on read)
- The SQL `tracking` column is **`bigint`**; both staging rows hold ~**1.19e11** (`119400642963`, `119400280393`), which **overflow Int32**. The Prisma model mapped it as `trackingId Int?` → **a plain read would throw** `Value out of range`. Confirmed via `MAX(tracking) > 2147483647 = 1`.
- **Fix:** `PackageCourseSubscription.trackingId Int? → BigInt?` and the referenced `PackageCourseSubscriptionTracking.id Int → BigInt` (the FK target; its own `id` is `bigint` with values ~1.19e11). Regenerated client v5.22.0. The transformer coerces `bigint → number` (lossless — below `Number.MAX_SAFE_INTEGER` ~9e15; null-guards the >2^53 case). No existing code reads these Prisma fields (verified by grep — all `trackingId` usages are Mongo/courier), so the change is non-breaking; `tsc` clean repo-wide (only pre-existing unrelated errors).
- `PackageCourseSubscriptionTracking` itself (the tracking table) is a **3b write-path** entity — only its PK type was corrected here so the schema validates and the back-relation compiles; no module built for it.

### Mongo↔SQL field-NAME divergence (handled in the transformer)
- Mongo `packageId` = the **PLAN** ref (PackageCourseEbookPrice) = SQL **`pcb_id`** (`planId`). Mongo `targetPackageId` = the **actual package** = SQL **`package_id`** (`packageId`). The DTO uses the **Mongo names** so consumer predicates port 1:1.
- **C3 seam:** `customer_id` is **`int`** here (not varchar like the order tables). In the migrated id-space the customer IS the int id (per customer-auth), so the module takes/returns `customerId` as an **int**; string→int resolution is the caller's boundary. Matches the C3 recommended default.
- Mongo-only commerce/promo fields (`promocodeId`, `promoterId`, `paidAmount`, `paymentStatus`, `razorpay*`, …) are NOT columns on this table (order row / 3b) → not produced. Owner `0` sentinel → null (same as commerce-price). Active entitlement = `status = true AND end_at > now`.

### Verification (flag OFF → live-DB tsx)
- `scripts/_tmp/verify-commerce-subscription.ts` (run, passed, removed): read did **not throw** on bigint tracking; `tracking` coerced lossless to a safe integer; SQL `package_id`→`targetPackageId` + `pcb_id`→`packageId` mapping; active check true before `endAt` / false after; `listByCustomer` scoping; `countActiveByPackage`. **ALL CHECKS PASSED.** Module `tsc` clean.

### Reads exposed
`hasActive{Course,Package}Subscription` + `getActive…` (access gates) · `findById` · `list{,Active}SubscriptionsByCustomer` · `countActiveBy{Package,Course}` — mirror the dominant Mongo entitlement predicates (`findOne({customerId, courseId|packageId, status:true, endAt:{$gt:now}})`).

---

## 2026-06-12 — Commerce · Price built (`commerce-price`) — Phase 3a, flag OFF

**Module:** First commerce-wave module (Phase 3a, sub-order C1 = price first, lowest risk). Table `ws_package_course_ebook_price` (1353 rows) — pure read-only plan/pricing lookup, no writes, no auth fields. Built dual-path (`src/modules/commerce-price/`: repository + service + transformer + types). **Flag NOT enabled** — flips together with catalog + the rest of 3a in one consistent int id-space (every price consumer joins int-id catalog rows + ObjectId-id subscription/order rows). Confirmed C1–C4 recommended defaults.

### Schema state — `PackageCourseEbookPrice` CLEAN (no Prisma change)
- Prisma model is a FAITHFUL 1:1 of the live DDL (all 13 cols, correct `@map`s). `DESCRIBE` vs model matched exactly — **no schema fix required** (unlike Package/Course nullable fixes).

### DRIFT found + handled (caught by the tsx verify script, not assumed)
1. **Owner-id `0` sentinel:** `package_id` / `course_id` / `ebook_id` use **`0`** (NOT only `NULL`) as the "not this owner" marker — 927/1353 rows mix `0`s with one real id. The transformer coalesces `0`/null → `null` to match Mongo's `null` representation. Verified the `> 0` invariant holds: **no row owns more than one entity** (`(pkg>0)+(course>0)+(ebook>0) ≤ 1` for all rows). Repository owner sampling/filters use `> 0`, not `IS NOT NULL`.
2. **`duration` is DAYS, not months** (memory `project_plan_duration_unit`): confirmed live — the `"12 Month"` plan row carries `duration: 365`. Surfaced raw by this read-only lookup; `endAt` computation (planDuration `asDays`/`setDate`) is the Phase 3b write boundary's concern.
3. **`material_price` null → 0:** nullable in SQL but defaults to `0` in the Mongo model; transformer coalesces.

### Verification (flag OFF → live-DB tsx, not HTTP)
- `scripts/_tmp/verify-commerce-price.ts` (run, passed, removed): 1353 rows; findById/findByIds round-trip + transform; owner `0`→null; exactly-one-owner; material_price null→0; per-owner active lists ordered by `duration` asc. **ALL CHECKS PASSED.** `tsc --noEmit` clean for the module (only pre-existing errors elsewhere).

### Reads exposed
`findById` / `findActiveById` / `findByIds` + `listActiveBy{Package,Course,Ebook}` and `…ByPackages/ByCourses` — all active-only owner lists ordered by `duration` asc (mirrors the Mongo `.sort({duration:1})` plan listings).

---

## 2026-06-11 — Commerce/Dashboard wave SCOPED (no code yet) — [`migration/COMMERCE_WAVE_SCOPE.md`](./migration/COMMERCE_WAVE_SCOPE.md)

**Decision:** the next wave is commerce/dashboard (chosen over migrating D2 catalog relations standalone — D2 is keyed entirely on the still-OFF int catalog id-space, unblocks nothing, ~12k churny rows for zero activation). Commerce is what catalog is *waiting on* (catalog detail/listing join pricing + check subscriptions), so it's the real unblock.

**Recommended sequencing — read-first, NOT one big flip:**
- **3a (read, flag OFF, unblocks catalog):** `commerce-price` (`ws_package_course_ebook_price`, 1353), `commerce-subscription` read (`ws_package_course_subscription`, 2), `commerce-ebook-sub` read (`ws_ebook_subscription`, 1), `commerce-promoter` (`ws_promoter`, 114), `commerce-promocode` (`ws_promocode` 2 + `ws_promoted_package_course_ebook` 5), `commerce-educator` (`ws_course_educator`, 56 — a full entity, not a join table).
- **3a + D2 folded in:** `ws_package_specific_subject` (1623), `ws_video_category_relation` (2456), `ws_video_category_package_relation` (6907), `ws_package_course_material` (1) — ride the catalog flip.
- **Flip 3a + catalog + address/profile/bank together** (one consistent int id-space — first go-live since the customer module).
- **3b (write-path, DANGEROUS, isolated, last):** `commerce-order` (`ws_package_course_order`) + subscription writes + `_tracking` + `commerce-ebook-order` — driven by `verify.controller.ts` (569 lines, Razorpay).

**Schema-drift flags spotted from `DESCRIBE` BEFORE coding:**
1. `customer_id` is **`varchar(255)`** in `ws_package_course_order` + `ws_ebook_order` (Mongo ObjectId-as-string), but **`int`** in `ws_package_course_subscription` — one wave carries both id representations; the order→subscription seam must be handled deliberately (C3).
2. Reserved-word columns needing Prisma `@map`: `ws_package_course_subscription_tracking.order`, `ws_video_category_relation.order`.
3. `price.duration` = **DAYS** (memory `project_plan_duration_unit`) → planDuration helper, `setDate` not `setMonth`.
4. `ws_course_educator` is a full entity (email/password/about/view/last_seen) — mis-grouped as a "relation" earlier; read-only in 3a.

**Open decisions (C1–C4) listed in the scope doc** — confirm 3a sub-order (price first), D2 timing (fold in), the customer_id seam, and 3b isolation before any code.

---

## 2026-06-11 — Catalog · Video built (`catalog-video`) — flag OFF + URL-contract parity PASS

**Module:** Catalog sub-module 3 of 3. Tables `ws_video` (156) + `ws_video_category` (157). M:N relation tables `ws_video_category_relation` (2456) + `ws_video_category_package_relation` (6907) **DEFERRED** (D2). See [`migration/CATALOG_MODULE_SCOPE.md`](./migration/CATALOG_MODULE_SCOPE.md). **Flag NOT enabled.**

### Schema state — `Video` CLEAN (no Prisma change)
- `Video` model matches the live DDL exactly (`platform, vimeo_id?, aws_id?, youtube_id?, slug, topic, order_by→order, type→priceType enum, status`). No drift, no schema edit, no regen needed.
- Minor: `ws_video_category` DDL has `parent`/`educator_id`/`pdf` cols the Prisma `VideoCategory` omits — read-safe (not selected). Mongo-only `courseId`/`liveCourseId`/`childCategoryIds`/`liveSessionId` are absent from `ws_video_category` (used by lecture course-membership + catalog browse) — a reason video stays OFF.

### D2 decision — DEFER the relation tables
The migrated client surface builds video-category groups from the Mongo `Package.specificSubjects[]` array + `VideoCategory.childCategoryIds` (catalog.controller.ts:74,120), NOT from the SQL `ws_video_category_relation` / `_package_relation` join tables (a legacy/admin representation). No enabled client path reads them ⇒ defer to the commerce/browse wave. Their Prisma models already exist, so no work is wasted.

### THE VIDEO-URL ENCRYPTION CONTRACT — parity PASS ✅
- Encryption (`utils/videoEncryption` via `encryptVideoSource`) is deterministic given (token, sourceId); sourceId is picked by `platform` from {youtube_id, aws_id, vimeo_id}. Token is random per request → URL is per-request, parity is per-(token, sourceId).
- The Prisma `Video` fields have the SAME names as the Mongo model, so a MySQL-sourced object fed into the SAME util yields an identical URL for a fixed token — **parity by construction**.
- **Verified (fixed token 1234567890123456, video 33089, aws):** MySQL `videoURL` === Mongo-shaped `videoURL` (`Ocgw9A2BWEoSRocWQ0tryTl76PeR9YFx9xCE57gp0fs=`), and `decrypt(videoURL) === aws_id`. Round-trip confirmed.
- **NEVER reimplement encryption** — the module exposes `getVideoEncryptInput()` / `toVideoEncryptInput()` returning the exact object the shared util consumes. `toVideoEncryptInput` coerces ""/null platform ids to undefined (live data stores "" for unused platform columns).

### New module (`src/modules/catalog-video/`)
- `repository.ts`: `findVideoById`, `listActiveVideosByCategory`, `countActiveVideosByCategory`; `findCategoryById`, `listActiveCategories`.
- `transformer.ts`: `toVideoDto`, `toVideoEncryptInput` (the URL contract), `toVideoCategoryDto`.
- `service.ts`: dual-path reads + `getVideoEncryptInput`; key `catalog-video`.
- `types.ts`: DTOs + `VideoEncryptInput` + the full contract/scope note.

### NOT done — flag stays OFF ⚠️
- Video/category ids int (MySQL) vs ObjectId (Mongo); still-Mongo consumers (lecture, free, dashboard resume, progress, catalog browse) join those ids. lecture course-membership needs `VideoCategory.courseId` (Mongo-only); paid access checks PackageCourseSubscription (commerce-wave). No controller wired (no safe standalone video-URL endpoint). ⇒ `catalog-video` flips **with** the commerce/dashboard wave (D3).

### Verification (live DB, tsx)
- 152 active categories; 5 active videos in category 3105 (list + count agree); URL-contract parity PASS (above). Temp script removed.

### Index/migration
- None. Reads only; no new indexes; no live DDL change; no Prisma change.

---

## 2026-06-11 — Catalog · Course built (`catalog-course`) — flag OFF

**Module:** Catalog sub-module 2 of 3. Tables `ws_course` (1 row) + `ws_course_subject_category` (1 row). See [`migration/CATALOG_MODULE_SCOPE.md`](./migration/CATALOG_MODULE_SCOPE.md). **Flag NOT enabled** (same id-coupling + commerce-join reasons as package).

### Prisma schema (drift fix) ⚠️
- `Course.image`: `String` → `String?` — the live `ws_course.image` DDL is **nullable** but Prisma declared it NOT NULL. Regenerated client v5.22.0. No live DDL change.

### Schema-drift notes (verified vs live `DESCRIBE`)
- `ws_course` nullable cols: `image`, `name`, `vcategory_id`, `pc_material_id`, `featured_order`.
- `ws_course` cols with NO Prisma mapping: `is_featured` (enum '0'/'1'), `purchase` (enum '0'/'1'), `featured_order` (int). The Mongo `Course` carries conceptual equivalents `isPopular`/`isPaid` (booleans) + Mongo-only `subtitle` and embedded `materialCategories[]`/`examCategories[]`. The SQL enums are not surfaced (no consumer reads them off the migrated row).
- `course_category_id` → `CourseSubjectCategory` (Prisma `courseSubjectCategoryId`); confirmed by data (course 75 → category 774).

### New module (`src/modules/catalog-course/`)
- `repository.ts`: `listActiveCategories`, `countActiveCoursesByCategory` (Prisma `groupBy`); `findCourseById`, `listActiveCourses` (name/desc search), `listActiveCoursesByCategory`.
- `transformer.ts`: `toCourseCategoryDto`/`…WithCountDto`, `toCourseDto` (only physically-present cols).
- `service.ts`: dual-path `listCourseCategoriesWithCounts` + course reads; key `catalog-course`.
- `types.ts`: DTOs + scope/drift note.

### App wiring
- `src/client/course/course.controller.ts` `listCourseCategoriesHandler` branches on `isCourseMysql()`. Listing/detail endpoints stay Mongo (they join PackageCourseEbookPrice plans + PackageCourseSubscription ownership and embed Mongo-only category groups).

### NOT done — flag stays OFF (same as package) ⚠️
- Course / subject-category ids are **int** (MySQL) vs **ObjectId** (Mongo); still-Mongo listing/detail/dashboard consumers join those ids. And listing endpoints need commerce-wave joins + Mongo-only fields. ⇒ `catalog-course` flips **together with** the commerce/dashboard wave (D3).

### Verification (live DB, tsx)
- `listCourseCategoriesWithCounts` → 1 category, `courseCount:1` (groupBy correct). `listActiveCourses`/`findCourseById(75)`/`listActiveCoursesByCategory(774)` → 1 row each, nullable `image`/`pcMaterialId` handled. Temp script removed.

### Index/migration
- None. Reads only; no new indexes; no live DDL change.

---

## 2026-06-11 — Catalog · Package built (`catalog-package-type` + `catalog-package`) — flags OFF

**Module:** Catalog sub-module 1 of 3 (`package → course → video`, D1). Tables `ws_package_type` (6 rows) + `ws_package` (4 rows). See [`migration/CATALOG_MODULE_SCOPE.md`](./migration/CATALOG_MODULE_SCOPE.md). **Both flags NOT enabled** (id-space coupling — see below).

### Prisma schema (drift fix) ⚠️
- `Package.shareable_link`: `String` → `String?` — the live `ws_package` DDL has `shareable_link` **nullable**, but the Prisma model declared it NOT NULL (would throw on a NULL row). Regenerated client v5.22.0. (All 4 current rows are non-null, but the type now matches the DDL.)
- No DDL change to the live DB.

### Schema-drift notes (verified vs live `DESCRIBE`)
- `ws_package_type` has ONLY `{id, name, created_at, updated_at}` — the Mongo `PackageType` additionally carries `order` + `active` which `listPackageTypes` filters/sorts on. MySQL branch synthesizes `order:0` + `active:true` to keep the response JSON shape identical.
- `ws_package.educator_id` exists in the DDL but is **absent from the Prisma `Package` model** (and NULL for all 4 rows) → transformer surfaces `educatorId: null`. Add to the Prisma model + regen if a consumer ever needs it.
- `ws_package` is a STRUCTURAL SUBSET of Mongo `ws_packages`: the SQL table lacks `subtitle, isPaid, isSmart/PlannerCourse, goalId, goalLabelId, examCountdown*, packageCategoryId, specificSubjects[], materialCategories[], examCategories[], withMaterialText/withoutMaterialText`. Every client package endpoint also joins commerce-wave tables (PackageCourseEbookPrice plans, PackageCourseSubscription ownership, PromoCode, PackageChat). ⇒ the full `/client/packages` contract CANNOT be reproduced from `ws_package` alone this wave.

### New module (`src/modules/catalog-package/`)
- `repository.ts`: `listPackageTypes`; `findPackageById`, `listActivePackages`, `listActivePackagesByType` (all `active:true`, ordered `order_by` then id).
- `transformer.ts`: `toPackageTypeDto` (synthesized order/active), `toPackageDto` (only physically-present columns; `educatorId:null`).
- `service.ts`: dual-path; two keys — `catalog-package-type` (Phase A) + `catalog-package` (Phase B).
- `types.ts`: DTOs + the full scope/drift note.

### App wiring
- `src/client/package/package.controller.ts` `listPackageTypes` branches on `isPackageTypeMysql()` (`catalog-package-type`). All other package endpoints stay Mongo (they need commerce joins + Mongo-only fields).

### NOT done — both flags stay OFF (audit finding) ⚠️
- **`ws_package_type` id-space coupling.** Type ids are **int** in MySQL but **ObjectId** in Mongo. Still-Mongo consumers join package-type ids: `purchase-history.controller.ts:89`, `my-subscriptions.controller.ts:108`, `dashboard.controller.ts:146`, package detail/list, `categories`, `free`, + admin package CRUD (`deletePackageType`). Flipping `listPackageTypes` to MySQL alone would return int ids from `/packages/types` while every other surface returns ObjectId package-type ids → inconsistent id space → broken FE. So `catalog-package-type` flips **together with** `catalog-package` and the commerce/dashboard wave (mirrors the address/profile/bank deferral, D3).

### Verification (live DB, tsx)
- Phase A: `listPackageTypes` → 6 rows, correct synthesized shape.
- Phase B: `listActivePackages` → 4 rows (incl. empty-string & NULL-tolerant `shareable_link`), ordered `order_by` (-8,1,11,14); `findPackageById(91)` full DTO; `listActivePackagesByType(1)` → 4. Temp script removed.

### Index/migration
- None. Reads only; no new indexes; no live DDL change.

---

## 2026-06-10 — `offline-city` migrated (DDL change) + cart resolution

**Module:** `offline-city` (cities only, to unblock `customer-address`) — see [`migration/OFFLINE_MODULE_SCOPE.md`](./migration/OFFLINE_MODULE_SCOPE.md). **Enabled** in `MIGRATION_MYSQL_MODULES`.

### DDL change (live DB) ⚠️
```sql
ALTER TABLE ws_offline_city
  ADD COLUMN status TINYINT(1) NOT NULL DEFAULT 1 AFTER image,
  ADD COLUMN `order` INT NOT NULL DEFAULT 0 AFTER status;
```
Reason (decision D1): Mongo `OfflineCity` has `status`/`order` (active-gating + manual ordering) but the legacy dump's `ws_offline_city` had neither. Added them to preserve behavior. Existing rows default to `status=1, order=0`.

### Prisma schema
- `OfflineCity`: added `status Boolean @default(true)` + `order Int @default(0) @map("order")`. Regenerated client v5.22.0.

### New module (`src/modules/offline-city/`)
- `repository.ts`: `listActive` (status=true, order then name), `findById`, `findNameById`.
- `transformer.ts`: row→DTO (string ids), `toCityNameDto`.
- `service.ts`: dual-path `listActiveCities` + `resolveCityName` (cart cityId→name).

### App wiring
- `src/client/address/address.controller.ts` `listCities` branches on `isOfflineCityMysql()`.
- `src/client/cart/cart.controller.ts` `attachShippingToCart` cityId→name resolution branches on the flag.

### NOT done (blocker for address flip)
- Cart (`cart.controller.ts:177`) + course-order (`course.service.ts:306`) still **read** `CustomerAddress` via Mongoose (ObjectId). `customer-address` stays OFF until those reads are branched — else enabling it breaks checkout.

### Verification (live DB)
- 2 cities, correct order/status. End-to-end: MySQL address `cityId=2` → `"Ahmedabad"` via the cart resolution path. Repo test rows cleaned up.

### Index/migration
- DDL: 2 columns added to `ws_offline_city` (additive, defaults). No new indexes.

---

## 2026-06-10 — Customer Module: `customer-bank-account` built + shipping assessed (flags OFF)

**Module:** `customer-bank-account` (Customer Module step 4) — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md) §7. **Flag NOT enabled** (referral withdrawal flow + reward-points transaction are Mongo-coupled).

### New module (`src/modules/customer-bank-account/`)
- `repository.ts` Prisma CRUD on `ws_customer_bank_account`: `listByCustomer`, `findOwned`, `create`, `updateOwned`, `deleteOwned` (hard delete = Mongo `findOneAndDelete` parity). Owner-scoped on `customer_id`.
- `transformer.ts` row→DTO (string ids, Mongo `_id`-shape compatible).
- `service.ts` dual-path via `isMysqlModule("customer-bank-account")`.

### App wiring
- `src/client/referral/referral.controller.ts`: 4 CRUD handlers (`listBankAccounts`, `createBankAccount`, `updateBankAccount`, `deleteBankAccount`) branch on `isBankAccountMysql()`. MySQL path uses integer ids; IFSC lookup (bank/branch/city) stays server-side in the controller.
- `requestWithdrawal` left on Mongo (embedded `bankAccount.toObject()` + reward-points txn) — branching it would create a mixed-backend transaction.

### Schema note
- Live `ws_customer_bank_account` has all columns the Prisma model declares (incl. `bank_name`/`branch_name`/`city`) — no phantom-column mismatch. No schema change needed.

### Shipping assessment
- `CustomerShipping` has **no standalone CRUD** — it's an internal checkout snapshot created/read inside cart + course-order flows and embedded into orders/subscriptions. Not migratable as part of the Customer Module; migrates with cart/orders. Prisma `CustomerShipping` (BigInt phones) already in place for that future work.

### Verification (live DB, customer 472347)
- Bank CRUD: create→list→update→delete cycle, owner-scoped, test row removed (DB clean).

### Index/migration
- No new indexes. No DDL.

---

## 2026-06-10 — Customer Module: `customer-profile` built (flag OFF)

**Module:** `customer-profile` (Customer Module step 3) — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md) §4. **Flag intentionally NOT enabled** (profile dashboard aggregates not-yet-migrated collections → stays on Mongo).

### Prisma schema
- Added `facebookId String? @default("0") @map("facebook_id") @db.VarChar(255)` to `Customer`. Read-only (no FB write path). Regenerated client v5.22.0.

### New module (`src/modules/customer-profile/`)
- `name.ts` — `full_name` ↔ first/middle/last split (read) / join (write) helpers.
- `repository.ts` — Prisma on `ws_customer`: `findActiveById`/`findLiveById`, `emailTakenByOther`, `hydrateGoals` (JSON int ids → ws_customer_target_goal, order preserved), `updateById`, `softDelete`, `setProfilePicture`, single-token device `setDeviceToken`/`clearDeviceToken`/`setDeviceTokenByPhone`.
- `transformer.ts` — row + goals → ProfileDto; `deriveProfileCompleted` (full_name present, not stored).
- `service.ts` — 9 fns, `{ ok, message, data }` envelope.

### App wiring
- `src/client/profile/customer.service.ts`: all 8 exported fns branch on `isProfileMysql()` → delegate to the module. Get/update keep the existing Redis profile cache (read-through + invalidate); picture upsert/delete keep S3 cleanup via the service's returned `previousUrl`; delete-account revokes MySQL `ws_customer_access_token` rows via `customerAuthRepository.deactivateTokens` + clears session cache.
- `dashboard.controller.ts` left on Mongo (cross-module aggregation) — untouched.

### Decisions encoded
- name: split full_name (join on write); device: single `device` token (newest wins, legacy parity); isProfileCompleted: derived; facebookId: read-only.

### Verification (live DB, customer 472347)
- `"DIXIT PATEL"` → `["DIXIT","","PATEL"]`; goals `[7,8,12,13,14]` → named DTOs in order; `isProfileCompleted=true`; `isNewUser=false`; facebook_id not leaked. Update name-join + goals rewrite, then restored (DB clean). Name split/join edge cases (1–4 tokens, empty, partial) verified.

### Index/migration
- No new indexes. One additive Prisma field map (`facebook_id`, column already exists). No DDL.

---

## 2026-06-10 — Customer Module: `customer-address` built (flag OFF)

**Module:** `customer-address` (Customer Module step 2) — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md) §3. **Flag intentionally NOT enabled** (runtime stays on Mongo until OfflineCity + cart checkout migrate).

### New module (`src/modules/customer-address/`)
- `repository.ts` Prisma CRUD on `ws_customer_address`: `listByCustomer`, `findOwned`, `create`, `updateOwned`, `softDeleteOwned`, `setDefault` (transaction). String→BigInt phone + string→Int pincode conversions; all queries owner-scoped on `user_id`.
- `transformer.ts` row→DTO: BigInt phones + int FKs → strings (Mongo `_id`-shape compatible); no nested populate.
- `service.ts` dual-path via `isMysqlModule("customer-address")`; uniform `{ ok, status, data|message }`.

### App wiring
- `src/client/address/address.controller.ts`: all 6 handlers (`getMyAddresses`, `getAddressById`, `createAddress`, `updateAddress`, `setDefaultAddress`, `deleteAddress`) branch on `isAddressMysql()`. MySQL path uses **integer** ids (bypasses Mongo ObjectId-regex validation).
- `src/client/address/address.validation.ts`: added `createAddressSchemaMysql` / `updateAddressSchemaMysql` — numeric FK ids, freeform `label`, **required `city`** string.

### Data note (caught by live-DB test)
- `ws_customer_address.city` is **NOT NULL** and is what legacy rows actually populate (`city_id` is NULL in the dump). Added `city` to input/DTO/validation accordingly.

### Verification (live DB)
- Full create→list→setDefault→update→soft-delete cycle for customer 472341; BigInt phone `9664796376` round-trips; test row removed (DB clean).

### Index/migration
- No new indexes. No DDL. Reads/writes existing `ws_customer_address` only.

---

## 2026-06-10 — Customer Module: schema fixes + `customer-lookups` enabled

**Module:** `customer-lookups` (Customer Module, step 1 of remaining migration — see [`migration/CUSTOMER_MODULE_REMAINING.md`](./migration/CUSTOMER_MODULE_REMAINING.md))

### Prisma schema (`prisma/schema.prisma`)
- `model CustomerAddress`: `phone` and `alternate_phone` changed `Int`/`Int?` → **`BigInt`/`BigInt?`**.
  Reason: 10-digit phone numbers (e.g. `8160530058`, `9664796376`) overflow `Int` (max 2,147,483,647) and fail to read.
- `model CustomerAddress`: kept `label String?`, `isDefault Boolean? @default(false) @map("is_default")`, `cityId Int? @map("city_id")`.
  Reason: live DB (`DESCRIBE ws_customer_address`) **has** these columns even though the legacy `websankul_staging.sql` dump does not — decision **"keep columns to match DB"** so default-address/label/city migrate without loss.
- `model CustomerShipping`: `phone`/`alternate_phone` changed `Int` → **`BigInt`** (same overflow fix).
- Ran `prisma generate` (v5.22.0); generated client verified against live DB.

### App wiring (`src/client/address/address.controller.ts`)
- `getStates`, `getEducations`, `getCharacteristic` (educations only) now branch on
  `isMysqlModule("customer-lookups")` → call `customer-lookups.service` (Prisma) when on, else Mongoose.
  DTOs projected to the exact existing Mongo contract (`{_id,name,stateCode}` / `{_id,name}`).
  Goal (rich onboarding collection) stays on Mongo.

### Env
- `MIGRATION_MYSQL_MODULES` += `customer-lookups` in `.env` and `.env.example`.

### Verification (live DB `127.0.0.1:3307/websankul_staging`)
- States: 12 active, correct shape. Educations: 10 active, correct shape.
- BigInt phone `8160530058` reads cleanly (would have overflowed old `Int`).
- `label`/`isDefault` columns read without error.

### Index/migration
- No new indexes. No destructive DDL. Live DB already had BigInt phone columns + the 3 extra columns (changed externally before this session).
