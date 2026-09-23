-- 2026-09-09 — live chat: separate public and private listings
--
-- WHY. Live class chat has two modes, toggled by the host: public (everyone sees
-- a message) and private (only the host and the sender see it). Both modes wrote
-- into ONE listing, so when the host toggled public -> private, private messages
-- appended onto the public timeline and the client rendered a mixed thread.
--
-- The mode was only ever read from ws_live_chat_setting.private_chat at SEND time
-- to decide the socket fan-out. It was never stored on the message, so history
-- could not be filtered afterwards: a reload returned every row regardless of the
-- mode it was sent in. Requirement doc: separate the listings, keep BOTH histories
-- in the database, and serve one mode at a time.
--
-- NOTHING IS DROPPED OR RENAMED. Two additive columns + one index.
--
--   1. is_private        — the mode that was active when the message was sent.
--                          Stamped once at send time and never rewritten when the
--                          host later toggles, so a message keeps the visibility
--                          it was sent under. Existing rows are all public chat,
--                          which is exactly what DEFAULT 0 gives them — no
--                          backfill needed.
--
--   2. target_customer_id — which customer a PRIVATE admin reply is addressed to.
--                          Private mode hides students from EACH OTHER; it does not
--                          hide the host from the class. So a host message needs to
--                          say who it is for: addressed, it reaches that student and
--                          the admins only, which is what stops one student reading
--                          a reply meant for another. NULL on an admin row means the
--                          host is talking to the whole class, and that message is
--                          delivered to everyone. Meaningless on a customer row and
--                          on any public row.
--
--   3. idx_lcm_class_private — history reads are now
--                          (live_class_id, is_private) ordered by created_at. The
--                          table only had idx_lcm_class (live_class_id alone), so
--                          every filtered read would scan the whole class and sort.
--
-- SAFE TO APPLY BEFORE THE CODE. `is_private` is NOT NULL with a default, so
-- existing INSERTs that omit it keep working and every existing row reads as
-- public — which is what it was. `target_customer_id` is nullable. No read or
-- write depends on either column until the new code ships.
--
-- ⚠ ORDER: apply this BEFORE deploying the code that declares these columns in
-- schema.prisma. Prisma selects every declared scalar, so code-ahead-of-DB raises
-- MySQL 1054 on every live-chat read (see the 2026-08-26 live-course incident).

ALTER TABLE `ws_live_chat_message`
  ADD COLUMN `is_private`         TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_admin`,
  ADD COLUMN `target_customer_id` INT        NULL     AFTER `is_private`;

-- Mode-scoped history: WHERE live_class_id = ? AND is_private = ? ORDER BY created_at
CREATE INDEX `idx_lcm_class_private`
  ON `ws_live_chat_message` (`live_class_id`, `is_private`, `created_at`);
