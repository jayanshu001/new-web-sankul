import type { Video, VideoCategory } from "@prisma/client";
import type {
  VideoCategoryDto,
  VideoDto,
  VideoEncryptInput,
  VideoPlatform,
  VideoPriceType,
} from "./catalog-video.types";

/** `ws_video` row → DTO. Carries the encryption-source fields verbatim. */
export const toVideoDto = (row: Video): VideoDto => ({
  _id: String(row.id),
  title: row.title,
  topic: row.topic,
  slug: row.slug,
  platform: row.platform as VideoPlatform,
  priceType: row.priceType as VideoPriceType,
  youtube_id: row.youtube_id ?? null,
  aws_id: row.aws_id ?? null,
  vimeo_id: row.vimeo_id ?? null,
  videoCategoryId: row.videoCategoryId != null ? String(row.videoCategoryId) : null,
  order: row.order,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

/**
 * THE URL CONTRACT — produce the exact object `encryptVideoSource` consumes,
 * from a migrated row (or its DTO). Field names are identical to the Mongo path,
 * so the SAME util yields an identical videoURL for any fixed token. NEVER
 * reimplement the encryption — only feed this into the shared util.
 */
export const toVideoEncryptInput = (
  row: Pick<Video, "platform" | "youtube_id" | "aws_id" | "vimeo_id">
): VideoEncryptInput => ({
  platform: row.platform as VideoPlatform,
  // Coerce ""/null to undefined so a blank non-active-platform id is never
  // mistaken for a source (the live data stores "" rather than NULL for the
  // unused platform columns). The URL is still driven solely by `platform`.
  youtube_id: row.youtube_id || undefined,
  aws_id: row.aws_id || undefined,
  vimeo_id: row.vimeo_id || undefined,
});

/** `ws_video_category` row → DTO (the columns Prisma maps). */
export const toVideoCategoryDto = (row: VideoCategory): VideoCategoryDto => ({
  _id: String(row.id),
  title: row.title,
  slug: row.slug,
  image: row.image,
  order: row.order_by,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
