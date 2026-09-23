import type { PackageChat } from "@prisma/client";
import type { PackageChatDto, ChatMediaType, ChatSenderType } from "./package-chat.types";

/**
 * SQL ws_package_chat row → the Mongo-shaped PackageChat doc. SQL `message` ↔
 * Mongo `text`; sender_id is a varchar admin ObjectId (string|null).
 */
export const toPackageChatDto = (row: PackageChat): PackageChatDto => ({
  _id: String(row.id),
  packageId: String(row.packageId),
  text: row.message ?? "",
  mediaUrl: row.mediaUrl ?? null,
  mediaType: (row.mediaType as ChatMediaType | null) ?? null,
  senderType: row.senderType as ChatSenderType,
  senderId: row.senderId ?? null,
  pushSent: row.pushSent,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});
