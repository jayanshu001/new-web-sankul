-- 2026-06-19 — extend ws_material with the client-facing columns the Mongo
-- Material model carries but ws_material lacked (C1 zero-Mongo: client material
-- listing/detail need isPaid gating, download tracking, newly-added detection,
-- and display metadata). Additive + prod-safe: existing 226 rows get defaults
-- (is_paid=0 → free, download_count=0). No data loss.
ALTER TABLE `ws_material`
  ADD COLUMN `description`    TEXT NULL,
  ADD COLUMN `thumbnail`     VARCHAR(512) NULL,
  ADD COLUMN `file_size`     BIGINT NULL,
  ADD COLUMN `file_mime`     VARCHAR(100) NULL,
  ADD COLUMN `language`      VARCHAR(50) NULL,
  ADD COLUMN `is_preview`    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `is_paid`       TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `download_count` INT NOT NULL DEFAULT 0;
