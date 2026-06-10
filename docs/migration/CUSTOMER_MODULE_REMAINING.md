# Customer Module — Remaining Migration Scope

> **Created:** 2026-06-10
> **Status (2026-06-10):** Customer Module surface **fully built**. Auth + Lookups **live**; Profile, Address, Bank-account dual-pathed with **flags OFF** (blocked only by non-customer deps); Shipping is part of cart/order checkout (not standalone). See §7.
> **Strategy reference:** [`legacy_system_migration_strategy.md`](./legacy_system_migration_strategy.md) · [`MIGRATED_MODULES.md`](./MIGRATED_MODULES.md)

This doc scopes the **next migration step** for the Customer Module: the three highest-value
sub-modules (**profile**, **address/shipping**, **lookups**) plus the dependent
**bank-account** / **target-goal** reads. Each follows the established
`repository → service → transformer` + `isMysqlModule("<key>")` dual-path pattern.

---

## 0. Current state (verified)

| Sub-module | SQL table(s) | Prisma model | MySQL code path | Env flag | Status |
|---|---|---|---|---|---|
| Auth (OTP/token) | `ws_customer`, `ws_customer_otp`, `ws_customer_access_token` | `Customer`, `CustomerOtp`, `CustomerAccessToken` | ✅ `auth.service.ts` + `customer-auth.repository.ts` | ✅ `customer-auth` | **Done** |
| Lookups (state/district/education/goal) | `ws_customer_state`, `ws_customer_distict`, `ws_customer_education`, `ws_customer_target_goal` | all 4 present | ✅ `customer-lookups.service.ts` + repo | ✅ `customer-lookups` (2026-06-10) | **Done — wired (`getStates`/`getEducations`/`getCharacteristic`) + live** |
| Profile (get/update, picture, device token, delete, dashboard) | `ws_customer` | `Customer` | ❌ Mongoose only | ❌ none | **Not started** |
| Address / Shipping | `ws_customer_address`, `ws_customer_shipping` | `CustomerAddress`, `CustomerShipping` | ❌ Mongoose only | ❌ none | **Not started** |
| Bank account | `ws_customer_bank_account` | `CustomerBankAccount` | ❌ Mongoose only | ❌ none | **Not started** |

---

## 1. Blockers & schema fixes (do these FIRST)

These must be resolved before any MySQL path will run correctly.

### 1.1 `CustomerAddress` phone overflow + phantom columns ✅ **RESOLVED 2026-06-10**
`prisma/schema.prisma` → `model CustomerAddress`:
- `phone`/`alternate_phone` changed `Int` → **`BigInt`** (10-digit numbers like `9664796376` overflowed `Int` max 2,147,483,647). Verified: `8160530058` now reads cleanly from the live DB.
- `label`, `is_default` (`isDefault`), `city_id` (`cityId`) — the **live DB has these columns** (confirmed via `DESCRIBE ws_customer_address`), so per decision **"Keep columns (match DB)"** they remain in the Prisma model (`label String?`, `isDefault Boolean? @default(false) @map("is_default")`, `cityId Int? @map("city_id")`). Default-address + label + city features can migrate to MySQL with no loss. (Note: these 3 columns are NOT in the original `websankul_staging.sql` dump — the live DB diverges from the dump; keep them.)
- Prisma client regenerated (v5.22.0) and verified against the live DB.

### 1.2 `CustomerShipping` model ✅ **already present**
`model CustomerShipping` exists, `@@map("ws_customer_shipping")`. Phone/alternate_phone also changed `Int` → **`BigInt`** (same overflow fix).

### 1.3 `facebook_id` unmapped on `Customer`
`ws_customer.facebook_id` is not in the Prisma `Customer` model. Confirm whether FB login/linking is live; if so add `facebookId String? @map("facebook_id")`, else document as intentionally dropped.

