# Migration Query / Schema / Index Changes

> Append-only log of query, schema, index, and migration changes. **Newest first.**

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
