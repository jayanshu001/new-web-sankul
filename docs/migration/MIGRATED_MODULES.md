# Migrated modules (MySQL / Prisma)

> **Generated:** 2026-06-17 — re-run `yarn docs:migrated-modules` when you add a module  
> **Scope:** Only modules with **repository → service → transformer** on **legacy MySQL** tables  
> **Enable in runtime:** `MIGRATION_MYSQL_MODULES` in `.env`

---

## Summary

| | |
|---|---|
| **Total migrated (code complete)** | 48 |
| **Active in env** (this generation) | `app-update, version, faq, banner-slider, testimonial, department, terms, popup, customer-auth, customer-lookups, customer-address, customer-profile, customer-bank-account, offline-city, catalog-package-type, catalog-package, catalog-course, catalog-video, catalog-ebook, catalog-material, catalog-book, offline-batch, commerce-order, ebook-order, book-order, offline-enquiry, package-chat, catalog-exam, commerce-price, commerce-subscription, commerce-ebook-sub, commerce-promoter, commerce-promocode, commerce-educator, admin-auth, customer-admin-crud, educator-auth, promoter-auth, promoter-data, referral, admin-rbac, client-exam, client-cart, admin-exam, client-educator, admin-plan, admin-master, admin-video` |
| **Full registry keys** | `app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth,customer-lookups,customer-address,customer-profile,customer-bank-account,offline-city,catalog-package-type,catalog-package,catalog-course,catalog-video,catalog-ebook,catalog-material,catalog-book,offline-batch,commerce-order,ebook-order,book-order,offline-enquiry,package-chat,catalog-exam,commerce-price,commerce-subscription,commerce-ebook-sub,commerce-promoter,commerce-promocode,commerce-educator,admin-auth,customer-admin-crud,educator-auth,promoter-auth,promoter-data,referral,admin-rbac,client-exam,client-cart,admin-exam,client-educator,admin-plan,admin-master,admin-video` |

