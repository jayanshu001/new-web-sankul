-- ============================================================================
-- Clear ALL subscription data for a set of customers.
--
-- Wipes the four subscription tables, the orders that produced them, and the
-- entitlement artifacts derived from those subscriptions. The ws_customer row,
-- addresses, tokens, wishlist and book orders are intentionally LEFT INTACT —
-- the customer keeps their account and simply looks like they never purchased.
--
-- Usage: edit @CUSTOMERS below, then
--   docker exec -i ws-mysql mysql -u<user> -p<pass> <db> < scripts/clear-customer-subscriptions.sql
--
-- NOTE: none of these tables carry foreign keys (only 4 FKs exist in the whole
-- schema, none of them here), so delete order is free — EXCEPT the tracking
-- delete, which resolves through ws_package_course_order and must therefore run
-- BEFORE the orders are removed.
--
-- ALWAYS take a row-level backup first:
--   mysqldump --no-create-info --complete-insert <db> <table> \
--     --where="customer_id IN (...)" > backup.sql
-- ============================================================================

SET @c1 = 472366;
SET @c2 = 472367;

START TRANSACTION;

-- 1. Package / course --------------------------------------------------------
--    Tracking first: it joins through the orders deleted in the next statement.
DELETE FROM ws_package_course_subscription_tracking
 WHERE `order` IN (SELECT id FROM ws_package_course_order WHERE customer_id IN (@c1, @c2));

DELETE FROM ws_package_course_subscription WHERE customer_id IN (@c1, @c2);
DELETE FROM ws_package_course_order        WHERE customer_id IN (@c1, @c2);

-- 2. Ebook -------------------------------------------------------------------
DELETE FROM ws_ebook_subscription WHERE customer_id IN (@c1, @c2);
DELETE FROM ws_ebook_order        WHERE customer_id IN (@c1, @c2);

-- 3. Live course -------------------------------------------------------------
DELETE FROM ws_live_course_subscription WHERE customer_id IN (@c1, @c2);

-- 4. Test series -------------------------------------------------------------
DELETE FROM ws_test_series_subscription WHERE customer_id IN (@c1, @c2);
DELETE FROM ws_test_series_order        WHERE customer_id IN (@c1, @c2);

-- 5. Entitlement artifacts produced by the subscriptions above ---------------
DELETE FROM ws_ebook_download         WHERE customer_id IN (@c1, @c2);
DELETE FROM ws_offline_video_download WHERE customer_id IN (@c1, @c2);
DELETE FROM ws_lecture_progress       WHERE customer_id IN (@c1, @c2);
DELETE FROM ws_enrollment_resume      WHERE customer_id IN (@c1, @c2);
DELETE FROM ws_folder_item            WHERE customer_id IN (@c1, @c2);

-- 6. Referral coin ledger tied to those orders -------------------------------
DELETE FROM ws_refferal_transaction WHERE customer_id IN (@c1, @c2);

COMMIT;
