/**
 * Package · Chat (READ + WRITE — Phase 3b) — MySQL (Prisma) branch types.
 *
 * Module key: `package-chat`. Package "announcement" chat (admin/system posts;
 * subscription-gated read). Spans a client READ + an admin WRITE:
 *   - GET  /client/package/:packageId/chat   (getChatMessages — paginated list)
 *   - POST /admin/package/:id/chat            (postChatMessage — create)
 *   - DELETE /admin/package/chat/:messageId   (deleteChatMessage)
 *
 * ── SCHEMA EXTENSION (2026-06-13) ───────────────────────────────────────────
 * `ws_package_chat` was a legacy STUB (`package_id`, `message`, timestamps). The
 * live Mongo PackageChat needs media + sender + push, so the table was EXTENDED
 * (additive ALTER — the first schema add in this migration): `media_url`,
 * `media_type` enum, `sender_type` enum, `sender_id`, `push_sent`. Now the SQL
 * row reproduces the Mongo doc 1:1.
 *
 * ── FIELD MAPPING ───────────────────────────────────────────────────────────
 *  - SQL `message` ↔ Mongo `text` (Mongo defaults `text` to ""; SQL message is
 *    NOT NULL → write "" when only media is sent).
 *  - SQL `media_url`/`media_type` ↔ Mongo `mediaUrl`/`mediaType`.
 *  - SQL `sender_type` ↔ Mongo `senderType` ('admin'|'system').
 *  - SQL `sender_id` is **VARCHAR** — it holds the admin ObjectId (admin auth
 *    stays on Mongo per the strategy), so it's a string here, not an int. Mongo
 *    `senderId` (ObjectId|null) → string|null.
 *  - SQL `push_sent` ↔ Mongo `pushSent`.
 *  - `package_id` is INT (the migrated id-space).
 *
 * Ids returned as strings (Mongo `_id`-shape).
 */

export type ChatMediaType = "image" | "video" | "pdf" | "audio" | "other";
export type ChatSenderType = "admin" | "system";

/** Mongo-shaped PackageChat doc (the list + the create response). */
export interface PackageChatDto {
  _id: string;
  packageId: string;
  /** Mongo `text` ← SQL message. */
  text: string;
  mediaUrl: string | null;
  mediaType: ChatMediaType | null;
  senderType: ChatSenderType;
  /** Admin ObjectId string (admin auth is Mongo), or null. */
  senderId: string | null;
  pushSent: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** A paginated chat listing (mirrors the Mongo {data,total} shape). */
export interface PackageChatPage {
  data: PackageChatDto[];
  total: number;
}

/** Input for posting a chat message (admin). */
export interface PostChatInput {
  packageId: number;
  text?: string;
  mediaUrl?: string;
  mediaType?: ChatMediaType;
  /** Admin ObjectId string (or null for system). */
  senderId?: string | null;
  senderType?: ChatSenderType;
}
