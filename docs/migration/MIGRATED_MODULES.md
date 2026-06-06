# Migrated modules (MySQL / Prisma)

> **Generated:** 2026-06-06 — re-run `yarn docs:migrated-modules` when you add a module  
> **Scope:** Only modules with **repository → service → transformer** on **legacy MySQL** tables  
> **Enable in runtime:** `MIGRATION_MYSQL_MODULES` in `.env`

---

## Summary

| | |
|---|---|
| **Total migrated (code complete)** | 9 |
| **Active in env** (this generation) | `app-update, version, faq, banner-slider, testimonial, department, terms, popup, customer-auth` |
| **Full registry keys** | `app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth` |

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

---

## Environment

```env
DATABASE_URL=mysql://root:websankul_dev@127.0.0.1:3307/websankul_staging
MIGRATION_MYSQL_MODULES=app-update,version,faq,banner-slider,testimonial,department,terms,popup,customer-auth
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

