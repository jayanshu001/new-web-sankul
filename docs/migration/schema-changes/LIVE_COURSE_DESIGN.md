# 🎥 Wave 6 — LiveCourse / LiveSession SQL Schema Design

> **Status:** ✅ SIGNED OFF + TABLES CREATED + BACKFILLED (2026-06-18). All 6 §6 decisions approved; backfill
> (existing Mongo rows → SQL) approved & run. DDL: `2026-06-18_create_ws_live_course_tables.sql` (14 tables).
> Backfill: `scripts/backfill-live-course-to-sql.ts`. Row counts match Mongo (4 courses / 4 plans / 10 subs /
> 51 sessions / 53 session-course links / 9 polls + 33 options / 11 votes / 52 chat / 195 attendance / 9
> reminders / 4 previews). ⚠ customer/educator/category cross-refs: customer resolved via phone bridge (14/267
> on staging — test users not in the SQL dump; production bridges better), others stored 0/null (no Mongo→SQL id
> bridge). **NEXT:** build the `admin-live-course` + client modules (repo/service/transformer), branch the
> controllers on `isLiveCourseMysql()`. **Created:** 2026-06-18.
> **Why this doc exists:** unlike every Wave 1–5 module, LiveCourse has **NO existing SQL tables** — there is
> nothing to migrate *to*. These tables must be **designed and created** first. Per the migration plan, the DDL
> is gated on this design doc + user sign-off. Once approved → create tables (additive DDL) → Prisma models →
> modules, exactly like Wave 5.
>
> **Source of truth:** the **live MongoDB** (read via `MONGODB_URI`). All 12 collections were inspected on
> 2026-06-18; column names/types below mirror the real documents. SQL table names follow the existing
> convention (singular `ws_live_course`, like `ws_book`/`ws_course`).

---

## 0. Collections inventory (live Mongo, 2026-06-18)

| Mongo collection | docs | → proposed SQL table | notes |
|---|---:|---|---|
| `ws_live_courses` | 4 | `ws_live_course` | core; embeds scheduleEntries/scheduleFolders + materialCategories/examCategories |
| `ws_live_course_plans` | 4 | `ws_live_course_plan` | price plans (duration in **MONTHS** here — see §3) |
| `ws_live_course_subscriptions` | 10 | `ws_live_course_subscription` | customer purchases |
| `ws_live_sessions` | 51 | `ws_live_session` + `ws_live_session_course` | session ↔ course is **many-to-many** (`liveCourseIds[]`) |
| `ws_live_course_categories` | 0 | `ws_live_course_category` | empty; thin master |
| `ws_live_chat_messages` | 52 | `ws_live_chat_message` | keyed by **string** `liveClassId` |
| `ws_live_chat_bans` | 0 | `ws_live_chat_ban` | empty |
| `ws_live_polls` | 9 | `ws_live_poll` + `ws_live_poll_option` | embedded `options[]` → child rows |
| `ws_live_poll_votes` | 16 | `ws_live_poll_vote` | |
| `ws_live_session_attendance` | 195 | `ws_live_session_attendance` | join/leave tracking |
| `livesessionreminders` | 9 | `ws_live_session_reminder` | rename to convention |
| `ws_live_session_previews` | 4 | `ws_live_session_preview` | |

**ID strategy:** every Mongo `ObjectId` → MySQL `INT AUTO_INCREMENT` PK (matches all existing tables; the modules
surface ids as strings, like every other migrated module). FK columns are nullable `INT` unless noted. All tables
get `created_at` / `updated_at TIMESTAMP NULL`. The Mongo `__v` is dropped.

---

## 1. `ws_live_course` (core)

Mirrors `ws_course` closely (LiveCourse is a sibling of Course). Embedded arrays → handled like the course/package
modules: `materialCategories[]`/`examCategories[]` → **pivot tables** (reuse the existing `ws_material_category_*`/
`ws_exam_category_*` pattern, scoped by a `live_course_id`); `scheduleEntries[]`/`scheduleFolders[]` → **JSON
columns** (free-form, admin-authored, never queried relationally).

> ⚠ **As built, both category arrays landed as JSON columns, not pivots** —
> `material_categories` / `exam_categories` on `ws_live_course`. For materials that broke
> entitlement outright: `client-material.getPurchasedMaterialIds` joins category → container
> pivot → subscription, so a live-course buyer got `isPurchased:false` on every material.
> **Corrected 2026-07-31** by `ws_material_category_live_course`
> (`2026-07-31_material_category_live_course.sql`): the JSON column stays the admin
> read/write shape and is mirrored onto the pivot, which is what entitlement reads.
> `exam_categories` is still JSON-only — check it before anything gates exam access on a
> live-course purchase.

