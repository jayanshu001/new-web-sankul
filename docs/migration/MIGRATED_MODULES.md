# Migrated modules (MySQL / Prisma)

> **Generated:** 2026-06-11 — re-run `yarn docs:migrated-modules` when you add a module  
> **Scope:** Only modules with **repository → service → transformer** on **legacy MySQL** tables  
> **Enable in runtime:** `MIGRATION_MYSQL_MODULES` in `.env`

---

## Summary

| | |
|---|---|
| **Total migrated (code complete)** | 18 |
| **Active in env** (this generation) | `app-update, version, faq, banner-slider, testimonial, department, terms, popup, customer-auth, customer-lookups, offline-city` |
| **Full registry keys** | `app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth,customer-lookups,customer-address,customer-profile,customer-bank-account,offline-city,catalog-package-type,catalog-package,catalog-course,catalog-video` |

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
| 11 | `customer-address` | Customer Address | `ws_customer_address` | `ws_customer_addresses` | ⏸ not in env | [Detail](#customer-address) |
| 12 | `customer-profile` | Customer Profile | `ws_customer` | `ws_customers` | ⏸ not in env | [Detail](#customer-profile) |
| 13 | `customer-bank-account` | Customer Bank Account | `ws_customer_bank_account` | `ws_customer_bank_accounts` | ⏸ not in env | [Detail](#customer-bank-account) |
| 14 | `offline-city` | Offline City | `ws_offline_city` | `ws_offline_cities` | ✅ enabled | [Detail](#offline-city) |
| 15 | `catalog-package-type` | Catalog · Package Type | `ws_package_type` | `ws_package_types` | ⏸ not in env | [Detail](#catalog-package-type) |
| 16 | `catalog-package` | Catalog · Package | `ws_package` | `ws_packages` | ⏸ not in env | [Detail](#catalog-package) |
| 17 | `catalog-course` | Catalog · Course | `ws_course / ws_course_subject_category` | `ws_courses / coursesubjectcategories` | ⏸ not in env | [Detail](#catalog-course) |
| 18 | `catalog-video` | Catalog · Video (+ URL-encryption contract) | `ws_video / ws_video_category` | `videos / videocategories` | ⏸ not in env | [Detail](#catalog-video) |

---

## Environment

```env
DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
MIGRATION_MYSQL_MODULES=app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth,customer-lookups,customer-address,customer-profile,customer-bank-account,offline-city,catalog-package-type,catalog-package,catalog-course,catalog-video
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
| **Status** | ⏸ Implemented; add `${m.key}` to env to enable |
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
| **Status** | ⏸ Implemented; add `${m.key}` to env to enable |
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
| **Status** | ⏸ Implemented; add `${m.key}` to env to enable |
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
| **Status** | ⏸ Implemented; add `${m.key}` to env to enable |
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
| **Status** | ⏸ Implemented; add `${m.key}` to env to enable |
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
| **Status** | ⏸ Implemented; add `${m.key}` to env to enable |
| **Prisma model** | `Course / CourseSubjectCategory` |
| **MySQL table** | `ws_course / ws_course_subject_category` |
| **Mongo collection (legacy app)** | `ws_courses / coursesubjectcategories` |
| **Code** | `src/modules/catalog-course (branches src/client/course/course.controller.ts listCourseCategoriesHandler)/` |
| **Data** | 1 course + 1 subject category in staging |
| **Smoke test** | `—  (flag OFF; verified via live-DB tsx test)` |
| **Admin API** | — |
| **Client API** | GET `/api/v1/client/courses/categories` (wired, flag OFF) |

**Transformer / schema notes:**

- FLAG OFF: course/subject-category ids int (MySQL) vs ObjectId (Mongo); still-Mongo listing/detail/dashboard consumers join those ids, and listing endpoints need commerce-wave joins (plans/subscriptions) + Mongo-only category groups. Flip with commerce
- Schema fix: Course.image String → String? (live DDL nullable); regenerated
- ws_course cols with no Prisma mapping: is_featured/purchase (enum 0/1), featured_order — Mongo has conceptual isPopular/isPaid + Mongo-only subtitle/embedded category groups; SQL enums not surfaced
- listCourseCategoriesHandler branched on isCourseMysql() with per-category active-course counts (Prisma groupBy)

**Field matrix:** [FIELD_COMPARISON.md](./FIELD_COMPARISON.md) (search for `Course / CourseSubjectCategory`) · **Inventory row:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md)

## 18. Catalog · Video (+ URL-encryption contract) {#catalog-video}

| | |
|---|---|
| **Module key** | `catalog-video` |
| **Phase** | 3 |
| **Migrated** | 2026-06-11 |
| **Status** | ⏸ Implemented; add `${m.key}` to env to enable |
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

