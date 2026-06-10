# Migration Query / Schema / Index Changes

> Append-only log of query, schema, index, and migration changes. **Newest first.**

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
