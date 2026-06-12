/**
 * Generates docs/migration/MIGRATED_MODULES.md — only modules on MySQL (Phase 2+).
 * Run: yarn docs:migrated-modules
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "docs/migration/MIGRATED_MODULES.md");

/** Modules with Prisma repository + service + transformer wired. Add here when a module ships. */
const MIGRATED_REGISTRY = [
  {
    key: "app-update",
    label: "App Update",
    phase: 2,
    migratedOn: "2026-06-04",
    prismaModel: "AppUpdate",
    mysqlTable: "ws_app_update",
    mongoCollection: "ws_app_updates",
    code: "src/modules/app-update",
    adminRoutes: "GET/PUT `/api/v1/admin/cms/app-update`",
    clientRoutes: "Used by `checkUpgrade` (client CMS)",
    testScript: "yarn db:test-cms-pilot",
    rowCountHint: "Singleton row `id = 1`",
    transformerNotes: [
      "MySQL column `isUpdateAvailble` (legacy typo) → API `isUpdateAvailable`",
      "Mongo collection `ws_app_updates` (plural) → MySQL `ws_app_update` (singular)",
    ],
  },
  {
    key: "version",
    label: "Version",
    phase: 2,
    migratedOn: "2026-06-04",
    prismaModel: "Version",
    mysqlTable: "ws_versions",
    mongoCollection: "ws_versions",
    code: "src/modules/version",
    adminRoutes: "GET/PUT `/api/v1/admin/cms/version`",
    clientRoutes: "GET `/api/v1/client/version`, `checkUpgrade`",
    testScript: "yarn db:test-cms-pilot",
    rowCountHint: "Singleton row `id = 1`",
    transformerNotes: ["Table/collection name matches (`ws_versions`)"],
  },
  {
    key: "faq",
    label: "FAQ",
    phase: 2,
    migratedOn: "2026-06-04",
    prismaModel: "FAQ",
    mysqlTable: "ws_faq",
    mongoCollection: "ws_faqs",
    code: "src/modules/faq",
    adminRoutes: "CRUD `/api/v1/admin/cms/faqs` (+ faq-types when on Mongo)",
    clientRoutes: "GET `/api/v1/client/faqs`, GET `/api/v1/client/faq-types`",
    testScript: "yarn db:test-faq",
    rowCountHint: "13 rows in staging (5 general, 8 referral)",
    transformerNotes: [
      "MySQL `type` enum (`general` | `referral`) — no `ws_faq_types` table",
      "API exposes synthetic `typeId` for admin/client compat with Mongo-era contract",
      "Admin write body uses `type` on MySQL (not Mongo `typeId`)",
      "Mongo collection `ws_faqs` → MySQL `ws_faq`",
    ],
  },
  {
    key: "banner-slider",
    label: "Banner Slider",
    phase: 2,
    migratedOn: "2026-06-06",
    prismaModel: "BannerSlider",
    mysqlTable: "ws_banner_slider",
    mongoCollection: "ws_banner_sliders",
    code: "src/modules/banner-slider",
    adminRoutes:
      "GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/banners` (+ POST `/banners/reorder`)",
    clientRoutes: "GET `/api/v1/client/banners` (optional `?key=` filter)",
    testScript: "yarn migration:api:banner-slider",
    rowCountHint: "2 rows in staging (key `package`, `course`)",
    transformerNotes: [
      "MySQL `key` lowercase (`package`|`course`|`book`|`ebook`) ↔ Mongo-cased enum (`Packages`|`Courses`|`Book`|`EBook`)",
      "`keyRef` (Mongo model name) derived from `key`",
      "`keyId` served as `null` on MySQL (column is NULL in dump; referenced catalog modules not migrated yet)",
      "Sorted by `orderBy` asc; `reorder` uses a Prisma transaction in place of Mongo bulkWrite",
      "Mongo collection `ws_banner_sliders` → MySQL `ws_banner_slider`",
    ],
  },
  {
    key: "testimonial",
    label: "Testimonial",
    phase: 2,
    migratedOn: "2026-06-06",
    prismaModel: "Testimonial",
    mysqlTable: "ws_testimonial",
    mongoCollection: "ws_testimonials",
    code: "src/modules/testimonial",
    adminRoutes: "GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/testimonials`",
    clientRoutes: "GET `/api/v1/client/testimonials`",
    testScript: "yarn migration:api:testimonial",
    rowCountHint: "5 rows in staging",
    transformerNotes: [
      "MySQL column `discription` (legacy typo) → API field `description`",
      "Sorted by `rating` desc",
      "Mongo collection `ws_testimonials` → MySQL `ws_testimonial`",
    ],
  },
  {
    key: "department",
    label: "Department (Contact-Us)",
    phase: 2,
    migratedOn: "2026-06-06",
    prismaModel: "Department",
    mysqlTable: "ws_department (+ ws_department_contact)",
    mongoCollection: "ws_departments",
    code: "src/modules/department",
    adminRoutes: "GET/POST/PUT/DELETE `/api/v1/admin/departments`",
    clientRoutes: "GET `/api/v1/client/contactus` (active depts + active contacts)",
    testScript: "yarn migration:api:department",
    rowCountHint: "4 departments, 13 contacts in staging",
    transformerNotes: [
      "Mongo embeds `contacts[]`; MySQL splits into `ws_department` + `ws_department_contact` (FK `department`) — transformer joins contacts under each dept",
      "MySQL column `decscription` (legacy typo) → API field `description`",
      "Contacts keep legacy `isCallAvailable` / `isWhatsAppAvailable` flags (additive vs Mongo shape); admin `contactSchema` accepts them",
      "PUT replaces the whole contact set (delete + recreate in a transaction) to mirror Mongo `$set: { contacts }`",
      "DELETE removes contacts then the department (no DB cascade in dump)",
      "Mongo collection `ws_departments` → MySQL `ws_department`",
    ],
  },
  {
    key: "terms",
    label: "Terms & Conditions",
    phase: 2,
    migratedOn: "2026-06-06",
    prismaModel: "TermsAndConditions",
    mysqlTable: "ws_termsandcondition",
    mongoCollection: "ws_terms_and_conditions",
    code: "src/modules/terms",
    adminRoutes: "GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/terms`",
    clientRoutes: "GET `/api/v1/client/terms` (array) · `?module=` (single|null)",
    testScript: "yarn migration:api:terms",
    rowCountHint: "3 rows (book, pendrive, referral code)",
    transformerNotes: [
      "MySQL `module` is a fixed `enum('book','pendrive','referral code')` — Prisma types it as `String`, but writes MUST use a valid value (else MySQL error 1265). Admin uses a MySQL-specific zod enum schema (mirrors faq's `type`)",
      "Client `GET /terms?module=` returns a single object or `null` (Mongo `findOne`); without `module` returns an array (Mongo `find`) — both filter `status: true`",
      "Mongo collection `ws_terms_and_conditions` → MySQL `ws_termsandcondition`",
    ],
  },
  {
    key: "popup",
    label: "Popup Notification",
    phase: 2,
    migratedOn: "2026-06-06",
    prismaModel: "PopupNotifications",
    mysqlTable: "ws_popup_notification",
    mongoCollection: "ws_popup_notifications",
    code: "src/modules/popup",
    adminRoutes: "GET/GET:id/POST/PUT/DELETE `/api/v1/admin/cms/popups` (+ S3 image upload middleware, DB-agnostic)",
    clientRoutes: "GET `/api/v1/client/popup` (active popup or null)",
    testScript: "yarn migration:api:popup",
    rowCountHint: "36 rows in staging",
    transformerNotes: [
      "Field-name mapping: API `promoExpireAt` ↔ MySQL `promo_expire_at` (nullable `date`); `createdAt`/`updatedAt` ↔ `created_at`/`updated_at`",
      "Client active popup = `status:true` AND `promo_expire_at > now`, newest first (`created_at desc`), single object or `null` (Mongo `findOne`)",
      "S3 image upload is route-level middleware (multer → `attachImage`), DB-agnostic; controller just receives `image` as a string",
      "Mongo collection `ws_popup_notifications` → MySQL `ws_popup_notification` (Prisma model name `PopupNotifications`, plural)",
    ],
  },
  {
    key: "customer-auth",
    label: "Customer Auth (OTP/token)",
    phase: 2,
    migratedOn: "2026-06-06",
    prismaModel: "Customer / CustomerOtp / CustomerAccessToken",
    mysqlTable: "ws_customer (+ ws_customer_otp, ws_customer_access_token)",
    mongoCollection: "ws_customers / ws_customer_otps / ws_customer_access_tokens",
    code: "src/modules/customer-auth (service refactored in src/client/auth/auth.service.ts)",
    adminRoutes: "—",
    clientRoutes:
      "POST `/api/v1/client/auth/otp/generate` · `/otp/resend` · `/otp/validate` · `/token/refresh` · DELETE `/logout`",
    testScript: "yarn migration:api:customer-auth",
    rowCountHint: "26 customers in staging; tests use real phone 9664796376 (static OTP 5786)",
    transformerNotes: [
      "Schema change: added nullable `refresh_token` TEXT column to `ws_customer_access_token` (+ Prisma model) — the dump table lacked it; mirrors the Mongo `refreshToken` field",
      "Profile mapping: MySQL single `full_name` → API `firstName` (middle/last = \"\"); state/district/education ids returned as strings; `goals` from the `goal` JSON column; `isProfileCompleted` computed (no column), never persisted",
      "`authenticate` middleware is NOT read-path coupled to the token table — it verifies the JWT + Redis revocation only, so migrating the token table does not affect general authenticated requests",
      "JWT signing/payload, Redis `customer_session:{id}`, `formatPhone`, static-OTP/SMS logic and all response shapes are shared across both DB branches; only persistence differs",
      "JWT `id` is the int customer id stringified on MySQL (was the Mongo ObjectId string)",
      "Collections `ws_customers/ws_customer_otps/ws_customer_access_tokens` → MySQL `ws_customer/ws_customer_otp/ws_customer_access_token`",
    ],
  },
  {
    key: "customer-lookups",
    label: "Customer Lookups (state/district/education/goal)",
    phase: 2,
    migratedOn: "2026-06-10",
    prismaModel: "CustomerState / CustomerDistict / CustomerEducation / CustomerTargetGoal",
    mysqlTable: "ws_customer_state / ws_customer_distict / ws_customer_education / ws_customer_target_goal",
    mongoCollection: "ws_customer_states / ws_customer_districts / ws_customer_educations / ws_customer_target_goals",
    code: "src/modules/customer-lookups",
    adminRoutes: "—",
    clientRoutes:
      "GET `/api/v1/client/address/states` · `/educations` · `/characteristic` (educations)",
    testScript: "yarn migration:api:customer-lookups",
    rowCountHint: "12 active states, 10 active educations in staging",
    transformerNotes: [
      "Wired into `src/client/address/address.controller.ts` (getStates/getEducations/getCharacteristic) — service was previously dead code",
      "Ids returned as strings (`_id` Mongo-shape); `state_code`↔`stateCode`; district `state` int FK ↔ Mongo `stateId`",
      "Controller projects to the exact Mongo contract (`{_id,name,stateCode}` / `{_id,name}`) so the `active`/`status` field isn't leaked",
      "Goal here = `ws_customer_target_goal` (NOT the rich onboarding `Goal` collection, which stays on Mongo)",
    ],
  },
  {
    key: "customer-address",
    label: "Customer Address",
    phase: 2,
    migratedOn: "2026-06-10",
    prismaModel: "CustomerAddress",
    mysqlTable: "ws_customer_address",
    mongoCollection: "ws_customer_addresses",
    code: "src/modules/customer-address",
    adminRoutes: "—",
    clientRoutes:
      "GET `/api/v1/client/address` · GET `/:id` · POST `/` · PUT `/:id` · PATCH `/:id/default` · DELETE `/:id`",
    testScript: "—  (flag OFF; verified via live-DB repo test)",
    rowCountHint: "Verified create→list→setDefault→update→delete on live DB (customer 472341)",
    transformerNotes: [
      "FLAG OFF: not enabled in MIGRATION_MYSQL_MODULES — `cityId` → OfflineCity (Mongo) and cart checkout resolves it; enable once OfflineCity + cart migrate",
      "Schema fix: `phone`/`alternate_phone` Int → BigInt (10-digit overflow); kept `label`/`is_default`/`city_id` to match live DB (NOT in original dump)",
      "`city` column is NOT NULL and is what legacy data populates (`city_id` is NULL) — required string in input/DTO",
      "MySQL path uses integer FK ids (own zod schemas `createAddressSchemaMysql`/`updateAddressSchemaMysql`); Mongo path keeps ObjectId regex",
      "BigInt phones serialized to string in transformer; `setDefault` uses a Prisma transaction",
    ],
  },
  {
    key: "customer-profile",
    label: "Customer Profile",
    phase: 2,
    migratedOn: "2026-06-10",
    prismaModel: "Customer",
    mysqlTable: "ws_customer",
    mongoCollection: "ws_customers",
    code: "src/modules/customer-profile (branches src/client/profile/customer.service.ts)",
    adminRoutes: "—",
    clientRoutes:
      "PUT `/api/v1/client/profile/update` · GET `/` · profile-picture · device-token · DELETE `/` (NOT dashboard — stays Mongo)",
    testScript: "—  (flag OFF; verified via live-DB service test)",
    rowCountHint: "Verified read/update on live DB (customer 472347 'DIXIT PATEL', goals [7,8,12,13,14])",
    transformerNotes: [
      "FLAG OFF: dashboard aggregates non-customer collections (folders/subs/notifications/exams) → enable once those migrate; dashboard left on Mongo",
      "Name: split `full_name` → first/middle/last on read, join on write (heuristic)",
      "Goals: `goal` JSON int array ↔ [{_id,name}] hydrated from ws_customer_target_goal (order preserved)",
      "isProfileCompleted: derived (full_name present), never stored",
      "Device tokens: single `device` column (newest wins) — legacy parity, not the Mongo `firebaseTokens[]` array",
      "facebookId: added to Prisma Customer (`@map(\"facebook_id\")`), mapped read-only (not surfaced in DTO)",
      "Get/update preserve the existing Redis profile cache; picture upsert/delete keep S3 cleanup; delete-account revokes MySQL tokens",
    ],
  },
  {
    key: "customer-bank-account",
    label: "Customer Bank Account",
    phase: 2,
    migratedOn: "2026-06-10",
    prismaModel: "CustomerBankAccount",
    mysqlTable: "ws_customer_bank_account",
    mongoCollection: "ws_customer_bank_accounts",
    code: "src/modules/customer-bank-account (branches src/client/referral/referral.controller.ts)",
    adminRoutes: "—",
    clientRoutes:
      "GET/POST/PUT/DELETE bank-account CRUD in the referral/rewards flow",
    testScript: "—  (flag OFF; verified via live-DB repo test)",
    rowCountHint: "Verified create→list→update→delete on live DB (customer 472347)",
    transformerNotes: [
      "FLAG OFF: referral `requestWithdrawal` embeds `bankAccount.toObject()` + reward-points txn (Mongo) — enable once the withdrawal/referral flow migrates",
      "Live DB matches the Prisma model (incl. bank_name/branch_name/city) — no schema change needed",
      "4 CRUD handlers branched; `requestWithdrawal` deliberately left on Mongo (mixed-backend txn risk)",
      "IFSC lookup (bank/branch/city) stays server-side in the controller; ids integer on MySQL path",
    ],
  },
  {
    key: "offline-city",
    label: "Offline City",
    phase: 2,
    migratedOn: "2026-06-10",
    prismaModel: "OfflineCity",
    mysqlTable: "ws_offline_city",
    mongoCollection: "ws_offline_cities",
    code: "src/modules/offline-city (branches address.controller.listCities + cart.controller cityId resolution)",
    adminRoutes: "—  (admin offline CRUD stays Mongo this pass)",
    clientRoutes: "GET `/api/v1/client/address/cities` (+ ?search)",
    testScript: "yarn migration:api:offline-city",
    rowCountHint: "2 cities in staging (Ahmedabad, Gandhinagar)",
    transformerNotes: [
      "Scope: CITIES ONLY — migrated to unblock customer-address (its cityId → OfflineCity; cart resolves cityId→name)",
      "Schema (D1): ADDED `status`/`order` columns to ws_offline_city via DDL to preserve Mongo active-gating + ordering (not in original dump)",
      "Cart `attachShippingToCart` cityId→name resolution branches on isOfflineCityMysql()",
      "Centers/batches/enquiry/admin remain on Mongo for a later offline pass",
      "Verified end-to-end: a MySQL address cityId=2 resolves to 'Ahmedabad' through the cart path",
    ],
  },
  {
    key: "catalog-package-type",
    label: "Catalog · Package Type",
    phase: 3,
    migratedOn: "2026-06-11",
    prismaModel: "PackageType",
    mysqlTable: "ws_package_type",
    mongoCollection: "ws_package_types",
    code: "src/modules/catalog-package (branches src/client/package/package.controller.ts listPackageTypes)",
    adminRoutes: "—  (admin package-type CRUD stays Mongo this pass)",
    clientRoutes: "GET `/api/v1/client/packages/types`",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "6 package types in staging",
    transformerNotes: [
      "FLAG OFF: package-type ids are int (MySQL) vs ObjectId (Mongo); still-Mongo consumers (purchase-history, my-subscriptions, dashboard, categories, free, admin CRUD) join package-type ids — flipping /packages/types alone splits the id space. Flip WITH the commerce/dashboard wave",
      "ws_package_type has only {id,name,created_at,updated_at}; Mongo PackageType adds order/active → synthesize order:0 + active:true to keep the response JSON shape identical",
      "listPackageTypes branched on isPackageTypeMysql(); all other package endpoints stay Mongo (need commerce joins + Mongo-only fields)",
    ],
  },
  {
    key: "catalog-package",
    label: "Catalog · Package",
    phase: 3,
    migratedOn: "2026-06-11",
    prismaModel: "Package",
    mysqlTable: "ws_package",
    mongoCollection: "ws_packages",
    code: "src/modules/catalog-package",
    adminRoutes: "—",
    clientRoutes: "—  (ws_package reads built but NOT wired; flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "4 active packages in staging",
    transformerNotes: [
      "FLAG OFF: ws_package is a STRUCTURAL SUBSET of Mongo ws_packages — missing subtitle/isPaid/isSmart/PlannerCourse/goalId/goalLabelId/examCountdown*/specificSubjects[]/materialCategories[]/examCategories[]/withMaterialText. Every client package endpoint also joins commerce-wave tables (PackageCourseEbookPrice plans, PackageCourseSubscription, PromoCode, PackageChat) → full /client/packages can't be reproduced this wave. Flip with commerce",
      "Schema fix: Package.shareable_link String → String? (live DDL nullable); regenerated client v5.22.0",
      "educator_id exists in the DDL but is absent from the Prisma Package model (NULL for all 4 rows) → transformer surfaces educatorId:null; add to Prisma + regen if a consumer needs it",
      "Reads: findPackageById, listActivePackages, listActivePackagesByType (all active:true, order_by then id)",
    ],
  },
  {
    key: "catalog-course",
    label: "Catalog · Course",
    phase: 3,
    migratedOn: "2026-06-11",
    prismaModel: "Course / CourseSubjectCategory",
    mysqlTable: "ws_course / ws_course_subject_category",
    mongoCollection: "ws_courses / coursesubjectcategories",
    code: "src/modules/catalog-course (branches course.controller.ts listCourseCategoriesHandler + listCoursesHandler + listCoursesByCategoryHandler)",
    adminRoutes: "—",
    clientRoutes: "GET `/courses/categories` + GET `/courses` + GET `/courses/category/:id` (all wired, flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "1 course + 1 subject category in staging",
    transformerNotes: [
      "FLAG OFF: course/subject-category ids int (MySQL) vs ObjectId (Mongo); still-Mongo detail/dashboard consumers join those ids. The LISTING endpoints are now fully covered (commerce-price + commerce-subscription built). Flip with the commerce cluster",
      "Schema fix #1: Course.image String → String? (live DDL nullable)",
      "Schema fix #2 (2026-06-12): added is_featured + purchase as Prisma enum CourseFlag01 (MySQL enum('0','1'), values @map'd to '0'/'1') + featured_order Int?. Transformer → Mongo isPopular (is_featured='1') / isPaid (purchase≠'0', honouring Mongo default true). isPopular is now a real filterable SQL column",
      "WIRED listing composition (listCoursesWithPlans): paginated active courses + active plans split by material (commerce-price) + per-customer purchase state isPurchased/daysLeft (commerce-subscription, lifetime-aware: longest endAt wins, endAt null beats dated, matched by courseId OR planId). Mirrors the Mongo paginateCoursesWithPlans {data,pagination} exactly. paymentStatus:'verified' Mongo filter collapses to status=true (no SQL column)",
      "listCourseCategoriesHandler branched on isCourseMysql() (Prisma groupBy counts); listCourses/listCoursesByCategory branch BEFORE the ObjectId guard (MySQL categoryId is int)",
    ],
  },
  {
    key: "catalog-video",
    label: "Catalog · Video (+ URL-encryption contract)",
    phase: 3,
    migratedOn: "2026-06-11",
    prismaModel: "Video / VideoCategory",
    mysqlTable: "ws_video / ws_video_category",
    mongoCollection: "videos / videocategories",
    code: "src/modules/catalog-video",
    adminRoutes: "—",
    clientRoutes: "—  (reads built; no safe standalone video-URL endpoint to wire; flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx + URL-parity test)",
    rowCountHint: "156 videos (all aws), 157 categories (152 active) in staging",
    transformerNotes: [
      "FLAG OFF: video/category ids int (MySQL) vs ObjectId (Mongo); lecture/free/dashboard-resume/progress/browse join those ids. lecture course-membership reads VideoCategory.courseId (Mongo-only); paid access checks PackageCourseSubscription (commerce-wave). Flip with commerce",
      "URL CONTRACT parity PASS ✅: Video Prisma fields match the Mongo names, so a MySQL row fed into the SAME encryptVideoSource util yields an identical videoURL for a fixed token. Verified (token 1234567890123456, video 33089 aws): MySQL URL === Mongo URL, decrypt === aws_id. NEVER reimplement encryption",
      "Module exposes getVideoEncryptInput()/toVideoEncryptInput() = the exact object encryptVideoSource consumes; coerces ''/null platform ids to undefined (live data stores '' for unused platform cols)",
      "Video Prisma model CLEAN vs DDL (no schema change). D2 = DEFER ws_video_category_relation (2456) + ws_video_category_package_relation (6907): client builds groups from Mongo Package.specificSubjects[]/childCategoryIds, not these SQL joins",
    ],
  },
  {
    key: "catalog-ebook",
    label: "Catalog · eBook (+ listing/detail composition)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "EBook",
    mysqlTable: "ws_ebook",
    mongoCollection: "ws_ebooks",
    code: "src/modules/catalog-ebook (branches ebook.controller.ts listEbooks + getEbookDetail)",
    adminRoutes: "—",
    clientRoutes: "GET `/client/ebooks` + GET `/client/ebooks/:id` (wired, flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "2 ebooks in staging",
    transformerNotes: [
      "NO separate ebook-price module: there is no `ws_ebook_price` table — ebook pricing lives in the SHARED `ws_package_course_ebook_price` (ebook_id-owned rows), already covered by commerce-price (added listActivePricesByEbooks plural). The Mongo EbookPrice shape is a subset of the PriceDto",
      "Mongo-only fields ABSENT from ws_ebook: isTrending/isPaid/examCountdownCategoryId/demoFileName/bookFileName. `isPaid` is DERIVED from plans (paid when ≥1 active plan price>0) — exactly the controller's documented fallback when the Mongo isPaid is absent (always, for SQL) → faithful. isTrending synthesized false",
      "Schema fix: ws_ebook description + author are nullable in the DDL but Prisma typed non-nullable → relaxed to optional. Field renames: terms_and_conditions→termsAndConditions, order_by→order, demo_url→demoUrl, book_url→bookUrl",
      "WIRED composition (listEbooksWithPlans / getEbookDetailWithPlans): active ebooks (name/author search + language filter) + active plans (commerce-price) + per-customer access window (commerce-ebook-sub.listActiveByCustomerForEbooks, strict status:true + endAt>now, latest wins). Computed details[]/isNew/isPurchased/daysLeft; the per-request deep link is supplied by a buildShareLink callback (HTTP concern stays in the controller). availablePromoCode always [] (ebooks aren't in the promo appliesTo model)",
      "Wired BEFORE the ObjectId guards (MySQL ebook/customer ids are int). C3: customerId resolved to int at the boundary",
    ],
  },
  {
    key: "catalog-material",
    label: "Catalog · Material (category navigation)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "Material / MaterialCategory",
    mysqlTable: "ws_material / ws_material_category",
    mongoCollection: "ws_materials / ws_material_categories",
    code: "src/modules/catalog-material (branches categories.controller.ts listMaterialCategoryChildren)",
    adminRoutes: "—",
    clientRoutes: "GET `/client/material-categories/:id/children` (wired, flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "226 materials, 5 material categories in staging",
    transformerNotes: [
      "SCOPED to category NAVIGATION only. Prisma Material + MaterialCategory models are clean (no schema fix)",
      "⚠ Item listing (listMaterialsByCategory) stays BLOCKED — its entitlement helper getPurchasedMaterialIds joins LiveCourse + LiveCourseSubscription (unmigrated) + the Mongo-only embedded materialCategories.category[] arrays on Course/Package/LiveCourse; ws_material also has no isPaid column. Not reproducible from SQL this pass",
      "STRUCTURAL TRANSLATION: the Mongo MaterialCategory.childCategoryIds[] embed has NO SQL column — children resolve via the SQL `parent` self-FK (WHERE parent=id). havingChildDirectory = ≥1 row with parent=this.id (one distinct query, not N)",
      "getCategoryChildren: parent + active children (order_by) + per-child active-material count + havingChildDirectory. Wired before the ObjectId guard (MySQL category id is int)",
    ],
  },
  {
    key: "catalog-book",
    label: "Catalog · Book (physical-book store reads)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "Book",
    mysqlTable: "ws_book",
    mongoCollection: "ws_books",
    code: "src/modules/catalog-book",
    adminRoutes: "—",
    clientRoutes: "—  (book DATA reads built; NOT wired — needs book-order/cart on same id-space; flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "10 books in staging",
    transformerNotes: [
      "FLAG OFF + NOT WIRED (like catalog-package): listBooks/getBookDetail enrich each book with per-customer cart qty (ws_book_cart*) + isPurchased (ws_book_order* by status) — those order/cart tables are NOT migrated. With book on int ids + orders on Mongo ObjectIds the keys can't match → flips with the book-order/cart wave",
      "Module supplies book DATA + the data-only computed fields: isPaid (discountedPrice>0), key (isCombo?combo:individual), daysLeft (null — one-time purchase), isNew (createdAt window); the per-request deep link via a buildShareLink callback. Order/cart-derived qty + isPurchased are left to the caller",
      "Schema fix: ws_book.order_by nullable in the DDL but Prisma typed non-null → relaxed to Int?",
      "Mongo-only fields ABSENT from ws_book: packageIds[] (embedded M:N for the package-detail material(Book) tab — appliesTo-style, not reproducible), examCountdownCategoryId, termsAndConditions, bookUrl, publication, deliveryEta, isTrending. isTrending synthesized false; publication/deliveryEta synthesized to the Mongo defaults",
      "Reads: getBookById / listBooksData (name+author search, language filter, order_by asc) / findBooksByIds (bulk hydration)",
    ],
  },
  {
    key: "offline-batch",
    label: "Offline · Center/Batch (browse reads)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "OfflineCenter / OfflineBatch",
    mysqlTable: "ws_offline_center / ws_offline_batch",
    mongoCollection: "ws_offline_centers / ws_offline_batches",
    code: "src/modules/offline-batch (branches offline.controller.ts listCenters/listBatches/getCenterDetail/getBatchDetail)",
    adminRoutes: "—",
    clientRoutes: "GET `/client/offline/centers` + `/batches` + `/centers/:id` + `/batches/:id` (wired, flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "3 centers, 3 batches in staging",
    transformerNotes: [
      "READ only. submitEnquiry (POST → ws_offline_enquiry) is a WRITE path, NOT built. getOfflineDashboard left on Mongo (also reads the unmigrated OfflineBannerSlider). Cities come from the offline-city module",
      "SCHEMA FIX (bigint overflow): OfflineCenter.phone was Int but the DDL is bigint (9099665555 overflows Int32) → would THROW on read; fixed to BigInt, DTO surfaces it as a STRING (Mongo stores phone as string). OfflineEnquiry.mobile also Int→BigInt (+ added created_at) for the future write path",
      "SCHEMA FIX (phantom column): NO `status` column on ws_offline_batch OR ws_offline_center, but the Mongo handlers all filter {status:true} and Prisma OfflineBatch.status was a phantom field (mapped nothing) → removed. MySQL branch drops the status filter (all rows active) + synthesizes status:true in the DTO",
      "image is a JSON column on ws_offline_center → mapped to Mongo `images: string[]`. SQL column TYPO: batch `discription` → Mongo `description`. center→city and batch→center→city relations populated",
      "Wired before the ObjectId guards (MySQL ids are int). Reads: listCenters (city+search), listBatches (center/city/upcoming/search), getCenterDetail (+nested batches), getBatchDetail; + dashboard helpers getCentersWithBatchesByCities / listUpcomingBatches",
    ],
  },
  {
    key: "catalog-exam",
    label: "Catalog · Exam (category navigation)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "Exam / ExamCategory",
    mysqlTable: "ws_exam / ws_exam_category",
    mongoCollection: "ws_exams / ws_exam_categories",
    code: "src/modules/catalog-exam (branches categories.controller.ts listExamCategoryChildren)",
    adminRoutes: "—",
    clientRoutes: "GET `/client/exam-categories/:id/children` (wired, flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "1 exam, 121 exam categories (118 active) in staging",
    transformerNotes: [
      "SCOPED to category NAVIGATION only (mirrors catalog-material). Item listing/attempt surface (questions/options/results + entitlement) NOT built this pass",
      "Schema fix: ExamCategory name/image nullable in the DDL but Prisma typed non-null → relaxed to String?",
      "DIFFERENCES vs material: display field is `name` (not `title`) — DTO sets BOTH title+name to the column (Mongo handler does `title: cat.name`); ws_exam_category has a `deleted` flag → active = status=true AND deleted=false; the per-child exam count is UNCONDITIONAL (countDocuments({categoryId}) with no status filter — Mongo parity)",
      "STRUCTURAL TRANSLATION: Mongo childCategoryIds[] embed → SQL parent_id self-FK (children = WHERE parent_id=id; havingChildDirectory via one distinct query). Wired before the ObjectId guard (MySQL category id is int)",
    ],
  },
  {
    key: "commerce-price",
    label: "Commerce · Price (plan/pricing lookup)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "PackageCourseEbookPrice",
    mysqlTable: "ws_package_course_ebook_price",
    mongoCollection: "ws_package_course_ebook_prices",
    code: "src/modules/commerce-price (+ ebook plural listActivePricesByEbooks)",
    adminRoutes: "—",
    clientRoutes: "—  (read-only lookup built; not wired; flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "1353 plan rows in staging",
    transformerNotes: [
      "FLAG OFF: Phase 3a read-only. Every price consumer joins int-id catalog (package/course/ebook) + ObjectId-id subscription/order rows → flips together with catalog + the rest of 3a in one consistent int id-space (the commerce-wave flip)",
      "Prisma PackageCourseEbookPrice is a FAITHFUL 1:1 of the SQL table (all 13 cols, correct @maps) — NO schema fix required",
      "DRIFT: owner cols (package_id/course_id/ebook_id) use `0` as the 'not this owner' sentinel, NOT only NULL — 927/1353 rows mix 0s + a real id. Transformer coalesces 0/null → null to match Mongo's null. Verified the >0 invariant holds: no row owns more than one entity",
      "duration is DAYS not months (e.g. the '12 Month' plan row has duration:365) — surfaced raw; endAt computation (planDuration asDays/setDate) is the Phase 3b write boundary's concern, not this lookup's. material_price null → 0 (Mongo default)",
      "Reads: findById / findActiveById / findByIds + listActiveBy{Package,Course,Ebook}(s), all active-only owner lists ordered by duration asc (mirrors the Mongo `.sort({duration:1})` plan listings)",
    ],
  },
  {
    key: "commerce-subscription",
    label: "Commerce · Subscription (READ — entitlement source of truth)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "PackageCourseSubscription",
    mysqlTable: "ws_package_course_subscription",
    mongoCollection: "ws_package_course_subscriptions",
    code: "src/modules/commerce-subscription",
    adminRoutes: "—",
    clientRoutes: "—  (READ entitlement checks built; not wired; flag OFF). Writes are 3b",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "2 subscriptions in staging",
    transformerNotes: [
      "FLAG OFF + READ-ONLY: entitlement source of truth. Writes (create/extend on payment) are Phase 3b (verify.controller). Joined by int catalog + int customer id-space, read by still-Mongo consumers (lecture/progress/dashboard/purchase-history) → flips with catalog + 3a",
      "SCHEMA FIX (bigint overflow): SQL `tracking` is bigint (~1.19e11, both staging rows overflow Int32) but Prisma mapped trackingId as Int? → would THROW on read. Fixed: PackageCourseSubscription.trackingId Int?→BigInt? + PackageCourseSubscriptionTracking.id Int→BigInt; regenerated v5.22.0. Transformer coerces bigint→number (lossless, < MAX_SAFE_INTEGER; null-guards >2^53)",
      "Mongo↔SQL NAME divergence (critical): Mongo `packageId` = the PLAN ref = SQL `pcb_id` (planId); Mongo `targetPackageId` = the actual package = SQL `package_id` (packageId). DTO uses Mongo names so consumer predicates port 1:1",
      "customer_id is INT here (C3 seam — varchar in order tables). In the migrated id-space the customer IS the int id, so the module takes/returns customerId as int; string→int resolution is the caller's boundary",
      "Mongo-only commerce/promo fields (promocodeId/promoterId/paidAmount/paymentStatus/razorpay*) are NOT on this table (order row / 3b) → not produced. Active entitlement = status=true AND end_at>now",
      "Reads: hasActive{Course,Package}Subscription + getActive… + findById + list{,Active}ByCustomer + countActiveBy{Package,Course} — mirror the dominant Mongo access-gate predicates",
    ],
  },
  {
    key: "commerce-ebook-sub",
    label: "Commerce · eBook Subscription (READ — ebook entitlement)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "EBookSubscription",
    mysqlTable: "ws_ebook_subscription",
    mongoCollection: "ws_ebook_subscriptions",
    code: "src/modules/commerce-ebook-sub",
    adminRoutes: "—",
    clientRoutes: "—  (READ entitlement checks built; not wired; flag OFF). Writes are 3b",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "1 ebook subscription in staging",
    transformerNotes: [
      "FLAG OFF + READ-ONLY: ebook entitlement source of truth. Writes (create on payment) are Phase 3b. Joined on int catalog (ebook) + int customer id-space, read by still-Mongo consumers (ebook read/list, downloads, dashboard) → flips with catalog + 3a",
      "SCHEMA FIX: Prisma EBookSubscription model was MISSING `status` (tinyint, the entitlement flag) + `payment_type` (enum) that exist in the DDL — read contract impossible without `status`. Added `status Boolean?` + `payment_type PackageCourseEbookPaymentType`. Also relaxed `start_at`/`end_at` DateTime → DateTime? (DDL nullable). Regenerated v5.22.0",
      "Active = status≠false (NULL treated as active, matching the column default 1 + Mongo default) AND end_at>now, latest endAt wins. price Decimal→number; owner `0` sentinel → null",
      "customer_id is INT (C3 seam, same as package subscription) — module takes/returns customerId as int. Mongo-only promo fields (promocodeId/promoterId/referrerId) are on the order row / 3b → not produced",
      "Reads: hasActiveEbookSubscription + getActive… + findById + findByOrderId + list{,Active}ByCustomer + countActiveByEbook — mirror the Mongo `findOne({customerId, ebookId, status:true, endAt:{$gt:now}})` access gate",
    ],
  },
  {
    key: "commerce-promoter",
    label: "Commerce · Promoter (READ — promocode owner master)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "Promoter",
    mysqlTable: "ws_promoter",
    mongoCollection: "ws_promoter",
    code: "src/modules/commerce-promoter",
    adminRoutes: "—",
    clientRoutes: "—  (READ master; not wired; flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "114 promoters in staging",
    transformerNotes: [
      "FLAG OFF + READ-ONLY: promocode owner master. int (MySQL) vs ObjectId (Mongo) ids join still-Mongo promocode/subscription consumers → flips with catalog + 3a",
      "SECURITY: `password` exists on the row (full entity, like ws_course_educator) but is NEVER surfaced in the DTO (Mongo model marks it select:false)",
      "SCHEMA FIX: full_name/email/phone are nullable in the DDL but Prisma typed them non-nullable String → relaxed to String? (no NULLs in current data; guards a future NULL)",
      "Name casing: Mongo camelCase (fullName/isDelete); DTO uses Mongo names. Active = status=true AND is_delete=false. Mongo lastLoginDate/lastLoginIp ≠ SQL last_seen_at → not produced",
      "Reads: findById / findActiveById / findByIds (bulk owner hydration) / listActive (name+email search)",
    ],
  },
  {
    key: "commerce-promocode",
    label: "Commerce · Promocode (READ — SQL-faithful, NOT the client appliesTo model)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "Promocode / PromotedPackageCourseEbook",
    mysqlTable: "ws_promocode / ws_promoted_package_course_ebook",
    mongoCollection: "ws_promo_codes / (embedded)",
    code: "src/modules/commerce-promocode",
    adminRoutes: "—",
    clientRoutes: "—  (SQL-faithful reads built; CANNOT serve client applyPromocode; flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "2 promocodes + 5 promoted plans in staging",
    transformerNotes: [
      "⚠ MODEL DIVERGENCE: the live Mongo PromoCode (ws_promo_codes) uses discountType/discountValue + appliesTo{type,ids[]}; the SQL tables have NONE of those — the discount is a per-plan promoter%/customer% split in ws_promoted_package_course_ebook (keyed by pcb_price_id=plan). The client applyPromocode/listPromocodes read the Mongo appliesTo shape, which CANNOT be reproduced from SQL. So this builds SQL-faithful reads ONLY, flag OFF (decision 2026-06-12); appliesTo reconciliation is a later effort",
      "SCHEMA FIX: promocode/promo_start_at/promo_expire_at are nullable in the DDL but Prisma typed them non-nullable → relaxed to optional. title/description NOT NULL in DDL but Prisma optional (safe direction)",
      "Valid = status=true AND promo_start_at<now<promo_expire_at; public listings add type='public', soonest-to-expire first. Code lookup uppercases (Mongo parity). Promoted plans included on single-promocode reads",
      "Reads: findById (w/ plans) / findValidByCode / listActivePublic + countActivePublic (paginated) / listPromotedPlans",
    ],
  },
  {
    key: "commerce-educator",
    label: "Commerce · Educator (READ — full entity master)",
    phase: 3,
    migratedOn: "2026-06-12",
    prismaModel: "CourseEducator",
    mysqlTable: "ws_course_educator",
    mongoCollection: "ws_course_educators",
    code: "src/modules/commerce-educator",
    adminRoutes: "—",
    clientRoutes: "—  (READ master + ref projection; not wired; flag OFF)",
    testScript: "—  (flag OFF; verified via live-DB tsx test)",
    rowCountHint: "56 educators in staging",
    transformerNotes: [
      "FLAG OFF + READ-ONLY: a FULL entity (email/password/about/view/last_seen_at), NOT a join table (it was mis-grouped as a 'catalog relation' earlier). int (MySQL) vs ObjectId (Mongo) ids join still-Mongo course/educator consumers → flips with catalog + 3a (final 3a read module)",
      "SECURITY: `password` (NOT NULL) on the row but NEVER surfaced — the client educator path does `.select('-password')`. DTO excludes it; the ref projection is `{_id,name,image}` only",
      "⚠ LATENT RISK (logged, deliberately NOT fixed): `id` is `bigint unsigned` but Prisma maps it `Int`. Current ids 20–85 (56 rows) → no overflow. Changing to BigInt would ripple into the Course.courseEducatorId FK + the built catalog-course module for zero present benefit — revisit (educator + Course FK together) only if ids approach 2^31",
      "image nullable in DDL but Prisma non-nullable String → DTO surfaces image:string|null defensively (no NULLs in data). SQL `deleted` flag does NOT exist (Mongo soft-delete has no SQL counterpart) → active = status=true is the sole gate. last_seen_at/email_verified_at omitted (not needed for the public master)",
      "Reads: findById / findActiveById / findByIds (bulk course-educator hydration) / listActive (name search) / findRefById ({_id,name,image} embed)",
    ],
  },
] as const;