| column | type | from Mongo | notes |
|---|---|---|---|
| `id` | INT PK AI | `_id` | |
| `name` | VARCHAR(255) NOT NULL | name | |
| `subtitle` | VARCHAR(255) | subtitle | |
| `description` | TEXT | description | |
| `image` | VARCHAR(500) | image | |
| `ordered` | INT NOT NULL DEFAULT 0 | ordered | |
| `shareable_link` | VARCHAR(500) | shareableLink | |
| `with_material` | TEXT | withMaterial | descriptive text (like ws_package) |
| `without_material` | TEXT | withoutMaterial | |
| `level` | VARCHAR(50) | level | |
| `class_type` | VARCHAR(20) NOT NULL DEFAULT 'live' | classType | |
| `status` | TINYINT(1) NOT NULL DEFAULT 1 | status | |
| `is_paid` | TINYINT(1) NOT NULL DEFAULT 1 | isPaid | |
| `is_popular` | TINYINT(1) NOT NULL DEFAULT 0 | isPopular | |
| `educator_id` | INT NULL | courseEducatorId | → ws_course_educator |
| `course_subject_category_id` | INT NULL | courseSubjectCategoryId | → ws_course_subject_category |
| `video_category_id` | INT NULL | videoCategoryId | → ws_video_category |
| `package_category_id` | INT NULL | packageCategoryId | (Mongo-only category; nullable) |
| `created_by` | INT NULL | createdBy | admin id |
| `schedule_entries` | JSON NULL | scheduleEntries[] | `[{date,subject,time,...}]` |
| `schedule_folders` | JSON NULL | scheduleFolders[] | `[{title,image,order,status,entries}]` |
| `created_at`/`updated_at` | TIMESTAMP NULL | | |

Indexes: `(status, ordered)`, `(course_subject_category_id)`, `(video_category_id)`.

---

## 2. `ws_live_session` + `ws_live_session_course` (⚠ many-to-many)

A session carries `liveCourseIds[]` (plural array — **one session can belong to several courses**), so it needs a
join table — NOT a scalar FK.

**`ws_live_session`**

| column | type | from | notes |
|---|---|---|---|
| `id` | INT PK AI | `_id` | |
| `title` | VARCHAR(255) | title | |
| `subject` | VARCHAR(255) | subject | |
| `educator_id` | INT NULL | educatorId | |
| `scheduled_at` | DATETIME NULL | scheduledAt | |
| `end_at` | DATETIME NULL | endAt | |
| `status` | VARCHAR(20) NOT NULL | status | SCHEDULED/LIVE/ENDED (varchar — Mongo uses enum strings) |
| `stream_id` | VARCHAR(100) NULL | streamId | |
| `rtmp_url` | VARCHAR(500) NULL | rtmpUrl | |
| `hls_url` | VARCHAR(500) NULL | hlsUrl | |
| `hls_urls` | JSON NULL | hlsUrls[] | multi-renditions |
| `recordings` | JSON NULL | recordings[] | `[{url,...}]` (free-form) |
| `recording_target_folder_id` | INT NULL | recordingTargetFolderId | |
| `created_at`/`updated_at` | TIMESTAMP NULL | | |

**`ws_live_session_course`** (join): `id` PK AI · `live_session_id` INT NOT NULL · `live_course_id` INT NOT NULL ·
`created_at`. Unique `(live_session_id, live_course_id)`.

