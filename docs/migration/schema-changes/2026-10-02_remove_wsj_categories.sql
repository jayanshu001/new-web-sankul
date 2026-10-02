-- ============================================================================
-- 2026-10-02 — Remove job categories (wsj_categories); listings filter by organization
-- ============================================================================
--
-- Why: the website, admin, websankul-backend and websankul-jobs-api no longer
-- read or write categories — listing chips and "Popular Exams" use
-- wsj_organizations instead (`?org=<slug>`).
--
-- No other DDL is needed for this release:
--   * qualifications (list) .... stored in wsj_contents.card JSON (`qualifications`)
--   * related job .............. existing wsj_contents.related_job_id column
--   * SEO / sections / card meta  existing wsj_contents.detail / card JSON
--
-- ORDER OF DEPLOYMENT (important):
--   1. Deploy websankul-backend + websankul-jobs-api with the updated
--      prisma/schema.prisma (category fields removed). Prisma lists every column
--      it selects, so running this script BEFORE that deploy breaks every
--      wsj_contents / wsj_previous_papers query.
--   2. Confirm nothing else uses these columns — in particular the legacy
--      Laravel admin (websankul-mobile-app-admin-panel, govt_jobs screens).
--   3. Run STEP 1 (backup), then STEP 2 (drop). Keep the backups until you are
--      sure nothing needs the old category data.
--
-- Server: MySQL 8.0.45 (INSTANT column drop supported).
-- Current data (2026-10-02): wsj_categories 16 rows, wsj_contents 51 rows and
-- wsj_previous_papers 15 rows with a category_id, wsj_content_categories 0 rows.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 0 — Pre-check (read only)
-- ----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM wsj_categories)                                   AS categories,
  (SELECT COUNT(*) FROM wsj_content_categories)                           AS content_category_links,
  (SELECT COUNT(*) FROM wsj_contents        WHERE category_id IS NOT NULL) AS contents_with_category,
  (SELECT COUNT(*) FROM wsj_previous_papers WHERE category_id IS NOT NULL) AS papers_with_category,
  (SELECT COUNT(*) FROM wsj_search_documents WHERE category_slugs IS NOT NULL) AS search_docs_with_category;


-- Legacy many-to-many join (already unused, 0 rows). Its FK
-- `fk_wsj_content_categories_category` is the only one pointing into
-- wsj_categories, so it must go before wsj_categories.
DROP TABLE IF EXISTS `wsj_content_categories`;

-- wsj_contents.category_id — indexed, no FK.
ALTER TABLE `wsj_contents`
  DROP INDEX `wsj_contents_category_id_index`,
  ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE `wsj_contents`
  DROP COLUMN `category_id`,
  ALGORITHM=INSTANT;

-- wsj_previous_papers.category_id — indexed, no FK.
ALTER TABLE `wsj_previous_papers`
  DROP INDEX `wsj_previous_papers_category_id_index`,
  ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE `wsj_previous_papers`
  DROP COLUMN `category_id`,
  ALGORITHM=INSTANT;

-- Search index no longer stores category slugs.
ALTER TABLE `wsj_search_documents`
  DROP COLUMN `category_slugs`,
  ALGORITHM=INSTANT;

-- The categories table itself (its own FK fk_wsj_categories_organization →
-- wsj_organizations is dropped with it).
DROP TABLE IF EXISTS `wsj_categories`;


-- ----------------------------------------------------------------------------
-- STEP 3 — Post-check (read only) — expect no rows
-- ----------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME LIKE 'wsj\_%'
   AND TABLE_NAME NOT LIKE '%\_bak\_20261002'
   AND (COLUMN_NAME IN ('category_id', 'category_slugs') OR TABLE_NAME IN ('wsj_categories', 'wsj_content_categories'));


-- ----------------------------------------------------------------------------
-- Permissions: no SQL needed. `jobs.categories` was removed from
-- src/admin/permission/permissions.catalog.ts; the permissions seeder marks
-- removed keys as deprecated (it never hard-deletes them).
-- ----------------------------------------------------------------------------


-- ============================================================================
-- ROLLBACK (only if needed; requires the STEP 1 backups). Re-add the Prisma
-- fields BEFORE redeploying any code that reads categories.
-- ============================================================================
-- CREATE TABLE `wsj_categories` LIKE `wsj_categories_bak_20261002`;
-- INSERT INTO `wsj_categories` SELECT * FROM `wsj_categories_bak_20261002`;
-- ALTER TABLE `wsj_categories`
--   ADD PRIMARY KEY (`id`),
--   ADD UNIQUE KEY `wsj_categories_slug_unique` (`slug`),
--   ADD KEY `idx_wsj_categories_organization_id` (`organization_id`),
--   ADD CONSTRAINT `fk_wsj_categories_organization`
--     FOREIGN KEY (`organization_id`) REFERENCES `wsj_organizations` (`id`),
--   MODIFY `id` bigint unsigned NOT NULL AUTO_INCREMENT;
--
-- ALTER TABLE `wsj_contents`
--   ADD COLUMN `category_id` bigint unsigned NULL AFTER `organization_id`,
--   ADD KEY `wsj_contents_category_id_index` (`category_id`);
-- UPDATE `wsj_contents` c
--   JOIN `wsj_category_links_bak_20261002` b
--     ON b.source_table = 'content' AND b.row_id = c.id
--    SET c.category_id = b.category_id;
--
-- ALTER TABLE `wsj_previous_papers`
--   ADD COLUMN `category_id` bigint unsigned NULL AFTER `organization_id`,
--   ADD KEY `wsj_previous_papers_category_id_index` (`category_id`);
-- UPDATE `wsj_previous_papers` p
--   JOIN `wsj_category_links_bak_20261002` b
--     ON b.source_table = 'previous_paper' AND b.row_id = p.id
--    SET p.category_id = b.category_id;
--
-- ALTER TABLE `wsj_search_documents`
--   ADD COLUMN `category_slugs` varchar(500) NULL AFTER `org_name`;
-- UPDATE `wsj_search_documents` s
--   JOIN `wsj_search_category_slugs_bak_20261002` b ON b.id = s.id
--    SET s.category_slugs = b.category_slugs;
--
-- (wsj_content_categories had 0 rows; recreate from
--  `wsj_content_categories_bak_20261002` with CREATE TABLE ... LIKE only if needed.)
--
-- Once everything is confirmed, drop the backups:
-- DROP TABLE `wsj_categories_bak_20261002`, `wsj_content_categories_bak_20261002`,
--            `wsj_category_links_bak_20261002`, `wsj_search_category_slugs_bak_20261002`;
