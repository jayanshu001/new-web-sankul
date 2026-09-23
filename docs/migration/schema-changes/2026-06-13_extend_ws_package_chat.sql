-- ─────────────────────────────────────────────────────────────────────────────
-- Schema change: EXTEND ws_package_chat (package-chat module, Phase 3b)
-- Date: 2026-06-13 · Branch: migration
--
-- WHY: ws_package_chat was a legacy STUB (id, package_id, message, timestamps).
-- The live Mongo PackageChat feature (admin/system package announcements) needs
-- media + sender + push fields. The SQL table could not represent the contract
-- `getChatMessages` returns, so it was EXTENDED (the first ADDITIVE schema change
-- in this migration) to reproduce the Mongo doc 1:1.
--
-- ADDITIVE ONLY — no existing column changed/dropped; safe to run on prod.
-- sender_id is VARCHAR because it holds the admin ObjectId (admin auth stays on
-- Mongo per the migration strategy), not an int.
--
-- Idempotency: this was applied directly to staging via ALTER. For prod, run the
-- same statement once. (Project convention is manual ALTER + `prisma db pull`,
-- not Prisma Migrate — there is no prisma/migrations dir.)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ws_package_chat
  ADD COLUMN media_url   VARCHAR(1000) NULL AFTER message,
  ADD COLUMN media_type  ENUM('image','video','pdf','audio','other') NULL DEFAULT 'other' AFTER media_url,
  ADD COLUMN sender_type ENUM('admin','system') NOT NULL DEFAULT 'admin' AFTER media_type,
  ADD COLUMN sender_id   VARCHAR(255) NULL AFTER sender_type,
  ADD COLUMN push_sent   TINYINT(1) NOT NULL DEFAULT 0 AFTER sender_id;

-- Prisma model: model PackageChat (was the stub `chat`) in prisma/schema.prisma,
-- with enums PackageChatMediaType / PackageChatSenderType. Regenerated with
-- prisma@5.22.0 after this ALTER.
