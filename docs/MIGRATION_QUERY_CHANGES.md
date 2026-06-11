# Migration Query / Schema / Index Changes

> Append-only log of query, schema, index, and migration changes. **Newest first.**

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
