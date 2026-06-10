# Offline Module — Migration Scope

> **Created:** 2026-06-10
> **Why now:** `customer-address` is built but **flag OFF** because its `cityId` → `OfflineCity` (Mongo) and cart checkout resolves it to a city name. Migrating Offline unblocks enabling `customer-address` — the last runtime gap in the Customer Module.
> **Pattern:** `repository → service → transformer` + `isMysqlModule("<key>")` dual-path, per [`MIGRATION_DOC_UPDATES.md`](./MIGRATION_DOC_UPDATES.md) scenario A.

---

## 0. Tables & current state

| Table | Prisma model | Rows | Status |
|---|---|---|---|
| `ws_offline_city` | `OfflineCity` | (staging) | Prisma model exists |
| `ws_offline_center` | `OfflineCenter` | (staging) | Prisma model exists |
| `ws_offline_batch` | `OfflineBatch` | (staging) | Prisma model exists |
| `ws_offline_banner_slider` | `OfflineBannerSlider` | (staging) | Prisma model exists |
| `ws_offline_enquiry` | `OfflineEnquiry` | (staging) | Prisma model exists |

All five Prisma models already exist. **No module is wired or flagged yet** — every consumer uses Mongoose.

---

## 1. Blockers & schema fixes (do FIRST) ⚠️

The Prisma models drifted from the live DDL (same class of bug as the address table).

### 1.1 Phantom columns — Prisma declares fields the DDL lacks
- **`OfflineBatch.status`** — Prisma has `status Boolean`, but `ws_offline_batch` has **no `status` column**. Any Prisma read selecting it will fail.
- **`OfflineCity`** — Mongo model has `order` + `status`; the DDL has **neither**. Mongo code filters `{ status: true }` and sorts `{ order: 1 }` everywhere.
- **`OfflineBatch`** — Mongo filters `{ status: true, startAt: { $gt: now } }`; DDL has `start_at` but **no `status`**.

**Decision needed (D1):** these `status`/`order` columns exist in Mongo but not in the live MySQL.
- **(a) Add columns** to MySQL via DDL (`status TINYINT(1) DEFAULT 1`, `order INT DEFAULT 0`) so behavior matches Mongo exactly — diverges from the legacy dump (which never had them).
- **(b) Drop from Prisma/behavior** — treat all rows as active, drop `status`/`order` filters on the MySQL path; sort by `name` or `id`. Matches the legacy schema; changes client behavior (no active-gating, no manual order).
- **(c) Match live DB as-is** — remove `status` from Prisma `OfflineBatch`; don't filter by status/order on MySQL. (Same spirit as (b).)

### 1.2 `OfflineCenter.phone` Int → BigInt
DDL is `bigint`; Prisma has `phone Int`. 10-digit phones overflow. → change to `BigInt` (same fix as address/shipping). **No decision needed** — clearly a bug.

### 1.3 `image` shape differs
- `OfflineCenter.image` is **JSON** (array of urls) in both DDL and Prisma — OK.
- `OfflineCity.image` / `OfflineBatch.image` are single `VARCHAR(255)` — OK.

---

## 2. Surface to migrate (per consumer)

### 2a. Client browsing — `src/client/offline/offline.controller.ts` (public)
- `getOfflineDashboard` — banners + cities + upcoming batches (populated center→city)
- `listCenters` (+ `?cityId`) — centers, populated city
- `listBatches` (+ `?cityId`) — batches, populated center→city
- `getCenterDetail` / `getBatchDetail` — single + nested
- `submitEnquiry` — writes `OfflineEnquiry`

### 2b. Client cities/centers — `src/client/address/address.controller.ts`
- `listCities` — `OfflineCity.find({status:true}).sort(order)` → **this is the address blocker**
- `listCentersByCity` — centers + nested active batches

### 2c. Cart checkout — `src/client/cart/cart.controller.ts`
- `attachShippingToCart` resolves `address.cityId` → `OfflineCity.name` (line ~203). **This is the exact line that blocks `customer-address`.** Once OfflineCity is on MySQL with int ids, address `cityId` (int) resolves against it cleanly.

### 2d. Admin CRUD — `src/admin/offline/offline.controller.ts`
- Full CRUD for banners, cities, centers, batches (list/get/create/update/delete + reorder).

### 2e. Admin dashboard — `src/admin/dashboard/dashboard.controller.ts`
- Counts (cities/centers/batches) — read-only.

---

## 3. The id-space problem (key design point)

