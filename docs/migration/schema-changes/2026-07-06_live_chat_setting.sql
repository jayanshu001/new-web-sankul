-- 2026-07-06 — Per-session live-chat settings (chatEnabled + privateChat).
--
-- Admin can toggle two per-live-session chat controls, keyed by liveClassId
-- (= the LiveSession streamId string, same key used by ws_live_chat_message /
-- ws_live_chat_ban):
--   chat_enabled  — when false, VIEWER sends are rejected server-side (admins
--                   can still send). Default true.
--   private_chat  — when true, viewer messages are NOT fanned out to other
--                   viewers (delivered to the sender + admins only, for
--                   moderation); admin messages still reach everyone. Default false.
--
-- Absent row = defaults (chat on, public). One row per liveClassId (unique).

CREATE TABLE IF NOT EXISTS `ws_live_chat_setting` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `live_class_id` VARCHAR(191) NOT NULL,
  `chat_enabled`  TINYINT(1) NOT NULL DEFAULT 1,
  `private_chat`  TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`    DATETIME NULL,
  `updated_at`    DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lcs_live_class_id` (`live_class_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