### 1.4 `goal` representation differs (Mongo embedded vs MySQL JSON)
- SQL: `ws_customer.goal` is a JSON array of **integer** target-goal IDs (`[1, 2]`) → joined to `ws_customer_target_goal`.
- Mongo: `goals` is an array of **ObjectIds** resolved against embedded `Goal.labels` subdocuments via `$unwind`/`$match`.
- The MySQL profile path must read `goal` JSON, then `prisma.customerTargetGoal.findMany({ where: { id: { in: ids } } })` to hydrate `{ id, name }`. **Do not** reuse the Mongo `Goal.aggregate` logic.

### 1.5 `firebaseToken` / device tokens differ
- SQL: single `device` TEXT column (`Customer.firebaseToken @map("device")`).
- Mongo: embedded `firebaseTokens[]` array with per-device `{ token, platform, updatedAt }`.
- Multi-device push relies on the array. On MySQL the single `device` column **cannot hold multiple device tokens** as-is. Options: (a) store newest token only (lossy, matches legacy), or (b) add a `ws_customer_device_token` child table. **Pick one and document it** — this affects `registerDeviceToken` / `unregisterDeviceToken` / `updateCustomerFirebaseToken`.

### 1.6 Dashboard counts cross not-yet-migrated collections
`dashboard.controller.ts` aggregates `CustomerAddress`, `PackageCourseSubscription`, `FolderItem`, `Notification`, `ExamResult`. Only addresses are in-scope here. **Keep the dashboard on Mongo until those modules migrate**, OR migrate only the `savedAddresses` count and leave the rest reading Mongo (mixed-read is acceptable per phase strategy but must be intentional).

---

## 2. Module 1 — `customer-lookups` ✅ **DONE (2026-06-10)**

Service/repo/transformer/types were already written and dual-pathed. Wired + enabled this session.

1. ✅ **Wired routes to the service.** `src/client/address/address.controller.ts` `getStates` / `getEducations` / `getCharacteristic` (educations) now branch on `isMysqlModule("customer-lookups")` → `customer-lookups.service` (Prisma) when on, Mongoose otherwise. DTOs projected to the exact Mongo contract.
2. ✅ Added `customer-lookups` to `MIGRATION_MYSQL_MODULES` in `.env` + `.env.example`.
3. ✅ Smoke-tested against live DB: states 12 / educations 10, shapes match, BigInt phone reads clean.

**Outstanding (not blocking):** admin lookup CRUD (if any) still calls models directly — route it through the service when admin lookups are migrated. District/target-goal client endpoints aren't currently exposed; the service supports them when needed.

**Acceptance:** ✅ lookup endpoints return identical DTOs from MySQL; `customer-lookups` enabled in env.

---

## 3. Module 2 — `customer-address` 🟡 **CODE COMPLETE, flag OFF (2026-06-10)**

Built this session. **Flag intentionally NOT enabled** — runtime stays on Mongo until OfflineCity
+ cart checkout migrate (cart resolves `cityId` → `OfflineCity.name`, and the two backends use
different id spaces: ObjectId vs int FK). Decision: **"Build, flag stays OFF."**

Files added (mirror `customer-auth` layout):
- ✅ `src/modules/customer-address/customer-address.repository.ts` — Prisma CRUD on `customerAddress` (list/find/create/update/soft-delete/setDefault). Phone string→BigInt, pincode string→Int conversions; owner-scoped queries; `setDefault` wrapped in `$transaction`.
- ✅ `src/modules/customer-address/customer-address.transformer.ts` — row → DTO (BigInt/int → string ids/phones to stay Mongo-shape-compatible; no nested populate).
- ✅ `src/modules/customer-address/customer-address.types.ts` — DTO + input types, with contract-divergence notes.
- ✅ `src/modules/customer-address/customer-address.service.ts` — dual-path entry (`isAddressMysql()`), uniform `{ ok, status, data|message }` envelope.
- ✅ Branched all 6 handlers in `src/client/address/address.controller.ts` with `isAddressMysql()`.
- ✅ Added `createAddressSchemaMysql` / `updateAddressSchemaMysql` (integer FK ids, freeform label) in `address.validation.ts`.

Resolved watch-outs:
- ✅ `BigInt` phone serialized to string in the transformer.
- ✅ `setDefaultAddress` uses the `is_default` column (kept per §1.1) + transaction.
- ✅ `userId` (`user_id`) is the int FK to `ws_customer.id`.
- ⚠️ **`city` column is NOT NULL** and is what legacy data actually populates (`city_id` is NULL in the dump). Added a required `city` string to input/DTO/validation. Caught by the live-DB CRUD test.

