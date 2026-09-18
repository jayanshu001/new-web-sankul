# Jobs Management — old → new field mapping

DDL: `docs/migration/schema-changes/2026-09-17_jobs_normalize_content.sql`
Backfill: `scripts/backfill-jobs-normalize.ts`
Prisma models: `prisma/schema.prisma`, appended block starting `// JOBS MANAGEMENT (wsj_*)`

Source of truth for every field that used to live inside `wsj_contents.card`/`detail`
JSON (and `wsj_previous_papers.pdf_url`/`job_ids`), now split into typed columns and
child tables. Legacy columns are **not dropped** — a later migration removes them once
the new admin has shipped and the backfill is verified in production.

## `wsj_contents` base columns — unchanged

`id`, `type`, `slug`, `title`, `subtitle`, `status`, `published_at`, `featured`,
`badge`, `sort_order`, `body_html`, `created_at`, `updated_at` map straight through to
`JobContent`. New: `featured_image_id` → `Media` (nothing populated it yet — no
featured-image concept existed before this migration).

`organization_id` stays a plain column (no DB FK existed before or after; `JobContent`
adds an app-level Prisma relation to `JobOrganization` for query convenience).
`category_id` (legacy single category) is preserved as-is **and** backfilled into one
`JobContentCategory` row — the admin should write through the join table going
forward; `category_id` is read-only legacy. `related_job_id` likewise kept as a plain
column with an app-level self-relation (`JobContent.relatedJob`/`relatedFrom`) — no
content currently sets it.

## SEO — `detail.seo` (job only) → `JobContentSeo` (all 7 types)

| Old (`detail.seo.*`) | New (`JobContentSeo`) |
| --- | --- |
| `seo_title` | `seoTitle` |
| `meta_description` | `metaDescription` |
| *(new field, no old source)* | `metaKeywords` |
| `canonical_url` | `canonicalUrl` |
| `og_title` | `ogTitle` |
| `og_description` | `ogDescription` |
| `og_image_id` / `og_image_url` | `ogImageId` → `Media` (old values were never a real media id; not backfilled, admin re-uploads) |
| `schema_type` | `schemaType` |
| `robots_index` | `robotsIndex` |
| `robots_follow` | `robotsFollow` |
| *(new field)* | `focusKeyword` |

Only `type=job` rows had this block in production (8 of 8 job rows backfilled). Every
other type gets the same `JobContentSeo` table going forward — this is the main SEO
gap the new admin closes.

## Shared repeaters (all types)

| Old JSON path | New table |
| --- | --- |
| `card.card_facts[]` (`icon`, `meta_key`\|`title`, `meta_value`\|`value`) | `JobContentFact` |
| `detail.products[]` (`product_type`, `product_id`, `is_featured`) | `JobContentProduct` (`contentId` set) |
| `detail.related_posts[]` (array of content ids) | `JobContentRelatedPost` |
| `detail.sections[]` (`title`, `block_type`, `position`, `icon`, `is_visible`, `items[]`) | `JobContentSection` + `JobContentSectionItem` |
| `detail.selection_process[]` / `download_steps[]` / `how_to_check_steps[]` / `objection_steps[]` | `JobContentStep` (`stepGroup` column distinguishes them) |

`card_facts` read both `meta_key`/`title` and `meta_value`/`value` — production data
used both spellings interchangeably; the backfill prefers `meta_key`/`meta_value`.

## Job-only repeaters — no production data yet, schema only

`detail.payment_modes[]` → `JobContentPaymentMode`, `detail.application_fees[]`
(`category_label`/`category`, `amount_label`/`amount`) → `JobContentFeeItem`,
`detail.important_dates[]` (`label`/`title`, `date`/`value`, `note`) →
`JobContentDateItem`, `detail.notes[]` (plain strings) → `JobContentNote`. None of the
8 live job rows populated these — genuinely new capability, not backfilled data.

## Per-type detail tables

