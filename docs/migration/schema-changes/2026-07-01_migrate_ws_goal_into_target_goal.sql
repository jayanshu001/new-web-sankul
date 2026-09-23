-- 2026-07-01  Consolidate ws_goal INTO ws_customer_target_goal, then drop ws_goal
--
-- ws_goal (packages/exam-countdowns categorization) is merged into
-- ws_customer_target_goal so there is a single goal master. ws_goal ids live in a
-- DIFFERENT id-space, so package/countdown FK ids (goal_id) must be REMAPPED, not
-- blindly reused. Labels JSON is copied verbatim, so goal_label_id values remain
-- valid (label ids are per-goal and preserved).
--
-- Idempotent: safe to re-run. Run this BEFORE dropping the table (step 4).
-- No FK constraints reference ws_goal (verified), so no constraint drop needed.
--
-- CAVEAT: if a ws_goal.title already exists as a ws_customer_target_goal.name with
-- DIFFERENT labels, the existing target row's labels win (INSERT is skipped); any
-- package/countdown goal_label_id that referenced the old ws_goal label id may then
-- not resolve. On staging the ws_goal titles (Defence/Government/UPSC) do not exist
-- in the target table, so they are inserted fresh with labels intact.

-- 1) Migrate ws_goal rows → ws_customer_target_goal (match by title→name; keep labels)
INSERT INTO `ws_customer_target_goal` (`name`, `image`, `active`, `labels`)
SELECT g.`title`, COALESCE(g.`image`, ''), g.`is_active`, g.`labels`
FROM `ws_goal` g
WHERE NOT EXISTS (
  SELECT 1 FROM `ws_customer_target_goal` t WHERE t.`name` = g.`title`
);

-- 2) Remap ws_package.goal_id (goal_label_id unchanged — labels copied verbatim)
UPDATE `ws_package` p
JOIN `ws_goal` g ON g.`id` = p.`goal_id`
JOIN `ws_customer_target_goal` t ON t.`name` = g.`title`
SET p.`goal_id` = t.`id`
WHERE p.`goal_id` IS NOT NULL;

-- 3) Remap ws_exam_countdown.goal_id
UPDATE `ws_exam_countdown` c
JOIN `ws_goal` g ON g.`id` = c.`goal_id`
JOIN `ws_customer_target_goal` t ON t.`name` = g.`title`
SET c.`goal_id` = t.`id`
WHERE c.`goal_id` IS NOT NULL;

-- 4) Drop the now-unused table (run only AFTER 1–3 succeed and app is repointed)
DROP TABLE IF EXISTS `ws_goal`;
