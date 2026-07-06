-- Persist the user's ORIGINAL solution-PDF filename on an exam, separate from
-- the generated storage key in `solution_pdf` (whose URL ends with e.g.
-- `…/1782281052706-solutionPdfUrl.pdf`). Mirrors ws_material.file_name. The admin
-- exam upload captures `req.file.originalname` and stores it here so the API can
-- echo back a human-readable name alongside `solutionPdfUrl`.
-- Additive, nullable — existing rows have NULL.
ALTER TABLE ws_exam ADD COLUMN solution_pdf_name VARCHAR(255) NULL AFTER solution_pdf;