function numberedTable(headers: string[], rows: string[][], start = 1): string {
  const sep = headers.map(() => "---").join("|");
  return `| # | ${headers.join(" | ")} |\n|---:|${sep}|\n${rows.map((c, i) => `| ${start + i} | ${c.join(" | ")} |`).join("\n")}`;
}

function main() {
  const envActive = (process.env.MIGRATION_MYSQL_MODULES ?? MIGRATED_REGISTRY.map((m) => m.key).join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const modules = MIGRATED_REGISTRY.filter((m) => envActive.includes(m.key));
  const registryKeys = MIGRATED_REGISTRY.map((m) => m.key).join(",");

  const summaryRows = MIGRATED_REGISTRY.map((m) => [
    `\`${m.key}\``,
    m.label,
    `\`${m.mysqlTable}\``,
    `\`${m.mongoCollection}\``,
    envActive.includes(m.key) ? "✅ enabled" : "⏸ not in env",
    `[Detail](#${m.key})`,
  ]);

  let sections = "";
  let n = 0;
  for (const m of MIGRATED_REGISTRY) {
    n++;
    const enabled = envActive.includes(m.key);
    sections += `\n## ${n}. ${m.label} {#${m.key}}\n\n`;
    sections += `| | |\n|---|---|\n`;
    sections += `| **Module key** | \`${m.key}\` |\n`;
    sections += `| **Phase** | ${m.phase} |\n`;
    sections += `| **Migrated** | ${m.migratedOn} |\n`;
    sections += `| **Status** | ${enabled ? "✅ Active when listed in `MIGRATION_MYSQL_MODULES`" : "⏸ Implemented; add \`${m.key}\` to env to enable"} |\n`;
    sections += `| **Prisma model** | \`${m.prismaModel}\` |\n`;
    sections += `| **MySQL table** | \`${m.mysqlTable}\` |\n`;
    sections += `| **Mongo collection (legacy app)** | \`${m.mongoCollection}\` |\n`;
    sections += `| **Code** | \`${m.code}/\` |\n`;
    sections += `| **Data** | ${m.rowCountHint} |\n`;
    sections += `| **Smoke test** | \`${m.testScript}\` |\n`;
    sections += `| **Admin API** | ${m.adminRoutes} |\n`;
    sections += `| **Client API** | ${m.clientRoutes} |\n`;
    sections += `\n**Transformer / schema notes:**\n\n`;
    for (const note of m.transformerNotes) {
      sections += `- ${note}\n`;
    }
    sections += `\n**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for \`${m.prismaModel}\`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)\n`;
  }

  const md = `# Migrated modules (MySQL / Prisma)

> **Generated:** ${new Date().toISOString().slice(0, 10)} — re-run \`yarn docs:migrated-modules\` when you add a module  
> **Scope:** Only modules with **repository → service → transformer** on **legacy MySQL** tables  
> **Enable in runtime:** \`MIGRATION_MYSQL_MODULES\` in \`.env\`

---

## Summary

| | |
|---|---|
| **Total migrated (code complete)** | ${MIGRATED_REGISTRY.length} |
| **Active in env** (this generation) | \`${envActive.join(", ") || "(none)"}\` |
| **Full registry keys** | \`${registryKeys}\` |

${numberedTable(
  ["Module key", "Label", "MySQL table", "Mongo collection", "Env", "Detail"],
  summaryRows
)}

---

## Environment

\`\`\`env
DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
MIGRATION_MYSQL_MODULES=${registryKeys}
\`\`\`

- Toggle: \`src/config/migration.ts\` → \`isMysqlModule("<key>")\`
- Prisma connects at boot when \`MIGRATION_MYSQL_MODULES\` is non-empty (\`src/index.ts\`)
- Unlisted modules still use **MongoDB** (Mongoose)

---

## Module details
${sections}
---

## Adding the next module

1. Implement \`src/modules/<name>/\` (repository, service, transformer).
2. Wire controllers with \`isMysqlModule("<key>")\`.
3. Add an entry to \`MIGRATED_REGISTRY\` in \`scripts/generate-migrated-modules.ts\`.
4. Run \`yarn docs:migrated-modules\`, \`yarn docs:schema-comparison\`, \`yarn docs:field-comparison\`.
5. Log tests in [MIGRATION_TEST_LOG.md](./MIGRATION_TEST_LOG.md) before expanding \`MIGRATION_MYSQL_MODULES\`.

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
`;

  fs.writeFileSync(OUT_PATH, md + "\n");
  console.log(`Wrote ${OUT_PATH} (${MIGRATED_REGISTRY.length} modules)`);
}

main();
