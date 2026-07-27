-- 2026-07-27  ws_ebook_subscription: customer-scoped active-sub index
--
-- WHY: my-subscriptions ebook tab uses the same customer+status+end_at pattern;
-- table had PRIMARY only. Same fix as idx_pcs_customer_status_endat.
--
-- Apply: yarn db:migrate

CREATE INDEX idx_ebook_sub_customer_status_endat
  ON ws_ebook_subscription (customer_id, status, end_at);
