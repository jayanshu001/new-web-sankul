-- 2026-08-20 — Offline video download registrations
--
-- Backs POST /client/subscriptions/downloads and scopes
-- GET  /client/subscriptions/access.
--
-- WHY: the mobile app downloads paid lectures and ebooks for offline play and must
-- expire them against the subscription that granted access, with no network at
-- playback time. This table records WHAT was downloaded, and which product the
-- user happened to be looking at when they tapped download.
--
-- The registration is a record of the download, NOT a declaration of entitlement.
-- GET deliberately ignores the stored product for videos and re-derives coverage
-- from the customer's CURRENT active subscriptions: every active course/package/
-- live course whose curriculum contains a registered lecture. A lecture
-- registered under Course A therefore also surfaces Package B while B is active,
-- so the file survives A expiring — the app cannot discover B itself and is not
-- asked to. `scope_id` matters mainly as the idempotency key and as an audit
-- trail of where the download came from.
--
-- NOT folder/playlist membership. `ws_folder_item` is a user-curated saved-items
-- list (and its writer route is currently disabled); this is a device-download
-- ledger with a product scope, which ws_folder_item has no column for.
--
-- scope_kind mirrors ws_enrollment_resume's vocabulary ("course" | "package" |
-- "liveCourse", camelCase liveCourse included) so the two enrollment-scoped
-- tables stay greppable together, PLUS "ebook". Materials stay out of scope
-- (local stamp only, per the FE spec).
--
-- For "ebook" rows the ebook IS the content, so video_id = scope_id = the ebook
-- id and there is no curriculum to expand into — those rows are returned as-is.
--
-- UNIQUE (customer_id, video_id, scope_kind, scope_id) is what makes the POST
-- idempotent — a repeat registration of the same download is an upsert that only
-- refreshes registered_at, never a duplicate row.
--
-- KEY idx_ovd_customer_scope (customer_id, scope_kind, scope_id) serves the GET,
-- which reads DISTINCT video_id (video scopes) and DISTINCT scope_id (ebooks)
-- for one customer — leading column customer_id, so it stays one index range
-- scan however many videos the customer has downloaded.
--
-- Prisma model: OfflineVideoDownload (see prisma/schema.prisma)
--
-- ORDERING: apply BEFORE the code deploy. Unlike an additive column, the code
-- cannot run at all without this table — POST and GET both touch it on every
-- call. No backfill: there is no historical record of which product a past
-- download came from, so existing offline files simply carry no registration
-- until the app re-registers them (the FE keeps its local stamp meanwhile).
--
-- Apply with:
--   npx prisma db execute --file docs/migration/schema-changes/2026-08-20_offline_video_download.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS `ws_offline_video_download` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `customer_id`    INT           NOT NULL,
  `video_id`       INT           NOT NULL,  -- lecture id; = scope_id for "ebook" rows
  `scope_kind`     VARCHAR(191)  NOT NULL,  -- "course" | "package" | "liveCourse" | "ebook"
  `scope_id`       INT           NOT NULL,
  `registered_at`  DATETIME(0)   NULL,
  `created_at`     DATETIME(0)   NULL,
  `updated_at`     DATETIME(0)   NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_customer_video_scope` (`customer_id`, `video_id`, `scope_kind`, `scope_id`),
  KEY `idx_ovd_customer_scope` (`customer_id`, `scope_kind`, `scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
