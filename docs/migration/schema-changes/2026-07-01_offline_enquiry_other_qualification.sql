-- 2026-07-01 — add other_qualification to ws_offline_enquiry (client batch
-- enquiry port). The Mongo OfflineBatchEnquiry stored a free-text
-- `otherQualification` when the applicant picks "other"; SQL folds batch
-- enquiries into ws_offline_enquiry, which lacked this column.
-- Additive + prod-safe: existing rows default NULL.
ALTER TABLE `ws_offline_enquiry` ADD COLUMN `other_qualification` VARCHAR(255) NULL DEFAULT NULL AFTER `qualification`;
