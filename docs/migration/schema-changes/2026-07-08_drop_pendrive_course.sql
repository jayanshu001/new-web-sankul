-- 2026-07-08 — Drop the retired Pendrive Course module (7 tables)
--
-- The pendrive product line is retired (no longer sold; see terms module notes:
-- `pendrive` is excluded from the ws_termsandcondition.module enum). None of the
-- 7 tables are referenced by application code — the Prisma models (PendriveCourse*)
-- had zero client-accessor usage — so they are dropped wholesale.
--
-- FK checks are disabled for the drop because the tables reference each other
-- (cart_item → cart/course, cart/order → storage_device, order → tracking) and
-- also carry FKs to ws_customer / ws_customer_shipping.
--
-- ⚠ IRREVERSIBLE. Take a backup/dump of these 7 tables before running in prod.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `ws_pendrive_course_cart_item`;
DROP TABLE IF EXISTS `ws_pendrive_course_order`;
DROP TABLE IF EXISTS `ws_pendrive_course_tracking`;
DROP TABLE IF EXISTS `ws_pendrive_course_cart`;
DROP TABLE IF EXISTS `ws_pendrive_course_storage_device`;
DROP TABLE IF EXISTS `ws_pendrive_course_tag`;
DROP TABLE IF EXISTS `ws_pendrive_course`;

SET FOREIGN_KEY_CHECKS = 1;