**job** (`card.*`) → `JobDetailJob`: `application_start`→`applicationStart`,
`application_end`→`applicationEnd`, `location`, `qualification`, `total_posts`→
`totalPosts`, `apply_url`→`applyUrl`, `official_notification_url`→
`officialNotificationUrl`. **`excerpt`** is a new column — old data stored it as
`card.excerpt` (distinct from the base `subtitle` column; both were populated with
different text on the one row that had it) and was previously undocumented in the
field inventory; added mid-migration before backfill ran.

**admit_card** → `JobDetailAdmitCard`: `tier_label`→`tierLabel`, `released_at`→
`releasedAt`, `exam_date_label`→`examDateLabel`, `release_status`→`releaseStatus`
(defaults to `coming_soon` if not exactly `"released"`), `download_url`→`downloadUrl`,
`notify_url`→`notifyUrl`.

**result** → `JobDetailResult`: `declared_at`→`declaredAt`, `official_url`→
`officialUrl`, `download_url`→`downloadUrl`.

**answer_key** → `JobDetailAnswerKey`: `key_status`→`keyStatus` (defaults to
`provisional` unless exactly `"final"`), `released_at`→`releasedAt`, `download_url`→
`downloadUrl`, `tags` (kept as JSON — genuinely freeform, not normalized further).

**other** → `JobDetailOther`: `summary`, `tags` (JSON, freeform), `card_meta`→
`cardMeta` (JSON, freeform key/value repeater).

**exam_calendar** → `JobDetailExamCalendar`: `exam_date`→`examDate`,
`apply_start_date`→`applyStartDate`, `apply_end_date`→`applyEndDate`,
`admit_card_date`→`admitCardDate`, `admit_card_note`→`admitCardNote`.

**syllabus** → `JobDetailSyllabus`: `card.subtitle` (distinct from base
`wsj_contents.subtitle` — syllabus rows populate both, with different text),
`languages`, `sections_count`→`sectionsCount`, `download_url`→`downloadUrl`.
`detail.stages[]` → `JobSyllabusStage` → `JobSyllabusSubject` → `JobSyllabusTopic`
(3-level). Stage objects in production also carried `description`, `mode`, `medium`,
`total_marks` and a redundant `stage_key` (duplicate of `title`) — the first four were
missing from the initial schema design and added before backfill ran once real data
was inspected; `stage_key` is dropped (redundant with `stage`, not carried forward).
Subject objects: `title`→`subject`. Topics were plain strings in production (not
objects) → `JobSyllabusTopic.topic`.

## `wsj_previous_papers`

Base scalar columns (`slug`, `organization_id`, `category_id`, `year`, `title`,
`subtitle`, `subject`, `format_label`, `years_label`, `papers_count`,
`downloads_count`, `tier`, `language`, `is_solved`, `description`, `status`,
`published_at`) map straight through, unchanged. New: `preview_media_id` → `Media`
(old `preview_url` untouched, not backfilled — no rows had one set).

| Old | New |
| --- | --- |
| `pdf_url` (plain URL string **or** JSON-encoded `[{label,url}]` in the same VARCHAR) | `JobPreviousPaperFile[]` (`label`, `url`, `sortOrder`) — the backfill detects which shape each row used |
| `job_ids` (JSON array), fallback `content_id` (legacy single link) | `JobPreviousPaperJobLink[]` — `job_ids` preferred; `content_id` used only when `job_ids` was empty |
| `products` (JSON array, `product_type`/`product_id`/`is_featured`) | `JobContentProduct[]` with `paperId` set (shared table with content's `products[]`) |

`recruitment_id` is legacy and was already always `NULL` in production — kept as a
plain column, nothing reads or writes it going forward.

## What still needs the admin/service layer, not the schema

- `og_image_id` on `JobContentSeo` needs real `Media` rows once the admin's upload
  flow exists — nothing to backfill today (old value was never a real asset id).
- `JobContent.categoryId` / `JobPreviousPaper.categoryId`/`organizationId` are legacy
  single-value columns kept for backward reference; new code should read/write
  `JobContentCategory` (many-to-many) and the `organization`/`linkedContent` Prisma
  relations, not the raw scalar columns, except where explicitly needed for
  backward-compat reads.
