-- Add Subscription: standardized payment section for Live Course grants.
-- The admin Live Course grant is being extended from a free-grant to a full
-- paid grant. ws_live_course_subscription already stores razorpay_order_id /
-- razorpay_payment_id / paid_amount / payment_status inline; add the remaining
-- payment columns so the granular method + bank reference + a remark persist on
-- the subscription row (this table has no sibling order table).
ALTER TABLE `ws_live_course_subscription`
  ADD COLUMN `payment_method`      VARCHAR(191) NULL AFTER `payment_status`,
  ADD COLUMN `bank_transaction_id` VARCHAR(191) NULL AFTER `razorpay_payment_id`,
  ADD COLUMN `remarks`             TEXT         NULL AFTER `bank_transaction_id`;
