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

ALTER TABLE `ws_offline_batch`
  ADD COLUMN `deleted_at` DATETIME NULL AFTER `updated_at`;

-- Speeds up the `deleted_at IS NULL` filter on list/count queries.
CREATE INDEX `idx_ws_offline_batch_deleted_at` ON `ws_offline_batch` (`deleted_at`);
