import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the package · chat branch (`ws_package_chat`, extended
 * 2026-06-13). Read (paginated list + count) for the client + write (create,
 * delete) for the admin. See types.ts for the field mapping.
 */
export const packageChatRepository = {
  /**
   * Paginated messages for a package, newest first. Tiebreak on `id` desc:
   * `created_at` is a second-granularity `datetime`, so messages posted in the
   * same second would otherwise order non-deterministically; `id` (autoincrement)
   * preserves true insertion order, matching the Mongo intent (newest first).
   */
  list: (packageId: number, skip: number, take: number) =>
    prisma.packageChat.findMany({
      where: { packageId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),

  /** Total messages for a package. */
  count: (packageId: number) =>
    prisma.packageChat.count({ where: { packageId } }),

  /** Does this package exist? (the write-path existence guard.) */
  packageExists: async (packageId: number): Promise<boolean> =>
    (await prisma.package.count({ where: { id: packageId } })) > 0,

  /** Create a message. `message` is NOT NULL → caller passes "" for media-only. */
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

  /** Delete a message by id; returns the deleted row or null if absent. */
  deleteById: async (id: number) => {
    const existing = await prisma.packageChat.findUnique({ where: { id } });
    if (!existing) return null;
    await prisma.packageChat.delete({ where: { id } });
    return existing;
  },
};