**Verified (live DB):** full create→list→setDefault→update→soft-delete cycle for customer 472341; BigInt phone `9664796376` round-trips; test row cleaned up.

**Acceptance:** ✅ address CRUD + default works on MySQL with a stable contract. **NOT enabled** pending OfflineCity/cart. Shipping repo/service still TODO (no client shipping endpoints today).

---

## 4. Module 3 — `customer-profile` 🟡 **CODE COMPLETE, flag OFF (2026-06-10)**

Built this session. **Flag intentionally NOT enabled** — the profile dashboard aggregates
not-yet-migrated collections (folders, subscriptions, notifications, exam results), so it stays on
Mongo per §1.6. Decisions taken: name = **split full_name** (join on write); device = **single
`device` token** (legacy parity); isProfileCompleted = **derived** (full_name present); facebookId =
**mapped read-only** (added to Prisma `Customer`).

Files added (`src/modules/customer-profile/`):
- ✅ `customer-profile.name.ts` — full_name ↔ first/middle/last split/join helpers.
- ✅ `customer-profile.types.ts` — ProfileDto (exact Mongo contract) + update input.
- ✅ `customer-profile.repository.ts` — Prisma on `ws_customer`: find/update/soft-delete, goal hydration via `ws_customer_target_goal`, single-token device set/clear/by-phone.
- ✅ `customer-profile.transformer.ts` — row + goals → ProfileDto (name split, derived `isProfileCompleted`).
- ✅ `customer-profile.service.ts` — 9 fns, `{ ok, message, data }` envelope.
- ✅ Branched all 8 fns in `src/client/profile/customer.service.ts` on `isProfileMysql()` (get/update keep the same Redis cache; picture upsert/delete keep S3 cleanup via returned `previousUrl`; delete-account revokes MySQL tokens via `customerAuthRepository.deactivateTokens`).
- ✅ Added `facebookId String? @default("0") @map("facebook_id")` to Prisma `Customer`; regenerated client.

Schema/data notes:
- `ws_customer` has single `full_name`, `goal` JSON int array, single `device` text, `facebook_id`; **no** first/middle/last or `is_profile_completed` columns → handled per decisions above.
- **Dashboard** (`dashboard.controller.ts`) left on Mongo (cross-module deps not migrated) — untouched.

**Verified (live DB, customer 472347):** `"DIXIT PATEL"` → `["DIXIT","","PATEL"]`; goals `[7,8,12,13,14]` hydrate to named DTOs in order; `isProfileCompleted=true`; `isNewUser=false`; `facebook_id` not leaked; update name-join + goals rewrite, then restored. Name split/join edge cases (1/2/3/4-token, empty, partial update) verified.

**Acceptance:** ✅ profile get/update/picture/delete/device-token return the same contract on MySQL. **NOT enabled** pending dashboard cross-module migration.

---

### (original scope notes below)
**Effort: ~2 days.** Largest surface; depends on §1.3–1.6.

- `src/modules/customer-profile/customer-profile.repository.ts` — Prisma read/update on `customer`.
- `customer-profile.transformer.ts` — row → the exact `profile` object the login endpoint returns (field-for-field parity is critical; frontend keys off `isProfileCompleted`, `isNewUser`, `goals[]`).
- Branch `src/client/profile/customer.service.ts`:
  - `getCustomerProfile` / `updateCustomerProfile` — JSON `goal` hydration via §1.4.
  - `upsertCustomerProfilePicture` / `deleteCustomerProfilePicture` — write `profile_picture` column; keep S3 cleanup + Redis invalidation.
  - `deleteCustomerAccount` — soft-delete (`is_account_deleted`, `status`) + deactivate tokens (reuse `customerAuthRepository.deactivateTokens`).
  - device-token handlers — per §1.5 decision.
