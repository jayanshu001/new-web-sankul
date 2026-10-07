// Package chat: list, post and delete package chat messages.
import { packageChatRepository as repo } from "./package-chat.repository";
import { toPackageChatDto } from "./package-chat.transformer";
import type {
  PackageChatDto,
  PackageChatPage,
  PostChatInput,
} from "./package-chat.types";

export const parsePackageChatId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const packageExists = (packageId: number): Promise<boolean> =>
  repo.packageExists(packageId);

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

/** `message` is NOT NULL, so media-only posts store "". senderType defaults to 'admin'. */
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

export const deleteChatMessageMysql = async (id: number): Promise<boolean> => {
  const deleted = await repo.deleteById(id);
  return deleted !== null;
};
