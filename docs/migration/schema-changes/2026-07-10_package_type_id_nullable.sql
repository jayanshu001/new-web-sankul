-- 2026-07-10 — Make ws_package.package_type_id nullable
--
-- The Add/Edit Package form sends packageTypeId = <id> OR null to CLEAR the type.
-- The Prisma model already declares `packageTypeId Int?` (nullable), but the live
-- column was `NOT NULL` (schema drift) — so a null write hit a P2011 null-constraint
-- error. This aligns the DB with the model so clearing the package type persists NULL
-- instead of silently coercing to sentinel id `1`.
--
-- Safe + backward-compatible: only loosens the constraint. Existing non-null values
-- are unaffected. Apply BEFORE relying on "null clears packageTypeId".

ALTER TABLE `ws_package`
  MODIFY COLUMN `package_type_id` INT NULL;
