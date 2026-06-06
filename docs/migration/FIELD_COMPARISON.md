# Field comparison — module by module

> **Generated:** 2026-06-06 — re-run `yarn docs:field-comparison` after schema changes  
> **Sources:** `websankul_staging.sql`, `prisma/schema.prisma`, `src/models/**/*.model.ts`  
> **Related:** [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) (table inventory) · [legacy_system_migration_strategy.md](./legacy_system_migration_strategy.md)

---

## How to read

| Column | Meaning |
|--------|---------|
| **Legacy MySQL column** | Column name in staging dump (`websankul_staging`) |
| **MySQL type / constraints** | Parsed from `CREATE TABLE` + `ALTER TABLE` (PK, UNIQUE, NOT NULL, DEFAULT, enum) |
| **MongoDB field** | Mongoose schema field (camelCase) |
| **Prisma field** | Prisma model property; DB column via `@map` when different |
| **Match** | ✅ aligned · ⚠️ rename · 🆕 Mongo-only · 🆕 MySQL-only · 🆕 Prisma-only |

**Migrated modules (`MIGRATION_MYSQL_MODULES`):** `app-update, version, faq, banner-slider, testimonial, department, terms, popup`

---

## Table of contents (by module)

| # | Module | Entities | Jump |
|---:|---|---|---|
| 1 | System / CMS | 19 | [Jump](#module-system) |
| 2 | Admin & permissions | 5 | [Jump](#module-admin) |
| 3 | Customer & auth | 23 | [Jump](#module-customer) |
| 4 | Books & orders | 8 | [Jump](#module-book) |
| 5 | Courses, packages & video | 47 | [Jump](#module-course) |
| 6 | E-books | 8 | [Jump](#module-ebook) |
| 7 | Exams & results | 10 | [Jump](#module-exam) |
| 8 | Exam countdown | 2 | [Jump](#module-examCountdown) |
| 9 | Offline centers | 5 | [Jump](#module-offline) |
| 10 | Promoters | 2 | [Jump](#module-promoter) |
| 11 | Referral program | 6 | [Jump](#module-referral) |
| 12 | Test series | 6 | [Jump](#module-testSeries) |
| 13 | Educators | 1 | [Jump](#module-educator) |
| 14 | MySQL + Prisma only (no Mongoose) | 4 | [Jump](#module-mysql-only) |
| 15 | Laravel / infra (not in new API) | 7 | [Jump](#module-laravel-infra) |
| 16 | Other / uncategorized | 1 | [Jump](#module-other) |

---

<a id="module-system"></a>

## 1. System / CMS

> Module key: `system` — 19 entities

### 1.1 ActivityLog — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ActivityLog |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_activity_log` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/system/ActivityLog.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | null; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `event` | String | required; maxlength:100 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `entityType` | String | null; maxlength:50 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `entityId` | ObjectId | null | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `duration` | Number | null | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `metadata` | Record<string, unknown> | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `ip` | String | null; maxlength:100 | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `userAgent` | String | null; maxlength:500 | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 1.2 FaqType — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | FaqType |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_faq_types` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/system/FaqType.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 1.3 LiveBannerSlider — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveBannerSlider |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_banner_sliders` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/system/LiveBannerSlider.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `image` | String | required; maxlength:500 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `liveCourseId` | ObjectId | required; ref:LiveCourse | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `orderBy` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 1.4 Notification — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Notification |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_notifications` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/system/Notification.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `all` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `platforms` | ("ios" | "android")[] | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `courseIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `userIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `customerId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `title` | string | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `body` | string | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `image` | string | null | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `type` | string | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `deepLink` | string | null | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `data` | Record<string, unknown> | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `isRead` | boolean | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `readAt` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `broadcast` | boolean | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `status` | NotificationStatus | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `scheduledAt` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `sentAt` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `failureReason` | string | null | — | — | — | — | 🆕 Mongo-only |
| 19 | — | — | — | `recipientCount` | number | — | — | — | — | 🆕 Mongo-only |
| 20 | — | — | — | `audience` | INotificationAudience | — | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 1.5 SocialLink — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | SocialLink |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_social_links` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/system/SocialLink.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `typeId` | ObjectId | required; ref:SocialLinkType | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `title` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `icon` | String | maxlength:500 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `link` | String | required; maxlength:500 | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 1.6 SocialLinkType — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | SocialLinkType |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_social_link_types` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/system/SocialLinkType.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required; unique; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 1.7 TermsAndConditions — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | TermsAndConditions |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_terms_and_conditions` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/system/TermsAndConditions.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `module` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `terms` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `freeShippingMinimumOrderAmount` | Number | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `status` | Boolean | required; true | — | — | — | 🆕 Mongo-only |

### 1.8 AppUpdate — ✅ Migrated

| | |
|---|---|
| **Prisma model** | AppUpdate |
| **Legacy MySQL** | `ws_app_update` |
| **MongoDB** | `ws_app_updates` |
| **Post-migration MySQL** | `ws_app_update` |
| **Mongoose** | `src/models/system/AppUpdate.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `latestVersion` | `int` | NOT NULL | `latestVersion` | Number | required | `latestVersion` | Int | — | ✅ |
| 3 | `updateType` | `enum('immediate','flexible')` | NOT NULL; DEFAULT 'flexible'; enum('immediate','flexible') | `updateType` | UpdateType | — | `updateType` | UpdateType | @default(flexible) | ✅ |
| 4 | `isUpdateAvailble` | `tinyint(1)` | NOT NULL | — | — | — | `isUpdateAvailble` | Boolean | — | ⚠️ check |
| 5 | — | — | — | `isUpdateAvailable` | boolean | — | — | — | — | 🆕 Mongo-only |

### 1.9 BannerSlider — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | BannerSlider |
| **Legacy MySQL** | `ws_banner_slider` |
| **MongoDB** | `ws_banner_sliders` |
| **Post-migration MySQL** | `ws_banner_slider` |
| **Mongoose** | `src/models/system/BannerSlider.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `image` | `varchar(256)` | NOT NULL | `image` | String | required; maxlength:255 | `image` | String | @db.VarChar(255) | ✅ |
| 3 | `key` | `varchar(256)` | NULL; DEFAULT NULL | `key` | String | — | `key` | String? | @db.VarChar(255) | ✅ |
| 4 | `key_id` | `int` | NULL; DEFAULT NULL | `keyId` | ObjectId | — | `keyId` | Int? | @db.Int | ✅ |
| 5 | `order_by` | `int` | NOT NULL | `orderBy` | Number | required | `orderBy` | Int | — | ✅ |
| 6 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 7 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 8 | — | — | — | `keyRef` | String | — | — | — | — | 🆕 Mongo-only |

### 1.10 Department — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Department |
| **Legacy MySQL** | `ws_department` |
| **MongoDB** | `ws_departments` |
| **Post-migration MySQL** | `ws_department` |
| **Mongoose** | `src/models/system/Department.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(256)` | NOT NULL | `name` | string | — | `name` | String | — | ✅ |
| 3 | `decscription` | `varchar(256)` | NOT NULL | — | — | — | `decscription` | String | — | ✅ SQL+Prisma |
| 4 | `order` | `int` | NOT NULL; DEFAULT '0' | `order` | Number | required | `order` | Int | — | ✅ |
| 5 | `active` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `active` | Boolean | required | `active` | Boolean | — | ✅ |
| 6 | — | — | — | `mobile` | String | required; maxlength:20 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `description` | string | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `contacts` | IDepartmentContact[] | — | — | — | — | 🆕 Mongo-only |

### 1.11 DepartmentContact — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | DepartmentContact |
| **Legacy MySQL** | `ws_department_contact` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_department_contact` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `department` | `int` | NOT NULL | — | — | — | `department` | Int | — | ✅ SQL+Prisma |
| 3 | `mobile` | `varchar(20)` | NOT NULL | — | — | — | `mobile` | String | @db.VarChar(20) | ✅ SQL+Prisma |
| 4 | `isCallAvailable` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `isCallAvailable` | Boolean | — | ⚠️ check |
| 5 | `isWhatsAppAvailable` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `isWhatsAppAvailable` | Boolean | — | ⚠️ check |
| 6 | `order` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 7 | `active` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `active` | Boolean | — | ✅ SQL+Prisma |

### 1.12 DynamicImage — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | DynamicImage |
| **Legacy MySQL** | `ws_dynamic_image` |
| **MongoDB** | `ws_dynamic_images` |
| **Post-migration MySQL** | `ws_dynamic_image` |
| **Mongoose** | `src/models/system/DynamicImage.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `logo` | `varchar(250)` | NOT NULL | `logo` | String | required | `logo` | String | — | ✅ |

### 1.13 FAQ — ✅ Migrated

| | |
|---|---|
| **Prisma model** | FAQ |
| **Legacy MySQL** | `ws_faq` |
| **MongoDB** | `ws_faqs` |
| **Post-migration MySQL** | `ws_faq` |
| **Mongoose** | `src/models/system/FAQ.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `type` | `enum('general','referral') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL; DEFAULT 'general'; enum('general','referral') | — | — | — | `type` | String | — | ✅ SQL+Prisma |
| 3 | `question` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `question` | String | required | `question` | String | — | ✅ |
| 4 | `answer` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `answer` | String | required | `answer` | String | — | ✅ |
| 5 | `is_expand` | `tinyint(1)` | NOT NULL; DEFAULT '0' | — | — | — | `is_expand` | Boolean | — | ✅ SQL+Prisma |
| 6 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 7 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 8 | — | — | — | `typeId` | ObjectId | required; ref:FaqType | — | — | — | 🆕 Mongo-only |

### 1.14 ImageNotification — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ImageNotification |
| **Legacy MySQL** | `ws_image_notification` |
| **MongoDB** | `ws_image_notifications` |
| **Post-migration MySQL** | `ws_image_notification` |
| **Mongoose** | `src/models/system/ImageNotification.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `image` | `varchar(256)` | NOT NULL | `image` | String | required | `image` | String | — | ✅ |
| 3 | `redirect_url` | `varchar(256)` | NULL; DEFAULT NULL | `redirectUrl` | String | — | `redirect_url` | String? | — | ✅ |
| 4 | `active` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `active` | Boolean | required; true | `active` | Boolean | — | ✅ |

### 1.15 PopupNotifications — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PopupNotifications |
| **Legacy MySQL** | `ws_popup_notification` |
| **MongoDB** | `ws_popup_notifications` |
| **Post-migration MySQL** | `ws_popup_notification` |
| **Mongoose** | `src/models/system/PopupNotification.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_520_ci` | NOT NULL | `title` | String | required | `title` | String | — | ✅ |
| 3 | `description` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_520_ci` | NOT NULL | `description` | String | required | `description` | String | — | ✅ |
| 4 | `image` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_520_ci` | NOT NULL | `image` | String | required | `image` | String | — | ✅ |
| 5 | `discount` | `varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci` | NOT NULL | `discount` | String | required | `discount` | String | — | ✅ |
| 6 | `promocode` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_unicode_520_ci` | NOT NULL | `promocode` | String | required | `promocode` | String | — | ✅ |
| 7 | `promo_expire_at` | `date` | NULL; DEFAULT NULL | `promoExpireAt` | Date | required | `promo_expire_at` | DateTime | — | ✅ |
| 8 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | Boolean | required | `status` | Boolean | — | ✅ |
| 9 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 10 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |

### 1.16 TermsAndConditions — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | TermsAndConditions |
| **Legacy MySQL** | `ws_termsandcondition` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_termsandcondition` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `module` | `enum('book','pendrive','referral code') CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL; enum('book','pendrive','referral code') | — | — | — | `module` | String | — | ✅ SQL+Prisma |
| 3 | `terms` | `varchar(2500) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NULL; DEFAULT NULL | — | — | — | `terms` | String | — | ✅ SQL+Prisma |
| 4 | `freeShippingMinimumOrderAmount` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `freeShippingMinimumOrderAmount` | Int | — | ⚠️ check |
| 5 | `status` | `tinyint(1)` | NULL; DEFAULT NULL | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |

### 1.17 Testimonial — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Testimonial |
| **Legacy MySQL** | `ws_testimonial` |
| **MongoDB** | `ws_testimonials` |
| **Post-migration MySQL** | `ws_testimonial` |
| **Mongoose** | `src/models/system/Testimonial.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255)` | NOT NULL | `name` | String | required | `name` | String | — | ✅ |
| 3 | `title` | `varchar(255)` | NOT NULL | `title` | String | required | `title` | String | — | ✅ |
| 4 | `discription` | `varchar(255)` | NOT NULL | — | — | — | `discription` | String | — | ✅ SQL+Prisma |
| 5 | `rating` | `int` | NOT NULL | `rating` | Number | required; min:1 | `rating` | Int | — | ✅ |
| 6 | — | — | — | `description` | String | required | — | — | — | 🆕 Mongo-only |

### 1.18 Version — ✅ Migrated

| | |
|---|---|
| **Prisma model** | Version |
| **Legacy MySQL** | `ws_versions` |
| **MongoDB** | `ws_versions` |
| **Post-migration MySQL** | `ws_versions` |
| **Mongoose** | `src/models/system/Version.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `latestVersionCode` | `int` | NULL; DEFAULT NULL | `latestVersionCode` | Number | required | `latestVersionCode` | Int | — | ✅ |
| 3 | `lastSupportedVersionCode` | `int` | NULL; DEFAULT NULL | `lastSupportedVersionCode` | Number | required | `lastSupportedVersionCode` | Int | — | ✅ |

### 1.19 Inquiry — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Inquiry |
| **Legacy MySQL** | `ws_website_inquiry` |
| **MongoDB** | `ws_website_inquiry` |
| **Post-migration MySQL** | `ws_website_inquiry` |
| **Mongoose** | `src/models/system/Inquiry.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255)` | NOT NULL | `name` | String | maxlength:255 | `name` | String | — | ✅ |
| 3 | `mobile` | `varchar(12)` | NOT NULL | `mobile` | String | maxlength:20 | `mobile` | String | — | ✅ |
| 4 | `email` | `varchar(255)` | NULL; DEFAULT NULL | `email` | String | maxlength:255 | `email` | String | — | ✅ |
| 5 | `city` | `varchar(100)` | NOT NULL | `city` | String | maxlength:100 | `city` | String | — | ✅ |
| 6 | `course` | `enum('UPSC','GPSC','STI','DYSO','RFO','PI','PSI','Constable','CCE','Talati','Forest','TET_TAT','FHW_MPHW')` | NOT NULL; enum('UPSC','GPSC','STI','DYSO','RFO','PI','PSI','Constable','CCE','Talati','Forest','TET_TAT','FHW_MPHW') | `course` | String | — | `course` | Courses | — | ✅ |
| 7 | `mode` | `enum('online','offline')` | NULL; DEFAULT NULL; enum('online','offline') | `mode` | String | — | `mode` | inquiryMode | — | ✅ |
| 8 | `createdAt` | `datetime` | NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `createdAt` | DateTime | @default(now()) | ✅ |
| 9 | `updatedAt` | `datetime` | NULL; DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updatedAt` | DateTime | — | ✅ |
| 10 | — | — | — | `customerId` | ObjectId | ref:Customer | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `description` | String | required; maxlength:2000 | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `message` | String | null | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `source` | String | "app"; maxlength:50 | — | — | — | 🆕 Mongo-only |


<a id="module-admin"></a>

## 2. Admin & permissions

> Module key: `admin` — 5 entities

### 2.1 AdminAccessToken — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | AdminAccessToken |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_admin_access_tokens` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/admin/AdminAccessToken.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `adminUserId` | ObjectId | required; ref:AdminUser | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `token` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `refreshToken` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `active` | Boolean | required; true | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `deleted` | Boolean | required; false | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `expiresAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 2.2 PermissionCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PermissionCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_permission_categories` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/admin/PermissionCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `slug` | String | required; unique; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 2.3 Permission — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Permission |
| **Legacy MySQL** | `ws_permissions` |
| **MongoDB** | `ws_permissions` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/admin/Permission.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `name` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `name` | String | required; maxlength:255 | — | — | — | ✅ |
| 3 | `guard_name` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `guardName` | String | required; maxlength:255 | — | — | — | ✅ |
| 4 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | — | — | — | ✅ |
| 5 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | — | — | — | ✅ |
| 6 | — | — | — | `categoryId` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |

### 2.4 Role — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Role |
| **Legacy MySQL** | `ws_roles` |
| **MongoDB** | `ws_roles` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/admin/Role.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `name` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `name` | String | required; maxlength:255 | — | — | — | ✅ |
| 3 | `guard_name` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `guardName` | String | required; maxlength:255 | — | — | — | ✅ |
| 4 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | — | — | — | ✅ |
| 5 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | — | — | — | ✅ |
| 6 | — | — | — | `permissions` | Schema.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |

### 2.5 AdminUser — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | AdminUser |
| **Legacy MySQL** | `ws_users` |
| **MongoDB** | `ws_users` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/admin/AdminUser.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `first_name` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `firstName` | String | required; maxlength:100 | — | — | — | ✅ |
| 3 | `last_name` | `varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NULL; DEFAULT NULL | `lastName` | String | maxlength:100 | — | — | — | ✅ |
| 4 | `email` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `email` | String | required; unique; maxlength:255 | — | — | — | ✅ |
| 5 | `image` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `image` | String | — | — | — | — | ✅ |
| 6 | `email_verified_at` | `timestamp NULL` | NULL; DEFAULT NULL | `emailVerifiedAt` | Date | — | — | — | — | ✅ |
| 7 | `password` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | `password` | String | required | — | — | — | ✅ |
| 8 | `last_login_date` | `datetime` | NULL; DEFAULT NULL | `lastLoginDate` | Date | — | — | — | — | ✅ |
| 9 | `last_login_ip` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NULL; DEFAULT NULL | `lastLoginIp` | string | — | — | — | — | ✅ |
| 10 | `last_seen_at` | `timestamp NULL` | NULL; DEFAULT NULL | `lastSeenAt` | Date | — | — | — | — | ✅ |
| 11 | `status` | `enum('0','1') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL; DEFAULT '1'; enum('0','1') | `status` | boolean | — | — | — | — | ✅ |
| 12 | `remember_token` | `varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NULL; DEFAULT NULL | `rememberToken` | string | — | — | — | — | ✅ |
| 13 | `is_dark` | `enum('0','1') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL; DEFAULT '0'; enum('0','1') | `isDark` | boolean | — | — | — | — | ✅ |
| 14 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | — | — | — | ✅ |
| 15 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | — | — | — | ✅ |
| 16 | — | — | — | `role` | AdminRole | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `roles` | Schema.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `permissions` | Schema.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |


<a id="module-customer"></a>

## 3. Customer & auth

> Module key: `customer` — 23 entities

### 3.1 CustomerAddress — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | CustomerAddress |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_customer_addresses` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/CustomerAddress.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required; maxlength:50 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `phone` | String | maxlength:15 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `alternatePhone` | String | maxlength:15 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `email` | String | maxlength:100 | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `address` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `address2` | String | maxlength:255 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `cityId` | ObjectId | ref:OfflineCity | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `stateId` | ObjectId | ref:CustomerState | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `pincode` | String | required; maxlength:10 | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `label` | String | "home" | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `isDefault` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `customerId` | ObjectId | ref:Customer | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.2 CustomerDistrict — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | CustomerDistrict |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_customer_districts` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/CustomerDistrict.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `stateId` | ObjectId | required; ref:CustomerState | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `active` | Boolean | required; true | — | — | — | 🆕 Mongo-only |

### 3.3 Folder — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Folder |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_folders` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/Folder.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `name` | String | required; maxlength:120 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `type` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `isDefaultFolder` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.4 FolderItem — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | FolderItem |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_folder_items` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/FolderItem.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `folderId` | ObjectId | required; ref:Folder | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `kind` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `refId` | ObjectId | required | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `addedAt` | Date | Date.now | — | — | — | 🆕 Mongo-only |

### 3.5 LectureAudioNote — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LectureAudioNote |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_lecture_audio_notes` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/LectureAudioNote.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `lectureType` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `videoId` | ObjectId | null; ref:Video | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `liveSessionId` | ObjectId | null; ref:LiveSession | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `courseId` | ObjectId | null; ref:Course | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `liveCourseIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `timestampSec` | number | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `title` | string | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `audioUrl` | string | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `audioKey` | string | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `mimeType` | string | null | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `sizeBytes` | number | null | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `durationSec` | number | null | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.6 LectureNote — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LectureNote |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_lecture_notes` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/LectureNote.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `lectureType` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `videoId` | ObjectId | null; ref:Video | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `liveSessionId` | ObjectId | null; ref:LiveSession | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `courseId` | ObjectId | null; ref:Course | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `liveCourseIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `timestampSec` | number | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `content` | string | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.7 LectureProgress — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LectureProgress |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_lecture_progress` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/LectureProgress.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `videoId` | ObjectId | null; ref:Video | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `liveSessionId` | ObjectId | null; ref:LiveSession | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `courseId` | ObjectId | null; ref:Course | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `liveCourseId` | ObjectId | null; ref:LiveCourse | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `packageId` | ObjectId | null; ref:Package | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `positionSec` | Number | required; 0; min:0  | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `durationSec` | Number | required; 0; min:0  | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `completed` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `completedAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `lastWatchedAt` | Date | required; () => new Date() | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.8 LiveCourseSubscription — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveCourseSubscription |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_course_subscriptions` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/LiveCourseSubscription.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `liveCourseId` | ObjectId | required; ref:LiveCourse | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `planId` | ObjectId | required; ref:LiveCoursePlan | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `startAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `endAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `promocodeId` | ObjectId | null; ref:PromoCode | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `originalAmount` | Number | null | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `discountAmount` | Number | null | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `paidAmount` | Number | null | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `paymentStatus` | "pending" | "verified" | "failed" | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `razorpayOrderId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `razorpayPaymentId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `paidAt` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.9 LiveSessionAttendance — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveSessionAttendance |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_session_attendance` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/LiveSessionAttendance.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `streamId` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `liveSessionId` | ObjectId | null; ref:LiveSession | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `userName` | String | "" | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `joinedAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `leftAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `durationSec` | Number | null | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.10 LiveSessionPreview — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveSessionPreview |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_session_previews` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/LiveSessionPreview.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `liveSessionId` | ObjectId | required; ref:LiveSession | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `startedAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.11 LiveSessionReminder — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveSessionReminder |
| **Legacy MySQL** | — |
| **MongoDB** | `(default livesessionreminders)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/LiveSessionReminder.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `liveSessionId` | ObjectId | required; ref:LiveSession | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `liveCourseId` | ObjectId | null; ref:LiveCourse | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `minutesBefore` | Number | required; min:0  | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `remindAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `sessionScheduledAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `notificationId` | ObjectId | null; ref:Notification | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `status` | LiveSessionReminderStatus | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.12 PackageCourseSubscription — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PackageCourseSubscription |
| **Legacy MySQL** | — |
| **MongoDB** | `(default packagecoursesubscriptions)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/PackageCourseSubscription.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `courseId` | ObjectId | null; ref:Course | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `targetPackageId` | ObjectId | null; ref:Package | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `packageId` | ObjectId | required; ref:PackageCourseEbookPrice | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `customerShippingId` | ObjectId | null; ref:CustomerShipping | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `trackingId` | Number | null | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `startAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `endAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `promocodeId` | ObjectId | null; ref:PromoCode | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `promoterId` | ObjectId | null; ref:Promoter | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `referrerId` | ObjectId | null; ref:Customer | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `paidAmount` | Number | null | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `customerPercentage` | Number | null | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `promoterPercentage` | Number | null | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `paymentStatus` | "pending" | "verified" | "failed" | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `paymentMethod` | string | null | — | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `withMaterial` | boolean | — | — | — | — | 🆕 Mongo-only |
| 19 | — | — | — | `remark` | string | null | — | — | — | — | 🆕 Mongo-only |
| 20 | — | — | — | `razorpayOrderId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `razorpayPaymentId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `paidAt` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 23 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 24 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.13 Wishlist — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Wishlist |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_wishlists` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/customer/Wishlist.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `itemType` | WishlistItemType | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `itemId` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 3.14 Customer — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Customer |
| **Legacy MySQL** | `ws_customer` |
| **MongoDB** | `ws_customers` |
| **Post-migration MySQL** | `ws_customer` |
| **Mongoose** | `src/models/customer/Customer.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `full_name` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `fullName` | String? | @db.VarChar(255) | ✅ SQL+Prisma |
| 3 | `phone` | `varchar(100)` | NOT NULL | — | — | — | `phoneNumber` | String | @unique @db.VarChar(11) | ✅ SQL+Prisma |
| 4 | `email_address` | `varchar(255)` | NULL; DEFAULT NULL | `emailAddress` | String | maxlength:255 | `emailAddress` | String? | @db.VarChar(255) | ✅ |
| 5 | `referral_code` | `varchar(15) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NULL; DEFAULT NULL | `referralCode` | String | — | `referralCode` | String? | — | ✅ |
| 6 | `reward_points` | `int` | NOT NULL; DEFAULT '0' | `rewardPoints` | Number | 0 | `rewardPoints` | Int? | — | ✅ |
| 7 | `password` | `varchar(255)` | NULL; DEFAULT NULL | `password` | String | maxlength:255 | `password` | String? | @db.VarChar(255) | ✅ |
| 8 | `is_phone_verified` | `tinyint` | NOT NULL; DEFAULT '0' | `isPhoneVerified` | Boolean | required; false | `isPhoneVerified` | Boolean | — | ✅ |
| 9 | `otp` | `varchar(4)` | NULL; DEFAULT 'null' | `otp` | String | maxlength:6 | `otp` | String? | @db.VarChar(4) | ✅ |
| 10 | `otp_expires_at` | `datetime` | NULL; DEFAULT CURRENT_TIMESTAMP | `otpExpiresAt` | Date | — | `otp_expires_at` | DateTime? | — | ✅ |
| 11 | `tried_otp` | `int` | NOT NULL; DEFAULT '0' | `triedOtp` | Number | required; 0 | `triedOtp` | Int | @db.Int | ✅ |
| 12 | `otp_blocked_at` | `datetime` | NULL; DEFAULT NULL | `otpBlockedAt` | Date | — | `otpBlockedAt` | DateTime? | — | ✅ |
| 13 | `profile_picture` | `varchar(255)` | NULL; DEFAULT NULL | `profilePicture` | String | maxlength:255 | `profile_picture` | String? | @db.VarChar(255) | ✅ |
| 14 | `phone_2` | `varchar(15)` | NULL; DEFAULT NULL | — | — | — | `phoneNumber2` | String? | @db.VarChar(11) | ✅ SQL+Prisma |
| 15 | `dob` | `date` | NULL; DEFAULT NULL | `dob` | Date | — | `birthDate` | DateTime? | @db.Date | ✅ |
| 16 | `education_id` | `int` | NULL; DEFAULT '0' | `educationId` | ObjectId | ref:CustomerEducation | `educationId` | Int? | @db.Int | ✅ |
| 17 | `state` | `int` | NOT NULL | — | — | — | `stateId` | Int? | — | ✅ SQL+Prisma |
| 18 | `district` | `int` | NOT NULL | — | — | — | `districtId` | Int? | — | ✅ SQL+Prisma |
| 19 | `city` | `varchar(255)` | NULL; DEFAULT NULL | `city` | String | maxlength:255 | `city` | String? | @db.VarChar(255) | ✅ |
| 20 | `gender` | `varchar(10)` | NULL; DEFAULT NULL | `gender` | String | maxlength:10 | `gender` | String? | @db.VarChar(10) | ✅ |
| 21 | `language` | `varchar(50)` | NULL; DEFAULT NULL | `language` | String | maxlength:50 | `language` | String? | @db.VarChar(50) | ✅ |
| 22 | `goal` | `json` | NULL; DEFAULT NULL | `goals` | Types.ObjectId[] | — | `goal` | Json? | @db.Json | ✅ |
| 23 | `facebook_id` | `varchar(255)` | NULL; DEFAULT '0' | — | — | — | — | — | — | 🆕 MySQL-only |
| 24 | `verified` | `tinyint(1)` | NULL; DEFAULT '0' | `verified` | Boolean | required; false | `verified` | Boolean | — | ✅ |
| 25 | `device` | `text` | NULL | — | — | — | `firebaseToken` | String? | @db.Text | ✅ SQL+Prisma |
| 26 | `os_type` | `enum('android','ios')` | NOT NULL; DEFAULT 'android'; enum('android','ios') | `osType` | OsType | — | `os_type` | OsType | @default(android) | ✅ |
| 27 | `last_login_date` | `datetime` | NULL; DEFAULT NULL | `lastLoginDate` | Date | — | `lastLogin` | DateTime? | — | ✅ |
| 28 | `last_login_ip` | `varchar(255)` | NULL; DEFAULT 'null' | `lastLoginIp` | string | — | `lastLoginIp` | String? | @db.VarChar(255) | ✅ |
| 29 | `login_count` | `int` | NULL; DEFAULT NULL | `loginCount` | number | — | `lastLoginCount` | Int? | @db.Int | ✅ |
| 30 | `is_login` | `tinyint(1)` | NULL; DEFAULT NULL | — | — | — | `isLoggedIn` | Boolean? | — | ✅ SQL+Prisma |
| 31 | `is_account_deleted` | `tinyint(1)` | NOT NULL; DEFAULT '0' | `isAccountDeleted` | boolean | — | `isAccountDeleted` | Boolean | @default(false) | ✅ |
| 32 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | boolean | — | `status` | Boolean | @default(true) | ✅ |
| 33 | `created_at` | `datetime` | NULL; DEFAULT NULL | `createdAt` | Date | — | `createdAt` | DateTime? | — | ✅ |
| 34 | `updated_at` | `datetime` | NULL; DEFAULT NULL | `updatedAt` | Date | () => new Date() | `updatedAt` | DateTime? | — | ✅ |
| 35 | — | — | — | `firstName` | String | maxlength:100 | — | — | — | 🆕 Mongo-only |
| 36 | — | — | — | `middleName` | String | maxlength:100 | — | — | — | 🆕 Mongo-only |
| 37 | — | — | — | `lastName` | String | maxlength:100 | — | — | — | 🆕 Mongo-only |
| 38 | — | — | — | `phoneNumber` | String | required; unique; maxlength:11 | — | — | — | 🆕 Mongo-only |
| 39 | — | — | — | `phone2` | String | maxlength:11 | — | — | — | 🆕 Mongo-only |
| 40 | — | — | — | `stateId` | ObjectId | ref:CustomerState | — | — | — | 🆕 Mongo-only |
| 41 | — | — | — | `districtId` | ObjectId | ref:CustomerDistrict | — | — | — | 🆕 Mongo-only |
| 42 | — | — | — | `isProfileCompleted` | Boolean | required; false | — | — | — | 🆕 Mongo-only |
| 43 | — | — | — | `isLoggedIn` | boolean | — | — | — | — | 🆕 Mongo-only |
| 44 | — | — | — | `token` | String | required | — | — | — | 🆕 Mongo-only |
| 45 | — | — | — | `platform` | String | — | — | — | — | 🆕 Mongo-only |

### 3.15 CustomerAccessToken — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerAccessToken |
| **Legacy MySQL** | `ws_customer_access_token` |
| **MongoDB** | `ws_customer_access_tokens` |
| **Post-migration MySQL** | `ws_customer_access_token` |
| **Mongoose** | `src/models/customer/CustomerAccessToken.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `customer_id` | `int` | NULL; DEFAULT NULL | `customerId` | ObjectId | required; ref:Customer | `customerId` | Int | — | ✅ |
| 3 | `token` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL | `token` | String | required | `token` | String | @db.Text | ✅ |
| 4 | `created_at` | `datetime` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime | — | ✅ |
| 5 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 6 | `expires_at` | `datetime` | NULL; DEFAULT NULL | `expiresAt` | Date | required | `expires_at` | DateTime | — | ✅ |
| 7 | `active` | `tinyint(1)` | NULL; DEFAULT '1' | `active` | Boolean | required; true | `active` | Boolean | — | ✅ |
| 8 | `deleted` | `tinyint(1)` | NULL; DEFAULT '0' | `deleted` | Boolean | required; false | `deleted` | Boolean | — | ✅ |
| 9 | — | — | — | `refreshToken` | String | required | — | — | — | 🆕 Mongo-only |

### 3.16 CustomerAddress — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerAddress |
| **Legacy MySQL** | `ws_customer_address` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_customer_address` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(50)` | NOT NULL | — | — | — | `name` | String | @db.VarChar(50) | ✅ SQL+Prisma |
| 3 | `phone` | `bigint` | NOT NULL | — | — | — | `phone` | Int | — | ✅ SQL+Prisma |
| 4 | `alternate_phone` | `bigint` | NULL; DEFAULT NULL | — | — | — | `alternate_phone` | Int? | — | ✅ SQL+Prisma |
| 5 | `email` | `varchar(100)` | NULL; DEFAULT NULL | — | — | — | `email` | String | @db.VarChar(100) | ✅ SQL+Prisma |
| 6 | `address` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci` | NOT NULL | — | — | — | `address` | String | @db.VarChar(255) | ✅ SQL+Prisma |
| 7 | `address_2` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci` | NOT NULL | — | — | — | `address_2` | String | @db.VarChar(255) | ✅ SQL+Prisma |
| 8 | `city` | `varchar(20)` | NOT NULL | — | — | — | `city` | String | @db.VarChar(20) | ✅ SQL+Prisma |
| 9 | `state` | `int` | NULL; DEFAULT NULL | — | — | — | `state` | Int? | — | ✅ SQL+Prisma |
| 10 | `pincode` | `int` | NOT NULL | — | — | — | `pincode` | Int | — | ✅ SQL+Prisma |
| 11 | `user_id` | `int` | NOT NULL | — | — | — | `userId` | Int? | — | ✅ SQL+Prisma |
| 12 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean? | — | ✅ SQL+Prisma |
| 13 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 14 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 3.17 CustomerBankAccount — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerBankAccount |
| **Legacy MySQL** | `ws_customer_bank_account` |
| **MongoDB** | `ws_customer_bank_accounts` |
| **Post-migration MySQL** | `ws_customer_bank_account` |
| **Mongoose** | `src/models/customer/CustomerBankAccount.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `customer_id` | `int` | NOT NULL | `customerId` | ObjectId | required; ref:Customer | `customerId` | Int | — | ✅ |
| 3 | `account_holder_name` | `varchar(150)` | NOT NULL | `accountHolderName` | String | required; maxlength:150 | `accountHolderName` | String | @db.VarChar(150) | ✅ |
| 4 | `ifsc_code` | `varchar(50)` | NOT NULL | `ifscCode` | String | required; maxlength:11 | `ifscCode` | String | @db.VarChar(50) | ✅ |
| 5 | `account_number` | `varchar(50)` | NOT NULL | `accountNumber` | String | required; maxlength:18 | `accountNumber` | String | — | ✅ |
| 6 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `createdAt` | DateTime? | — | ✅ |
| 7 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updatedAt` | DateTime? | — | ✅ |
| 8 | — | — | — | `bankName` | String | maxlength:150 | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `branchName` | String | maxlength:200 | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `city` | String | maxlength:100 | — | — | — | 🆕 Mongo-only |

### 3.18 CustomerDistict — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerDistict |
| **Legacy MySQL** | `ws_customer_distict` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_customer_distict` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255)` | NOT NULL | — | — | — | `name` | String | @db.VarChar(255) | ✅ SQL+Prisma |
| 3 | `state` | `int` | NOT NULL | — | — | — | `stateId` | Int | — | ✅ SQL+Prisma |
| 4 | `active` | `tinyint(1)` | NOT NULL | — | — | — | `active` | Boolean | — | ✅ SQL+Prisma |

### 3.19 CustomerEducation — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerEducation |
| **Legacy MySQL** | `ws_customer_education` |
| **MongoDB** | `ws_customer_educations` |
| **Post-migration MySQL** | `ws_customer_education` |
| **Mongoose** | `src/models/customer/CustomerEducation.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(100)` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | @db.VarChar(255) | ✅ |
| 3 | `status` | `tinyint(1)` | NOT NULL | `status` | Boolean | required; true | `status` | Boolean | — | ✅ |

### 3.20 CustomerOtp — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerOtp |
| **Legacy MySQL** | `ws_customer_otp` |
| **MongoDB** | `ws_customer_otps` |
| **Post-migration MySQL** | `ws_customer_otp` |
| **Mongoose** | `src/models/customer/CustomerOtp.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `customer_id` | `int` | NOT NULL | `customerId` | ObjectId | required; ref:Customer | `customerId` | Int | — | ✅ |
| 3 | `otp` | `varchar(10)` | NOT NULL | `otp` | String | required; maxlength:6 | `otp` | String | @db.VarChar(4) | ✅ |
| 4 | `created_at` | `datetime` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |

### 3.21 CustomerShipping — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerShipping |
| **Legacy MySQL** | `ws_customer_shipping` |
| **MongoDB** | `ws_customer_shippings` |
| **Post-migration MySQL** | `ws_customer_shipping` |
| **Mongoose** | `src/models/customer/CustomerShipping.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(50)` | NOT NULL | `name` | String | required; maxlength:50 | `name` | String | @db.VarChar(50) | ✅ |
| 3 | `phone` | `bigint` | NOT NULL | `phone` | String | required; maxlength:15 | `phone` | Int | — | ✅ |
| 4 | `alternate_phone` | `bigint` | NULL; DEFAULT NULL | `alternatePhone` | String | maxlength:15 | `alternate_phone` | Int? | — | ✅ |
| 5 | `email` | `varchar(100)` | NULL; DEFAULT NULL | `email` | String | maxlength:100 | `email` | String | @db.VarChar(100) | ✅ |
| 6 | `address` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci` | NOT NULL | `address` | String | required; maxlength:255 | `address` | String | @db.VarChar(255) | ✅ |
| 7 | `address_2` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci` | NOT NULL | — | — | — | `address_2` | String | @db.VarChar(255) | ✅ SQL+Prisma |
| 8 | `city` | `varchar(20)` | NOT NULL | `city` | String | required; maxlength:20 | `city` | String | @db.VarChar(20) | ✅ |
| 9 | `state` | `int` | NULL; DEFAULT NULL | — | — | — | `state` | Int? | — | ✅ SQL+Prisma |
| 10 | `pincode` | `int` | NOT NULL | `pincode` | String | required; maxlength:10 | `pincode` | Int | — | ✅ |
| 11 | `user_id` | `int` | NOT NULL | — | — | — | `userId` | Int? | — | ✅ SQL+Prisma |
| 12 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | Boolean | true | `status` | Boolean? | — | ✅ |
| 13 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 14 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 15 | — | — | — | `address2` | String | maxlength:255 | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `stateId` | ObjectId | ref:CustomerState | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `customerId` | ObjectId | ref:Customer | — | — | — | 🆕 Mongo-only |

### 3.22 CustomerState — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerState |
| **Legacy MySQL** | `ws_customer_state` |
| **MongoDB** | `ws_customer_states` |
| **Post-migration MySQL** | `ws_customer_state` |
| **Mongoose** | `src/models/customer/CustomerState.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255)` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | @db.VarChar(255) | ✅ |
| 3 | `state_code` | `varchar(55)` | NOT NULL | `stateCode` | String | required; maxlength:255 | `state_code` | String | @db.VarChar(255) | ✅ |
| 4 | `active` | `tinyint(1)` | NOT NULL | `active` | Boolean | required; true | `active` | Boolean | — | ✅ |

### 3.23 CustomerTargetGoal — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CustomerTargetGoal |
| **Legacy MySQL** | `ws_customer_target_goal` |
| **MongoDB** | `ws_customer_target_goals` |
| **Post-migration MySQL** | `ws_customer_target_goal` |
| **Mongoose** | `src/models/customer/CustomerTargetGoal.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(100)` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | @db.VarChar(255) | ✅ |
| 3 | `image` | `varchar(255)` | NOT NULL | `image` | String | required | `image` | String | — | ✅ |
| 4 | `active` | `tinyint(1)` | NOT NULL | `active` | Boolean | required; true | `active` | Boolean | — | ✅ |


<a id="module-book"></a>

## 4. Books & orders

> Module key: `book` — 8 entities

### 4.1 BookSetting — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | BookSetting |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_book_settings` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/book/BookSetting.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `key` | String | required; unique; "default" | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `freeShippingMinOrderAmount` | Number | required; 0; min:0  | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `supportPhone` | String | maxlength:20 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `termsAndConditions` | String | [] | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `gstRate` | Number | required; 0; min:0  | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `originCity` | String | maxlength:50 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `originHub` | String | maxlength:100 | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 4.2 Counter — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Counter |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_counters` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/book/Counter.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `_id` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `seq` | Number | required; 0 | — | — | — | 🆕 Mongo-only |

### 4.3 Book — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Book |
| **Legacy MySQL** | `ws_book` |
| **MongoDB** | `ws_books` |
| **Post-migration MySQL** | `ws_book` |
| **Mongoose** | `src/models/book/Book.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | — | ✅ |
| 3 | `thumbnail` | `varchar(256)` | NOT NULL; DEFAULT ' ' | `thumbnail` | string | — | `thumbnail` | String? | — | ✅ |
| 4 | `author` | `varchar(50)` | NULL; DEFAULT NULL | `author` | string | — | `author` | String? | — | ✅ |
| 5 | `image` | `varchar(250)` | NULL; DEFAULT NULL | `image` | string | — | `image` | String? | — | ✅ |
| 6 | `description` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NULL | `description` | string | — | `description` | String? | — | ✅ |
| 7 | `demo_url` | `varchar(256)` | NULL; DEFAULT NULL | `demoUrl` | string | — | `demo_url` | String? | — | ✅ |
| 8 | `weight` | `int` | NOT NULL; DEFAULT '0' | `weight` | number | — | `weight` | Int? | — | ✅ |
| 9 | `pages` | `int` | NOT NULL | `pages` | number | — | `pages` | Int? | — | ✅ |
| 10 | `dynamic_link` | `varchar(256)` | NOT NULL | `dynamicLink` | string | — | `dynamic_link` | String? | — | ✅ |
| 11 | `list_price` | `int` | NOT NULL | `listPrice` | number | — | `list_price` | Int | — | ✅ |
| 12 | `discounted_price` | `int` | NOT NULL | `discountedPrice` | number | — | `discounted_price` | Int | — | ✅ |
| 13 | `shipping_price` | `int` | NOT NULL; DEFAULT '0' | `shippingPrice` | number | — | `shipping_price` | Int | — | ✅ |
| 14 | `order_by` | `int` | NULL; DEFAULT NULL | `orderBy` | number | — | `order_by` | Int | — | ✅ |
| 15 | `language` | `varchar(100)` | NOT NULL; DEFAULT 'Gujarati' | `language` | BookLanguage | string | — | `language` | String | — | ✅ |
| 16 | `is_magazine` | `tinyint(1)` | NOT NULL; DEFAULT '0' | `isMagazine` | boolean | — | `is_magazine` | Boolean | @default(false) | ✅ |
| 17 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | boolean | — | `active` | Boolean | @default(true) | ✅ |
| 18 | `is_combo` | `tinyint(1)` | NOT NULL; DEFAULT '0' | `isCombo` | boolean | — | `isCombo` | Boolean | @default(false) | ✅ |
| 19 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 20 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 21 | — | — | — | `examCountdownCategoryId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `bookUrl` | string | — | — | — | — | 🆕 Mongo-only |
| 23 | — | — | — | `publication` | string | — | — | — | — | 🆕 Mongo-only |
| 24 | — | — | — | `deliveryEta` | string | — | — | — | — | 🆕 Mongo-only |
| 25 | — | — | — | `isTrending` | boolean | — | — | — | — | 🆕 Mongo-only |

### 4.4 BookCart — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | BookCart |
| **Legacy MySQL** | `ws_book_cart` |
| **MongoDB** | `ws_book_carts` |
| **Post-migration MySQL** | `ws_book_cart` |
| **Mongoose** | `src/models/book/BookCart.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `cart_id` | `varchar(255)` | NOT NULL | — | — | — | `cart_id` | String | — | ✅ SQL+Prisma |
| 3 | `user_ip_address` | `varchar(50)` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 4 | `cart_status` | `int` | NOT NULL; DEFAULT '1' | — | — | — | — | — | — | 🆕 MySQL-only |
| 5 | `user_id` | `int` | NOT NULL | — | — | — | `userId` | Int? | — | ✅ SQL+Prisma |
| 6 | `item_id` | `int` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 7 | `shipping_id` | `int` | NULL; DEFAULT NULL | `shippingId` | Types.ObjectId | null | — | `shippingId` | Int? | — | ✅ |
| 8 | `qty` | `int` | NULL; DEFAULT NULL | `qty` | Number | required; min:1  | — | — | — | ✅ |
| 9 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | boolean | — | `active` | Boolean | — | ✅ |
| 10 | `created_at` | `datetime` | NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 11 | `last_update` | `datetime` | NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |
| 12 | — | — | — | `bookId` | ObjectId | required; ref:Book | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `customerId` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `items` | IBookCartItem[] | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 4.5 BookCartItem — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | BookCartItem |
| **Legacy MySQL** | `ws_book_cart_item` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_book_cart_item` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `cart_id` | `varchar(255)` | UNIQUE; NULL; DEFAULT NULL | — | — | — | `cartId` | Int? | — | ⚠️ check |
| 3 | `cartid` | `int` | NOT NULL | — | — | — | `cartId` | Int? | — | ✅ SQL+Prisma |
| 4 | `item_id` | `int` | NOT NULL | — | — | — | `bookId` | Int? | — | ✅ SQL+Prisma |
| 5 | `qty` | `int` | NOT NULL | — | — | — | `qty` | Int | — | ✅ SQL+Prisma |
| 6 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | — | — | — | 🆕 MySQL-only |
| 7 | `last_update` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | — | — | — | 🆕 MySQL-only |

### 4.6 BookOrder — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | BookOrder |
| **Legacy MySQL** | `ws_book_order` |
| **MongoDB** | `ws_book_orders` |
| **Post-migration MySQL** | `ws_book_order` |
| **Mongoose** | `src/models/book/BookOrder.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `order_id` | `varchar(255)` | UNIQUE; NOT NULL | — | — | — | `receiptId` | String | — | ✅ SQL+Prisma |
| 3 | `customer_id` | `int` | NOT NULL | `customerId` | Types.ObjectId | — | `userId` | Int? | — | ✅ |
| 4 | `user_ip` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 5 | `cart_id` | `varchar(255)` | NOT NULL | — | — | — | `cartId` | String | — | ✅ SQL+Prisma |
| 6 | `shipping_id` | `int` | NOT NULL | `shippingId` | Types.ObjectId | — | `shippingId` | Int? | — | ✅ |
| 7 | `tracking_id` | `bigint` | NULL; DEFAULT NULL | `trackingId` | string | — | `trackingId` | Int? | — | ✅ |
| 8 | `order_type` | `enum('purchase')` | NOT NULL; enum('purchase') | `orderType` | BookOrderType | — | `orderType` | BookOrderType | — | ✅ |
| 9 | `order_items` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NULL | — | — | — | `orderItems` | String | — | ✅ SQL+Prisma |
| 10 | `payment_method` | `varchar(50)` | NOT NULL; DEFAULT 'razorpay' | `paymentMethod` | PaymentMethod | — | `paymentMethod` | PaymentMethod | — | ✅ |
| 11 | `order_price` | `double` | NOT NULL | — | — | — | `amount` | Decimal | — | ✅ SQL+Prisma |
| 12 | `gateway_order_id` | `varchar(255)` | NOT NULL | — | — | — | `gatewayOrderId` | String | — | ✅ SQL+Prisma |
| 13 | `razorpay_order` | `text` | NOT NULL | — | — | — | `gatewayOrder` | String | — | ✅ SQL+Prisma |
| 14 | `gateway_transaction_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `gatewayPaymentId` | String? | — | ✅ SQL+Prisma |
| 15 | `transaction_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `transactionId` | String? | — | ✅ SQL+Prisma |
| 16 | `order_date` | `timestamp NULL` | NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `orderDate` | DateTime? | — | ✅ SQL+Prisma |
| 17 | `status` | `varchar(20)` | NOT NULL | `status` | BookOrderStatus | — | `status` | String | — | ✅ |
| 18 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `createdAt` | DateTime? | — | ✅ |
| 19 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updatedAt` | DateTime? | — | ✅ |
| 20 | — | — | — | `bookId` | ObjectId | required; ref:Book | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `name` | String | required | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `qty` | Number | required; min:1  | — | — | — | 🆕 Mongo-only |
| 23 | — | — | — | `listPrice` | Number | required; min:0  | — | — | — | 🆕 Mongo-only |
| 24 | — | — | — | `price` | Number | required; min:0  | — | — | — | 🆕 Mongo-only |
| 25 | — | — | — | `shippingPrice` | Number | required; 0; min:0 | — | — | — | 🆕 Mongo-only |
| 26 | — | — | — | `weight` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 27 | — | — | — | `isMagazine` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 28 | — | — | — | `courier` | BookCourier | — | — | — | — | 🆕 Mongo-only |
| 29 | — | — | — | `receiptId` | string | — | — | — | — | 🆕 Mongo-only |
| 30 | — | — | — | `items` | IBookOrderItem[] | — | — | — | — | 🆕 Mongo-only |
| 31 | — | — | — | `totalListPrice` | number | — | — | — | — | 🆕 Mongo-only |
| 32 | — | — | — | `totalDiscountedPrice` | number | — | — | — | — | 🆕 Mongo-only |
| 33 | — | — | — | `totalShippingPrice` | number | — | — | — | — | 🆕 Mongo-only |
| 34 | — | — | — | `amount` | number | — | — | — | — | 🆕 Mongo-only |
| 35 | — | — | — | `razorpayOrderId` | string | — | — | — | — | 🆕 Mongo-only |
| 36 | — | — | — | `razorpayPaymentId` | string | — | — | — | — | 🆕 Mongo-only |
| 37 | — | — | — | `razorpayOrderPayload` | Record<string, any> | — | — | — | — | 🆕 Mongo-only |
| 38 | — | — | — | `tracking` | IBookOrderTracking | — | — | — | — | 🆕 Mongo-only |
| 39 | — | — | — | `paidAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 40 | — | — | — | `shippedAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 41 | — | — | — | `deliveredAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 42 | — | — | — | `cancelledAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 43 | — | — | — | `remarks` | string | — | — | — | — | 🆕 Mongo-only |

### 4.7 BookOrderItem — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | BookOrderItem |
| **Legacy MySQL** | `ws_book_order_item` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_book_order_item` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `order_id` | `varchar(255)` | NOT NULL | — | — | — | `order_id` | String | — | ✅ SQL+Prisma |
| 3 | `qty` | `int` | NOT NULL | — | — | — | `qty` | Int | — | ✅ SQL+Prisma |
| 4 | `list_price` | `int` | NOT NULL | — | — | — | `list_price` | Int | — | ✅ SQL+Prisma |
| 5 | `price` | `int` | NOT NULL | — | — | — | `price` | Int | — | ✅ SQL+Prisma |
| 6 | `shipping_price` | `int` | NOT NULL | — | — | — | `shipping_price` | Int | — | ✅ SQL+Prisma |
| 7 | `book_id` | `int` | NOT NULL | — | — | — | `bookId` | Int? | — | ✅ SQL+Prisma |
| 8 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 9 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 4.8 BookTracking — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | BookTracking |
| **Legacy MySQL** | `ws_book_tracking` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_book_tracking` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `tracking_id` | `bigint` | PK AI; NOT NULL | — | — | — | `tracking_id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `order_id` | `varchar(255)` | NOT NULL | — | — | — | `orderId` | String | — | ✅ SQL+Prisma |
| 3 | `status` | `varchar(10)` | NOT NULL; DEFAULT 'pending' | — | — | — | `status` | String | — | ✅ SQL+Prisma |
| 4 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 5 | `last_update` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |


<a id="module-course"></a>

## 5. Courses, packages & video

> Module key: `course` — 47 entities

### 5.1 Course — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Course |
| **Legacy MySQL** | — |
| **MongoDB** | `(default courses)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/Course.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `category` | ObjectId | required; ref:MaterialCategory | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `name` | string | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `subtitle` | string | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `description` | string | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `image` | string | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `ordered` | number | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `shareableLink` | string | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `withMaterial` | string | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `withoutMaterial` | string | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `level` | string | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `isPaid` | boolean | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `isPopular` | boolean | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `courseEducatorId` | mongoose.Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `courseSubjectCategoryId` | mongoose.Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `videoCategoryId` | mongoose.Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `materialCategories` | ICourseCategoryRef[] | — | — | — | — | 🆕 Mongo-only |
| 19 | — | — | — | `examCategories` | ICourseCategoryRef[] | — | — | — | — | 🆕 Mongo-only |
| 20 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.2 CourseEducator — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | CourseEducator |
| **Legacy MySQL** | — |
| **MongoDB** | `(default courseeducators)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/CourseEducator.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `image` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `about` | String | "" | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `email` | String | required; unique | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `password` | String | null | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `view` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.3 CourseSubjectCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | CourseSubjectCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `(default coursesubjectcategorys)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/CourseSubjectCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `slug` | String | required; unique | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `image` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `parent` | mongoose.Types.ObjectId | number | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.4 LiveChatBan — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveChatBan |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_chat_bans` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/LiveChatBan.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; unique; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `bannedBy` | ObjectId | required; ref:AdminUser | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `reason` | String | null; maxlength:500 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.5 LiveChatMessage — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveChatMessage |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_chat_messages` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/LiveChatMessage.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `liveClassId` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `customerId` | ObjectId | null; ref:Customer | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `adminId` | ObjectId | null; ref:AdminUser | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `isAdmin` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `userName` | String | required; maxlength:200 | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `message` | String | required; maxlength:2000 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `deletedAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `deletedBy` | ObjectId | null; ref:AdminUser | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `updatedAt` | Date | timestamps | — | — | — | 🆕 Mongo-only |

### 5.6 LiveCourse — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveCourse |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_courses` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/LiveCourse.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `category` | ObjectId | required; ref:MaterialCategory | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `_id` | mongoose.Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `date` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `subject` | string | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `time` | string | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `title` | string | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `image` | string | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `entries` | ILiveCourseScheduleEntry[] | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `name` | string | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `subtitle` | string | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `description` | string | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `ordered` | number | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `shareableLink` | string | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `withMaterial` | string | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `withoutMaterial` | string | — | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `level` | string | — | — | — | — | 🆕 Mongo-only |
| 19 | — | — | — | `classType` | LiveCourseClassType | — | — | — | — | 🆕 Mongo-only |
| 20 | — | — | — | `isPaid` | boolean | — | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `isPopular` | boolean | — | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `startTime` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 23 | — | — | — | `courseEducatorId` | mongoose.Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 24 | — | — | — | `packageCategoryId` | mongoose.Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 25 | — | — | — | `videoCategoryId` | mongoose.Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 26 | — | — | — | `examCountdownCategoryIds` | mongoose.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 27 | — | — | — | `examCountdownIds` | mongoose.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 28 | — | — | — | `materialCategories` | ILiveCourseCategoryRef[] | — | — | — | — | 🆕 Mongo-only |
| 29 | — | — | — | `examCategories` | ILiveCourseCategoryRef[] | — | — | — | — | 🆕 Mongo-only |
| 30 | — | — | — | `scheduleFolders` | ILiveCourseScheduleFolder[] | — | — | — | — | 🆕 Mongo-only |
| 31 | — | — | — | `createdBy` | mongoose.Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 32 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 33 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.7 LiveCoursePlan — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveCoursePlan |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_course_plans` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/LiveCoursePlan.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `liveCourseId` | ObjectId | required; ref:LiveCourse | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `name` | String | null | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `duration` | Number | required; min:1  | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `price` | Number | required; min:0  | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `originalPrice` | Number | null; min:0  | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `isDefault` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.8 LivePoll — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LivePoll |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_polls` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/LivePoll.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `text` | String | required; maxlength:300 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `votes` | Number | 0; min:0  | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `liveClassId` | string | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `question` | string | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `options` | IPollOption[] | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `totalVotes` | number | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `isActive` | boolean | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `createdBy` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `createdByName` | string | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `closedAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.9 LivePollVote — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LivePollVote |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_poll_votes` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/LivePollVote.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `pollId` | ObjectId | required; ref:LivePoll | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `optionIndex` | Number | required; min:0  | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | timestamps | — | — | — | 🆕 Mongo-only |

### 5.10 LiveSession — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | LiveSession |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_live_sessions` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/LiveSession.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `quality` | String | — | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `file_size` | Number | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `path` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `title` | string | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `liveCourseIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `subject` | string | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `educatorId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `endAt` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `scheduledAt` | Date | null | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `streamId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `rtmpUrl` | string | null | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `hlsUrl` | string | null | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `hlsUrls` | Record<string, string> | null | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `status` | LiveSessionStatus | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `recordings` | ILiveSessionRecording[] | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.11 MaterialCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | MaterialCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `(default materialcategorys)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/MaterialCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `slug` | String | "" | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `image` | String | null | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `parent` | ObjectId | null; ref:MaterialCategory | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `ancestors` | mongoose.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `childCategoryIds` | mongoose.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `order` | number | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.12 PackageCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PackageCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `(default packagecategorys)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/PackageCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `slug` | String | required; unique | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `image` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.13 PackageCourseEbookPrice — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PackageCourseEbookPrice |
| **Legacy MySQL** | — |
| **MongoDB** | `(default packagecourseebookprices)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/PackageCourseEbookPrice.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `courseId` | ObjectId | null; ref:Course | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `packageId` | ObjectId | null; ref:Package | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `ebookId` | ObjectId | null; ref:Ebook | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `name` | String | null | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `duration` | Number | required | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `price` | Number | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `withMaterial` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `materialPrice` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `isDefault` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.14 PackageCourseMaterial — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PackageCourseMaterial |
| **Legacy MySQL** | — |
| **MongoDB** | `(default packagecoursematerials)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/PackageCourseMaterial.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `image` | String | null | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `isActive` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.15 PackageVideoCategoryRelation — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PackageVideoCategoryRelation |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_package_video_category_relations` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/PackageVideoCategoryRelation.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `packageId` | ObjectId | required; ref:Package | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `videoCategoryRelationId` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `active` | boolean | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.16 PromoCode — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PromoCode |
| **Legacy MySQL** | — |
| **MongoDB** | `(default promocodes)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/PromoCode.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `type` | String | — | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `promocode` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `title` | String | "" | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `description` | String | "" | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `promo_start_at` | Date | required | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `promo_expire_at` | Date | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `discountType` | String | required; "percentage" | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `discountValue` | Number | required; 0; min:0  | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `promoterId` | ObjectId | null; ref:Promoter | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `ids` | ObjectId | [] | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.17 PromotedPackageCourseEbook — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PromotedPackageCourseEbook |
| **Legacy MySQL** | — |
| **MongoDB** | `(default promotedpackagecourseebooks)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/PromotedPackageCourseEbook.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `planId` | ObjectId | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `planKind` | String | "price" | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `promocodeId` | ObjectId | required; ref:PromoCode | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `customerPercentage` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `promoterPercentage` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.18 Video — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Video |
| **Legacy MySQL** | — |
| **MongoDB** | `(default videos)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/Video.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `videoCategoryId` | ObjectId | required; ref:VideoCategory | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `liveSessionId` | ObjectId | null; ref:LiveSession | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `title` | String | "" | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `topic` | String | "" | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `slug` | String | "" | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `platform` | String | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `priceType` | String | "paid" | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `youtube_id` | String | null | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `aws_id` | String | null | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `vimeo_id` | String | null | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.19 VideoCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | VideoCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `(default videocategorys)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/VideoCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `slug` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `subjectKey` | String | null | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `image` | String | null | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `courseId` | ObjectId | null; ref:Course | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `liveCourseId` | ObjectId | null; ref:LiveCourse | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `childCategoryIds` | mongoose.Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `educatorId` | mongoose.Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `order_by` | number | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.20 VideoCategoryRelation — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | VideoCategoryRelation |
| **Legacy MySQL** | — |
| **MongoDB** | `(default videocategoryrelations)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/course/VideoCategoryRelation.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `parent` | ObjectId | required; ref:VideoCategory | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `child` | ObjectId | required; ref:VideoCategory | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 5.21 Course — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Course |
| **Legacy MySQL** | `ws_course` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_course` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `course_category_id` | `int` | NOT NULL | — | — | — | `courseSubjectCategoryId` | Int? | — | ✅ SQL+Prisma |
| 3 | `educator_id` | `int` | NOT NULL | — | — | — | `courseEducatorId` | Int? | — | ✅ SQL+Prisma |
| 4 | `vcategory_id` | `int` | NULL; DEFAULT NULL | — | — | — | `videoCategoryId` | Int? | — | ✅ SQL+Prisma |
| 5 | `name` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `name` | String? | — | ✅ SQL+Prisma |
| 6 | `image` | `varchar(256)` | NULL; DEFAULT NULL | — | — | — | `image` | String | — | ✅ SQL+Prisma |
| 7 | `description` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `description` | String | — | ✅ SQL+Prisma |
| 8 | `order_by` | `int` | NOT NULL | — | — | — | `ordered` | Int | — | ✅ SQL+Prisma |
| 9 | `shareable_link` | `varchar(256)` | NOT NULL | — | — | — | `shareableLink` | String | — | ✅ SQL+Prisma |
| 10 | `with_material` | `text` | NOT NULL | — | — | — | `withMaterial` | String | — | ✅ SQL+Prisma |
| 11 | `without_material` | `text` | NOT NULL | — | — | — | `withoutMaterial` | String | — | ✅ SQL+Prisma |
| 12 | `pc_material_id` | `int` | NULL; DEFAULT NULL | — | — | — | `pcMaterialId` | Int? | — | ✅ SQL+Prisma |
| 13 | `featured_order` | `int` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 14 | `level` | `text` | NOT NULL | — | — | — | `level` | String | — | ✅ SQL+Prisma |
| 15 | `purchase` | `enum('0','1')` | NULL; DEFAULT NULL; enum('0','1') | — | — | — | — | — | — | 🆕 MySQL-only |
| 16 | `is_featured` | `enum('0','1')` | NULL; DEFAULT '0'; enum('0','1') | — | — | — | — | — | — | 🆕 MySQL-only |
| 17 | `status` | `tinyint(1)` | NOT NULL | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 18 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 19 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |

### 5.22 CourseEducator — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CourseEducator |
| **Legacy MySQL** | `ws_course_educator` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_course_educator` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `email_address` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | `email` | String | — | ✅ SQL+Prisma |
| 3 | `password` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | `password` | String | — | ✅ SQL+Prisma |
| 4 | `name` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 5 | `image` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NULL; DEFAULT NULL | — | — | — | `image` | String | — | ✅ SQL+Prisma |
| 6 | `about` | `longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | `about` | String | — | ✅ SQL+Prisma |
| 7 | `view` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `view` | Int | — | ✅ SQL+Prisma |
| 8 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 9 | `last_seen_at` | `date` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 10 | `email_verified_at` | `date` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 11 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 12 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |

### 5.23 CourseSubjectCategory — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | CourseSubjectCategory |
| **Legacy MySQL** | `ws_course_subject_category` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_course_subject_category` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `title` | String | — | ✅ SQL+Prisma |
| 3 | `slug` | `varchar(255)` | NOT NULL | — | — | — | `slug` | String | — | ✅ SQL+Prisma |
| 4 | `parent` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `parent` | Int | — | ✅ SQL+Prisma |
| 5 | `image` | `varchar(255)` | NOT NULL; DEFAULT ' ' | — | — | — | `image` | String | — | ✅ SQL+Prisma |
| 6 | `order_by` | `int` | NOT NULL | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 7 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 8 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 9 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |

### 5.24 Material — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Material |
| **Legacy MySQL** | `ws_material` |
| **MongoDB** | `ws_materials` |
| **Post-migration MySQL** | `ws_material` |
| **Mongoose** | `src/models/course/Material.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | `title` | String | required; maxlength:255 | `name` | String | — | ✅ |
| 3 | `material_category_id` | `int` | NOT NULL | `materialCategoryId` | mongoose.Types.ObjectId | — | `materialCategoryId` | Int? | — | ✅ |
| 4 | `direct_link` | `varchar(500)` | NULL; DEFAULT NULL | `directLink` | string | — | `direct_link` | String? | — | ✅ |
| 5 | `file` | `text` | NOT NULL | `file` | string | — | `file` | String | — | ✅ |
| 6 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | boolean | — | `status` | Boolean | — | ✅ |
| 7 | `order_by` | `int` | NOT NULL | — | — | — | `order_by` | Int | — | ✅ SQL+Prisma |
| 8 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 9 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 10 | — | — | — | `description` | String | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `thumbnail` | string | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `fileSize` | number | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `fileMime` | string | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `language` | string | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `isPreview` | boolean | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `downloadCount` | number | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `order` | number | — | — | — | — | 🆕 Mongo-only |

### 5.25 MaterialCategory — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | MaterialCategory |
| **Legacy MySQL** | `ws_material_category` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_material_category` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 3 | `slug` | `varchar(255)` | NOT NULL | — | — | — | `slug` | String | — | ✅ SQL+Prisma |
| 4 | `parent` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `parent` | Int | — | ✅ SQL+Prisma |
| 5 | `image` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `image` | String? | — | ✅ SQL+Prisma |
| 6 | `order_by` | `int` | NOT NULL | — | — | — | `order_by` | Int | — | ✅ SQL+Prisma |
| 7 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 8 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 9 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.26 MaterialCategoryCourse — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | MaterialCategoryCourse |
| **Legacy MySQL** | `ws_material_category_course` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_material_category_course` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `course_id` | `int` | NOT NULL | — | — | — | `courseId` | Int? | — | ✅ SQL+Prisma |
| 3 | `mcategory_id` | `int` | NOT NULL | — | — | — | `materialCategoryId` | Int? | — | ✅ SQL+Prisma |
| 4 | `order` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 5 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 6 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.27 MaterialCategoryPackage — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | MaterialCategoryPackage |
| **Legacy MySQL** | `ws_material_category_package` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_material_category_package` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `package_id` | `int` | NOT NULL | — | — | — | `packageId` | Int? | — | ✅ SQL+Prisma |
| 3 | `mcategory_id` | `int` | NOT NULL | — | — | — | `materialCategoryId` | Int? | — | ✅ SQL+Prisma |
| 4 | `order` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 5 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 6 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.28 Package — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Package |
| **Legacy MySQL** | `ws_package` |
| **MongoDB** | `ws_packages` |
| **Post-migration MySQL** | `ws_package` |
| **Mongoose** | `src/models/course/Package.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | `name` | string | — | `name` | String | — | ✅ |
| 3 | `description` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | `description` | string | — | `description` | String | — | ✅ |
| 4 | `image` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NOT NULL | `image` | string | — | `image` | String | — | ✅ |
| 5 | `shareable_link` | `varchar(256) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | `shareableLink` | string | — | `shareable_link` | String | — | ✅ |
| 6 | `with_material` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NOT NULL | — | — | — | `withMaterial` | String | — | ✅ SQL+Prisma |
| 7 | `without_material` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NOT NULL | — | — | — | `withoutMaterial` | String | — | ✅ SQL+Prisma |
| 8 | `pc_material_id` | `int` | NULL; DEFAULT NULL | — | — | — | `pcMaterialId` | Int? | — | ✅ SQL+Prisma |
| 9 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | Boolean | true | `active` | Boolean | — | ✅ |
| 10 | `package_type_id` | `int` | NOT NULL; DEFAULT '1' | `packageTypeId` | Types.ObjectId | null | — | `packageTypeId` | Int? | — | ✅ |
| 11 | `educator_id` | `int` | NULL; DEFAULT NULL | `educatorId` | Types.ObjectId | null | — | — | — | — | ✅ |
| 12 | `exam_id` | `int` | NOT NULL; DEFAULT '1' | — | — | — | `examId` | Int? | — | ✅ SQL+Prisma |
| 13 | `order_by` | `tinyint` | NOT NULL; DEFAULT '0' | — | — | — | `order_by` | Int | — | ✅ SQL+Prisma |
| 14 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 15 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 16 | — | — | — | `category` | ObjectId | required | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `subtitle` | string | — | — | — | — | 🆕 Mongo-only |
| 19 | — | — | — | `withMaterialText` | string | — | — | — | — | 🆕 Mongo-only |
| 20 | — | — | — | `withoutMaterialText` | string | — | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `active` | boolean | — | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `isPaid` | boolean | — | — | — | — | 🆕 Mongo-only |
| 23 | — | — | — | `isSmartCourse` | boolean | — | — | — | — | 🆕 Mongo-only |
| 24 | — | — | — | `isPlannerCourse` | boolean | — | — | — | — | 🆕 Mongo-only |
| 25 | — | — | — | `goalId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 26 | — | — | — | `goalLabelId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 27 | — | — | — | `examCountdownCategoryIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 28 | — | — | — | `examCountdownIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 29 | — | — | — | `packageCategoryId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 30 | — | — | — | `specificSubjects` | IPackageCategoryRef[] | — | — | — | — | 🆕 Mongo-only |
| 31 | — | — | — | `materialCategories` | IPackageCategoryRef[] | — | — | — | — | 🆕 Mongo-only |
| 32 | — | — | — | `examCategories` | IPackageCategoryRef[] | — | — | — | — | 🆕 Mongo-only |
| 33 | — | — | — | `notificationTopic` | string | — | — | — | — | 🆕 Mongo-only |

### 5.29 chat — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | chat |
| **Legacy MySQL** | `ws_package_chat` |
| **MongoDB** | `ws_package_chats` |
| **Post-migration MySQL** | `ws_package_chat` |
| **Mongoose** | `src/models/course/PackageChat.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `package_id` | `int` | NOT NULL | `packageId` | ObjectId | required; ref:Package | `packageId` | Int | — | ✅ |
| 3 | `message` | `text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | `message` | String | — | ✅ SQL+Prisma |
| 4 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `createdAt` | DateTime? | — | ✅ |
| 5 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updatedAt` | DateTime? | — | ✅ |
| 6 | — | — | — | `text` | String | "" | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `mediaUrl` | String | maxlength:1000 | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `mediaType` | PackageChatMediaType | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `senderType` | PackageChatSenderType | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `senderId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `pushSent` | boolean | — | — | — | — | 🆕 Mongo-only |

### 5.30 PackageCourseEbookPrice — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageCourseEbookPrice |
| **Legacy MySQL** | `ws_package_course_ebook_price` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_package_course_ebook_price` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `package_id` | `int` | NULL; DEFAULT NULL | — | — | — | `packageId` | Int? | — | ✅ SQL+Prisma |
| 3 | `course_id` | `int` | NULL; DEFAULT NULL | — | — | — | `courseId` | Int? | — | ✅ SQL+Prisma |
| 4 | `ebook_id` | `int` | NULL; DEFAULT NULL | — | — | — | `ebookId` | Int? | — | ✅ SQL+Prisma |
| 5 | `name` | `varchar(150)` | NULL; DEFAULT NULL | — | — | — | `name` | String? | — | ✅ SQL+Prisma |
| 6 | `price` | `int` | NOT NULL | — | — | — | `price` | Int | — | ✅ SQL+Prisma |
| 7 | `duration` | `int` | NOT NULL | — | — | — | `duration` | Int | — | ✅ SQL+Prisma |
| 8 | `with_material` | `tinyint(1)` | NULL; DEFAULT '0' | — | — | — | `withMaterial` | Boolean | — | ✅ SQL+Prisma |
| 9 | `material_price` | `int` | NULL; DEFAULT NULL | — | — | — | `materialPrice` | Int? | — | ✅ SQL+Prisma |
| 10 | `is_default` | `tinyint(1)` | NULL; DEFAULT '0' | — | — | — | `isDefault` | Boolean | — | ✅ SQL+Prisma |
| 11 | `status` | `tinyint(1)` | NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 12 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 13 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.31 PackageCourseMaterial — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageCourseMaterial |
| **Legacy MySQL** | `ws_package_course_material` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_package_course_material` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `varchar(255)` | NOT NULL | — | — | — | `title` | String | — | ✅ SQL+Prisma |
| 3 | `created_at` | `timestamp NULL` | NULL; DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 4 | `updated_at` | `timestamp NULL` | NULL; DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.32 PackageCourseOrder — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageCourseOrder |
| **Legacy MySQL** | `ws_package_course_order` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_package_course_order` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `unique_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `uniqueId` | String? | — | ✅ SQL+Prisma |
| 3 | `customer_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `userId` | Int? | — | ✅ SQL+Prisma |
| 4 | `payment_method` | `varchar(100)` | NOT NULL | — | — | — | `paymentMethod` | PaymentMethod | — | ✅ SQL+Prisma |
| 5 | `order_type` | `enum('purchase')` | NOT NULL; DEFAULT 'purchase'; enum('purchase') | — | — | — | `orderType` | PackageCourseEbookOrderType | — | ✅ SQL+Prisma |
| 6 | `generate_from` | `enum('app','web')` | NOT NULL; DEFAULT 'app'; enum('app','web') | — | — | — | — | — | — | 🆕 MySQL-only |
| 7 | `promocode` | `json` | NULL; DEFAULT NULL | — | — | — | `promocode` | Json? | — | ✅ SQL+Prisma |
| 8 | `refferalcode` | `json` | NULL; DEFAULT NULL | — | — | — | `refferalcode` | Json? | — | ✅ SQL+Prisma |
| 9 | `plan_id` | `int` | NULL; DEFAULT NULL | — | — | — | `planId` | Int? | — | ✅ SQL+Prisma |
| 10 | `shipping` | `int` | NULL; DEFAULT NULL | — | — | — | `shipping` | Int? | — | ✅ SQL+Prisma |
| 11 | `price` | `double` | NULL; DEFAULT NULL | — | — | — | `OrigianalPrice` | Int | — | ✅ SQL+Prisma |
| 12 | `code_discount` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `codeDiscount` | Int? | — | ✅ SQL+Prisma |
| 13 | `ws_coin` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `wsCoin` | Int? | — | ✅ SQL+Prisma |
| 14 | `discount_price` | `int` | NULL; DEFAULT NULL | — | — | — | `amount` | Int | — | ✅ SQL+Prisma |
| 15 | `razorpay_order_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `gatewayOrderId` | String? | — | ✅ SQL+Prisma |
| 16 | `razorpay_payment_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `gatewayPaymentId` | String? | — | ✅ SQL+Prisma |
| 17 | `razorpay_order` | `text` | NULL | — | — | — | `gatewayOrder` | String? | — | ✅ SQL+Prisma |
| 18 | `ip_address` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `ip_address` | String? | — | ✅ SQL+Prisma |
| 19 | `bank_transaction_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `bankTransactionId` | String? | — | ✅ SQL+Prisma |
| 20 | `status` | `enum('cancel','complete','pending')` | NOT NULL; DEFAULT 'pending'; enum('cancel','complete','pending') | — | — | — | `status` | PackageCourseEbookOrderStatus | — | ✅ SQL+Prisma |
| 21 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 22 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |

### 5.33 PackageCourseSubscription — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageCourseSubscription |
| **Legacy MySQL** | `ws_package_course_subscription` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_package_course_subscription` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `customer_id` | `int` | NULL; DEFAULT NULL | — | — | — | `customerId` | Int? | — | ✅ SQL+Prisma |
| 3 | `order_id` | `int` | NULL; DEFAULT NULL | — | — | — | `orderId` | Int? | — | ✅ SQL+Prisma |
| 4 | `package_id` | `int` | NULL; DEFAULT NULL | — | — | — | `packageId` | Int? | — | ✅ SQL+Prisma |
| 5 | `course_id` | `int` | NULL; DEFAULT NULL | — | — | — | `courseId` | Int? | — | ✅ SQL+Prisma |
| 6 | `pcb_id` | `int` | NULL; DEFAULT NULL | — | — | — | `planId` | Int? | — | ✅ SQL+Prisma |
| 7 | `pc_material_id` | `int` | NULL; DEFAULT NULL | — | — | — | `pcMaterialId` | Int? | — | ✅ SQL+Prisma |
| 8 | `shipping` | `int` | NULL; DEFAULT NULL | — | — | — | `shippingId` | Int? | — | ✅ SQL+Prisma |
| 9 | `tracking` | `bigint` | NULL; DEFAULT NULL | — | — | — | `trackingId` | Int? | — | ✅ SQL+Prisma |
| 10 | `start_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `startAt` | DateTime? | — | ✅ SQL+Prisma |
| 11 | `end_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `endAt` | DateTime? | — | ✅ SQL+Prisma |
| 12 | `amount` | `double` | NULL; DEFAULT NULL | — | — | — | `amount` | Decimal? | — | ✅ SQL+Prisma |
| 13 | `course_amount` | `double` | NULL; DEFAULT NULL | — | — | — | `courseAmount` | Decimal? | — | ✅ SQL+Prisma |
| 14 | `material_amount` | `double` | NULL; DEFAULT NULL | — | — | — | `materialAmount` | Decimal? | — | ✅ SQL+Prisma |
| 15 | `status` | `tinyint` | NULL; DEFAULT NULL | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 16 | `remarks` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL | — | — | — | `remarks` | String? | — | ✅ SQL+Prisma |
| 17 | `payment_type` | `enum('backend','online') CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NOT NULL; DEFAULT 'online'; enum('backend','online') | — | — | — | `payment_type` | PackageCourseEbookPaymentType | — | ✅ SQL+Prisma |
| 18 | `created_by` | `int` | NULL; DEFAULT NULL | — | — | — | `created_by` | Int? | — | ✅ SQL+Prisma |
| 19 | `updated_by` | `int` | NULL; DEFAULT NULL | — | — | — | `updated_by` | Int? | — | ✅ SQL+Prisma |
| 20 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 21 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |

### 5.34 PackageCourseSubscriptionTracking — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageCourseSubscriptionTracking |
| **Legacy MySQL** | `ws_package_course_subscription_tracking` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_package_course_subscription_tracking` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `order` | `int` | NOT NULL | — | — | — | `orderId` | Int? | — | ✅ SQL+Prisma |
| 3 | `status` | `varchar(25)` | NOT NULL; DEFAULT 'pending' | — | — | — | `status` | String | — | ✅ SQL+Prisma |
| 4 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 5 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.35 PackageSpecificSubject — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageSpecificSubject |
| **Legacy MySQL** | `ws_package_specific_subject` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_package_specific_subject` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `package_id` | `int` | NOT NULL | — | — | — | `packageId` | Int? | — | ✅ SQL+Prisma |
| 3 | `subject_id` | `int` | NOT NULL | — | — | — | `subjectId` | Int? | — | ✅ SQL+Prisma |
| 4 | `order_by` | `int` | NOT NULL | — | — | — | `order_by` | Int | — | ✅ SQL+Prisma |
| 5 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 6 | `created_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 7 | `updated_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.36 PackageType — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageType |
| **Legacy MySQL** | `ws_package_type` |
| **MongoDB** | `ws_package_types` |
| **Post-migration MySQL** | `ws_package_type` |
| **Mongoose** | `src/models/course/PackageType.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255)` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | @db.VarChar(255) | ✅ |
| 3 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 4 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 5 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `active` | Boolean | true | — | — | — | 🆕 Mongo-only |

### 5.37 PendriveCourse — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PendriveCourse |
| **Legacy MySQL** | `ws_pendrive_course` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_pendrive_course` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(100)` | NOT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 3 | `thumbnail` | `varchar(250)` | NOT NULL | — | — | — | `thumbnail` | String | — | ✅ SQL+Prisma |
| 4 | `image` | `json` | NULL; DEFAULT NULL | — | — | — | `image` | Json? | — | ✅ SQL+Prisma |
| 5 | `orderby` | `int` | NOT NULL | — | — | — | `orderby` | Int | — | ✅ SQL+Prisma |
| 6 | `description` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `description` | String | — | ✅ SQL+Prisma |
| 7 | `language` | `varchar(50)` | NOT NULL | — | — | — | `language` | String | — | ✅ SQL+Prisma |
| 8 | `pendrive` | `varchar(50)` | NOT NULL | — | — | — | `pendrive` | String | — | ✅ SQL+Prisma |
| 9 | `dynamicLink` | `varchar(255)` | NOT NULL | — | — | — | `dynamicLink` | String | — | ⚠️ check |
| 10 | `duration` | `int` | NOT NULL | — | — | — | `duration` | Int | — | ✅ SQL+Prisma |
| 11 | `courseStorage` | `int` | NOT NULL | — | — | — | `courseStorage` | Int | — | ⚠️ check |
| 12 | `courseStorageUnit` | `varchar(20)` | NOT NULL | — | — | — | `courseStorageUnit` | String | — | ⚠️ check |
| 13 | `noOfSubjects` | `int` | NOT NULL | — | — | — | `noOfSubjects` | Int | — | ⚠️ check |
| 14 | `noOfVideos` | `int` | NOT NULL | — | — | — | `noOfVideos` | Int | — | ⚠️ check |
| 15 | `listPrice` | `int` | NOT NULL | — | — | — | `listPrice` | Int | — | ⚠️ check |
| 16 | `discountedPrice` | `int` | NOT NULL | — | — | — | `discountedPrice` | Int | — | ⚠️ check |
| 17 | `shippingPrice` | `int` | NOT NULL | — | — | — | `shippingPrice` | Int | — | ⚠️ check |
| 18 | `withMaterial` | `tinyint(1)` | NOT NULL | — | — | — | `withMaterial` | Boolean | — | ⚠️ check |
| 19 | `materialName` | `text` | NOT NULL | — | — | — | `materialName` | String | — | ⚠️ check |
| 20 | `materialPrice` | `int` | NOT NULL | — | — | — | `materialPrice` | Int | — | ⚠️ check |
| 21 | `examTag` | `json` | NULL; DEFAULT NULL | — | — | — | `examTag` | Json? | — | ⚠️ check |
| 22 | `isCombo` | `tinyint(1)` | NOT NULL | — | — | — | `isCombo` | Boolean | — | ⚠️ check |
| 23 | `active` | `tinyint(1)` | NOT NULL | — | — | — | `active` | Boolean | — | ✅ SQL+Prisma |
| 24 | `createdAt` | `datetime` | NOT NULL | — | — | — | `createdAt` | DateTime? | — | ⚠️ check |

### 5.38 PendriveCourseCart — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PendriveCourseCart |
| **Legacy MySQL** | `ws_pendrive_course_cart` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_pendrive_course_cart` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `user` | `int` | NOT NULL | — | — | — | `user` | Int? | — | ✅ SQL+Prisma |
| 3 | `shipping` | `int` | NULL; DEFAULT NULL | — | — | — | `shipping` | Int? | — | ✅ SQL+Prisma |
| 4 | `storageDevice` | `int` | NULL; DEFAULT NULL | — | — | — | `storageDevice` | Int? | — | ⚠️ check |
| 5 | `active` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `active` | Boolean | — | ✅ SQL+Prisma |

### 5.39 PendriveCourseCartItem — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PendriveCourseCartItem |
| **Legacy MySQL** | `ws_pendrive_course_cart_item` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_pendrive_course_cart_item` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `cart` | `int` | NOT NULL | — | — | — | `cart` | Int? | — | ✅ SQL+Prisma |
| 3 | `pendriveCourse` | `int` | NOT NULL | — | — | — | `pendriveCourse` | Int? | — | ⚠️ check |

### 5.40 PendriveCourseOrder — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PendriveCourseOrder |
| **Legacy MySQL** | `ws_pendrive_course_order` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_pendrive_course_order` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `receiptId` | `varchar(50)` | NOT NULL | — | — | — | `receiptId` | String | — | ⚠️ check |
| 3 | `user` | `int` | NOT NULL | — | — | — | `user` | Int? | — | ✅ SQL+Prisma |
| 4 | `cart` | `int` | NOT NULL | — | — | — | `cart` | Int | — | ✅ SQL+Prisma |
| 5 | `shipping` | `int` | NOT NULL | — | — | — | `shipping` | Int? | — | ✅ SQL+Prisma |
| 6 | `tracking` | `bigint` | NULL; DEFAULT NULL | — | — | — | `tracking` | Int? | — | ✅ SQL+Prisma |
| 7 | `orderType` | `varchar(25)` | NOT NULL | — | — | — | `orderType` | String | — | ⚠️ check |
| 8 | `storageDevice` | `int` | NOT NULL | — | — | — | `storageDevice` | Int? | — | ⚠️ check |
| 9 | `orderItems` | `text` | NOT NULL | — | — | — | `orderItems` | String | — | ⚠️ check |
| 10 | `amount` | `float` | NOT NULL | — | — | — | `amount` | Decimal | — | ✅ SQL+Prisma |
| 11 | `paymentMethod` | `varchar(25)` | NOT NULL; DEFAULT 'razorpay' | — | — | — | `paymentMethod` | PaymentMethod | — | ⚠️ check |
| 12 | `gatewayOrderID` | `varchar(25)` | NULL; DEFAULT NULL | — | — | — | `gatewayOrderId` | String | — | ✅ SQL+Prisma |
| 13 | `gatewayPaymentID` | `varchar(25)` | NULL; DEFAULT NULL | — | — | — | `gatewayPaymentId` | String? | — | ✅ SQL+Prisma |
| 14 | `createdAt` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `createdAt` | DateTime? | — | ⚠️ check |
| 15 | `updatedAt` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `updatedAt` | DateTime? | — | ⚠️ check |
| 16 | `status` | `varchar(25)` | NOT NULL | — | — | — | `status` | String | — | ✅ SQL+Prisma |

### 5.41 PendriveCourseStorageDevice — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PendriveCourseStorageDevice |
| **Legacy MySQL** | `ws_pendrive_course_storage_device` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_pendrive_course_storage_device` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(50)` | NOT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 3 | `note` | `varchar(250)` | NOT NULL | — | — | — | `note` | String | — | ✅ SQL+Prisma |
| 4 | `isDefault` | `tinyint(1)` | NOT NULL | — | — | — | `isDefault` | Boolean | — | ⚠️ check |
| 5 | `active` | `tinyint(1)` | NOT NULL | — | — | — | `active` | Boolean | — | ✅ SQL+Prisma |

### 5.42 PendriveCourseTag — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PendriveCourseTag |
| **Legacy MySQL** | `ws_pendrive_course_tag` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_pendrive_course_tag` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `tag_id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `tag_name` | `varchar(255)` | NOT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 3 | `tag_count` | `int` | NULL; DEFAULT NULL | — | — | — | `count` | Int? | — | ✅ SQL+Prisma |
| 4 | `tag_image` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `image` | String? | — | ✅ SQL+Prisma |
| 5 | `tag_featured` | `int` | NULL; DEFAULT NULL | — | — | — | `featured` | Int? | — | ✅ SQL+Prisma |

### 5.43 PendriveCourseTracking — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PendriveCourseTracking |
| **Legacy MySQL** | `ws_pendrive_course_tracking` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_pendrive_course_tracking` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `order` | `int` | NOT NULL | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 3 | `status` | `varchar(25)` | NOT NULL; DEFAULT 'pending' | — | — | — | `status` | String | — | ✅ SQL+Prisma |
| 4 | `createdAt` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `createdAt` | DateTime? | — | ⚠️ check |
| 5 | `updatedAt` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `updatedAt` | DateTime? | — | ⚠️ check |

### 5.44 Video — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Video |
| **Legacy MySQL** | `ws_video` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_video` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `vcategory_id` | `int` | NOT NULL | — | — | — | `videoCategoryId` | Int? | — | ✅ SQL+Prisma |
| 3 | `title` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `title` | String | — | ✅ SQL+Prisma |
| 4 | `topic` | `varchar(25) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `topic` | String | — | ✅ SQL+Prisma |
| 5 | `platform` | `varchar(255)` | NOT NULL; DEFAULT ' ' | — | — | — | `platform` | String | — | ✅ SQL+Prisma |
| 6 | `vimeo_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `vimeo_id` | String? | — | ✅ SQL+Prisma |
| 7 | `aws_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `aws_id` | String? | — | ✅ SQL+Prisma |
| 8 | `youtube_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `youtube_id` | String? | — | ✅ SQL+Prisma |
| 9 | `slug` | `varchar(255)` | NOT NULL | — | — | — | `slug` | String | — | ✅ SQL+Prisma |
| 10 | `order_by` | `int` | NOT NULL | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 11 | `type` | `enum('free','paid')` | NOT NULL; DEFAULT 'free'; enum('free','paid') | — | — | — | `priceType` | VideoType | — | ✅ SQL+Prisma |
| 12 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 13 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 14 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.45 VideoCategory — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | VideoCategory |
| **Legacy MySQL** | `ws_video_category` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_video_category` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `title` | String | — | ✅ SQL+Prisma |
| 3 | `slug` | `varchar(255)` | NOT NULL | — | — | — | `slug` | String | — | ✅ SQL+Prisma |
| 4 | `parent` | `int` | NOT NULL; DEFAULT '0' | — | — | — | — | — | — | 🆕 MySQL-only |
| 5 | `educator_id` | `int` | NOT NULL; DEFAULT '0' | — | — | — | — | — | — | 🆕 MySQL-only |
| 6 | `image` | `varchar(255)` | NOT NULL; DEFAULT ' ' | — | — | — | `image` | String | — | ✅ SQL+Prisma |
| 7 | `pdf` | `varchar(255)` | NOT NULL; DEFAULT ' ' | — | — | — | — | — | — | 🆕 MySQL-only |
| 8 | `order_by` | `int` | NOT NULL | — | — | — | `order_by` | Int | — | ✅ SQL+Prisma |
| 9 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 10 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 11 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.46 PackageVideoCategoryRelation — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PackageVideoCategoryRelation |
| **Legacy MySQL** | `ws_video_category_package_relation` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_video_category_package_relation` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `video_category_relation_id` | `int` | NULL; DEFAULT NULL | — | — | — | `videoCategoryRelationId` | Int | — | ✅ SQL+Prisma |
| 3 | `package_id` | `int` | NULL; DEFAULT NULL | — | — | — | `packageId` | Int | — | ✅ SQL+Prisma |
| 4 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 5 | `created_at` | `timestamp NULL` | NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 6 | `updated_at` | `timestamp` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 5.47 VideoCategoryRelation — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | VideoCategoryRelation |
| **Legacy MySQL** | `ws_video_category_relation` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_video_category_relation` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `parent` | `int` | NOT NULL | — | — | — | `parent` | Int | — | ✅ SQL+Prisma |
| 3 | `child` | `int` | NOT NULL | — | — | — | `child` | Int | — | ✅ SQL+Prisma |
| 4 | `order` | `int` | NOT NULL; DEFAULT '1' | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 5 | `created_at` | `timestamp` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | — | — | — | 🆕 MySQL-only |
| 6 | `updated_at` | `timestamp` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | — | — | — | 🆕 MySQL-only |


<a id="module-ebook"></a>

## 6. E-books

> Module key: `ebook` — 8 entities

### 6.1 Ebook — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Ebook |
| **Legacy MySQL** | — |
| **MongoDB** | `(default ebooks)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/ebook/Ebook.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `examCountdownCategoryId` | mongoose.Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `description` | string | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `author` | string | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `publisher` | string | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `language` | EBookLanguage | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `order` | number | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `image` | string | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `thumbnail` | string | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `demoUrl` | string | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `bookUrl` | string | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `demoFileName` | string | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `bookFileName` | string | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `link` | string | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `termsAndConditions` | string | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `isTrending` | boolean | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 19 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 6.2 EbookDownload — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | EbookDownload |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_ebook_downloads` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/ebook/EbookDownload.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `ebookId` | ObjectId | required; ref:Ebook | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `downloadedAt` | Date | Date.now | — | — | — | 🆕 Mongo-only |

### 6.3 EbookOrder — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | EbookOrder |
| **Legacy MySQL** | — |
| **MongoDB** | `(default ebookorders)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/ebook/EbookOrder.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `ebookId` | ObjectId | required; ref:Ebook | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `planId` | ObjectId | null; ref:EbookPrice | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `paymentMethod` | String | required | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `orderType` | String | PackageCourseEbookOrderType.PURCHASE | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `orderPrice` | Number | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `razorpayOrderId` | String | null | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `razorpayPaymentId` | String | null | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `ipAddress` | String | null | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `transactionId` | String | null | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `status` | String | PackageCourseEbookOrderStatus.PENDING | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 6.4 EbookPrice — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | EbookPrice |
| **Legacy MySQL** | — |
| **MongoDB** | `(default ebookprices)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/ebook/EbookPrice.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `ebookId` | ObjectId | required; ref:Ebook | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `name` | String | null | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `duration` | Number | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `price` | Number | required | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `isDefault` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 6.5 EbookSubscription — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | EbookSubscription |
| **Legacy MySQL** | — |
| **MongoDB** | `(default ebooksubscriptions)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/ebook/EbookSubscription.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `orderId` | ObjectId | required; ref:EbookOrder | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `ebookId` | ObjectId | required; ref:Ebook | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `price` | Number | required | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `startAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `endAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `remarks` | String | null | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `paymentType` | String | PackageCourseEbookPaymentType.BACKEND | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `promocodeId` | ObjectId | null; ref:PromoCode | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `promoterId` | ObjectId | null; ref:Promoter | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `referrerId` | ObjectId | null; ref:Customer | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 6.6 EBook — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | EBook |
| **Legacy MySQL** | `ws_ebook` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_ebook` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(256) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 3 | `thumbnail` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci` | NOT NULL | — | — | — | `thumbnail` | String | — | ✅ SQL+Prisma |
| 4 | `image` | `varchar(256)` | NOT NULL | — | — | — | `image` | String | — | ✅ SQL+Prisma |
| 5 | `description` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NULL | — | — | — | `description` | String | — | ✅ SQL+Prisma |
| 6 | `terms_and_conditions` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `termsAndConditions` | String | — | ✅ SQL+Prisma |
| 7 | `author` | `varchar(256) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NULL; DEFAULT NULL | — | — | — | `author` | String | — | ✅ SQL+Prisma |
| 8 | `publisher` | `varchar(256)` | NULL; DEFAULT NULL | — | — | — | `publisher` | String? | — | ✅ SQL+Prisma |
| 9 | `order_by` | `int` | NOT NULL | — | — | — | `orderby` | Int | — | ✅ SQL+Prisma |
| 10 | `language` | `enum('English','Gujarati','Hindi')` | NULL; DEFAULT 'Gujarati'; enum('English','Gujarati','Hindi') | — | — | — | `language` | EBookLanguage | — | ✅ SQL+Prisma |
| 11 | `demo_url` | `varchar(255)` | NOT NULL | — | — | — | `bookDemoUrl` | String | — | ✅ SQL+Prisma |
| 12 | `book_url` | `varchar(255)` | NOT NULL | — | — | — | `bookUrl` | String | — | ✅ SQL+Prisma |
| 13 | `link` | `varchar(255)` | NOT NULL | — | — | — | `shareableLink` | String | — | ✅ SQL+Prisma |
| 14 | `status` | `tinyint(1)` | NOT NULL | — | — | — | `active` | Boolean | — | ✅ SQL+Prisma |
| 15 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 16 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |

### 6.7 EBookOrder — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | EBookOrder |
| **Legacy MySQL** | `ws_ebook_order` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_ebook_order` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `unique_id` | `varchar(255)` | NOT NULL | — | — | — | `uniqueId` | String | — | ✅ SQL+Prisma |
| 3 | `customer_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `userId` | Int? | — | ✅ SQL+Prisma |
| 4 | `payment_method` | `varchar(100)` | NOT NULL | — | — | — | `paymentMethod` | PaymentMethod | — | ✅ SQL+Prisma |
| 5 | `order_type` | `enum('purchase')` | NOT NULL; DEFAULT 'purchase'; enum('purchase') | — | — | — | `orderType` | PackageCourseEbookOrderType | — | ✅ SQL+Prisma |
| 6 | `promocode` | `json` | NULL; DEFAULT NULL | — | — | — | `promocode` | Json? | — | ✅ SQL+Prisma |
| 7 | `plan_id` | `int` | NOT NULL | — | — | — | `planId` | Int? | — | ✅ SQL+Prisma |
| 8 | `order_price` | `double(10,2)` | NOT NULL | — | — | — | `orderPrice` | Int | — | ✅ SQL+Prisma |
| 9 | `razorpay_order_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `gatewayOrderId` | String | — | ✅ SQL+Prisma |
| 10 | `razorpay_payment_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `gatewayPaymentId` | String? | — | ✅ SQL+Prisma |
| 11 | `razorpay_order` | `text` | NULL | — | — | — | `gatewayOrder` | String? | — | ✅ SQL+Prisma |
| 12 | `ip_address` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `ip_address` | String? | — | ✅ SQL+Prisma |
| 13 | `transaction_id` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `bankTransactionId` | String? | — | ✅ SQL+Prisma |
| 14 | `status` | `enum('cancel','complete','pending')` | NOT NULL; DEFAULT 'pending'; enum('cancel','complete','pending') | — | — | — | `status` | PackageCourseEbookOrderStatus | — | ✅ SQL+Prisma |
| 15 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 16 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |

### 6.8 EBookSubscription — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | EBookSubscription |
| **Legacy MySQL** | `ws_ebook_subscription` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_ebook_subscription` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `order_id` | `int` | NOT NULL | — | — | — | `orderId` | Int? | — | ✅ SQL+Prisma |
| 3 | `customer_id` | `int` | NOT NULL | — | — | — | `customerId` | Int? | — | ✅ SQL+Prisma |
| 4 | `ebook_id` | `int` | NOT NULL | — | — | — | `ebookId` | Int? | — | ✅ SQL+Prisma |
| 5 | `price` | `double(10,2)` | NOT NULL; DEFAULT '0.00' | — | — | — | `price` | Decimal | — | ✅ SQL+Prisma |
| 6 | `start_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `startAt` | DateTime | — | ✅ SQL+Prisma |
| 7 | `end_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `endAt` | DateTime | — | ✅ SQL+Prisma |
| 8 | `remarks` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL | — | — | — | `remarks` | String? | — | ✅ SQL+Prisma |
| 9 | `payment_type` | `enum('online','backend') CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NOT NULL; DEFAULT 'online'; enum('online','backend') | — | — | — | — | — | — | 🆕 MySQL-only |
| 10 | `status` | `tinyint(1)` | NULL; DEFAULT '1' | — | — | — | — | — | — | 🆕 MySQL-only |
| 11 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 12 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |


<a id="module-exam"></a>

## 7. Exams & results

> Module key: `exam` — 10 entities

### 7.1 ExamCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ExamCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_exam_categories` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/exam/ExamCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `image` | String | maxlength:500 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `parentId` | ObjectId | null; ref:ExamCategory | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `ancestors` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `childCategoryIds` | Types.ObjectId[] | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `orderBy` | number | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 7.2 Exam — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Exam |
| **Legacy MySQL** | `ws_exam` |
| **MongoDB** | `ws_exam` |
| **Post-migration MySQL** | `ws_exam` |
| **Mongoose** | `src/models/exam/Exam.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `type` | `enum('daily','subject')` | NOT NULL; enum('daily','subject') | `type` | ExamType | — | `type` | ExamType | — | ✅ |
| 3 | `exam_category_id` | `int` | NOT NULL | — | — | — | `examCategoryId` | Int? | — | ✅ SQL+Prisma |
| 4 | `is_paid` | `tinyint(1)` | NOT NULL; DEFAULT '0' | `isPaid` | boolean | — | `isPaid` | Boolean | — | ✅ |
| 5 | `title` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NULL | `title` | String | required; maxlength:255 | `name` | String | — | ✅ |
| 6 | `description` | `text` | NULL | `description` | String | — | `description` | String | — | ✅ |
| 7 | `time` | `int` | NOT NULL | — | — | — | `time` | Int | — | ✅ SQL+Prisma |
| 8 | `questions` | `int` | NOT NULL | — | — | — | `numberOfQuestions` | Int | — | ✅ SQL+Prisma |
| 9 | `positive_marks` | `decimal(10,2)` | NOT NULL; DEFAULT '1.00' | `positiveMarks` | number | — | `positiveMarks` | Decimal | — | ✅ |
| 10 | `negative_marks` | `decimal(10,2)` | NOT NULL; DEFAULT '-0.33' | `negativeMarks` | number | — | `negativeMarks` | Decimal | — | ✅ |
| 11 | `solution_pdf` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `solution` | String? | — | ✅ SQL+Prisma |
| 12 | `start_date` | `datetime` | NOT NULL | — | — | — | `startAt` | DateTime? | — | ✅ SQL+Prisma |
| 13 | `end_date` | `datetime` | NOT NULL | — | — | — | `endAt` | DateTime? | — | ✅ SQL+Prisma |
| 14 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | ExamStatus | — | `status` | Boolean | — | ✅ |
| 15 | `order_by` | `float` | NOT NULL | `orderBy` | number | — | `order_by` | Int | — | ✅ |
| 16 | `send_push` | `tinyint(1)` | NOT NULL; DEFAULT '0' | `sendPush` | boolean | — | `send_push` | Boolean | — | ✅ |
| 17 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `createAt` | DateTime? | — | ✅ |
| 18 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updatedAt` | DateTime? | — | ✅ |
| 19 | — | — | — | `categoryId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 20 | — | — | — | `durationMinutes` | number | — | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `questionCount` | number | — | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `passingMarks` | number | — | — | — | — | 🆕 Mongo-only |
| 23 | — | — | — | `solutionPdfUrl` | string | — | — | — | — | 🆕 Mongo-only |
| 24 | — | — | — | `instructions` | string | — | — | — | — | 🆕 Mongo-only |
| 25 | — | — | — | `policy` | string | — | — | — | — | 🆕 Mongo-only |
| 26 | — | — | — | `startAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 27 | — | — | — | `endAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 28 | — | — | — | `language` | ExamLanguage | — | — | — | — | 🆕 Mongo-only |
| 29 | — | — | — | `difficulty` | ExamDifficulty | — | — | — | — | 🆕 Mongo-only |

### 7.3 ExamCategory — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamCategory |
| **Legacy MySQL** | `ws_exam_category` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_exam_category` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 3 | `image` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | — | — | — | `image` | String | — | ✅ SQL+Prisma |
| 4 | `parent_id` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `parent` | Int | — | ✅ SQL+Prisma |
| 5 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '0' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 6 | `order_by` | `int` | NOT NULL | — | — | — | `order_by` | Int | — | ✅ SQL+Prisma |
| 7 | `deleted` | `tinyint(1)` | NOT NULL; DEFAULT '0' | — | — | — | `deleted` | Boolean | — | ✅ SQL+Prisma |
| 8 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 9 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 7.4 ExamCategoryCourse — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamCategoryCourse |
| **Legacy MySQL** | `ws_exam_category_course` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_exam_category_course` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `course_id` | `int` | NOT NULL | — | — | — | `courseId` | Int? | — | ✅ SQL+Prisma |
| 3 | `exam_category_id` | `int` | NOT NULL | — | — | — | `examCategoryId` | Int? | — | ✅ SQL+Prisma |
| 4 | `order` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 5 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 6 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 7.5 ExamCategoryPackage — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamCategoryPackage |
| **Legacy MySQL** | `ws_exam_category_package` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_exam_category_package` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `package_id` | `int` | NOT NULL | — | — | — | `packageId` | Int? | — | ✅ SQL+Prisma |
| 3 | `exam_category_id` | `int` | NOT NULL | — | — | — | `examCategoryId` | Int? | — | ✅ SQL+Prisma |
| 4 | `order` | `int` | NOT NULL; DEFAULT '0' | — | — | — | `order` | Int | — | ✅ SQL+Prisma |
| 5 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 6 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 7.6 ExamQuestion — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamQuestion |
| **Legacy MySQL** | `ws_exam_question` |
| **MongoDB** | `ws_exam_question` |
| **Post-migration MySQL** | `ws_exam_question` |
| **Mongoose** | `src/models/exam/ExamQuestion.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci` | NULL | `title` | String | required | `name` | String | — | ✅ |
| 3 | `answer` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | `answer` | String | required; maxlength:1000 | `answer` | String | — | ✅ |
| 4 | `exam_id` | `int` | NOT NULL | `examId` | ObjectId | required; ref:Exam | `exam` | Int? | — | ✅ |
| 5 | `image` | `varchar(255)` | NULL; DEFAULT NULL | `image` | String | null; maxlength:500 | `image` | String? | — | ✅ |
| 6 | `solution_text` | `text CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | `solutionText` | String | null | `solutionDescription` | String? | — | ✅ |
| 7 | `solution_image` | `varchar(255)` | NULL; DEFAULT NULL | `solutionImage` | String | null; maxlength:500 | `solutionFile` | String? | — | ✅ |
| 8 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | Boolean | true | `status` | Boolean | — | ✅ |
| 9 | `order_by` | `int` | NOT NULL | `orderBy` | Number | 0 | `order_by` | Int | — | ✅ |
| 10 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `createdAt` | DateTime? | — | ✅ |
| 11 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updatedAt` | DateTime? | — | ✅ |

### 7.7 ExamQuestionOption — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamQuestionOption |
| **Legacy MySQL** | `ws_exam_question_option` |
| **MongoDB** | `ws_exam_question_option` |
| **Post-migration MySQL** | `ws_exam_question_option` |
| **Mongoose** | `src/models/exam/ExamQuestionOption.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `title` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci` | NOT NULL | — | — | — | `name` | String | — | ✅ SQL+Prisma |
| 3 | `question_id` | `int` | NOT NULL | `questionId` | ObjectId | required; ref:ExamQuestion | `question` | Int? | — | ✅ |
| 4 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `createdAt` | DateTime? | — | ✅ |
| 5 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updatedAt` | DateTime? | — | ✅ |
| 6 | — | — | — | `name` | String | required; maxlength:1000 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `image` | String | null; maxlength:500 | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `orderBy` | Number | 0 | — | — | — | 🆕 Mongo-only |

### 7.8 ExamResult — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamResult |
| **Legacy MySQL** | `ws_exam_result` |
| **MongoDB** | `ws_exam_result` |
| **Post-migration MySQL** | `ws_exam_result` |
| **Mongoose** | `src/models/exam/ExamResult.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `qresult_id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `qresult_customer_id` | `int` | NOT NULL | — | — | — | `customerId` | Int? | — | ✅ SQL+Prisma |
| 3 | `qresult_qtest_id` | `int` | NOT NULL | — | — | — | `examId` | Int? | — | ✅ SQL+Prisma |
| 4 | `qresult_total` | `int` | NOT NULL | — | — | — | `total` | Int | — | ✅ SQL+Prisma |
| 5 | `qresult_attempt` | `int` | NOT NULL | — | — | — | `attempt` | Int | — | ✅ SQL+Prisma |
| 6 | `qresult_skip` | `int` | NOT NULL | — | — | — | `skip` | Int | — | ✅ SQL+Prisma |
| 7 | `qresult_true` | `int` | NOT NULL | — | — | — | `success` | Int | — | ✅ SQL+Prisma |
| 8 | `qresult_false` | `int` | NOT NULL | — | — | — | `failed` | Int | — | ✅ SQL+Prisma |
| 9 | `qresult_result` | `decimal(10,2)` | NOT NULL; DEFAULT '0.00' | — | — | — | `score` | Decimal | — | ✅ SQL+Prisma |
| 10 | `qresult_timing` | `varchar(100)` | NOT NULL | — | — | — | `timing` | String | — | ✅ SQL+Prisma |
| 11 | `qresult_ratting` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `ratting` | String? | — | ✅ SQL+Prisma |
| 12 | `qresult_solution` | `varchar(255)` | NULL; DEFAULT NULL | — | — | — | `solution` | String? | — | ✅ SQL+Prisma |
| 13 | `qresult_created_date` | `timestamp` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 14 | `qresult_status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean? | — | ✅ SQL+Prisma |
| 15 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `examId` | ObjectId | required; ref:Exam | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `attemptNumber` | Number | required; 1 | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `total` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 19 | — | — | — | `attempt` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 20 | — | — | — | `skip` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 21 | — | — | — | `success` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 22 | — | — | — | `failed` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 23 | — | — | — | `score` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 24 | — | — | — | `timing` | String | required; "00:00" | — | — | — | 🆕 Mongo-only |
| 25 | — | — | — | `ratting` | String | null | — | — | — | 🆕 Mongo-only |
| 26 | — | — | — | `solution` | String | null | — | — | — | 🆕 Mongo-only |
| 27 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 28 | — | — | — | `inProgress` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 29 | — | — | — | `startedAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 30 | — | — | — | `submittedAt` | Date | null | — | — | — | 🆕 Mongo-only |
| 31 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 32 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 7.9 ExamResultDetail — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamResultDetail |
| **Legacy MySQL** | `ws_exam_result_detail` |
| **MongoDB** | `ws_exam_result_detail` |
| **Post-migration MySQL** | `ws_exam_result_detail` |
| **Mongoose** | `src/models/exam/ExamResultDetail.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `qresult_detail_id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `qresult_detail_qresult_id` | `int` | NULL; DEFAULT NULL | — | — | — | `examResultId` | Int? | — | ✅ SQL+Prisma |
| 3 | `qresult_detail_qtest_id` | `int` | NOT NULL | — | — | — | `examId` | Int? | — | ✅ SQL+Prisma |
| 4 | `qresult_detail_customer_id` | `int` | NOT NULL | — | — | — | `customerId` | Int? | — | ✅ SQL+Prisma |
| 5 | `qresult_detail_question_id` | `int` | NOT NULL | — | — | — | `questionId` | Int? | — | ✅ SQL+Prisma |
| 6 | `qresult_detail_answer_id` | `int` | NULL; DEFAULT NULL | — | — | — | `answerId` | Int? | — | ✅ SQL+Prisma |
| 7 | `qresult_detail_result` | `enum('true','false','skip')` | NOT NULL; DEFAULT 'false'; enum('true','false','skip') | — | — | — | `result` | ExamResultType | — | ✅ SQL+Prisma |
| 8 | `qresult_detail_point` | `varchar(11)` | NOT NULL | — | — | — | `point` | Decimal | — | ✅ SQL+Prisma |
| 9 | — | — | — | `examResultId` | ObjectId | required; ref:ExamResult | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `examId` | ObjectId | required; ref:Exam | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `questionId` | ObjectId | required; ref:ExamQuestion | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `answerId` | ObjectId | null; ref:ExamQuestionOption | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `result` | ExamResultType | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `point` | number | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 7.10 ExamResultDetailAnalytics — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | ExamResultDetailAnalytics |
| **Legacy MySQL** | `ws_exam_result_detail_analytics` |
| **MongoDB** | `ws_exam_result_detail_analytics` |
| **Post-migration MySQL** | `ws_exam_result_detail_analytics` |
| **Mongoose** | `src/models/exam/ExamResultDetailAnalytics.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `userId` | `int` | NOT NULL | — | — | — | `customerId` | Int? | — | ✅ SQL+Prisma |
| 3 | `exams` | `int` | NOT NULL | `exams` | Number | 0 | `exams` | Int | — | ✅ |
| 4 | `questions` | `int` | NOT NULL | `questions` | Number | 0 | `questions` | Int | — | ✅ |
| 5 | `attempt` | `int` | NOT NULL | `attempt` | Number | 0 | `attempt` | Int | — | ✅ |
| 6 | `skip` | `int` | NOT NULL | `skip` | Number | 0 | `skip` | Int | — | ✅ |
| 7 | `success` | `int` | NOT NULL | `success` | Number | 0 | `success` | Int | — | ✅ |
| 8 | `failed` | `int` | NOT NULL | `failed` | Number | 0 | `failed` | Int | — | ✅ |
| 9 | `score` | `float(11,2)` | NOT NULL | `score` | Number | 0 | `score` | Decimal | — | ✅ |
| 10 | — | — | — | `customerId` | ObjectId | required; unique; ref:Customer | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |


<a id="module-examCountdown"></a>

## 8. Exam countdown

> Module key: `examCountdown` — 2 entities

### 8.1 ExamCountdown — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ExamCountdown |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_exam_countdowns` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/examCountdown/ExamCountdown.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required; maxlength:200 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `categoryId` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `examDate` | Date | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `description` | string | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 8.2 ExamCountdownCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ExamCountdownCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_exam_countdown_categories` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/examCountdown/ExamCountdownCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required; maxlength:60 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `colorHex` | string | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `order` | number | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |


<a id="module-offline"></a>

## 9. Offline centers

> Module key: `offline` — 5 entities

### 9.1 OfflineBannerSlider — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | OfflineBannerSlider |
| **Legacy MySQL** | `ws_offline_banner_slider` |
| **MongoDB** | `ws_offline_banner_slider` |
| **Post-migration MySQL** | `ws_offline_banner_slider` |
| **Mongoose** | `src/models/offline/OfflineBannerSlider.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `image` | `varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | `image` | String | required; maxlength:500 | `image` | String | — | ✅ |
| 3 | `key` | `varchar(256) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NULL; DEFAULT NULL | `key` | String | maxlength:100 | `key` | String? | — | ✅ |
| 4 | `key_id` | `int` | NULL; DEFAULT NULL | `keyId` | Number | — | `keyId` | Int? | — | ✅ |
| 5 | `created_at` | `timestamp` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `createdAt` | DateTime | — | ✅ |
| 6 | `updated_at` | `timestamp` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updatedAt` | DateTime | — | ✅ |
| 7 | — | — | — | `orderBy` | Number | 0 | — | — | — | 🆕 Mongo-only |

### 9.2 OfflineBatch — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | OfflineBatch |
| **Legacy MySQL** | `ws_offline_batch` |
| **MongoDB** | `ws_offline_batch` |
| **Post-migration MySQL** | `ws_offline_batch` |
| **Mongoose** | `src/models/offline/OfflineBatch.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | — | ✅ |
| 3 | `image` | `varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | `image` | String | required; maxlength:500 | `image` | String | — | ✅ |
| 4 | `discription` | `varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | — | — | — | `discription` | String | — | ✅ SQL+Prisma |
| 5 | `start_at` | `datetime` | NOT NULL | `startAt` | Date | required | `startAt` | DateTime | — | ✅ |
| 6 | `duration` | `varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL; DEFAULT '1 Year' | `duration` | String | required; maxlength:100 | `duration` | String | — | ✅ |
| 7 | `center_id` | `int` | NOT NULL | `centerId` | ObjectId | required; ref:OfflineCenter | `centerId` | Int | — | ✅ |
| 8 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `createdAt` | DateTime | — | ✅ |
| 9 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updatedAt` | DateTime | — | ✅ |
| 10 | — | — | — | — | — | — | `status` | Boolean | — | 🆕 Prisma-only |
| 11 | — | — | — | `description` | String | required | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |

### 9.3 OfflineCenter — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | OfflineCenter |
| **Legacy MySQL** | `ws_offline_center` |
| **MongoDB** | `ws_offline_center` |
| **Post-migration MySQL** | `ws_offline_center` |
| **Mongoose** | `src/models/offline/OfflineCenter.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | — | ✅ |
| 3 | `image` | `json` | NULL; DEFAULT NULL | `images` | String | [] | `image` | Json? | — | ✅ |
| 4 | `address` | `varchar(500) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | `address` | String | required | `address` | String | — | ✅ |
| 5 | `latitude` | `double` | NOT NULL; DEFAULT '0' | `latitude` | Number | required | `latitude` | Float | — | ✅ |
| 6 | `longitude` | `double` | NOT NULL; DEFAULT '0' | `longitude` | Number | required | `longitude` | Float | — | ✅ |
| 7 | `phone` | `bigint` | NOT NULL | `phone` | String | required; maxlength:20 | `phone` | Int | — | ✅ |
| 8 | `city_id` | `int` | NOT NULL | `cityId` | ObjectId | required; ref:OfflineCity | `cityId` | Int | — | ✅ |
| 9 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `createdAt` | DateTime | — | ✅ |
| 10 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updatedAt` | DateTime | — | ✅ |
| 11 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |

### 9.4 OfflineCity — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | OfflineCity |
| **Legacy MySQL** | `ws_offline_city` |
| **MongoDB** | `ws_offline_city` |
| **Post-migration MySQL** | `ws_offline_city` |
| **Mongoose** | `src/models/offline/OfflineCity.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | `name` | String | required; maxlength:100 | `name` | String | — | ✅ |
| 3 | `image` | `varchar(255) CHARACTER SET latin1 COLLATE latin1_swedish_ci` | NOT NULL | `image` | String | required; maxlength:500 | `image` | String | — | ✅ |
| 4 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | `createdAt` | DateTime | — | ✅ |
| 5 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | `updatedAt` | Date | — | `updatedAt` | DateTime | — | ✅ |
| 6 | — | — | — | `order` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |

### 9.5 OfflineEnquiry — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | OfflineEnquiry |
| **Legacy MySQL** | `ws_offline_enquiry` |
| **MongoDB** | `ws_offline_enquiry` |
| **Post-migration MySQL** | `ws_offline_enquiry` |
| **Mongoose** | `src/models/offline/OfflineEnquiry.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `customer_id` | `int` | NOT NULL | `customerId` | ObjectId | null; ref:Customer | `userId` | Int? | — | ✅ |
| 3 | `name` | `varchar(100)` | NOT NULL | `name` | String | required; maxlength:255 | `name` | String | — | ✅ |
| 4 | `email` | `varchar(50)` | NOT NULL | `email` | String | required; maxlength:255 | `email` | String | — | ✅ |
| 5 | `mobile` | `bigint` | NOT NULL | `mobile` | String | required; maxlength:20 | `mobile` | Int | — | ✅ |
| 6 | `qualification` | `varchar(100)` | NOT NULL | `qualification` | String | required; maxlength:255 | `qualification` | String | — | ✅ |
| 7 | `batch_id` | `int` | NOT NULL | `batchId` | ObjectId | required; ref:OfflineBatch | `batchId` | Int | — | ✅ |
| 8 | `created_at` | `timestamp NULL` | NULL; DEFAULT CURRENT_TIMESTAMP | `createdAt` | Date | — | — | — | — | ✅ |
| 9 | — | — | — | `remarks` | String | null | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |


<a id="module-promoter"></a>

## 10. Promoters

> Module key: `promoter` — 2 entities

### 10.1 PromoterAccessToken — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | PromoterAccessToken |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_promoter_access_tokens` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/promoter/PromoterAccessToken.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `promoterId` | ObjectId | required; ref:Promoter | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `token` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `refreshToken` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `active` | Boolean | required; true | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `deleted` | Boolean | required; false | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `expiresAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 10.2 Promoter — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Promoter |
| **Legacy MySQL** | `ws_promoter` |
| **MongoDB** | `ws_promoter` |
| **Post-migration MySQL** | `ws_promoter` |
| **Mongoose** | `src/models/promoter/Promoter.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `full_name` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | `fullName` | String | required; maxlength:255 | `full_name` | String | — | ✅ |
| 3 | `email` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | `email` | String | required; unique; maxlength:255 | `email` | String | — | ✅ |
| 4 | `password` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | `password` | String | maxlength:255 | — | — | — | ✅ |
| 5 | `phone` | `varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | `phone` | String | required; maxlength:20 | `phone` | String | — | ✅ |
| 6 | `image` | `varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | `image` | String | null; maxlength:500 | `image` | String? | — | ✅ |
| 7 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | `status` | Boolean | true | `status` | Boolean | — | ✅ |
| 8 | `is_delete` | `tinyint(1)` | NOT NULL; DEFAULT '0' | `isDelete` | Boolean | false | `is_delete` | Boolean | — | ✅ |
| 9 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | `createdAt` | Date | — | `created_at` | DateTime? | — | ✅ |
| 10 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | `updatedAt` | Date | — | `updated_at` | DateTime? | — | ✅ |
| 11 | `last_seen_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 12 | — | — | — | `lastLoginDate` | Date | null | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `lastLoginIp` | String | null; maxlength:100 | — | — | — | 🆕 Mongo-only |


<a id="module-referral"></a>

## 11. Referral program

> Module key: `referral` — 6 entities

### 11.1 ReferralFaq — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ReferralFaq |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_referral_faqs` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/referral/ReferralFaq.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `question` | String | required; maxlength:500 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `answer` | String | required; maxlength:5000 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `order` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `status` | Boolean | required; true | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 11.2 ReferralProgram — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ReferralProgram |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_referral_programs` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/referral/ReferralProgram.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required; unique; maxlength:50 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `title` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `image` | String | maxlength:255 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `referralDiscount` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `referralReward` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `minimumPrice` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `initialRewardAmount` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `video` | String | maxlength:255 | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `status` | Boolean | required; true | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 11.3 ReferralTerm — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ReferralTerm |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_referral_terms` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/referral/ReferralTerm.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `text` | String | required; maxlength:1000 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `order` | Number | required; 0 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `status` | Boolean | required; true | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 11.4 ReferralTransaction — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | ReferralTransaction |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_referral_transactions` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/referral/ReferralTransaction.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `orderId` | ObjectId | — | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `bankAccount` | Mixed | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `description` | String | required; maxlength:150 | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `coin` | Number | required | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `type` | RefferalTransactionType | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `status` | RefferalTransactionStatus | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `utr` | string | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `failureReason` | string | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `providerRef` | string | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `providerPayload` | Record<string, any> | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 11.5 RefferalProgram — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | RefferalProgram |
| **Legacy MySQL** | `ws_refferal_program` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_refferal_program` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `name` | `varchar(50)` | NOT NULL | — | — | — | `name` | String | @db.VarChar(50) | ✅ SQL+Prisma |
| 3 | `title` | `varchar(150)` | NOT NULL | — | — | — | `title` | String | — | ✅ SQL+Prisma |
| 4 | `image` | `varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | `image` | String | — | ✅ SQL+Prisma |
| 5 | `refferal_discount` | `float` | NOT NULL | — | — | — | `refferalDiscount` | Decimal | — | ✅ SQL+Prisma |
| 6 | `refferal_reward` | `float` | NOT NULL | — | — | — | `refferalReward` | Decimal | — | ✅ SQL+Prisma |
| 7 | `minimum_price` | `int` | NOT NULL | — | — | — | `minimumPrice` | Int | — | ✅ SQL+Prisma |
| 8 | `initial_reward_amount` | `int` | NOT NULL | — | — | — | `initialRewardAmount` | Int | — | ✅ SQL+Prisma |
| 9 | `video` | `varchar(100)` | NOT NULL | — | — | — | `video` | String | @db.VarChar(100) | ✅ SQL+Prisma |
| 10 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean? | — | ✅ SQL+Prisma |

### 11.6 RefferalTransaction — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | RefferalTransaction |
| **Legacy MySQL** | `ws_refferal_transaction` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_refferal_transaction` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `order_id` | `int` | NULL; DEFAULT NULL | — | — | — | `orderId` | Int? | — | ✅ SQL+Prisma |
| 3 | `customer_id` | `int` | NOT NULL | — | — | — | `customerId` | Int | — | ✅ SQL+Prisma |
| 4 | `bank_account` | `json` | NULL; DEFAULT NULL | — | — | — | `bankAccount` | Json? | — | ✅ SQL+Prisma |
| 5 | `description` | `varchar(150)` | NOT NULL | — | — | — | `description` | String | @db.VarChar(150) | ✅ SQL+Prisma |
| 6 | `coin` | `int` | NOT NULL | — | — | — | `coin` | Int | — | ✅ SQL+Prisma |
| 7 | `type` | `enum('credit','debit')` | NOT NULL; enum('credit','debit') | — | — | — | `type` | RefferalTransactionType | — | ✅ SQL+Prisma |
| 8 | `status` | `enum('pending','successful') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL; enum('pending','successful') | — | — | — | `status` | RefferalTransactionStatus | — | ✅ SQL+Prisma |
| 9 | `created_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `createdAt` | DateTime? | — | ✅ SQL+Prisma |
| 10 | `updated_at` | `datetime` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | `updatedAt` | DateTime? | — | ✅ SQL+Prisma |


<a id="module-testSeries"></a>

## 12. Test series

> Module key: `testSeries` — 6 entities

### 12.1 TestSeries — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | TestSeries |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_test_series` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/testSeries/TestSeries.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `title` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `description` | String | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `thumbnail` | String | maxlength:500 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `examCategoryId` | ObjectId | null; ref:ExamCategory | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `language` | ExamLanguage | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `paperCount` | number | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `isFree` | boolean | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `instructions` | string | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `policy` | string | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `orderBy` | number | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 12.2 TestSeriesContentCategory — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | TestSeriesContentCategory |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_test_series_content_category` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/testSeries/TestSeriesContentCategory.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `testSeriesId` | ObjectId | required; ref:TestSeries | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `name` | String | required; maxlength:255 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `icon` | String | maxlength:500 | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `orderBy` | Number | 0 | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 12.3 TestSeriesExam — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | TestSeriesExam |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_test_series_exam` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/testSeries/TestSeriesExam.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `testSeriesId` | ObjectId | required; ref:TestSeries | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `contentCategoryId` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `examId` | Types.ObjectId | — | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `orderBy` | number | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 12.4 TestSeriesOrder — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | TestSeriesOrder |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_test_series_orders` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/testSeries/TestSeriesOrder.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `testSeriesId` | ObjectId | required; ref:TestSeries | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `planId` | ObjectId | null; ref:TestSeriesPrice | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `paymentMethod` | PaymentMethod | — | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `orderType` | PackageCourseEbookOrderType | — | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `orderPrice` | number | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `basePrice` | number | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `discountAmount` | number | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `gstAmount` | number | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `handlingFee` | number | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `promocodeId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `razorpayOrderId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `razorpayPaymentId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 14 | — | — | — | `ipAddress` | string | null | — | — | — | — | 🆕 Mongo-only |
| 15 | — | — | — | `transactionId` | string | null | — | — | — | — | 🆕 Mongo-only |
| 16 | — | — | — | `status` | PackageCourseEbookOrderStatus | — | — | — | — | 🆕 Mongo-only |
| 17 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 18 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 12.5 TestSeriesPrice — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | TestSeriesPrice |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_test_series_prices` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/testSeries/TestSeriesPrice.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `testSeriesId` | ObjectId | required; ref:TestSeries | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `name` | String | null; maxlength:200 | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `durationDays` | Number | required; min:1  | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `price` | Number | required; min:0  | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `originalPrice` | Number | min:0  | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `isDefault` | Boolean | false | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `status` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

### 12.6 TestSeriesSubscription — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | TestSeriesSubscription |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_test_series_subscriptions` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/testSeries/TestSeriesSubscription.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `orderId` | ObjectId | null; ref:TestSeriesOrder | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `customerId` | ObjectId | required; ref:Customer | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `testSeriesId` | ObjectId | required; ref:TestSeries | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `planId` | ObjectId | null; ref:TestSeriesPrice | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `price` | Number | required; min:0  | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `startAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `endAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `remarks` | String | null | — | — | — | 🆕 Mongo-only |
| 9 | — | — | — | `paymentType` | PackageCourseEbookPaymentType | — | — | — | — | 🆕 Mongo-only |
| 10 | — | — | — | `status` | boolean | — | — | — | — | 🆕 Mongo-only |
| 11 | — | — | — | `promocodeId` | Types.ObjectId | null | — | — | — | — | 🆕 Mongo-only |
| 12 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 13 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |


<a id="module-educator"></a>

## 13. Educators

> Module key: `educator` — 1 entity

### 13.1 EducatorAccessToken — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | EducatorAccessToken |
| **Legacy MySQL** | — |
| **MongoDB** | `ws_educator_access_tokens` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/educator/EducatorAccessToken.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `educatorId` | ObjectId | required; ref:CourseEducator | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `token` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `refreshToken` | String | required | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `active` | Boolean | required; true | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `deleted` | Boolean | required; false | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `expiresAt` | Date | required | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 8 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |


<a id="module-mysql-only"></a>

## 14. MySQL + Prisma only (no Mongoose)

> Module key: `mysql-only` — 4 entities

### 14.1 Promocode — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | Promocode |
| **Legacy MySQL** | `ws_promocode` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_promocode` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `promoter_id` | `int` | NOT NULL | — | — | — | `promoterId` | Int? | — | ✅ SQL+Prisma |
| 3 | `promocode` | `varchar(20) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NULL; DEFAULT NULL | — | — | — | `promocode` | String | — | ✅ SQL+Prisma |
| 4 | `title` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci` | NOT NULL | — | — | — | `title` | String? | — | ✅ SQL+Prisma |
| 5 | `description` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci` | NOT NULL | — | — | — | `description` | String? | — | ✅ SQL+Prisma |
| 6 | `promo_start_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `promo_start_at` | DateTime | — | ✅ SQL+Prisma |
| 7 | `promo_expire_at` | `datetime` | NULL; DEFAULT NULL | — | — | — | `promo_expire_at` | DateTime | — | ✅ SQL+Prisma |
| 8 | `type` | `enum('private','public') CHARACTER SET utf8mb3 COLLATE utf8mb3_bin` | NOT NULL; DEFAULT 'private'; enum('private','public') | — | — | — | `type` | PromocodeType | — | ✅ SQL+Prisma |
| 9 | `status` | `tinyint(1)` | NOT NULL; DEFAULT '1' | — | — | — | `status` | Boolean | — | ✅ SQL+Prisma |
| 10 | `created_by` | `int` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 11 | `updated_by` | `int` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 12 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 13 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 14.2 PromotedPackageCourseEbook — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | PromotedPackageCourseEbook |
| **Legacy MySQL** | `ws_promoted_package_course_ebook` |
| **MongoDB** | — |
| **Post-migration MySQL** | `ws_promoted_package_course_ebook` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | `id` | Int | @id @default(autoincrement()) | ✅ SQL+Prisma |
| 2 | `promocode_id` | `int` | NOT NULL | — | — | — | `promocodeId` | Int? | — | ✅ SQL+Prisma |
| 3 | `pcb_price_id` | `int` | NOT NULL | — | — | — | `planId` | Int? | — | ✅ SQL+Prisma |
| 4 | `type` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci` | NULL; DEFAULT NULL | — | — | — | `type` | String? | — | ✅ SQL+Prisma |
| 5 | `promoter_percentage` | `float` | NOT NULL; DEFAULT '0' | — | — | — | `promoterPercentage` | Decimal | — | ✅ SQL+Prisma |
| 6 | `customer_percentage` | `float` | NOT NULL; DEFAULT '0' | — | — | — | `customerPercentage` | Decimal | — | ✅ SQL+Prisma |
| 7 | `created_by` | `int` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 8 | `updated_by` | `int` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 9 | `created_at` | `timestamp NULL` | NULL; DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | — | — | — | `created_at` | DateTime? | — | ✅ SQL+Prisma |
| 10 | `updated_at` | `timestamp NULL` | NULL; DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | — | — | — | `updated_at` | DateTime? | — | ✅ SQL+Prisma |

### 14.3 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_tag` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `tag_id` | `int` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `tag_name` | `varchar(255)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `tag_count` | `int` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 4 | `tag_image` | `varchar(255)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 5 | `tag_featured` | `int` | NOT NULL; DEFAULT '0' | — | — | — | — | — | — | 🆕 MySQL-only |

### 14.4 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_user_inquiry` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `name` | `varchar(100)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `email` | `varchar(100)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 4 | `phone` | `bigint` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 5 | `city` | `varchar(50)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 6 | `dob` | `varchar(11)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 7 | `gender` | `varchar(10)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 8 | `education` | `varchar(50)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 9 | `inquiryFor` | `varchar(250)` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 10 | `createdAt` | `datetime` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |


<a id="module-laravel-infra"></a>

## 15. Laravel / infra (not in new API)

> Module key: `laravel-infra` — 7 entities

### 15.1 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_failed_jobs` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `uuid` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `connection` | `text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 4 | `queue` | `text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 5 | `payload` | `longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 6 | `exception` | `longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 7 | `failed_at` | `timestamp` | NOT NULL; DEFAULT CURRENT_TIMESTAMP | — | — | — | — | — | — | 🆕 MySQL-only |

### 15.2 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_migrations` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `int UNSIGNED` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `migration` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `batch` | `int` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |

### 15.3 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_model_has_permissions` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `permission_id` | `bigint UNSIGNED` | PK; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `model_type` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `model_id` | `bigint UNSIGNED` | PK; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |

### 15.4 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_model_has_roles` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `role_id` | `bigint UNSIGNED` | PK; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `model_type` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `model_id` | `bigint UNSIGNED` | PK; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |

### 15.5 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_password_resets` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `email` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `token` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 4 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |

### 15.6 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_personal_access_tokens` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `id` | `bigint UNSIGNED` | PK AI; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `customer_id` | `int` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 3 | `tokenable_type` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 4 | `tokenable_id` | `bigint UNSIGNED` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 5 | `name` | `varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 6 | `token` | `varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 7 | `abilities` | `text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` | NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 8 | `last_used_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 9 | `created_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 10 | `updated_at` | `timestamp NULL` | NULL; DEFAULT NULL | — | — | — | — | — | — | 🆕 MySQL-only |

### 15.7 — — ⏳ Not migrated

| | |
|---|---|
| **Prisma model** | — |
| **Legacy MySQL** | `ws_role_has_permissions` |
| **MongoDB** | — |
| **Post-migration MySQL** | — |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | `permission_id` | `bigint UNSIGNED` | PK; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |
| 2 | `role_id` | `bigint UNSIGNED` | PK; NOT NULL | — | — | — | — | — | — | 🆕 MySQL-only |


<a id="module-other"></a>

## 16. Other / uncategorized

> Module key: `other` — 1 entity

### 16.1 Goal — 🆕 Mongo-only

| | |
|---|---|
| **Prisma model** | Goal |
| **Legacy MySQL** | — |
| **MongoDB** | `(default goals)` |
| **Post-migration MySQL** | — |
| **Mongoose** | `src/models/Goal.model.ts` |

| # | Legacy MySQL column | MySQL type | MySQL constraints | MongoDB field | Mongo type | Mongo constraints | Prisma field | Prisma type | Prisma constraints | Match |
|---:|---|---|---|---|---|---|---|---|---|---|
| 1 | — | — | — | `name` | String | required | — | — | — | 🆕 Mongo-only |
| 2 | — | — | — | `title` | String | required | — | — | — | 🆕 Mongo-only |
| 3 | — | — | — | `labels` | Array | [] | — | — | — | 🆕 Mongo-only |
| 4 | — | — | — | `image` | String | null | — | — | — | 🆕 Mongo-only |
| 5 | — | — | — | `isActive` | Boolean | true | — | — | — | 🆕 Mongo-only |
| 6 | — | — | — | `createdAt` | Date | — | — | — | — | 🆕 Mongo-only |
| 7 | — | — | — | `updatedAt` | Date | — | — | — | — | 🆕 Mongo-only |

---

## Maintenance

1. Regenerate after schema changes: `yarn docs:field-comparison`
2. Regenerate table inventory: `yarn docs:schema-comparison`
3. For complex renames (e.g. Customer `full_name` vs `firstName`), add notes in [SCHEMA_COMPARISON.md](./SCHEMA_COMPARISON.md) appendices.

