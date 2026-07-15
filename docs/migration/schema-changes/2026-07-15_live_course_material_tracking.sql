-- 2026-07-15 — Live-course material shipment tracking (Track Order parity with Books).
--
-- ws_live_course_subscription had with_material + customer_shipping_id but NO place
-- to store a shipment AWB/status (unlike ws_book_order.tracking_id and
-- ws_package_course_subscription.tracking, which already carry it). Add two inline
-- columns so with-material live-course orders can surface Track Order in
-- GET client/purchase-history/subscriptions and the tracking-detail endpoint.
--
-- tracking_id is a synthetic AWB allocated at payment-verify (below the Tirupati
-- INITIAL_Number threshold → generic/Mahavir trackingUrl), mirroring how SQL book
-- AWBs work today. NULL until the sub is a paid with-material order.
--
-- Idempotent apply on staging:
--   npx prisma db execute --file docs/migration/schema-changes/2026-07-15_live_course_material_tracking.sql

ALTER TABLE ws_live_course_subscription
  ADD COLUMN tracking_id BIGINT NULL,
  ADD COLUMN tracking_status VARCHAR(20) NULL;
