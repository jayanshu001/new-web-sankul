-- Persist the user's ORIGINAL upload filename on a material, separate from the
-- generated storage key embedded in `file` (e.g. the URL ends with
-- `…/1782281052706-file.pdf`). The admin material upload now captures
-- `req.file.originalname` (multer-s3 preserves it) and stores it here so the API
-- can echo back a human-readable name, e.g. "Test 151 - Class 3.pdf".
-- Additive, nullable — existing rows (legacy import) simply have NULL.
ALTER TABLE ws_material ADD COLUMN file_name VARCHAR(255) NULL AFTER file;
