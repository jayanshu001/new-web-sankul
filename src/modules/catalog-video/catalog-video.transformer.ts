// Video catalog: row to DTO mapping (response shape is frozen).
import type { Video, VideoCategory } from "@prisma/client";
import type {
  VideoCategoryDto,
  VideoDto,
  VideoEncryptInput,
  VideoPlatform,
  VideoPriceType,
} from "./catalog-video.types";

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
 * Builds the exact input `encryptVideoSource` consumes. Never reimplement the
 * encryption; only feed this into the shared util.
 */
export const toVideoEncryptInput = (
  row: Pick<Video, "platform" | "youtube_id" | "aws_id" | "vimeo_id">
): VideoEncryptInput => ({
  platform: row.platform as VideoPlatform,
  // Coerce ""/null to undefined: live data stores "" for unused platform columns,
  // which must never be mistaken for a source. The URL is driven solely by `platform`.
  youtube_id: row.youtube_id || undefined,
  aws_id: row.aws_id || undefined,
  vimeo_id: row.vimeo_id || undefined,
});

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
