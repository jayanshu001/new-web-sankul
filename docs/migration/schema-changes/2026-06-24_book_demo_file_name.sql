-- Persist the user's ORIGINAL demo-PDF filename on a book, separate from the
-- generated storage key in `demo_url`. Mirrors ws_ebook.demo_file_name. Books
-- only have a demo PDF (no full-book PDF / book_url), so only demo_file_name is
-- needed. The admin book create/update already captures req.file.originalname
-- into req.body.demoFileName; this column lets it persist + round-trip on edit.
-- Additive, nullable — existing rows have NULL.
ALTER TABLE ws_book ADD COLUMN demo_file_name VARCHAR(255) NULL AFTER demo_url;
