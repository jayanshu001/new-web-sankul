import { prisma } from "../../config/prisma";
import type { MediaCreateInput } from "./media.types";

export const mediaRepository = {
  findById: (id: bigint) => prisma.media.findUnique({ where: { id } }),

  delete: (id: bigint) => prisma.media.delete({ where: { id } }),

  create: (input: MediaCreateInput) =>
    prisma.media.create({
      data: {
        url: input.url,
        altText: input.altText,
        width: input.width,
        height: input.height,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    }),
};
