-- ExamCountdown goal tagging (parity with Package.goal_id / goal_label_id).
-- Lets an admin tag an exam countdown to a Goal (ws_goal) and a specific label
-- within that goal's labels JSON (e.g. goal "Civil Services" → label "GPSC").
-- The client dashboard uses goal_label_id to prioritise countdowns matching the
-- user's selected goal-labels (ws_customer.goal = int[] of label ids), falling
-- back to nearest-upcoming when there's no match.

ALTER TABLE `ws_exam_countdown`
  ADD COLUMN `goal_id`       INT NULL AFTER `category_id`,
  ADD COLUMN `goal_label_id` INT NULL AFTER `goal_id`,
  ADD KEY `idx_exam_countdown_goal_label` (`goal_label_id`, `exam_date`);
