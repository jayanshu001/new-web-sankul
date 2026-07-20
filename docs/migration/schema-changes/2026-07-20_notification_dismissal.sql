-- 2026-07-20 — Client-side notification delete: per-user dismissal table.
--
-- WHY A TABLE INSTEAD OF `DELETE FROM ws_notification`:
--   Notifications are served with the visibility filter (customer_id = me OR
--   broadcast = true). Broadcast rows (broadcast = 1) are SHARED by every customer —
--   there is exactly one row backing the same banner for the whole user base.
--   A hard `DELETE` of a broadcast row on behalf of one customer would remove that
--   notification from EVERYONE's feed (cross-user data loss). Personal rows are
--   single-owner and could be hard-deleted, but we keep ONE uniform mechanism so the
--   client contract (and the delete endpoints) behave identically for both kinds.
--
-- SEMANTICS: "delete" == "dismiss from my feed" == insert one row here. The client
--   list / unread-count queries LEFT-exclude any notification id present in this table
--   for the requesting customer. Reversible (delete the dismissal row) and never
--   destroys the underlying notification for other recipients.
--
-- Rollback: DROP TABLE IF EXISTS `ws_notification_dismissal`;

CREATE TABLE IF NOT EXISTS `ws_notification_dismissal` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `customer_id`     INT NOT NULL,
  `notification_id` INT NOT NULL,
  `created_at`      DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_notif_dismissal` (`customer_id`, `notification_id`),
  KEY `idx_notif_dismissal_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
