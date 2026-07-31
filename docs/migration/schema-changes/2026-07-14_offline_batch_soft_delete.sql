-- 2026-07-14 — Soft delete for ws_offline_batch
--
-- WHY: DELETE /admin/offline/batches/:id previously HARD-deleted the batch AND
-- cascade-deleted every enquiry in it (ws_offline_enquiry), destroying lead history.
-- Enquiries carry a REQUIRED FK (batch_id → ws_offline_batch.id), so they cannot
-- outlive a hard-deleted batch. Instead we soft-delete the batch: the row stays
-- (keeping the enquiry relation valid, so /admin/offline/batch-enquiries still shows
-- them with their batch name), but `deleted_at` hides it from every batch listing.
--
-- CODE (already updated): deleteBatch flags `deleted_at = now()` and no longer
-- cascades enquiry deletes; all batch reads filter `deleted_at IS NULL`.
--
-- Nullable, no default → existing rows are treated as NOT deleted. Non-destructive.
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no ADD COLUMN / CREATE INDEX "IF NOT
-- EXISTS", so each add is guarded on information_schema and becomes a no-op if
-- already applied (fixes "Duplicate column name" on a re-run).

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_offline_batch' AND COLUMN_NAME = 'deleted_at');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_offline_batch` ADD COLUMN `deleted_at` DATETIME NULL AFTER `updated_at`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Speeds up the `deleted_at IS NULL` filter on list/count queries.
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_offline_batch' AND INDEX_NAME = 'idx_ws_offline_batch_deleted_at');
SET @ddl := IF(@exists = 0,
  'CREATE INDEX `idx_ws_offline_batch_deleted_at` ON `ws_offline_batch` (`deleted_at`)',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
