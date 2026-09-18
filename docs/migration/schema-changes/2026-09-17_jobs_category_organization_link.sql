-- 2026-09-17 — Jobs Management: scope categories to an organization
--
-- WHY. Job categories (wsj_categories) are currently global/unscoped. The
-- admin content editor needs to filter the category picker down to only the
-- categories that belong to the organization selected on that content item
-- (one organization -> many categories), so the admin doesn't have to hunt
-- through every category from every organization while writing a post.
--
-- Nullable FK — a category with no organization is treated as a shared/
-- global category and still shows up regardless of which organization is
-- selected (all 15 existing categories fall into this bucket after this
-- migration; nothing is backfilled or reassigned).
--
-- SAFE TO APPLY BEFORE THE CODE. Additive only (one nullable column, one FK,
-- one index).  ON DELETE SET NULL — deleting an organization demotes its
-- categories back to global instead of failing or cascading.
--
-- IDEMPOTENT (2026-09-18 fix). The original version of this file was a single
-- unguarded `ALTER TABLE ... ADD COLUMN ... ADD CONSTRAINT ... ADD INDEX`,
-- which fails with "Duplicate column name 'organization_id'" if the deploy
-- script re-runs it after it already succeeded once (the apply-ddl runner has
-- no per-file "already applied" tracking). Split into three guarded
-- statements, each checked against information_schema first — same pattern
-- as 2026-08-26_purchase_history_indexes.sql — so a re-run is a clean no-op.

-- ── 1. wsj_categories.organization_id column ──────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wsj_categories'
    AND COLUMN_NAME='organization_id');
SET @ddl := IF(@has = 0,
  'ALTER TABLE wsj_categories ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER label',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. FK wsj_categories.organization_id -> wsj_organizations.id ─────────
SET @has := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='wsj_categories'
    AND CONSTRAINT_NAME='fk_wsj_categories_organization'
    AND CONSTRAINT_TYPE='FOREIGN KEY');
SET @ddl := IF(@has = 0,
  'ALTER TABLE wsj_categories
     ADD CONSTRAINT fk_wsj_categories_organization
       FOREIGN KEY (organization_id) REFERENCES wsj_organizations(id) ON DELETE SET NULL',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. wsj_categories(organization_id) index ──────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wsj_categories'
    AND INDEX_NAME='idx_wsj_categories_organization_id');
SET @ddl := IF(@has = 0,
  'ALTER TABLE wsj_categories
     ADD INDEX idx_wsj_categories_organization_id (organization_id)',
  'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
