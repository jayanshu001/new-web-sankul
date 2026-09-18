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
-- one index). ON DELETE SET NULL — deleting an organization demotes its
-- categories back to global instead of failing or cascading.

ALTER TABLE wsj_categories
  ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER label,
  ADD CONSTRAINT fk_wsj_categories_organization
    FOREIGN KEY (organization_id) REFERENCES wsj_organizations(id) ON DELETE SET NULL,
  ADD INDEX idx_wsj_categories_organization_id (organization_id);