- Email-uniqueness check → `prisma.customer.findFirst({ where: { emailAddress, id: { not }, isAccountDeleted: false } })`.
- `isProfileComplete()` lives on the Mongo model — port the completion rule into the transformer/service.
- **Dashboard:** leave on Mongo (see §1.6) or migrate `savedAddresses` count only.
- Keep the existing **Redis cache keys/TTL** unchanged so cache behavior is identical.

**Acceptance:** profile get/update/picture/delete/device-token return byte-identical contracts on MySQL; goals hydrate from `ws_customer_target_goal`; cache still invalidates.

---

## 5. Module 4 — `customer-bank-account` (small)

**Effort: ~½ day.** Only needed if referral payout reads it.
- Repo + service dual-path on `customerBankAccount` (`ws_customer_bank_account`).
- Branch wherever bank accounts are read/written (referral flow). See [`BANK_ACCOUNTS_CLIENT.md`](../BANK_ACCOUNTS_CLIENT.md).

---

## 6. Suggested order & rollout

1. **§1 schema fixes** (Prisma `CustomerAddress` BigInt + drop phantom cols; add `CustomerShipping`; decide goal/device/facebook). — *prerequisite*
2. **customer-lookups** — wire + enable (lowest risk, code exists).
3. **customer-address** — enable after lookups (address UI uses lookup dropdowns).
4. **customer-profile** — enable last (largest, touches dashboard).
5. **customer-bank-account** — alongside or after profile.

Per established pattern: build with flag **off**, verify parity Mongo-vs-MySQL, then add the key to `MIGRATION_MYSQL_MODULES`. Update [`MIGRATED_MODULES.md`](./MIGRATED_MODULES.md) and [`MIGRATION_TRACKER.md`](./MIGRATION_TRACKER.md) per module, and log results in [`MIGRATION_TEST_LOG.md`](./MIGRATION_TEST_LOG.md).

---

## 7. Definition of "Customer Module fully migrated"

- [x] §1 schema fixes landed — CustomerAddress/CustomerShipping BigInt phones; address `label`/`isDefault`/`cityId` kept to match live DB (2026-06-10). *Still open:* goal (JSON ints vs ObjectIds), device tokens (single `device` col vs `firebaseTokens[]`), `facebook_id` — needed for profile, §1.3–1.6.
- [x] `customer-lookups` wired to routes + enabled (2026-06-10)
- [x] `customer-address` dual-pathed (2026-06-10) — **flag OFF** pending OfflineCity/cart
- [x] `customer-profile` dual-pathed (2026-06-10) — **flag OFF** pending dashboard cross-module migration; goal/device/facebook/name decisions encoded
- [x] `customer-bank-account` dual-pathed (2026-06-10) — 4 CRUD handlers branched, verified on live DB; **flag OFF** (withdrawal/referral flow Mongo-coupled)
- [x] Shipping assessed (2026-06-10): **NOT an independent customer piece.** `CustomerShipping` is an internal checkout snapshot created/read inside cart + course-order flows and embedded into orders/subscriptions (`.populate("customerShippingId")`). It migrates WITH cart/orders, not as part of the Customer Module. Prisma `CustomerShipping` (BigInt phones) is ready for that future work.
- [x] All migrated paths verified against the live DB (lookups, address, profile, bank-account)
- [x] Tracker + migrated-modules docs updated

### Result: the Customer Module's own surface is **fully built**
Every customer-owned table now has a MySQL path:

| Sub-module | Code | Flag | Why not enabled |
|---|---|---|---|
| Auth | ✅ | ✅ **live** | — |
| Lookups | ✅ | ✅ **live** | — |
| Profile | ✅ | ⚪ off | dashboard aggregates non-customer collections (folders/subs/notifications/exams) |
| Address | ✅ | ⚪ off | `cityId` → OfflineCity (Mongo); cart checkout resolves it |
| Bank account | ✅ | ⚪ off | withdrawal/referral flow + reward-points txn are Mongo |
| Shipping | ➖ | — | not standalone — part of cart/order checkout |

The remaining flag-flips are gated by **other** modules (cart, orders, dashboard sources, referral),
not by any unbuilt customer code. Enabling each customer flag is safe once its non-customer
dependency migrates.
