import type { Media } from "@prisma/client";
import type { MediaDto } from "./media.types";

export const toMediaDto = (row: Media): MediaDto => ({
  _id: String(row.id),
  url: row.url,
  altText: row.altText ?? undefined,
  width: row.width ?? undefined,
  height: row.height ?? undefined,
});