| # | Module key | Label | MySQL table | Mongo collection | Env | Detail |
|---:|---|---|---|---|---|---|
| 1 | `app-update` | App Update | `ws_app_update` | `ws_app_updates` | ✅ enabled | [Detail](#app-update) |
| 2 | `version` | Version | `ws_versions` | `ws_versions` | ✅ enabled | [Detail](#version) |
| 3 | `faq` | FAQ | `ws_faq` | `ws_faqs` | ✅ enabled | [Detail](#faq) |
| 4 | `banner-slider` | Banner Slider | `ws_banner_slider` | `ws_banner_sliders` | ✅ enabled | [Detail](#banner-slider) |
| 5 | `testimonial` | Testimonial | `ws_testimonial` | `ws_testimonials` | ✅ enabled | [Detail](#testimonial) |
| 6 | `department` | Department (Contact-Us) | `ws_department (+ ws_department_contact)` | `ws_departments` | ✅ enabled | [Detail](#department) |
| 7 | `terms` | Terms & Conditions | `ws_termsandcondition` | `ws_terms_and_conditions` | ✅ enabled | [Detail](#terms) |
| 8 | `popup` | Popup Notification | `ws_popup_notification` | `ws_popup_notifications` | ✅ enabled | [Detail](#popup) |
| 9 | `customer-auth` | Customer Auth (OTP/token) | `ws_customer (+ ws_customer_otp, ws_customer_access_token)` | `ws_customers / ws_customer_otps / ws_customer_access_tokens` | ✅ enabled | [Detail](#customer-auth) |
| 10 | `customer-lookups` | Customer Lookups (state/district/education/goal) | `ws_customer_state / ws_customer_distict / ws_customer_education / ws_customer_target_goal` | `ws_customer_states / ws_customer_districts / ws_customer_educations / ws_customer_target_goals` | ✅ enabled | [Detail](#customer-lookups) |
| 11 | `customer-address` | Customer Address | `ws_customer_address` | `ws_customer_addresses` | ✅ enabled | [Detail](#customer-address) |
| 12 | `customer-profile` | Customer Profile | `ws_customer` | `ws_customers` | ✅ enabled | [Detail](#customer-profile) |
| 13 | `customer-bank-account` | Customer Bank Account | `ws_customer_bank_account` | `ws_customer_bank_accounts` | ✅ enabled | [Detail](#customer-bank-account) |
| 14 | `offline-city` | Offline City | `ws_offline_city` | `ws_offline_cities` | ✅ enabled | [Detail](#offline-city) |
| 15 | `catalog-package-type` | Catalog · Package Type | `ws_package_type` | `ws_package_types` | ✅ enabled | [Detail](#catalog-package-type) |
| 16 | `catalog-package` | Catalog · Package | `ws_package` | `ws_packages` | ✅ enabled | [Detail](#catalog-package) |
| 17 | `catalog-course` | Catalog · Course | `ws_course / ws_course_subject_category` | `ws_courses / coursesubjectcategories` | ✅ enabled | [Detail](#catalog-course) |
| 18 | `catalog-video` | Catalog · Video (+ URL-encryption contract) | `ws_video / ws_video_category` | `videos / videocategories` | ✅ enabled | [Detail](#catalog-video) |
| 19 | `catalog-ebook` | Catalog · eBook (+ listing/detail composition) | `ws_ebook` | `ws_ebooks` | ✅ enabled | [Detail](#catalog-ebook) |
| 20 | `catalog-material` | Catalog · Material (category navigation) | `ws_material / ws_material_category` | `ws_materials / ws_material_categories` | ✅ enabled | [Detail](#catalog-material) |
| 21 | `catalog-book` | Catalog · Book (physical-book store reads — WIRED) | `ws_book` | `ws_books` | ✅ enabled | [Detail](#catalog-book) |
| 22 | `offline-batch` | Offline · Center/Batch (browse reads) | `ws_offline_center / ws_offline_batch` | `ws_offline_centers / ws_offline_batches` | ✅ enabled | [Detail](#offline-batch) |
| 23 | `commerce-order` | Commerce · Order (course WRITE path — Phase 3b) | `ws_package_course_order / ws_package_course_subscription / ws_package_course_subscription_tracking` | `ws_package_course_subscriptions (one doc carries order + entitlement)` | ✅ enabled | [Detail](#commerce-order) |
| 24 | `ebook-order` | Ebook · Order (ebook WRITE path — Phase 3b) | `ws_ebook_order / ws_ebook_subscription` | `ws_ebook_orders / ws_ebook_subscriptions` | ✅ enabled | [Detail](#ebook-order) |
| 25 | `book-order` | Book · Order (cart-checkout WRITE path — Phase 3b) | `ws_book_order / ws_book_order_item / ws_book_cart / ws_book_cart_item / ws_book_tracking` | `ws_book_orders / ws_book_carts (embedded items[]; embedded tracking{history[]})` | ✅ enabled | [Detail](#book-order) |
| 26 | `offline-enquiry` | Offline · Enquiry (lead-capture WRITE — Phase 3b) | `ws_offline_enquiry` | `ws_offline_enquiries` | ✅ enabled | [Detail](#offline-enquiry) |
| 27 | `package-chat` | Package · Chat (announcement READ + WRITE — Phase 3b) | `ws_package_chat (EXTENDED 2026-06-13)` | `ws_package_chats` | ✅ enabled | [Detail](#package-chat) |
| 28 | `catalog-exam` | Catalog · Exam (category navigation) | `ws_exam / ws_exam_category` | `ws_exams / ws_exam_categories` | ✅ enabled | [Detail](#catalog-exam) |
| 29 | `commerce-price` | Commerce · Price (plan/pricing lookup) | `ws_package_course_ebook_price` | `ws_package_course_ebook_prices` | ✅ enabled | [Detail](#commerce-price) |
| 30 | `commerce-subscription` | Commerce · Subscription (READ — entitlement source of truth) | `ws_package_course_subscription` | `ws_package_course_subscriptions` | ✅ enabled | [Detail](#commerce-subscription) |
| 31 | `commerce-ebook-sub` | Commerce · eBook Subscription (READ — ebook entitlement) | `ws_ebook_subscription` | `ws_ebook_subscriptions` | ✅ enabled | [Detail](#commerce-ebook-sub) |
| 32 | `commerce-promoter` | Commerce · Promoter (READ — promocode owner master) | `ws_promoter` | `ws_promoter` | ✅ enabled | [Detail](#commerce-promoter) |
| 33 | `commerce-promocode` | Commerce · Promocode (READ — SQL-faithful, NOT the client appliesTo model) | `ws_promocode / ws_promoted_package_course_ebook` | `ws_promo_codes / (embedded)` | ✅ enabled | [Detail](#commerce-promocode) |
| 34 | `commerce-educator` | Commerce · Educator (READ — full entity master) | `ws_course_educator` | `ws_course_educators` | ✅ enabled | [Detail](#commerce-educator) |
| 35 | `admin-auth` | Admin Auth + Administrator CRUD (ws_users) | `ws_users (+ ws_admin_access_tokens, ws_roles, ws_permissions, ws_model_has_roles, ws_model_has_permissions)` | `ws_users (+ ws_admin_access_tokens, roles, permissions)` | ✅ enabled | [Detail](#admin-auth) |
| 36 | `customer-admin-crud` | Admin · Customer CRUD (ws_customer) | `ws_customer` | `ws_customers` | ✅ enabled | [Detail](#customer-admin-crud) |
| 37 | `educator-auth` | Educator Auth + Admin Educator Master CRUD (ws_course_educator) | `ws_course_educator (+ ws_educator_access_tokens)` | `ws_course_educators (+ ws_educator_access_tokens)` | ✅ enabled | [Detail](#educator-auth) |
| 38 | `promoter-auth` | Promoter Auth (ws_promoter) | `ws_promoter (+ ws_promoter_access_tokens)` | `ws_promoter (+ ws_promoter_access_tokens)` | ✅ enabled | [Detail](#promoter-auth) |
| 39 | `promoter-data` | Promoter Analytics (customers/subscriptions/dashboard/promocode) | `ws_package_course_subscription / ws_ebook_subscription (joined via order.promocode JSON)` | `ws_package_course_subscriptions / ws_ebook_subscriptions / ws_promo_codes` | ✅ enabled | [Detail](#promoter-data) |
| 40 | `referral` | Referral (rewards/withdrawal/program — client + admin + webhook) | `ws_refferal_program / ws_refferal_transaction (+ ws_customer)` | `ws_refferal_programs / ws_refferal_transactions` | ✅ enabled | [Detail](#referral) |
| 41 | `admin-rbac` | Admin RBAC (roles + permissions management) | `ws_roles / ws_permissions / ws_role_has_permissions` | `roles / permissions / permissioncategories` | ✅ enabled | [Detail](#admin-rbac) |
| 42 | `client-exam` | Client Exam (reads + saveAnswers scoring write) | `ws_exam / ws_exam_category / ws_exam_question(_option) / ws_exam_result(_detail)(_analytics)` | `ws_exams / ws_exam_categories / ws_exam_questions / ws_exam_results` | ✅ enabled | [Detail](#client-exam) |
| 43 | `client-cart` | Client Book Cart (add/update/remove/shipping/get) | `ws_book_cart / ws_book_cart_item` | `ws_book_carts (embedded items[])` | ✅ enabled | [Detail](#client-cart) |
| 44 | `admin-exam` | Admin Exam (reads: exams/questions/submissions/analytics) | `ws_exam / ws_exam_question(_option) / ws_exam_result(_detail)(_analytics)` | `ws_exams / ws_exam_questions / ws_exam_results` | ✅ enabled | [Detail](#admin-exam) |
| 45 | `client-educator` | Client Educator detail (profile + courses + plans) | `ws_course_educator / ws_course / ws_package_course_ebook_price / ws_package_course_subscription` | `ws_course_educators / ws_courses` | ✅ enabled | [Detail](#client-educator) |
| 46 | `admin-plan` | Admin Plan CRUD (PackageCourseEbookPrice) | `ws_package_course_ebook_price` | `ws_package_course_ebook_prices` | ✅ enabled | [Detail](#admin-plan) |
| 47 | `admin-master` | Admin Master sub-catalog CRUD + full videoCategory (pc-material / subject / video categories) | `ws_package_course_material / ws_course_subject_category / ws_video_category` | `ws_package_course_materials / coursesubjectcategories / videocategories` | ✅ enabled | [Detail](#admin-master) |
| 48 | `admin-video` | Admin Video CRUD (ws_video) | `ws_video` | `videos` | ✅ enabled | [Detail](#admin-video) |

---

## Environment

```env
DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
MIGRATION_MYSQL_MODULES=app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth,customer-lookups,customer-address,customer-profile,customer-bank-account,offline-city,catalog-package-type,catalog-package,catalog-course,catalog-video,catalog-ebook,catalog-material,catalog-book,offline-batch,commerce-order,ebook-order,book-order,offline-enquiry,package-chat,catalog-exam,commerce-price,commerce-subscription,commerce-ebook-sub,commerce-promoter,commerce-promocode,commerce-educator,admin-auth,customer-admin-crud,educator-auth,promoter-auth,promoter-data,referral,admin-rbac,client-exam,client-cart,admin-exam,client-educator,admin-plan,admin-master,admin-video
```

- Toggle: `src/config/migration.ts` → `isMysqlModule("<key>")`
- Prisma connects at boot when `MIGRATION_MYSQL_MODULES` is non-empty (`src/index.ts`)
- Unlisted modules still use **MongoDB** (Mongoose)

---

## Module details

## 1. App Update {#app-update}

| | |
|---|---|
| **Module key** | `app-update` |
| **Phase** | 2 |
| **Migrated** | 2026-06-04 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `AppUpdate` |
| **MySQL table** | `ws_app_update` |
| **Mongo collection (legacy app)** | `ws_app_updates` |
| **Code** | `src/modules/app-update/` |
| **Data** | Singleton row `id = 1` |
| **Smoke test** | `yarn db:test-cms-pilot` |
| **Admin API** | GET/PUT `/api/v1/admin/cms/app-update` |
| **Client API** | Used by `checkUpgrade` (client CMS) |

**Transformer / schema notes:**

- MySQL column `isUpdateAvailble` (legacy typo) → API `isUpdateAvailable`
- Mongo collection `ws_app_updates` (plural) → MySQL `ws_app_update` (singular)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `AppUpdate`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 2. Version {#version}

| | |
|---|---|
| **Module key** | `version` |
| **Phase** | 2 |
| **Migrated** | 2026-06-04 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Version` |
| **MySQL table** | `ws_versions` |
| **Mongo collection (legacy app)** | `ws_versions` |
| **Code** | `src/modules/version/` |
| **Data** | Singleton row `id = 1` |
| **Smoke test** | `yarn db:test-cms-pilot` |
| **Admin API** | GET/PUT `/api/v1/admin/cms/version` |
| **Client API** | GET `/api/v1/client/version`, `checkUpgrade` |

**Transformer / schema notes:**

- Table/collection name matches (`ws_versions`)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Version`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 3. FAQ {#faq}

| | |
|---|---|
| **Module key** | `faq` |
| **Phase** | 2 |
| **Migrated** | 2026-06-04 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `FAQ` |
| **MySQL table** | `ws_faq` |
| **Mongo collection (legacy app)** | `ws_faqs` |
| **Code** | `src/modules/faq/` |
| **Data** | 13 rows in staging (5 general, 8 referral) |
| **Smoke test** | `yarn db:test-faq` |
| **Admin API** | CRUD `/api/v1/admin/cms/faqs` (+ faq-types when on Mongo) |
| **Client API** | GET `/api/v1/client/faqs`, GET `/api/v1/client/faq-types` |

**Transformer / schema notes:**

- MySQL `type` enum (`general` | `referral`) — no `ws_faq_types` table
- API exposes synthetic `typeId` for admin/client compat with Mongo-era contract
- Admin write body uses `type` on MySQL (not Mongo `typeId`)
- Mongo collection `ws_faqs` → MySQL `ws_faq`

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `FAQ`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 4. Banner Slider {#banner-slider}

| | |
|---|---|
| **Module key** | `banner-slider` |
| **Phase** | 2 |
| **Migrated** | 2026-06-06 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `BannerSlider` |
| **MySQL table** | `ws_banner_slider` |
| **Mongo collection (legacy app)** | `ws_banner_sliders` |
| **Code** | `src/modules/banner-slider/` |
| **Data** | 2 rows in staging (key `package`, `course`) |
| **Smoke test** | `yarn migration:api:banner-slider` |
| **Admin API** | GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/banners` (+ POST `/banners/reorder`) |
| **Client API** | GET `/api/v1/client/banners` (optional `?key=` filter) |

**Transformer / schema notes:**

- MySQL `key` lowercase (`package`|`course`|`book`|`ebook`) ↔ Mongo-cased enum (`Packages`|`Courses`|`Book`|`EBook`)
- `keyRef` (Mongo model name) derived from `key`
- `keyId` served as `null` on MySQL (column is NULL in dump; referenced catalog modules not migrated yet)
- Sorted by `orderBy` asc; `reorder` uses a Prisma transaction in place of Mongo bulkWrite
- Mongo collection `ws_banner_sliders` → MySQL `ws_banner_slider`

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `BannerSlider`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 5. Testimonial {#testimonial}

| | |
|---|---|
| **Module key** | `testimonial` |
| **Phase** | 2 |
| **Migrated** | 2026-06-06 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Testimonial` |
| **MySQL table** | `ws_testimonial` |
| **Mongo collection (legacy app)** | `ws_testimonials` |
| **Code** | `src/modules/testimonial/` |
| **Data** | 5 rows in staging |
| **Smoke test** | `yarn migration:api:testimonial` |
| **Admin API** | GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/testimonials` |
| **Client API** | GET `/api/v1/client/testimonials` |

**Transformer / schema notes:**

- MySQL column `discription` (legacy typo) → API field `description`
- Sorted by `rating` desc
- Mongo collection `ws_testimonials` → MySQL `ws_testimonial`

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Testimonial`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 6. Department (Contact-Us) {#department}

| | |
|---|---|
| **Module key** | `department` |
| **Phase** | 2 |
| **Migrated** | 2026-06-06 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Department` |
| **MySQL table** | `ws_department (+ ws_department_contact)` |
| **Mongo collection (legacy app)** | `ws_departments` |
| **Code** | `src/modules/department/` |
| **Data** | 4 departments, 13 contacts in staging |
| **Smoke test** | `yarn migration:api:department` |
| **Admin API** | GET/POST/PUT/DELETE `/api/v1/admin/departments` |
| **Client API** | GET `/api/v1/client/contactus` (active depts + active contacts) |

**Transformer / schema notes:**

- Mongo embeds `contacts[]`; MySQL splits into `ws_department` + `ws_department_contact` (FK `department`) — transformer joins contacts under each dept
- MySQL column `decscription` (legacy typo) → API field `description`
- Contacts keep legacy `isCallAvailable` / `isWhatsAppAvailable` flags (additive vs Mongo shape); admin `contactSchema` accepts them
- PUT replaces the whole contact set (delete + recreate in a transaction) to mirror Mongo `$set: { contacts }`
- DELETE removes contacts then the department (no DB cascade in dump)
- Mongo collection `ws_departments` → MySQL `ws_department`

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Department`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 7. Terms & Conditions {#terms}

| | |
|---|---|
| **Module key** | `terms` |
| **Phase** | 2 |
| **Migrated** | 2026-06-06 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `TermsAndConditions` |
| **MySQL table** | `ws_termsandcondition` |
| **Mongo collection (legacy app)** | `ws_terms_and_conditions` |
| **Code** | `src/modules/terms/` |
| **Data** | 3 rows (book, pendrive, referral code) |
| **Smoke test** | `yarn migration:api:terms` |
| **Admin API** | GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/terms` |
| **Client API** | GET `/api/v1/client/terms` (array) · `?module=` (single|null) |

**Transformer / schema notes:**

- MySQL `module` is a fixed `enum('book','pendrive','referral code')` — Prisma types it as `String`, but writes MUST use a valid value (else MySQL error 1265). Admin uses a MySQL-specific zod enum schema (mirrors faq's `type`)
- Client `GET /terms?module=` returns a single object or `null` (Mongo `findOne`); without `module` returns an array (Mongo `find`) — both filter `status: true`
- Mongo collection `ws_terms_and_conditions` → MySQL `ws_termsandcondition`

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `TermsAndConditions`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 8. Popup Notification {#popup}

| | |
|---|---|
| **Module key** | `popup` |
| **Phase** | 2 |
| **Migrated** | 2026-06-06 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PopupNotifications` |
| **MySQL table** | `ws_popup_notification` |
| **Mongo collection (legacy app)** | `ws_popup_notifications` |
| **Code** | `src/modules/popup/` |
| **Data** | 36 rows in staging |
| **Smoke test** | `yarn migration:api:popup` |
| **Admin API** | GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/popups` (+ S3 image upload middleware, DB-agnostic) |
| **Client API** | GET `/api/v1/client/popup` (active popup or null) |

**Transformer / schema notes:**

- Field-name mapping: API `promoExpireAt` ↔ MySQL `promo_expire_at` (nullable `date`); `createdAt`/`updatedAt` ↔ `created_at`/`updated_at`
- Client active popup = `status:true` AND `promo_expire_at > now`, newest first (`created_at desc`), single object or `null` (Mongo `findOne`)
- S3 image upload is route-level middleware (multer → `attachImage`), DB-agnostic; controller just receives `image` as a string
- Mongo collection `ws_popup_notifications` → MySQL `ws_popup_notification` (Prisma model name `PopupNotifications`, plural)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PopupNotifications`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 9. Customer Auth (OTP/token) {#customer-auth}

| | |
|---|---|
| **Module key** | `customer-auth` |
| **Phase** | 2 |
| **Migrated** | 2026-06-06 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Customer / CustomerOtp / CustomerAccessToken` |
| **MySQL table** | `ws_customer (+ ws_customer_otp, ws_customer_access_token)` |
| **Mongo collection (legacy app)** | `ws_customers / ws_customer_otps / ws_customer_access_tokens` |
| **Code** | `src/modules/customer-auth (service refactored in src/client/auth/auth.service.ts)/` |
| **Data** | 26 customers in staging; tests use real phone 9664796376 (static OTP 5786) |
| **Smoke test** | `yarn migration:api:customer-auth` |
| **Admin API** | — |
| **Client API** | POST `/api/v1/client/auth/otp/generate` · `/otp/resend` · `/otp/validate` · `/token/refresh` · DELETE `/logout` |

**Transformer / schema notes:**

- Schema change: added nullable `refresh_token` TEXT column to `ws_customer_access_token` (+ Prisma model) — the dump table lacked it; mirrors the Mongo `refreshToken` field
- Profile mapping: MySQL single `full_name` → API `firstName` (middle/last = ""); state/district/education ids returned as strings; `goals` from the `goal` JSON column; `isProfileCompleted` computed (no column), never persisted
- `authenticate` middleware is NOT read-path coupled to the token table — it verifies the JWT + Redis revocation only, so migrating the token table does not affect general authenticated requests
- JWT signing/payload, Redis `customer_session:{id}`, `formatPhone`, static-OTP/SMS logic and all response shapes are shared across both DB branches; only persistence differs
- JWT `id` is the int customer id stringified on MySQL (was the Mongo ObjectId string)
- Collections `ws_customers/ws_customer_otps/ws_customer_access_tokens` → MySQL `ws_customer/ws_customer_otp/ws_customer_access_token`

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Customer / CustomerOtp / CustomerAccessToken`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 10. Customer Lookups (state/district/education/goal) {#customer-lookups}

| | |
|---|---|
| **Module key** | `customer-lookups` |
| **Phase** | 2 |
| **Migrated** | 2026-06-10 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `CustomerState / CustomerDistict / CustomerEducation / CustomerTargetGoal` |
| **MySQL table** | `ws_customer_state / ws_customer_distict / ws_customer_education / ws_customer_target_goal` |
| **Mongo collection (legacy app)** | `ws_customer_states / ws_customer_districts / ws_customer_educations / ws_customer_target_goals` |
| **Code** | `src/modules/customer-lookups/` |
| **Data** | 12 active states, 10 active educations in staging |
| **Smoke test** | `yarn migration:api:customer-lookups` |
| **Admin API** | — |
| **Client API** | GET `/api/v1/client/address/states` · `/educations` · `/characteristic` (educations) |

**Transformer / schema notes:**

- Wired into `src/client/address/address.controller.ts` (getStates/getEducations/getCharacteristic) — service was previously dead code
- Ids returned as strings (`_id` Mongo-shape); `state_code`↔`stateCode`; district `state` int FK ↔ Mongo `stateId`
- Controller projects to the exact Mongo contract (`{_id,name,stateCode}` / `{_id,name}`) so the `active`/`status` field isn't leaked
- Goal here = `ws_customer_target_goal` (NOT the rich onboarding `Goal` collection, which stays on Mongo)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `CustomerState / CustomerDistict / CustomerEducation / CustomerTargetGoal`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 11. Customer Address {#customer-address}

| | |
|---|---|
| **Module key** | `customer-address` |
| **Phase** | 2 |
| **Migrated** | 2026-06-10 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `CustomerAddress` |
| **MySQL table** | `ws_customer_address` |
| **Mongo collection (legacy app)** | `ws_customer_addresses` |
| **Code** | `src/modules/customer-address/` |
| **Data** | Verified create→list→setDefault→update→delete on live DB (customer 472341) |
| **Smoke test** | `—  (flag OFF; verified via live-DB repo test)` |
| **Admin API** | — |
| **Client API** | GET `/api/v1/client/address` · GET `/:id` · POST `/` · PUT `/:id` · PATCH `/:id/default` · DELETE `/:id` |

**Transformer / schema notes:**

- FLAG OFF: not enabled in MIGRATION_MYSQL_MODULES — `cityId` → OfflineCity (Mongo) and cart checkout resolves it; enable once OfflineCity + cart migrate
- Schema fix: `phone`/`alternate_phone` Int → BigInt (10-digit overflow); kept `label`/`is_default`/`city_id` to match live DB (NOT in original dump)
- `city` column is NOT NULL and is what legacy data populates (`city_id` is NULL) — required string in input/DTO
- MySQL path uses integer FK ids (own zod schemas `createAddressSchemaMysql`/`updateAddressSchemaMysql`); Mongo path keeps ObjectId regex
- BigInt phones serialized to string in transformer; `setDefault` uses a Prisma transaction

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `CustomerAddress`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 12. Customer Profile {#customer-profile}

| | |
|---|---|
| **Module key** | `customer-profile` |
| **Phase** | 2 |
| **Migrated** | 2026-06-10 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Customer` |
| **MySQL table** | `ws_customer` |
| **Mongo collection (legacy app)** | `ws_customers` |
| **Code** | `src/modules/customer-profile (branches src/client/profile/customer.service.ts)/` |
| **Data** | Verified read/update on live DB (customer 472347 'DIXIT PATEL', goals [7,8,12,13,14]) |
| **Smoke test** | `—  (flag OFF; verified via live-DB service test)` |
| **Admin API** | — |
| **Client API** | PUT `/api/v1/client/profile/update` · GET `/` · profile-picture · device-token · DELETE `/` (NOT dashboard — stays Mongo) |

**Transformer / schema notes:**

- FLAG OFF: dashboard aggregates non-customer collections (folders/subs/notifications/exams) → enable once those migrate; dashboard left on Mongo
- Name: split `full_name` → first/middle/last on read, join on write (heuristic)
- Goals: `goal` JSON int array ↔ [{_id,name}] hydrated from ws_customer_target_goal (order preserved)
- isProfileCompleted: derived (full_name present), never stored
- Device tokens: single `device` column (newest wins) — legacy parity, not the Mongo `firebaseTokens[]` array
- facebookId: added to Prisma Customer (`@map("facebook_id")`), mapped read-only (not surfaced in DTO)
- Get/update preserve the existing Redis profile cache; picture upsert/delete keep S3 cleanup; delete-account revokes MySQL tokens

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Customer`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 13. Customer Bank Account {#customer-bank-account}

| | |
|---|---|
| **Module key** | `customer-bank-account` |
| **Phase** | 2 |
| **Migrated** | 2026-06-10 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `CustomerBankAccount` |
| **MySQL table** | `ws_customer_bank_account` |
| **Mongo collection (legacy app)** | `ws_customer_bank_accounts` |
| **Code** | `src/modules/customer-bank-account (branches src/client/referral/referral.controller.ts)/` |
| **Data** | Verified create→list→update→delete on live DB (customer 472347) |
| **Smoke test** | `—  (flag OFF; verified via live-DB repo test)` |
| **Admin API** | — |
| **Client API** | GET/POST/PUT/DELETE bank-account CRUD in the referral/rewards flow |

**Transformer / schema notes:**

- FLAG OFF: referral `requestWithdrawal` embeds `bankAccount.toObject()` + reward-points txn (Mongo) — enable once the withdrawal/referral flow migrates
- Live DB matches the Prisma model (incl. bank_name/branch_name/city) — no schema change needed
- 4 CRUD handlers branched; `requestWithdrawal` deliberately left on Mongo (mixed-backend txn risk)
- IFSC lookup (bank/branch/city) stays server-side in the controller; ids integer on MySQL path

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `CustomerBankAccount`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 14. Offline City {#offline-city}

| | |
|---|---|
| **Module key** | `offline-city` |
| **Phase** | 2 |
| **Migrated** | 2026-06-10 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `OfflineCity` |
| **MySQL table** | `ws_offline_city` |
| **Mongo collection (legacy app)** | `ws_offline_cities` |
| **Code** | `src/modules/offline-city (branches address.controller.listCities + cart.controller cityId resolution)/` |
| **Data** | 2 cities in staging (Ahmedabad, Gandhinagar) |
| **Smoke test** | `yarn migration:api:offline-city` |
| **Admin API** | —  (admin offline CRUD stays Mongo this pass) |
| **Client API** | GET `/api/v1/client/address/cities` (+ ?search) |

**Transformer / schema notes:**

- Scope: CITIES ONLY — migrated to unblock customer-address (its cityId → OfflineCity; cart resolves cityId→name)
- Schema (D1): ADDED `status`/`order` columns to ws_offline_city via DDL to preserve Mongo active-gating + ordering (not in original dump)
- Cart `attachShippingToCart` cityId→name resolution branches on isOfflineCityMysql()
- Centers/batches/enquiry/admin remain on Mongo for a later offline pass
- Verified end-to-end: a MySQL address cityId=2 resolves to 'Ahmedabad' through the cart path

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `OfflineCity`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 15. Catalog · Package Type {#catalog-package-type}

| | |
|---|---|
| **Module key** | `catalog-package-type` |
| **Phase** | 3 |
| **Migrated** | 2026-06-11 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PackageType` |
| **MySQL table** | `ws_package_type` |
| **Mongo collection (legacy app)** | `ws_package_types` |
| **Code** | `src/modules/catalog-package (branches src/client/package/package.controller.ts listPackageTypes)/` |
| **Data** | 6 package types in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | —  (admin package-type CRUD stays Mongo this pass) |
| **Client API** | GET `/api/v1/client/packages/types` |

**Transformer / schema notes:**

- FLAG OFF: package-type ids are int (MySQL) vs ObjectId (Mongo); still-Mongo consumers (purchase-history, my-subscriptions, dashboard, categories, free, admin CRUD) join package-type ids — flipping /packages/types alone splits the id space. Flip WITH the commerce/dashboard wave
- ws_package_type has only {id,name,created_at,updated_at}; Mongo PackageType adds order/active → synthesize order:0 + active:true to keep the response JSON shape identical
- listPackageTypes branched on isPackageTypeMysql(); all other package endpoints stay Mongo (need commerce joins + Mongo-only fields)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PackageType`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 16. Catalog · Package {#catalog-package}

| | |
|---|---|
| **Module key** | `catalog-package` |
| **Phase** | 3 |
| **Migrated** | 2026-06-11 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Package` |
| **MySQL table** | `ws_package` |
| **Mongo collection (legacy app)** | `ws_packages` |
| **Code** | `src/modules/catalog-package/` |
| **Data** | 4 active packages in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | —  (ws_package reads built but NOT wired; flag OFF) |

**Transformer / schema notes:**

- FLAG OFF: ws_package is a STRUCTURAL SUBSET of Mongo ws_packages — missing subtitle/isPaid/isSmart/PlannerCourse/goalId/goalLabelId/examCountdown*/specificSubjects[]/materialCategories[]/examCategories[]/withMaterialText. Every client package endpoint also joins commerce-wave tables (PackageCourseEbookPrice plans, PackageCourseSubscription, PromoCode, PackageChat) → full /client/packages can't be reproduced this wave. Flip with commerce
- Schema fix: Package.shareable_link String → String? (live DDL nullable); regenerated client v5.22.0
- educator_id exists in the DDL but is absent from the Prisma Package model (NULL for all 4 rows) → transformer surfaces educatorId:null; add to Prisma + regen if a consumer needs it
- Reads: findPackageById, listActivePackages, listActivePackagesByType (all active:true, order_by then id)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Package`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 17. Catalog · Course {#catalog-course}

| | |
|---|---|
| **Module key** | `catalog-course` |
| **Phase** | 3 |
| **Migrated** | 2026-06-11 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Course / CourseSubjectCategory` |
| **MySQL table** | `ws_course / ws_course_subject_category` |
| **Mongo collection (legacy app)** | `ws_courses / coursesubjectcategories` |
| **Code** | `src/modules/catalog-course (branches course.controller.ts listCourseCategoriesHandler + listCoursesHandler + listCoursesByCategoryHandler)/` |
| **Data** | 1 course + 1 subject category in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | GET `/courses/categories` + GET `/courses` + GET `/courses/category/:id` (all wired, flag OFF) |

**Transformer / schema notes:**

- FLAG OFF: course/subject-category ids int (MySQL) vs ObjectId (Mongo); still-Mongo detail/dashboard consumers join those ids. The LISTING endpoints are now fully covered (commerce-price + commerce-subscription built). Flip with the commerce cluster
- Schema fix #1: Course.image String → String? (live DDL nullable)
- Schema fix #2 (2026-06-12): added is_featured + purchase as Prisma enum CourseFlag01 (MySQL enum('0','1'), values @map'd to '0'/'1') + featured_order Int?. Transformer → Mongo isPopular (is_featured='1') / isPaid (purchase≠'0', honouring Mongo default true). isPopular is now a real filterable SQL column
- WIRED listing composition (listCoursesWithPlans): paginated active courses + active plans split by material (commerce-price) + per-customer purchase state isPurchased/daysLeft (commerce-subscription, lifetime-aware: longest endAt wins, endAt null beats dated, matched by courseId OR planId). Mirrors the Mongo paginateCoursesWithPlans {data,pagination} exactly. paymentStatus:'verified' Mongo filter collapses to status=true (no SQL column)
- listCourseCategoriesHandler branched on isCourseMysql() (Prisma groupBy counts); listCourses/listCoursesByCategory branch BEFORE the ObjectId guard (MySQL categoryId is int)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Course / CourseSubjectCategory`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 18. Catalog · Video (+ URL-encryption contract) {#catalog-video}

| | |
|---|---|
| **Module key** | `catalog-video` |
| **Phase** | 3 |
| **Migrated** | 2026-06-11 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Video / VideoCategory` |
| **MySQL table** | `ws_video / ws_video_category` |
| **Mongo collection (legacy app)** | `videos / videocategories` |
| **Code** | `src/modules/catalog-video/` |
| **Data** | 156 videos (all aws), 157 categories (152 active) in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx + URL-parity test)` |
| **Admin API** | — |
| **Client API** | —  (reads built; no safe standalone video-URL endpoint to wire; flag OFF) |

**Transformer / schema notes:**

- FLAG OFF: video/category ids int (MySQL) vs ObjectId (Mongo); lecture/free/dashboard-resume/progress/browse join those ids. lecture course-membership reads VideoCategory.courseId (Mongo-only); paid access checks PackageCourseSubscription (commerce-wave). Flip with commerce
- URL CONTRACT parity PASS ✅: Video Prisma fields match the Mongo names, so a MySQL row fed into the SAME encryptVideoSource util yields an identical videoURL for a fixed token. Verified (token 1234567890123456, video 33089 aws): MySQL URL === Mongo URL, decrypt === aws_id. NEVER reimplement encryption
- Module exposes getVideoEncryptInput()/toVideoEncryptInput() = the exact object encryptVideoSource consumes; coerces ''/null platform ids to undefined (live data stores '' for unused platform cols)
- Video Prisma model CLEAN vs DDL (no schema change). D2 = DEFER ws_video_category_relation (2456) + ws_video_category_package_relation (6907): client builds groups from Mongo Package.specificSubjects[]/childCategoryIds, not these SQL joins

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Video / VideoCategory`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 19. Catalog · eBook (+ listing/detail composition) {#catalog-ebook}

| | |
|---|---|
| **Module key** | `catalog-ebook` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `EBook` |
| **MySQL table** | `ws_ebook` |
| **Mongo collection (legacy app)** | `ws_ebooks` |
| **Code** | `src/modules/catalog-ebook (branches ebook.controller.ts listEbooks + getEbookDetail)/` |
| **Data** | 2 ebooks in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | GET `/client/ebooks` + GET `/client/ebooks/:id` (wired, flag OFF) |

**Transformer / schema notes:**

- NO separate ebook-price module: there is no `ws_ebook_price` table — ebook pricing lives in the SHARED `ws_package_course_ebook_price` (ebook_id-owned rows), already covered by commerce-price (added listActivePricesByEbooks plural). The Mongo EbookPrice shape is a subset of the PriceDto
- Mongo-only fields ABSENT from ws_ebook: isTrending/isPaid/examCountdownCategoryId/demoFileName/bookFileName. `isPaid` is DERIVED from plans (paid when ≥1 active plan price>0) — exactly the controller's documented fallback when the Mongo isPaid is absent (always, for SQL) → faithful. isTrending synthesized false
- Schema fix: ws_ebook description + author are nullable in the DDL but Prisma typed non-nullable → relaxed to optional. Field renames: terms_and_conditions→termsAndConditions, order_by→order, demo_url→demoUrl, book_url→bookUrl
- WIRED composition (listEbooksWithPlans / getEbookDetailWithPlans): active ebooks (name/author search + language filter) + active plans (commerce-price) + per-customer access window (commerce-ebook-sub.listActiveByCustomerForEbooks, strict status:true + endAt>now, latest wins). Computed details[]/isNew/isPurchased/daysLeft; the per-request deep link is supplied by a buildShareLink callback (HTTP concern stays in the controller). availablePromoCode always [] (ebooks aren't in the promo appliesTo model)
- Wired BEFORE the ObjectId guards (MySQL ebook/customer ids are int). C3: customerId resolved to int at the boundary

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `EBook`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 20. Catalog · Material (category navigation) {#catalog-material}

| | |
|---|---|
| **Module key** | `catalog-material` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Material / MaterialCategory` |
| **MySQL table** | `ws_material / ws_material_category` |
| **Mongo collection (legacy app)** | `ws_materials / ws_material_categories` |
| **Code** | `src/modules/catalog-material (branches categories.controller.ts listMaterialCategoryChildren)/` |
| **Data** | 226 materials, 5 material categories in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | GET `/client/material-categories/:id/children` (wired, flag OFF) |

**Transformer / schema notes:**

- SCOPED to category NAVIGATION only. Prisma Material + MaterialCategory models are clean (no schema fix)
- ⚠ Item listing (listMaterialsByCategory) stays BLOCKED — its entitlement helper getPurchasedMaterialIds joins LiveCourse + LiveCourseSubscription (unmigrated) + the Mongo-only embedded materialCategories.category[] arrays on Course/Package/LiveCourse; ws_material also has no isPaid column. Not reproducible from SQL this pass
- STRUCTURAL TRANSLATION: the Mongo MaterialCategory.childCategoryIds[] embed has NO SQL column — children resolve via the SQL `parent` self-FK (WHERE parent=id). havingChildDirectory = ≥1 row with parent=this.id (one distinct query, not N)
- getCategoryChildren: parent + active children (order_by) + per-child active-material count + havingChildDirectory. Wired before the ObjectId guard (MySQL category id is int)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Material / MaterialCategory`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 21. Catalog · Book (physical-book store reads — WIRED) {#catalog-book}

| | |
|---|---|
| **Module key** | `catalog-book` |
| **Phase** | 3 |
| **Migrated** | 2026-06-13 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Book` |
| **MySQL table** | `ws_book` |
| **Mongo collection (legacy app)** | `ws_books` |
| **Code** | `src/modules/catalog-book (branches book.controller.ts listBooks + getBookDetail)/` |
| **Data** | 10 books in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test, 12/12 composition)` |
| **Admin API** | — |
| **Client API** | GET `/client/books` + GET `/client/books/:id` (wired behind isBookMysql(), flag OFF) |

**Transformer / schema notes:**

- NOW WIRED (2026-06-13): listBooks/getBookDetail branch on isBookMysql(). The per-customer cart qty/cartId + isPurchased enrichment is composed from the book-order read helpers (getActiveCartState / getPurchasedBookIdSet) — those order/cart tables migrated with book-order (Phase 3b), so the int book id-space now matches. Was previously blocked on exactly that dep
- Composition: catalog-book supplies book DATA + data-only computed fields; the controller layers cart qty (ws_book_cart_item) + cartId (ws_book_cart.cart_id) + isPurchased (ws_book_order_item joined to orders in verified/shipped/delivered). C3 seam: customerId coerced Number(req.user.id). Detail branches before the ObjectId guard (MySQL book id is an int)
- Module supplies book DATA + the data-only computed fields: isPaid (discountedPrice>0), key (isCombo?combo:individual), daysLeft (null — one-time purchase), isNew (createdAt window); the per-request deep link via a buildShareLink callback. Order/cart-derived qty + isPurchased are left to the caller
- Schema fix: ws_book.order_by nullable in the DDL but Prisma typed non-null → relaxed to Int?
- Mongo-only fields ABSENT from ws_book: packageIds[] (embedded M:N for the package-detail material(Book) tab — appliesTo-style, not reproducible), examCountdownCategoryId, termsAndConditions, bookUrl, publication, deliveryEta, isTrending. isTrending synthesized false; publication/deliveryEta synthesized to the Mongo defaults
- Reads: getBookById / listBooksData (name+author search, language filter, order_by asc) / findBooksByIds (bulk hydration)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Book`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 22. Offline · Center/Batch (browse reads) {#offline-batch}

| | |
|---|---|
| **Module key** | `offline-batch` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `OfflineCenter / OfflineBatch` |
| **MySQL table** | `ws_offline_center / ws_offline_batch` |
| **Mongo collection (legacy app)** | `ws_offline_centers / ws_offline_batches` |
| **Code** | `src/modules/offline-batch (branches offline.controller.ts listCenters/listBatches/getCenterDetail/getBatchDetail)/` |
| **Data** | 3 centers, 3 batches in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | GET `/client/offline/centers` + `/batches` + `/centers/:id` + `/batches/:id` (wired, flag OFF) |

**Transformer / schema notes:**

- READ only. submitEnquiry (POST → ws_offline_enquiry) is a WRITE path, NOT built. getOfflineDashboard left on Mongo (also reads the unmigrated OfflineBannerSlider). Cities come from the offline-city module
- SCHEMA FIX (bigint overflow): OfflineCenter.phone was Int but the DDL is bigint (9099665555 overflows Int32) → would THROW on read; fixed to BigInt, DTO surfaces it as a STRING (Mongo stores phone as string). OfflineEnquiry.mobile also Int→BigInt (+ added created_at) for the future write path
- SCHEMA FIX (phantom column): NO `status` column on ws_offline_batch OR ws_offline_center, but the Mongo handlers all filter {status:true} and Prisma OfflineBatch.status was a phantom field (mapped nothing) → removed. MySQL branch drops the status filter (all rows active) + synthesizes status:true in the DTO
- image is a JSON column on ws_offline_center → mapped to Mongo `images: string[]`. SQL column TYPO: batch `discription` → Mongo `description`. center→city and batch→center→city relations populated
- Wired before the ObjectId guards (MySQL ids are int). Reads: listCenters (city+search), listBatches (center/city/upcoming/search), getCenterDetail (+nested batches), getBatchDetail; + dashboard helpers getCentersWithBatchesByCities / listUpcomingBatches

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `OfflineCenter / OfflineBatch`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 23. Commerce · Order (course WRITE path — Phase 3b) {#commerce-order}

| | |
|---|---|
| **Module key** | `commerce-order` |
| **Phase** | 3 |
| **Migrated** | 2026-06-13 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PackageCourseOrder / PackageCourseSubscription / PackageCourseSubscriptionTracking` |
| **MySQL table** | `ws_package_course_order / ws_package_course_subscription / ws_package_course_subscription_tracking` |
| **Mongo collection (legacy app)** | `ws_package_course_subscriptions (one doc carries order + entitlement)` |
| **Code** | `src/modules/commerce-order (branches course-payment.controller.ts createCourseOrderPayment + verify.controller.ts course branch)/` |
| **Data** | 3 orders / 2 subs / 3 tracking in staging (restored after tsx cleanup) |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test, 28/28)` |
| **Admin API** | — |
| **Client API** | POST `/client/payment/create-order/course` + course branch of POST `/client/payment/verify` (wired, flag OFF) |

**Transformer / schema notes:**

- FIRST WRITE PATH (Phase 3b). Scope: COURSE only (signed off — WRITE_PATH_SCOPE.md). ebook/book ride the same pattern next; live-course/test-series verify branches deferred (NO SQL tables)
- ONE-DOC→THREE-TABLES: Mongo writes one PackageCourseSubscription doc; SQL splits order (ws_package_course_order) vs entitlement (ws_package_course_subscription) vs trail (ws_package_course_subscription_tracking). create-order writes the order row only; verify writes subscription+tracking in ONE $transaction
- DRIFT: customer_id TYPE SPLIT — order table VARCHAR, subscription table INT (same logical id; C3 seam coerces Number(req.user.id)). tracking + tracking.id are BIGINT (overflow Int32) → surfaced as number. tracking.order FKs order.id NOT subscription.id. order.status enum↔Mongo paymentStatus (pending↔pending, complete↔verified, cancel↔failed). duration=DAYS (planDuration asDays)
- UPSERT-EXTEND reproduced in SQL: a second purchase folds endAt (+DAYS) + sums amount onto the active sub, no new row (no duplicate My-Subscriptions card). Idempotent re-verify returns the existing sub
- DUAL-READ FALLBACK (rollback safety): verify checks MySQL for the course order FIRST when the flag is ON; on miss it falls through to the Mongo fan-out so a flag flip between create-order and verify can't orphan an in-flight payment. The verify response merges order payment fields + subscription entitlement fields into the Mongo-shaped data.subscription

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PackageCourseOrder / PackageCourseSubscription / PackageCourseSubscriptionTracking`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 24. Ebook · Order (ebook WRITE path — Phase 3b) {#ebook-order}

| | |
|---|---|
| **Module key** | `ebook-order` |
| **Phase** | 3 |
| **Migrated** | 2026-06-13 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `EBookOrder / EBookSubscription` |
| **MySQL table** | `ws_ebook_order / ws_ebook_subscription` |
| **Mongo collection (legacy app)** | `ws_ebook_orders / ws_ebook_subscriptions` |
| **Code** | `src/modules/ebook-order (branches ebook-payment.controller.ts createEbookOrderPayment + verify.controller.ts ebook branch)/` |
| **Data** | 2 orders / 1 sub in staging (restored after tsx cleanup) |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test, 28/28)` |
| **Admin API** | — |
| **Client API** | POST `/client/payment/create-order/ebook` + ebook branch of POST `/client/payment/verify` (wired, flag OFF) |

**Transformer / schema notes:**

- SECOND write path — rides the commerce-order pattern. Scope: EBOOK after COURSE. book-order next; live-course/test-series deferred (no SQL tables)
- ONE-DOC→TWO-TABLES (no tracking, unlike course): create-order writes ws_ebook_order (pending; unique_id NOT NULL = receipt id); verify ONE $transaction flips order→complete + extend-or-create ws_ebook_subscription. The verify ebook branch returns data:{kind:'ebook',order} — the ORDER not the sub — so the DTO mirrors the Mongo EbookOrder doc
- DRIFT: customer_id VARCHAR(order)/INT(sub) split (C3 coercion). NO ebook_id on the order table — only plan_id; ebook re-derived from the plan at verify + in the DTO. order.status enum strings IDENTICAL on SQL+Mongo ('pending'|'complete'|'cancel') → no translation. order_price = paid amount (no discount col). duration=DAYS. payment_type enum('online','backend')→online
- UPSERT-EXTEND: second purchase folds endAt +DAYS, sums price, repoints the sub at the latest order, no new row. Idempotent re-verify returns the existing order DTO
- DUAL-READ FALLBACK in verify (MySQL first, Mongo fan-out on miss) — same rollback safety as commerce-order

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `EBookOrder / EBookSubscription`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 25. Book · Order (cart-checkout WRITE path — Phase 3b) {#book-order}

| | |
|---|---|
| **Module key** | `book-order` |
| **Phase** | 3 |
| **Migrated** | 2026-06-13 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `BookOrder / BookOrderItem / BookCart / BookCartItem / BookTracking` |
| **MySQL table** | `ws_book_order / ws_book_order_item / ws_book_cart / ws_book_cart_item / ws_book_tracking` |
| **Mongo collection (legacy app)** | `ws_book_orders / ws_book_carts (embedded items[]; embedded tracking{history[]})` |
| **Code** | `src/modules/book-order (branches payment.controller.ts createBookOrderPayment + verify.controller.ts book branch)/` |
| **Data** | 6 orders / 1 item / 2 carts / 2 cart-items / 3 tracking in staging (restored after tsx cleanup) |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test, 25/25)` |
| **Admin API** | — |
| **Client API** | POST `/client/payment/create-order` (book cart) + book branch of POST `/client/payment/verify` (wired, flag OFF) |

**Transformer / schema notes:**

- THIRD write path — a DIFFERENT shape (cart checkout → 5 tables, line items, courier AWB). Signed off in BOOK_ORDER_SCOPE.md. Completing it UNBLOCKS catalog-book wiring (reads built, were blocked on order/cart deps)
- SCHEMA FIX (read-breaking BigInt): ws_book_tracking.tracking_id + ws_book_order.tracking_id are BIGINT (AWB ~1.19e11, overflow Int32) but Prisma mapped Int → reads THREW. Fixed BookTracking.tracking_id Int→BigInt + BookOrder.trackingId Int?→BigInt?, regenerated. Surfaced as number
- create-order (2 phases): preview cart (ws_book_cart + cart_item child rows → totals w/ ws_termsandcondition module='book' free-shipping=500) → Razorpay → ONE $transaction writes ws_book_order (pending; order_items TEXT blob + cart_id + razorpay payload, all NOT NULL) + ws_book_order_item rows (FK order_id = VARCHAR business key)
- verify: ONE $transaction — insert ws_book_tracking (bigint AUTO_INCREMENT = the AWB; base 119400693004, no Counter) → flip order→verified + tracking_id → deactivate cart (status=0, match user+shipping; cart_item rows KEPT, Mongo parity). customer_id is INT here (NOT the VARCHAR split of course/ebook)
- Embedded→child: Mongo items[] → order_item rows (+ denormalized JSON blob). TRACKING HISTORY LOSS (signed-off D-B3): SQL ws_book_tracking has no history/note cols → persist flat row, DTO SYNTHESIZES the single verify entry [{status:'Order Placed',note:'Payment received',at}]. varchar(10) status → store short 'verified' (DTO carries human text). Dual-read fallback in verify

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `BookOrder / BookOrderItem / BookCart / BookCartItem / BookTracking`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 26. Offline · Enquiry (lead-capture WRITE — Phase 3b) {#offline-enquiry}

| | |
|---|---|
| **Module key** | `offline-enquiry` |
| **Phase** | 3 |
| **Migrated** | 2026-06-13 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `OfflineEnquiry` |
| **MySQL table** | `ws_offline_enquiry` |
| **Mongo collection (legacy app)** | `ws_offline_enquiries` |
| **Code** | `src/modules/offline-enquiry (branches offline.controller.ts submitEnquiry)/` |
| **Data** | 4 enquiries in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test, 10/10)` |
| **Admin API** | — |
| **Client API** | POST `/client/offline/enquiry` (wired, flag OFF; anonymous-allowed) |

**Transformer / schema notes:**

- Small single-table lead-capture write. No schema change — OfflineEnquiry model existed (mobile Int→BigInt fix landed in the offline-batch pass)
- DRIFT: mobile BIGINT — input string → digits parsed to BigInt for the column, surfaced back as string (12-digit/country-code numbers overflow Int32). batch_id INT — branch validates int + existence via offline-batch (before the ObjectId parse)
- ANONYMOUS vs NOT NULL: route is anonymous-allowed (userId may be null) but customer_id is INT NOT NULL → store the 0 sentinel for anonymous (no FK enforced); DTO maps 0→null (Mongo shape)
- NO remarks column: the Mongo enquiry accepts optional remarks; SQL has no column → validator accepts it (contract-stable) but it's DROPPED on the SQL write (documented gap)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `OfflineEnquiry`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 27. Package · Chat (announcement READ + WRITE — Phase 3b) {#package-chat}

| | |
|---|---|
| **Module key** | `package-chat` |
| **Phase** | 3 |
| **Migrated** | 2026-06-13 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PackageChat (+ enums PackageChatMediaType / PackageChatSenderType)` |
| **MySQL table** | `ws_package_chat (EXTENDED 2026-06-13)` |
| **Mongo collection (legacy app)** | `ws_package_chats` |
| **Code** | `src/modules/package-chat (branches client package.controller.ts getChatMessages + admin package.service.ts listChatMessages/postChatMessage/deleteChatMessage)/` |
| **Data** | 0 chats in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test, 21/21)` |
| **Admin API** | POST `/admin/package/:id/chat` · DELETE `/admin/package/chat/:messageId` (wired, flag OFF) |
| **Client API** | GET `/client/package/:packageId/chat` (subscription-gated; wired, flag OFF) |

**Transformer / schema notes:**

- LAST 3b write path. ⚠ FIRST SCHEMA ADD: ws_package_chat was a STUB (message only) that couldn't represent the Mongo PackageChat (media/sender/push). EXTENDED via additive ALTER — media_url, media_type enum, sender_type enum, sender_id VARCHAR, push_sent (see docs/migration/schema-changes/2026-06-13_extend_ws_package_chat.sql). Stub Prisma model `chat`→`PackageChat`
- Field map: SQL message↔Mongo text (NOT NULL → store '' for media-only). sender_id is VARCHAR (admin ObjectId; admin auth stays Mongo) → string|null. media_type/sender_type Prisma enums; push_sent Boolean; package_id INT
- List ordering: created_at is second-granularity datetime → added `id desc` tiebreaker after `created_at desc` to preserve insertion order (Mongo's millisecond createdAt doesn't tie)
- Client read gates via commerce-subscription hasActivePackageSubscription (int ids), branches before the ObjectId guard. Admin write/delete branch inside the admin service (centralized); parsePackageChatId guards the int id

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PackageChat (+ enums PackageChatMediaType / PackageChatSenderType)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 28. Catalog · Exam (category navigation) {#catalog-exam}

| | |
|---|---|
| **Module key** | `catalog-exam` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Exam / ExamCategory` |
| **MySQL table** | `ws_exam / ws_exam_category` |
| **Mongo collection (legacy app)** | `ws_exams / ws_exam_categories` |
| **Code** | `src/modules/catalog-exam (branches categories.controller.ts listExamCategoryChildren)/` |
| **Data** | 1 exam, 121 exam categories (118 active) in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | GET `/client/exam-categories/:id/children` (wired, flag OFF) |

**Transformer / schema notes:**

- SCOPED to category NAVIGATION only (mirrors catalog-material). Item listing/attempt surface (questions/options/results + entitlement) NOT built this pass
- Schema fix: ExamCategory name/image nullable in the DDL but Prisma typed non-null → relaxed to String?
- DIFFERENCES vs material: display field is `name` (not `title`) — DTO sets BOTH title+name to the column (Mongo handler does `title: cat.name`); ws_exam_category has a `deleted` flag → active = status=true AND deleted=false; the per-child exam count is UNCONDITIONAL (countDocuments({categoryId}) with no status filter — Mongo parity)
- STRUCTURAL TRANSLATION: Mongo childCategoryIds[] embed → SQL parent_id self-FK (children = WHERE parent_id=id; havingChildDirectory via one distinct query). Wired before the ObjectId guard (MySQL category id is int)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Exam / ExamCategory`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 29. Commerce · Price (plan/pricing lookup) {#commerce-price}

| | |
|---|---|
| **Module key** | `commerce-price` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PackageCourseEbookPrice` |
| **MySQL table** | `ws_package_course_ebook_price` |
| **Mongo collection (legacy app)** | `ws_package_course_ebook_prices` |
| **Code** | `src/modules/commerce-price (+ ebook plural listActivePricesByEbooks)/` |
| **Data** | 1353 plan rows in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | —  (read-only lookup built; not wired; flag OFF) |

**Transformer / schema notes:**

- FLAG OFF: Phase 3a read-only. Every price consumer joins int-id catalog (package/course/ebook) + ObjectId-id subscription/order rows → flips together with catalog + the rest of 3a in one consistent int id-space (the commerce-wave flip)
- Prisma PackageCourseEbookPrice is a FAITHFUL 1:1 of the SQL table (all 13 cols, correct @maps) — NO schema fix required
- DRIFT: owner cols (package_id/course_id/ebook_id) use `0` as the 'not this owner' sentinel, NOT only NULL — 927/1353 rows mix 0s + a real id. Transformer coalesces 0/null → null to match Mongo's null. Verified the >0 invariant holds: no row owns more than one entity
- duration is DAYS not months (e.g. the '12 Month' plan row has duration:365) — surfaced raw; endAt computation (planDuration asDays/setDate) is the Phase 3b write boundary's concern, not this lookup's. material_price null → 0 (Mongo default)
- Reads: findById / findActiveById / findByIds + listActiveBy{Package,Course,Ebook}(s), all active-only owner lists ordered by duration asc (mirrors the Mongo `.sort({duration:1})` plan listings)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PackageCourseEbookPrice`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 30. Commerce · Subscription (READ — entitlement source of truth) {#commerce-subscription}

| | |
|---|---|
| **Module key** | `commerce-subscription` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PackageCourseSubscription` |
| **MySQL table** | `ws_package_course_subscription` |
| **Mongo collection (legacy app)** | `ws_package_course_subscriptions` |
| **Code** | `src/modules/commerce-subscription/` |
| **Data** | 2 subscriptions in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | —  (READ entitlement checks built; not wired; flag OFF). Writes are 3b |

**Transformer / schema notes:**

- FLAG OFF + READ-ONLY: entitlement source of truth. Writes (create/extend on payment) are Phase 3b (verify.controller). Joined by int catalog + int customer id-space, read by still-Mongo consumers (lecture/progress/dashboard/purchase-history) → flips with catalog + 3a
- SCHEMA FIX (bigint overflow): SQL `tracking` is bigint (~1.19e11, both staging rows overflow Int32) but Prisma mapped trackingId as Int? → would THROW on read. Fixed: PackageCourseSubscription.trackingId Int?→BigInt? + PackageCourseSubscriptionTracking.id Int→BigInt; regenerated v5.22.0. Transformer coerces bigint→number (lossless, < MAX_SAFE_INTEGER; null-guards >2^53)
- Mongo↔SQL NAME divergence (critical): Mongo `packageId` = the PLAN ref = SQL `pcb_id` (planId); Mongo `targetPackageId` = the actual package = SQL `package_id` (packageId). DTO uses Mongo names so consumer predicates port 1:1
- customer_id is INT here (C3 seam — varchar in order tables). In the migrated id-space the customer IS the int id, so the module takes/returns customerId as int; string→int resolution is the caller's boundary
- Mongo-only commerce/promo fields (promocodeId/promoterId/paidAmount/paymentStatus/razorpay*) are NOT on this table (order row / 3b) → not produced. Active entitlement = status=true AND end_at>now
- Reads: hasActive{Course,Package}Subscription + getActive… + findById + list{,Active}ByCustomer + countActiveBy{Package,Course} — mirror the dominant Mongo access-gate predicates

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PackageCourseSubscription`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 31. Commerce · eBook Subscription (READ — ebook entitlement) {#commerce-ebook-sub}

| | |
|---|---|
| **Module key** | `commerce-ebook-sub` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `EBookSubscription` |
| **MySQL table** | `ws_ebook_subscription` |
| **Mongo collection (legacy app)** | `ws_ebook_subscriptions` |
| **Code** | `src/modules/commerce-ebook-sub/` |
| **Data** | 1 ebook subscription in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | —  (READ entitlement checks built; not wired; flag OFF). Writes are 3b |

**Transformer / schema notes:**

- FLAG OFF + READ-ONLY: ebook entitlement source of truth. Writes (create on payment) are Phase 3b. Joined on int catalog (ebook) + int customer id-space, read by still-Mongo consumers (ebook read/list, downloads, dashboard) → flips with catalog + 3a
- SCHEMA FIX: Prisma EBookSubscription model was MISSING `status` (tinyint, the entitlement flag) + `payment_type` (enum) that exist in the DDL — read contract impossible without `status`. Added `status Boolean?` + `payment_type PackageCourseEbookPaymentType`. Also relaxed `start_at`/`end_at` DateTime → DateTime? (DDL nullable). Regenerated v5.22.0
- Active = status≠false (NULL treated as active, matching the column default 1 + Mongo default) AND end_at>now, latest endAt wins. price Decimal→number; owner `0` sentinel → null
- customer_id is INT (C3 seam, same as package subscription) — module takes/returns customerId as int. Mongo-only promo fields (promocodeId/promoterId/referrerId) are on the order row / 3b → not produced
- Reads: hasActiveEbookSubscription + getActive… + findById + findByOrderId + list{,Active}ByCustomer + countActiveByEbook — mirror the Mongo `findOne({customerId, ebookId, status:true, endAt:{$gt:now}})` access gate

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `EBookSubscription`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 32. Commerce · Promoter (READ — promocode owner master) {#commerce-promoter}

| | |
|---|---|
| **Module key** | `commerce-promoter` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Promoter` |
| **MySQL table** | `ws_promoter` |
| **Mongo collection (legacy app)** | `ws_promoter` |
| **Code** | `src/modules/commerce-promoter/` |
| **Data** | 114 promoters in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | —  (READ master; not wired; flag OFF) |

**Transformer / schema notes:**

- FLAG OFF + READ-ONLY: promocode owner master. int (MySQL) vs ObjectId (Mongo) ids join still-Mongo promocode/subscription consumers → flips with catalog + 3a
- SECURITY: `password` exists on the row (full entity, like ws_course_educator) but is NEVER surfaced in the DTO (Mongo model marks it select:false)
- SCHEMA FIX: full_name/email/phone are nullable in the DDL but Prisma typed them non-nullable String → relaxed to String? (no NULLs in current data; guards a future NULL)
- Name casing: Mongo camelCase (fullName/isDelete); DTO uses Mongo names. Active = status=true AND is_delete=false. Mongo lastLoginDate/lastLoginIp ≠ SQL last_seen_at → not produced
- Reads: findById / findActiveById / findByIds (bulk owner hydration) / listActive (name+email search)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Promoter`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 33. Commerce · Promocode (READ — SQL-faithful, NOT the client appliesTo model) {#commerce-promocode}

| | |
|---|---|
| **Module key** | `commerce-promocode` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Promocode / PromotedPackageCourseEbook` |
| **MySQL table** | `ws_promocode / ws_promoted_package_course_ebook` |
| **Mongo collection (legacy app)** | `ws_promo_codes / (embedded)` |
| **Code** | `src/modules/commerce-promocode/` |
| **Data** | 2 promocodes + 5 promoted plans in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | —  (SQL-faithful reads built; CANNOT serve client applyPromocode; flag OFF) |

**Transformer / schema notes:**

- ⚠ MODEL DIVERGENCE: the live Mongo PromoCode (ws_promo_codes) uses discountType/discountValue + appliesTo{type,ids[]}; the SQL tables have NONE of those — the discount is a per-plan promoter%/customer% split in ws_promoted_package_course_ebook (keyed by pcb_price_id=plan). The client applyPromocode/listPromocodes read the Mongo appliesTo shape, which CANNOT be reproduced from SQL. So this builds SQL-faithful reads ONLY, flag OFF (decision 2026-06-12); appliesTo reconciliation is a later effort
- SCHEMA FIX: promocode/promo_start_at/promo_expire_at are nullable in the DDL but Prisma typed them non-nullable → relaxed to optional. title/description NOT NULL in DDL but Prisma optional (safe direction)
- Valid = status=true AND promo_start_at<now<promo_expire_at; public listings add type='public', soonest-to-expire first. Code lookup uppercases (Mongo parity). Promoted plans included on single-promocode reads
- Reads: findById (w/ plans) / findValidByCode / listActivePublic + countActivePublic (paginated) / listPromotedPlans

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Promocode / PromotedPackageCourseEbook`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 34. Commerce · Educator (READ — full entity master) {#commerce-educator}

| | |
|---|---|
| **Module key** | `commerce-educator` |
| **Phase** | 3 |
| **Migrated** | 2026-06-12 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `CourseEducator` |
| **MySQL table** | `ws_course_educator` |
| **Mongo collection (legacy app)** | `ws_course_educators` |
| **Code** | `src/modules/commerce-educator/` |
| **Data** | 56 educators in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | —  (READ master + ref projection; not wired; flag OFF) |

**Transformer / schema notes:**

- FLAG OFF + READ-ONLY: a FULL entity (email/password/about/view/last_seen_at), NOT a join table (it was mis-grouped as a 'catalog relation' earlier). int (MySQL) vs ObjectId (Mongo) ids join still-Mongo course/educator consumers → flips with catalog + 3a (final 3a read module)
- SECURITY: `password` (NOT NULL) on the row but NEVER surfaced — the client educator path does `.select('-password')`. DTO excludes it; the ref projection is `{_id,name,image}` only
- ⚠ LATENT RISK (logged, deliberately NOT fixed): `id` is `bigint unsigned` but Prisma maps it `Int`. Current ids 20–85 (56 rows) → no overflow. Changing to BigInt would ripple into the Course.courseEducatorId FK + the built catalog-course module for zero present benefit — revisit (educator + Course FK together) only if ids approach 2^31
- image nullable in DDL but Prisma non-nullable String → DTO surfaces image:string|null defensively (no NULLs in data). SQL `deleted` flag does NOT exist (Mongo soft-delete has no SQL counterpart) → active = status=true is the sole gate. last_seen_at/email_verified_at omitted (not needed for the public master)
- Reads: findById / findActiveById / findByIds (bulk course-educator hydration) / listActive (name search) / findRefById ({_id,name,image} embed)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `CourseEducator`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 35. Admin Auth + Administrator CRUD (ws_users) {#admin-auth}

| | |
|---|---|
| **Module key** | `admin-auth` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `AdminUser / AdminAccessToken / AdminRoleRow / AdminPermissionRow / AdminModelHasRole / AdminModelHasPermission` |
| **MySQL table** | `ws_users (+ ws_admin_access_tokens, ws_roles, ws_permissions, ws_model_has_roles, ws_model_has_permissions)` |
| **Mongo collection (legacy app)** | `ws_users (+ ws_admin_access_tokens, roles, permissions)` |
| **Code** | `src/modules/admin-auth (branches src/admin/auth/admin.auth.service.ts + src/admin/administrator/administrator.controller.ts)/` |
| **Data** | 3 admins in staging |
| **Smoke test** | `—  (verified via live-DB tsx; HTTP login verified)` |
| **Admin API** | POST `/admin/auth/login` · `/refresh` · DELETE `/logout` · POST `/change-password` · PUT `/profile` · CRUD `/admin/administrators` (+ `/pre-requisites`, `/:id/status`) |
| **Client API** | — |

**Transformer / schema notes:**

- ⚠ OVERTURNS the earlier 'Laravel admin/RBAC is OUT OF SCOPE / stays Mongo' decision — admin auth + administrator management are now on SQL. Login authenticates against ws_users (NOT Mongo).
- Passwords are Laravel `$2y$` bcrypt — bcryptjs `compare` verifies them as-is (treats $2y$ === $2b$). All existing admins log in with current passwords.
- ws_users has NO `role` and NO `deleted` column. role/roles/permissions resolved from the spatie pivots (ws_model_has_roles → ws_roles, model_type `App\\Models\\User`); `role` string DERIVED from role names (super→super_admin, editor→editor, else admin). 'delete' = status='0' + revoke tokens (row retained).
- status/is_dark are enum('0','1') → Prisma enums AdminStatusFlag{inactive=0,active=1} / AdminDarkFlag{light=0,dark=1}.
- DDL ADD: created ws_admin_access_tokens (mirrors ws_customer_access_token). JWT payload + Redis admin_session:{id} unchanged; numeric id stringified into the token.
- Administrator CRUD: list (search+status+role filter, paginated), get, create, update, delete(disable), toggle-status, pre-requisites (roles dropdown from ws_roles). Validation relaxed to accept numeric spatie role id alongside the 24-hex ObjectId.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `AdminUser / AdminAccessToken / AdminRoleRow / AdminPermissionRow / AdminModelHasRole / AdminModelHasPermission`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 36. Admin · Customer CRUD (ws_customer) {#customer-admin-crud}

| | |
|---|---|
| **Module key** | `customer-admin-crud` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Customer (+ CustomerState/CustomerDistict/CustomerEducation lookups)` |
| **MySQL table** | `ws_customer` |
| **Mongo collection (legacy app)** | `ws_customers` |
| **Code** | `src/modules/admin-customer (branches src/admin/customer/customer.controller.ts)/` |
| **Data** | 27 customers in staging |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | GET `/admin/customers` (list) · `/:id` · `/pre-requisites` · `/states/:id/districts` · POST `/` · PUT `/:id` · DELETE `/:id` · PATCH `/:id/status` |
| **Client API** | — |

**Transformer / schema notes:**

- Gated by the existing `customer-auth` flag (admin customer management flips together with customer auth). Single MODULE constant = 'customer-auth'.
- ws_customer stores a single `full_name` — API exposes firstName/middleName/lastName. compose on write, split on read.
- state/district are NOT NULL (no default) → cleared/absent values write 0 (legacy sentinel, matches customer-auth createStub), never NULL. education_id nullable. Create uses Prisma unchecked input to set raw FK columns.
- FK ids are Int (not ObjectId) → list filters + create/update accept numeric ids; validation relaxed. dob→birthDate, profile_picture, phone_2→phone2, goal(JSON)←goals[]. Changing phone resets is_phone_verified.
- Subscription/order/address aggregate handlers (course/ebook subs, addresses, getCustomerDetails) return empty on the SQL branch — those models aren't migrated yet.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Customer (+ CustomerState/CustomerDistict/CustomerEducation lookups)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 37. Educator Auth + Admin Educator Master CRUD (ws_course_educator) {#educator-auth}

| | |
|---|---|
| **Module key** | `educator-auth` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `CourseEducator (extended) / EducatorAccessToken` |
| **MySQL table** | `ws_course_educator (+ ws_educator_access_tokens)` |
| **Mongo collection (legacy app)** | `ws_course_educators (+ ws_educator_access_tokens)` |
| **Code** | `src/modules/educator-auth (branches src/educator/auth/educator.auth.service.ts + src/admin/master/educator.controller.ts)/` |
| **Data** | 56 educators in staging |
| **Smoke test** | `—  (verified via live-DB tsx; HTTP educator list + admin login verified)` |
| **Admin API** | GET `/admin/master/educators` (list, sort+search+status, paginated) · `/:id/details` · POST `/` · PUT `/:id` · DELETE `/:id` |
| **Client API** | POST `/educator/auth/login` · `/token/refresh` · DELETE `/logout` · GET/PUT `/auth/me` · POST `/auth/change-password` |

**Transformer / schema notes:**

- ⚠ MIXED PASSWORD HASHES: 40 rows are legacy 32-char MD5, 16 are bcrypt ($2). The Mongo branch only did bcrypt.compare (would lock out the 40 MD5 educators). verifyEducatorPassword tries bcrypt first, then md5(input)===stored for 32-hex hashes. Empty-string MD5 (d41d8cd9…) = 'no password', never matches. Password CHANGE always writes bcrypt (upgrades legacy on change).
- DDL ADD: created ws_educator_access_tokens (mirrors the admin/customer token tables). JWT payload {id,email,role:'educator',type:'educator'} + Redis educator_session:{id} + 1-device middleware rule all unchanged.
- Extended Prisma CourseEducator: image → nullable; added last_seen_at/email_verified_at + the accessTokens relation. (commerce-educator READ module unaffected.)
- Admin master CRUD: list has an `id` SECONDARY SORT tiebreaker — 37/56 rows share NULL updated_at, so without it the order is arbitrary and pagination drifts (a row on two pages). With it: every educator appears exactly once across pages.
- ws_course_educator has NO `deleted` column → admin delete = status=false + revoke tokens (row retained). password is NOT NULL but create validation makes it optional → store '' (no-login) when absent, bcrypt when provided. getEducatorDetails associations (courses/live-courses/packages/sessions) return empty on SQL (those models unmigrated).
- Image-clear (PUT educator): updateEducatorSchema overrides image → z.string().url().nullable().optional() so explicit null clears it (omit=keep, URL=set); Mongo fallback maps null→'' (model image:required). Create still requires a URL.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `CourseEducator (extended) / EducatorAccessToken`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 38. Promoter Auth (ws_promoter) {#promoter-auth}

| | |
|---|---|
| **Module key** | `promoter-auth` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Promoter (extended) / PromoterAccessToken` |
| **MySQL table** | `ws_promoter (+ ws_promoter_access_tokens)` |
| **Mongo collection (legacy app)** | `ws_promoter (+ ws_promoter_access_tokens)` |
| **Code** | `src/modules/promoter-auth (branches src/promoter/auth/promoter.auth.service.ts)/` |
| **Data** | 114 promoters in staging (only 1 has a password) |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | — |
| **Client API** | POST `/promoter/auth/login` · `/token/refresh` · DELETE `/logout` · GET/PUT `/auth/me` · POST `/auth/change-password` |

**Transformer / schema notes:**

- Wave 1 of the Mongo-only push. Mirrors educator-auth. New `ws_promoter_access_tokens` (DDL ADD → schema-changes/2026-06-17_create_ws_promoter_access_tokens.sql).
- Extended Prisma `Promoter`: added password + lastSeenAt (@map last_seen_at) + accessTokens relation; new PromoterAccessToken model. commerce-promoter READ transformer still excludes password (safe).
- verifyPromoterPassword (bcrypt then 32-hex MD5) — only 1/114 promoters has a password (bcrypt); the rest are admin-created with no login. ws_promoter has NO last_login_date/_ip cols → touchLogin writes last_seen_at.
- JWT {id,email,role:'promoter',type:'promoter'} + Redis promoter_session:{id} unchanged; numeric id stringified.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Promoter (extended) / PromoterAccessToken`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 39. Promoter Analytics (customers/subscriptions/dashboard/promocode) {#promoter-data}

| | |
|---|---|
| **Module key** | `promoter-data` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `(raw SQL over ws_package_course_order/subscription, ws_ebook_order/subscription, ws_promocode, ws_customer)` |
| **MySQL table** | `ws_package_course_subscription / ws_ebook_subscription (joined via order.promocode JSON)` |
| **Mongo collection (legacy app)** | `ws_package_course_subscriptions / ws_ebook_subscriptions / ws_promo_codes` |
| **Code** | `src/modules/promoter-data (branches src/promoter/{customer,subscription,dashboard,promocode}/)/` |
| **Data** | promoter 130 → 2 subs, ₹15,300, commission ₹765, 2 customers |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | — |
| **Client API** | GET `/promoter/customers`(+`/:id`) · `/promoter/subscriptions`(+`/report`) · `/promoter/dashboard`(+`/overview`) · `/promoter/promocodes`(+`/:id`) |

**Transformer / schema notes:**

- ⚠ ATTRIBUTION DIVERGENCE: SQL subscription tables have NO promoter_id/promoter_percentage/paid_amount. `ws_*_order.promocode` is a JSON snapshot embedding promoterId + promotedPackageCourseEbook[0].promoterPercentage → attribute via JSON_EXTRACT($.promoterId) joined order.id = subscription.order_id.
- All raw SQL (prisma.$queryRawUnsafe, bound params) — Prisma can't express JSON-path filters or DATE_FORMAT time-bucket grouping. revenue = subscription.amount/price; commission = amount * pct/100.
- Overview chart buckets: today→hour, week/month→day, year/all→month, custom→derived by span. Separate flag from promoter-auth.
- Limitation: promocode appliesTo not representable from SQL (returns empty, like commerce-promocode); overview promocodeId scope param ignored on SQL.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `(raw SQL over ws_package_course_order/subscription, ws_ebook_order/subscription, ws_promocode, ws_customer)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 40. Referral (rewards/withdrawal/program — client + admin + webhook) {#referral}

| | |
|---|---|
| **Module key** | `referral` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `RefferalProgram / RefferalTransaction (+ Customer reward fields)` |
| **MySQL table** | `ws_refferal_program / ws_refferal_transaction (+ ws_customer)` |
| **Mongo collection (legacy app)** | `ws_refferal_programs / ws_refferal_transactions` |
| **Code** | `src/modules/referral (branches src/client/referral/{referral,content}.controller.ts + src/admin/referral/referral.service.ts + src/webhooks/razorpay-payout.controller.ts)/` |
| **Data** | 1 program; transactions created on withdrawal/adjust |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | program CRUD `/admin/referral/programs` · `/transactions` · `/withdrawals`(+`/csv`) · `/referrers` · PATCH withdrawal status · reject · adjust rewards |
| **Client API** | GET `/client/referral/rewards` · `/transactions`(+`/:id`) · `/status` · POST `/withdraw` · `/generate-code`; webhook `/razorpay-payout` |

**Transformer / schema notes:**

- Wave 2 (Mongo-only push) — client + admin + webhook all on SQL. DDL on ws_refferal_transaction: +provider_ref +failure_reason cols + `status` enum widened with `failed` (schema-changes/2026-06-17_*).
- Withdrawal: atomic Prisma $transaction (decrement ws_customer.reward_points + create pending DEBIT txn) → RazorpayX payout → on failure, atomic refund (re-credit points + mark txn failed). Mixed-backend risk gone (customer+bank+txn all SQL).
- Webhook (razorpay-payout): flips a pending withdrawal by provider_ref → successful, or refunds points (DEBIT) + marks failed; idempotent (non-pending skipped). Mongo-only utr/providerPayload NOT persisted (not in response contract).
- Admin (branched in src/admin/referral/referral.service.ts): program CRUD, txn list (w/ customer), updateWithdrawalStatus, rejectWithdrawal+refund, withdrawalsReport + CSV (raw SQL JSON_EXTRACT over bank_account), adjustCustomerRewards (atomic), listReferrers per-customer GROUP BY rollup. listReferrers pagination total is approximated.
- ⚠ getTerms/getFaqs + admin FAQ/Term CRUD STAY on Mongo — ws_referral_faq/ws_referral_term have NO SQL tables (Mongo-only content).

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `RefferalProgram / RefferalTransaction (+ Customer reward fields)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 41. Admin RBAC (roles + permissions management) {#admin-rbac}

| | |
|---|---|
| **Module key** | `admin-rbac` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `AdminRoleRow / AdminPermissionRow / AdminRoleHasPermission (+ AdminModelHasRole)` |
| **MySQL table** | `ws_roles / ws_permissions / ws_role_has_permissions` |
| **Mongo collection (legacy app)** | `roles / permissions / permissioncategories` |
| **Code** | `src/modules/admin-rbac (branches src/admin/role/role.controller.ts + src/admin/permission/permission.service.ts)/` |
| **Data** | 31 roles, 115 permissions, 143 pivot rows |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | CRUD `/admin/roles` (+`/:id/permissions`) · CRUD `/admin/permissions` (+`/tree`, `/:id/roles`) |
| **Client API** | — |

**Transformer / schema notes:**

- Wave 3 (Mongo-only push). spatie tables admin-auth already READS; this adds management writes. Prisma: +created_at/updated_at on AdminRoleRow/AdminPermissionRow + new AdminRoleHasPermission pivot model (no DDL — tables existed).
- Role create/update/syncPermissions WRITE ws_role_has_permissions directly (delete-all + insert in a $transaction), validating permission ids belong to the role's guard. deleteRole cascades the pivot + ws_model_has_roles (no DB FK cascade in legacy schema). roleInUse checks ws_model_has_roles.
- Permission `category` is DERIVED from the name prefix (`bannerslider.create` → `bannerslider`); the tree groups by it. Permission create/update ignore category_id on SQL.
- ⚠ Mongo-only gaps: ws_permission_categories has NO SQL table → the permissionCategory CRUD controller STAYS Mongo; the Mongo permission category object {id,title,slug} becomes a derived string on SQL.
- ids are bigint unsigned; surfaced as String/Number (small values, like commerce-educator). guard_name is a real column (default 'web').

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `AdminRoleRow / AdminPermissionRow / AdminRoleHasPermission (+ AdminModelHasRole)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 42. Client Exam (reads + saveAnswers scoring write) {#client-exam}

| | |
|---|---|
| **Module key** | `client-exam` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Exam / ExamCategory / ExamQuestion / ExamQuestionOption / ExamResult / ExamResultDetail / ExamResultDetailAnalytics` |
| **MySQL table** | `ws_exam / ws_exam_category / ws_exam_question(_option) / ws_exam_result(_detail)(_analytics)` |
| **Mongo collection (legacy app)** | `ws_exams / ws_exam_categories / ws_exam_questions / ws_exam_results` |
| **Code** | `src/modules/client-exam (branches src/client/exam/exam.controller.ts)/` |
| **Data** | 1 exam, 1 question, 5 options, 2 results in staging |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | —  (admin exam reads pending — Wave 4 remainder) |
| **Client API** | GET `/client/exams/category/:id` · `/exams/:id/questions` · `/exams/my/attempts` · `/exams/:id/solution(/analytics)` · `/quizzes/daily`; POST `/save/answers` |

**Transformer / schema notes:**

- Wave 4 (Mongo-only push) — full CLIENT exam surface: reads + the saveAnswers scoring WRITE. ⚠ Test Series (ws_test_series*) + ExamCountdown (ws_exam_countdown*) have NO SQL tables → MONGO-ONLY, excluded (like LiveCourse).
- Schema fix: Exam.description String→String? (1 NULL row would throw). Result tables use the legacy qresult_* column prefix (mapped in Prisma).
- getExamQuestions NEVER surfaces the question `answer` during an attempt. listExamsByCategory hides scheduled exams past endAt + decorates per-customer isCompleted/lastResult. getDailyExams = year→month→week→tests drill-down (raw SQL grouping).
- saveAnswers (WRITE): norm(option.name)===norm(question.answer)→true/false, 'skip'→skip; point +pos/−|neg|/0; inserts ws_exam_result + ws_exam_result_detail in a $transaction, recomputes ws_exam_result_detail_analytics, computes rank by best-score-per-customer. SQL-side numeric-id payload validation. Verified exact vs live DB.
- Mongo-only drops on SQL: attemptNumber/inProgress/startedAt/submittedAt (no columns; qresult_attempt = attempt COUNT). getSolutionDownloadByExam (PDF via generateExamSolutionPdf) stays Mongo. Admin exam reads/CRUD are the pending Wave-4 remainder.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Exam / ExamCategory / ExamQuestion / ExamQuestionOption / ExamResult / ExamResultDetail / ExamResultDetailAnalytics`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 43. Client Book Cart (add/update/remove/shipping/get) {#client-cart}

| | |
|---|---|
| **Module key** | `client-cart` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `BookCart / BookCartItem (+ CustomerShipping, CustomerAddress, Book)` |
| **MySQL table** | `ws_book_cart / ws_book_cart_item` |
| **Mongo collection (legacy app)** | `ws_book_carts (embedded items[])` |
| **Code** | `src/modules/client-cart (branches src/client/cart/cart.controller.ts)/` |
| **Data** | 2 carts in staging |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | — |
| **Client API** | POST `/client/cart` · PATCH `/cart/items/:bookId` · DELETE `/cart/items/:bookId` · POST `/cart/shipping` · GET `/cart` |

**Transformer / schema notes:**

- Wave 5 (first slice). Mongo BookCart embeds items[]; SQL splits into ws_book_cart (one active row/customer, active=`status` column) + ws_book_cart_item (cartId→cart.id, bookId→`item_id`). Reuses the BookCart/BookCartItem Prisma models book-order already uses (no schema change).
- cart_id is a NOT-NULL VARCHAR business key → generated `cart-<base36>` (matches existing rows like cart-124dhc...). getCart computes the same totals summary as Mongo (subtotal/listTotal/discount/itemCount/shipping/shippingWaived/total).
- attachShippingToCart find-or-creates a ws_customer_shipping row (userId, phone BigInt, state Int, pincode Int, address_2/email/city NOT NULL) + resolves city via the offline-city module; stamps shipping_id onto the cart.
- SQL branch validates numeric ids (the Mongo path's zod enforces 24-hex ObjectId). add re-uses an existing line via increment; verified add/increment/get-totals/update/remove cycle vs live DB.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `BookCart / BookCartItem (+ CustomerShipping, CustomerAddress, Book)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 44. Admin Exam (reads: exams/questions/submissions/analytics) {#admin-exam}

| | |
|---|---|
| **Module key** | `admin-exam` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Exam / ExamQuestion / ExamQuestionOption / ExamResult / ExamResultDetail / ExamResultDetailAnalytics` |
| **MySQL table** | `ws_exam / ws_exam_question(_option) / ws_exam_result(_detail)(_analytics)` |
| **Mongo collection (legacy app)** | `ws_exams / ws_exam_questions / ws_exam_results` |
| **Code** | `src/modules/admin-exam (branches src/admin/exam/exam.controller.ts)/` |
| **Data** | 1 exam, 2 results in staging |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | GET `/admin/exams`(+`/:id`) · `/admin/exams/questions`(+`/:id`) · `/admin/exams/:examId/submissions` · `/:examId/analytics` · `/results/:id` · `/analytics/customer/:id`; PATCH `/results/:id/invalidate` |
| **Client API** | — |

**Transformer / schema notes:**

- Wave 4 admin slice — READ surface + invalidateResult. Reuses the ws_exam* tables (shared with client-exam); exam categories are already on catalog-exam. No DDL.
- Admin DOES see the question `answer` (the client attempt view hides it). getExams supports search/category/type/status/isPaid filters; getQuestions returns options.
- getExamAnalytics uses raw SQL over the qresult_* columns: overall (totalCandidates/avgScore/max/min/avgAccuracy) + per-question (correct/wrong/skipped/accuracy, sorted hardest-first).
- Deferred (stay Mongo): admin exam/question CRUD writes + getSolutionDownloadByExam (PDF via generateExamSolutionPdf). Test Series + ExamCountdown remain Mongo-only (no SQL tables).

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Exam / ExamQuestion / ExamQuestionOption / ExamResult / ExamResultDetail / ExamResultDetailAnalytics`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 45. Client Educator detail (profile + courses + plans) {#client-educator}

| | |
|---|---|
| **Module key** | `client-educator` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `CourseEducator / Course / PackageCourseEbookPrice / PackageCourseSubscription` |
| **MySQL table** | `ws_course_educator / ws_course / ws_package_course_ebook_price / ws_package_course_subscription` |
| **Mongo collection (legacy app)** | `ws_course_educators / ws_courses` |
| **Code** | `src/modules/client-educator (branches src/client/educator/educator.controller.ts)/` |
| **Data** | educator 20 → 1 course / 5 plans in staging |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | — |
| **Client API** | GET `/client/educators/:id` |

**Transformer / schema notes:**

- Wave 5 client read. Composes already-migrated tables (no DDL): educator profile + their active courses + per-course plans split with/withoutMaterial + per-course daysLeft from active subscriptions (lifetime-aware: null endAt beats dated, latest wins) + fire-and-forget view++.
- Course relation fields are `educator`/`subject`; CourseSubjectCategory exposes `title` (not name).
- ⚠ Sibling client reads STAY Mongo: client material (entitlement helper needs LiveCourse + Mongo embedded materialCategories[]; ws_material has no isPaid/ancestors) and client search/globalSearch (includes LiveCourse — no SQL table). wishlist/folder/lecture-note(s)/free-progress also Mongo-only (no SQL tables).

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `CourseEducator / Course / PackageCourseEbookPrice / PackageCourseSubscription`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 46. Admin Plan CRUD (PackageCourseEbookPrice) {#admin-plan}

| | |
|---|---|
| **Module key** | `admin-plan` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PackageCourseEbookPrice (+ PromotedPackageCourseEbook, PackageCourseSubscription)` |
| **MySQL table** | `ws_package_course_ebook_price` |
| **Mongo collection (legacy app)** | `ws_package_course_ebook_prices` |
| **Code** | `src/modules/admin-plan (branches src/admin/plan/plan.controller.ts)/` |
| **Data** | 1353 plans in staging |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | CRUD `/admin/plans` (+ `/:id/toggle`, `/:id/default`, `/bulk/status`, `/bulk/delete`, `/:id/clone`) |
| **Client API** | — |

**Transformer / schema notes:**

- Wave 5 first admin catalog CRUD module. All 10 handlers (list/get/create/update/delete/toggle/markAsDefault/bulkStatus/bulkDelete/clone). No DDL.
- A plan is owned by exactly ONE of course/package/ebook. Unused owner ids are stored as EITHER NULL or 0 (legacy mix) → treat NULL-or-0 as 'not owned'; on write set the chosen owner + 0 the other two; entityType filter uses `>0`.
- Single-default-per-entity invariant: after any create/update/markAsDefault that sets isDefault, clearSiblingDefaults flips all OTHER plans of the same owner to isDefault=false.
- deletePlan blocked when the plan has subscribers (ws_package_course_subscription.packageId); on delete/bulkDelete also cascades ws_promoted_package_course_ebook rows (planId=pcb_price_id). clone forces isDefault=false. Verified the full lifecycle vs live DB.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PackageCourseEbookPrice (+ PromotedPackageCourseEbook, PackageCourseSubscription)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 47. Admin Master sub-catalog CRUD + full videoCategory (pc-material / subject / video categories) {#admin-master}

| | |
|---|---|
| **Module key** | `admin-master` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `PackageCourseMaterial / CourseSubjectCategory / VideoCategory` |
| **MySQL table** | `ws_package_course_material / ws_course_subject_category / ws_video_category` |
| **Mongo collection (legacy app)** | `ws_package_course_materials / coursesubjectcategories / videocategories` |
| **Code** | `src/modules/admin-master (branches src/admin/pc-material/ + src/admin/master/{material,subjectCategory,videoCategory}.controller.ts + the FULL src/admin/videoCategory/videoCategory.controller.ts)/` |
| **Data** | 1 pc-material, 1 subject-cat, 157 video-cats |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | CRUD `/admin/pc-materials` · `/admin/master/{materials,subject-categories,video-categories}` · full `/admin/video-categories` (+ `/:id/courses`, `/:id/videos`, `/:id/status`) |
| **Client API** | — |

**Transformer / schema notes:**

- Wave 5 admin small-master CRUD. PackageCourseMaterial (ws_package_course_material) is TITLE-ONLY in SQL — pc-material AND master/material share it; master/material's image/isActive fields are dropped on the SQL branch.
- VideoCategory list resolves child_categories + hasChildren from the `parent` self-FK (Mongo populated childCategoryIds). Schema: added parent/educatorId(@map educator_id)/pdf to the VideoCategory Prisma model (were absent) — all NOT NULL w/ default 0/'' in the DB, so the service coerces to 0/'' on write (never null). catalog-video reads unaffected (additive nullable fields).
- ⚠ master/packageCategory STAYS Mongo — ws_package_category does not exist in SQL. VideoCategory delete's ws_video_category_relation (D2) cleanup is deferred (relations not migrated).
- FULL admin videoCategory controller also branched here (list/prereqs/get/create/update/toggle/delete + courses-list + videos-list). ⚠ Mongo childCategoryIds[] is a DAG; SQL has only a single `parent` FK → children DERIVED from parent, childCategoryIds NOT writable on SQL. The `duplicate` (BFS DAG clone + courseId/liveCourseId, no SQL cols) STAYS Mongo.

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `PackageCourseMaterial / CourseSubjectCategory / VideoCategory`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 48. Admin Video CRUD (ws_video) {#admin-video}

| | |
|---|---|
| **Module key** | `admin-video` |
| **Phase** | 3 |
| **Migrated** | 2026-06-17 |
| **Status** | ✅ Active when listed in `MIGRATION_MYSQL_MODULES` |
| **Prisma model** | `Video (+ VideoCategory)` |
| **MySQL table** | `ws_video` |
| **Mongo collection (legacy app)** | `videos` |
| **Code** | `src/modules/admin-video (branches src/admin/video/video.controller.ts)/` |
| **Data** | 156 videos in staging |
| **Smoke test** | `—  (verified via live-DB tsx)` |
| **Admin API** | GET `/admin/videos` · `/pre-requisites` · `/:id` · POST `/` · PUT `/:id` · DELETE `/:id` · PATCH `/:id/status` · POST `/reorder` |
| **Client API** | — |

**Transformer / schema notes:**

- Wave 5 admin CRUD. All 8 handlers. platform = youtube|vimeo|aws with ONLY the matching *_id column populated (others nulled on create / platform-switch).
- slug auto-uniquify: append -2/-3/… until free (never 409), excludeId on update. video-category existence validated on create + re-link. prereqs `has_children` derived from the VideoCategory `parent` self-FK. toItem response shape (id/name/slug/order/topic/type/status/video_category/platform/{youtube,vimeo,aws}+ids) matches the Mongo branch.
- priceType is the VideoType enum (free|paid). SQL-side numeric category ids. No schema change (Video model was clean).

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Video (+ VideoCategory)`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

---

## Adding the next module

1. Implement `src/modules/<name>/` (repository, service, transformer).
2. Wire controllers with `isMysqlModule("<key>")`.
3. Add an entry to `MIGRATED_REGISTRY` in `scripts/generate-migrated-modules.ts`.
4. Run `yarn docs:migrated-modules`, `yarn docs:schema-comparison`, `yarn docs:field-comparison`.
5. Log tests in [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md) before expanding `MIGRATION_MYSQL_MODULES`.

---

## Related docs

| Document | Purpose |
|----------|---------|
| [MIGRATION_TRACKER.md](./MIGRATION_TRACKER.md) | Build progress & changelog |
| [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md) | Pass/Fail test checklist |
| [testing-guide.md](./testing-guide.md) | How to validate each module |
| [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) | All tables — inventory |
| [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) | All modules — column/field matrix |
| [MIGRATION_DOC_UPDATES.md](./MIGRATION_DOC_UPDATES.md) | What to update after each change |

