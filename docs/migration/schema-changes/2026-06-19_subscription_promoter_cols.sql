-- 2026-06-19 — C8: add the promoter-attribution columns the admin-promoter
-- subscriptions/dashboard handlers need (Mongo PackageCourseSubscription carries
-- promoterId / promoterPercentage / paidAmount directly; SQL had none). Additive,
-- nullable, prod-safe. Lets getPromoterSubscriptions return the literal fields
-- instead of the order-JSON attribution approximation.

ALTER TABLE `ws_package_course_subscription`
  ADD COLUMN `promoter_id`         INT NULL,
  ADD COLUMN `promoter_percentage` DECIMAL(10,2) NULL,
  ADD COLUMN `paid_amount`         DECIMAL(10,2) NULL,
  ADD KEY `idx_pcs_promoter` (`promoter_id`, `created_at`);
