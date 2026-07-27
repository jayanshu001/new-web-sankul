-- 2026-07-27  Admin dashboard revenue aggregates: created_at range indexes
--
-- WHY: fetchDashboardData() date-window aggregates + seriesFor() raw SQL on
-- ws_ebook_order, ws_book_order, ws_test_series_subscription,
-- ws_live_course_subscription filter on created_at (+ status/payment_status).
-- Without indexes these become full scans as order volume grows.
--
-- Apply: yarn db:migrate

CREATE INDEX idx_ebook_order_created_status
  ON ws_ebook_order (created_at, status);

CREATE INDEX idx_book_order_created_status
  ON ws_book_order (created_at, status);

CREATE INDEX idx_tss_created
  ON ws_test_series_subscription (created_at);

CREATE INDEX idx_lcs_created_payment
  ON ws_live_course_subscription (created_at, payment_status);
