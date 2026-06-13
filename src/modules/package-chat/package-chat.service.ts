/**
 * Package · Chat (READ + WRITE — Phase 3b) service — dual-path (MySQL ↔ Mongo).
 *
 * Module key: `package-chat`. See types.ts for the schema-extension + field map.
 * Read = the subscription-gated client listing; write = the admin post/delete.
 * Flag OFF until go-live.
 */
import { isMysqlModule } from "../../config/migration";
import { packageChatRepository as repo } from "./package-chat.repository";
import { toPackageChatDto } from "./package-chat.transformer";
import type {
  PackageChatDto,
  PackageChatPage,
  PostChatInput,
} from "./package-chat.types";

export const PACKAGE_CHAT_MODULE = "package-chat";

export const isPackageChatMysql = (): boolean =>
  isMysqlModule(PACKAGE_CHAT_MODULE);

export const parsePackageChatId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Does this package exist? (write-path guard.) */
export const packageExists = (packageId: number): Promise<boolean> =>
  repo.packageExists(packageId);

/**
 * Paginated chat messages for a package (newest first) + total. Mirrors the
 * Mongo `find().sort({createdAt:-1}).skip().limit()` + countDocuments().
 */
export const listChatMessagesMysql = async (
  packageId: number,
  page: number,
  limit: number
): Promise<PackageChatPage> => {
  const skip = (Math.max(page, 1) - 1) * Math.max(limit, 1);
  const [rows, total] = await Promise.all([
    repo.list(packageId, skip, Math.max(limit, 1)),
    repo.count(packageId),
  ]);
  return { data: rows.map(toPackageChatDto), total };
};

/**
 * Post a chat message. `message` is NOT NULL in SQL → store "" when only media
 * is provided (Mongo defaults `text` to ""). senderType defaults to 'admin'.
 */
export const postChatMessageMysql = async (
  input: PostChatInput
): Promise<PackageChatDto> => {
  const row = await repo.create({
    packageId: input.packageId,
    message: input.text ?? "",
    mediaUrl: input.mediaUrl ?? null,
    mediaType: input.mediaType ?? null,
    senderType: input.senderType ?? "admin",
    senderId: input.senderId ?? null,
  });
  return toPackageChatDto(row);
};

/** Delete a message; returns true if a row was deleted, false if absent. */
export const deleteChatMessageMysql = async (id: number): Promise<boolean> => {
  const deleted = await repo.deleteById(id);
  return deleted !== null;
};
