-- Package "isPopular" flag (admin panel).
-- Adds a non-null boolean column to ws_package, mirroring is_paid/is_individual.
-- Default 0 (false) so existing rows are unaffected.

ALTER TABLE `ws_package`
  ADD COLUMN `is_popular` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_paid`;
