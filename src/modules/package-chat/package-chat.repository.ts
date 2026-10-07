// Package chat: Prisma queries.
import { prisma } from "../../config/prisma";

export const packageChatRepository = {
  /** Newest first; tiebreak on `id` because `created_at` has second granularity. */
  list: (packageId: number, skip: number, take: number) =>
    prisma.packageChat.findMany({
      where: { packageId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),

  count: (packageId: number) =>
    prisma.packageChat.count({ where: { packageId } }),

  packageExists: async (packageId: number): Promise<boolean> =>
    (await prisma.package.count({ where: { id: packageId } })) > 0,

  /** `message` is NOT NULL, so the caller passes "" for media-only posts. */
  create: (input: {
    packageId: number;
    message: string;
    mediaUrl: string | null;
    mediaType: "image" | "video" | "pdf" | "audio" | "other" | null;
    senderType: "admin" | "system";
    senderId: string | null;
  }) =>
    prisma.packageChat.create({
      data: {
        packageId: input.packageId,
        message: input.message,
        mediaUrl: input.mediaUrl,
        mediaType: input.mediaType ?? undefined,
        senderType: input.senderType,
        senderId: input.senderId,
        pushSent: false,
      },
    }),

  deleteById: async (id: number) => {
    const existing = await prisma.packageChat.findUnique({ where: { id } });
    if (!existing) return null;
    await prisma.packageChat.delete({ where: { id } });
    return existing;
  },
};