Same divergence as address: Mongo uses ObjectId ids; MySQL uses int ids. `OfflineCenter.cityId`,
`OfflineBatch.centerId`, and **`CustomerAddress.cityId`** all reference these.

**This is why Offline + address should flip together.** If OfflineCity goes MySQL (int ids) while
`customer-address` stays Mongo (ObjectId `cityId`), the cart's `cityId` resolution breaks. Plan:

1. Migrate Offline (city/center/batch) dual-path, **flag OFF**.
2. Migrate the cart `cityId`→cityName resolution to honor the offline flag.
3. Flip **`offline` + `customer-address` ON together** so the int-id space is consistent end-to-end.

**Decision needed (D2):** scope of this step —
- **(a) Cities + centers + batches + address-unblock** (full offline browse + admin + flip address). Largest, but actually finishes the Customer Module runtime.
- **(b) Cities only** (minimum to unblock address): migrate `OfflineCity` + the cart resolution + `listCities`, leave centers/batches/enquiry/admin on Mongo for a later offline pass. Smallest path to enabling `customer-address`.

---

## 4. Suggested order

1. **§1 schema fixes** (BigInt phone; resolve D1 status/order) — prerequisite.
2. **`offline-city`** repo/service/transformer + branch `listCities` + cart `cityId` resolution.
3. (if D2=a) **centers + batches** + the client browsing controller + admin CRUD.
4. **Flip `offline` (or `offline-city`) + `customer-address` ON together**; verify cart checkout end-to-end.
5. Enquiry write path (small) — can trail.

---

## 5. Decisions (resolved 2026-06-10)

- **D1 — status/order columns:** ✅ **Add to MySQL.** `status TINYINT DEFAULT 1` + `order INT DEFAULT 0` added to `ws_offline_city` via DDL; Prisma `OfflineCity` updated; client regenerated. Preserves Mongo active-gating + ordering.
- **D2 — scope:** ✅ **Cities only.** Built `offline-city` module; centers/batches/enquiry/admin stay on Mongo.
- **D3 — enable address now?:** ⚠️ **Changed to: enable `offline-city` only; keep `customer-address` OFF.** See §7 — the cart + course-order still **read** `CustomerAddress` via Mongoose with ObjectId `addressId`. Flipping address ON would break checkout. Address flip needs the cart/course address-read migrated too (scope expansion into commerce).

## 7. ⚠️ Blocker found: address flip needs cart/course address-READ migration

The address↔city↔cart **resolution** is built and verified (a MySQL address `cityId=2` resolves to `"Ahmedabad"` end-to-end). BUT enabling `customer-address` is **not** safe yet:

- `src/client/cart/cart.controller.ts:177` — `CustomerAddress.findOne({ _id: addressId })` (Mongoose, ObjectId).
- `src/client/course/course.service.ts:306` — `CustomerAddress.findOne(matchQuery)` (Mongoose).

If `customer-address` writes to MySQL (int ids) while these reads stay Mongo, the cart/course **can't find the address** → checkout breaks. So:

- ✅ **Enabled now:** `offline-city` (serves cities/`listCities` from MySQL + the cart `cityId`→name resolution honors the flag). Independently safe and useful.
- ⛔ **Still OFF:** `customer-address` — needs the cart (`attachShippingToCart`) and course-order (`addCourseOrderShipping`) address **reads** branched on `isAddressMysql()` first.

**Decision (2026-06-10): DEFER the `customer-address` flip to the commerce wave.**
Address is tightly coupled to cart / course-order / `CustomerShipping` — all still on Mongo. Flipping it
ON in isolation would mean migrating a slice of commerce (and touching checkout, a critical path) just
to enable one customer sub-module backed by 2 legacy rows. The end-goal is full MySQL (Mongo retires),
so address *will* flip — but **with the commerce wave** (cart/orders/shipping migrate together → consistent
int-id space → flip address + shipping + offline-center/batch then). The address **code is done and
verified**; only the enable is deferred. No checkout changes now.

---

## 6. Definition of done

- [ ] §1 schema fixes (BigInt phone; D1 resolved)
- [ ] `offline`(-city) dual-pathed; client `listCities` + cart `cityId` resolution honor the flag
- [ ] (if D2=a) centers/batches/enquiry/admin dual-pathed
- [ ] `offline`(+`customer-address`) enabled together; cart checkout verified end-to-end on MySQL
- [ ] Registry + schema-comparison generators updated; api-tests authored
- [ ] Test log + tracker + README updated; docs regenerated
