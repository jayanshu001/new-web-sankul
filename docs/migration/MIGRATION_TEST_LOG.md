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
