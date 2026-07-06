-- 2026-06-30 — "Most Popular" pricing-plan tag across commerce modules.
--
-- Two columns per plan table:
--   most_popular_pinned  — admin override ("pin this plan as most popular").
--                          When any plan of a product is pinned, it wins.
--   is_most_popular      — EFFECTIVE flag the API reads. Written by the recompute
--                          job: pinned plan if any, else the plan with the most
--                          all-time paid orders for that product; tie → lowest
--                          price, then lowest id. No sales + no pin → all false.
--
-- 3 tables (Course/Package/Ebook share ws_package_course_ebook_price):
ALTER TABLE ws_package_course_ebook_price
  ADD COLUMN is_most_popular     TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN most_popular_pinned TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE ws_live_course_plan
  ADD COLUMN is_most_popular     TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN most_popular_pinned TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE ws_test_series_price
  ADD COLUMN is_most_popular     TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN most_popular_pinned TINYINT(1) NOT NULL DEFAULT 0;