> **Chat/polls key off a STRING `liveClassId`** (e.g. `live_class_001`), not the session int id. Decision: keep a
> `live_class_id VARCHAR(100)` column on chat/poll tables verbatim (it's the room key the realtime layer uses);
> do NOT try to FK it to a session. Documented as a string business key (same spirit as `ws_book_order.order_id`).

---

## 3. `ws_live_course_plan`

| column | type | from | notes |
|---|---|---|---|
| `id` | INT PK AI | `_id` | |
| `live_course_id` | INT NOT NULL | liveCourseId | |
| `name` | VARCHAR(255) NULL | name | |
| `duration` | INT NOT NULL | duration | ⚠ **MONTHS here** (Mongo "3 Months" → duration 3). Unlike the package/course/ebook price table where duration is DAYS. The subscription endAt uses `computeEndAt` WITHOUT `asDays` (setMonth). Flagged so we don't misapply the [[project_plan_duration_unit]] DAYS rule. |
| `price` | INT NOT NULL | price | |
| `is_default` | TINYINT(1) NOT NULL DEFAULT 0 | isDefault | |
| `status` | TINYINT(1) NOT NULL DEFAULT 1 | status | |
| `created_at`/`updated_at` | TIMESTAMP NULL | | |

Index: `(live_course_id, status)`.

---

## 4. `ws_live_course_subscription`

| column | type | from |
|---|---|---|
| `id` | INT PK AI | `_id` |
| `customer_id` | INT NOT NULL | customerId |
| `live_course_id` | INT NOT NULL | liveCourseId |
| `plan_id` | INT NULL | planId |
| `start_at` / `end_at` | DATETIME NULL | startAt/endAt |
| `status` | TINYINT(1) NOT NULL DEFAULT 1 | status |
| `promocode_id` | INT NULL | promocodeId |
| `original_amount` / `discount_amount` / `paid_amount` | INT NULL | originalAmount/discountAmount/paidAmount |
| `payment_status` | VARCHAR(20) | paymentStatus |
| `razorpay_order_id` / `razorpay_payment_id` | VARCHAR(255) NULL | razorpay* |
| `paid_at` | DATETIME NULL | paidAt |
| `created_at`/`updated_at` | TIMESTAMP NULL | |

Indexes: `(customer_id, live_course_id)`, `(live_course_id, status)`.

---

## 5. Chat / polls / attendance / reminders / previews

- **`ws_live_chat_message`**: `id` · `live_class_id` VARCHAR(100) · `customer_id` INT · `user_name` VARCHAR(255) ·
  `message` TEXT · timestamps.
- **`ws_live_chat_ban`** (empty, design from model): `id` · `live_class_id` VARCHAR(100) · `customer_id` INT ·
  `banned_by` INT NULL · `reason` VARCHAR(255) NULL · timestamps.
- **`ws_live_poll`**: `id` · `live_class_id` VARCHAR(100) · `question` VARCHAR(500) · `total_votes` INT DEFAULT 0 ·
  `is_active` TINYINT(1) · `created_by` INT · `closed_at` DATETIME NULL · timestamps.
- **`ws_live_poll_option`** (embedded `options[]` → child): `id` · `poll_id` INT · `option_index` INT ·
  `text` VARCHAR(255) · `votes` INT DEFAULT 0.
- **`ws_live_poll_vote`**: `id` · `poll_id` INT · `customer_id` INT · `option_index` INT · timestamps.
  Unique `(poll_id, customer_id)` (one vote per customer).
- **`ws_live_session_attendance`**: `id` · `stream_id` VARCHAR(100) · `live_session_id` INT · `customer_id` INT ·
  `user_name` VARCHAR(255) · `joined_at`/`left_at` DATETIME · `duration_sec` INT · timestamps.
- **`ws_live_session_reminder`**: `id` · `live_session_id` INT · `live_course_id` INT · `customer_id` INT ·
  `minutes_before` INT · `notification_id` INT NULL · `remind_at`/`session_scheduled_at` DATETIME ·
  `status` VARCHAR(20) · timestamps.
- **`ws_live_session_preview`**: `id` · `live_session_id` INT · `customer_id` INT · `started_at` DATETIME · timestamps.

---

## 6. Open decisions for sign-off

1. **Table-name convention:** singular (`ws_live_course`) to match `ws_book`/`ws_course`. ✅ recommended.
   (Mongo uses plural `ws_live_courses`.)
2. **`liveCourseIds[]` many-to-many** via `ws_live_session_course` join table (vs a scalar FK). ✅ recommended —
   the data genuinely has multi-course sessions.
3. **JSON columns** for `scheduleEntries`/`scheduleFolders`/`recordings`/`hlsUrls` (free-form, admin-authored,
   never filtered relationally) vs child tables. ✅ JSON recommended (simpler; matches how `ws_*_order.promocode`
   already stores JSON snapshots).
4. **Embedded poll `options[]`** → child table `ws_live_poll_option` (so per-option vote counts are queryable). ✅
5. **`live_class_id`** stays a **string** business key on chat/poll tables (the realtime room key), NOT FK'd to a
   session int. ✅
6. **Plan `duration` is MONTHS** here (not DAYS) — endAt via `computeEndAt` without `asDays`. ⚠ confirm.
7. **Backfill?** Do we migrate the existing Mongo rows (4 courses / 51 sessions / 195 attendance / …) into the new
   tables, or start the SQL tables empty and only NEW writes land in SQL (dual-write/cutover)? **This is the one
   that needs your call** — backfill = a one-time ETL script; empty-start = simplest but the SQL branch shows no
   historical data until re-entered. *(Every prior wave migrated against tables that ALREADY had the legacy data;
   here the data only exists in Mongo, so this is a genuinely new question.)*

---

## 7. Rollout plan (after sign-off)

1. Write DDL → `schema-changes/2026-06-18_create_ws_live_course_tables.sql` (additive; `CREATE TABLE IF NOT EXISTS`).
2. Apply to `websankul_staging`; add Prisma models; `prisma generate`.
3. (If backfill approved) write `scripts/backfill-live-course-to-sql.ts` (ObjectId→int id map, embeds→JSON/children).
4. Build `src/modules/admin-live-course/` + client modules (repo + service + transformer), branch the controllers
   on `isLiveCourseMysql()`, exactly like Wave 5.
5. Verify vs live DB; `tsc`; enable flag; doc protocol.
