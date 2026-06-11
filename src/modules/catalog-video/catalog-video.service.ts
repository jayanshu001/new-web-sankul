/**
 * Catalog · Video service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Gated behind `isMysqlModule("catalog-video")` — currently **flag OFF**.
 *
 * Built dual-path but NOT enabled. Reasons (same OFF-flag pattern as
 * package/course, D3):
 *  1. Video/category ids are int (MySQL) vs ObjectId (Mongo); still-Mongo
 *     consumers (lecture, free, dashboard resume, progress, catalog browse) join
 *     those ids — flipping one read splits the id space → broken FE.
 *  2. lecture.controller course-membership check reads `VideoCategory.courseId`,
 *     and catalog browse reads `Package.specificSubjects[]` / `childCategoryIds`
 *     — all Mongo-only fields absent from `ws_video_category`.
 *  3. Paid-lecture access checks PackageCourseSubscription (commerce-wave).
 * ⇒ `catalog-video` flips WITH the commerce/dashboard wave.
 *
 * THE URL CONTRACT: `videoEncryptInput()` returns the exact object
 * `encryptVideoSource` consumes; field names match the Mongo path so the SAME
 * util yields an identical URL for a fixed token. NEVER reimplement encryption.
 * See docs/migration/CATALOG_MODULE_SCOPE.md.
 */
import { isMysqlModule } from "../../config/migration";
import { catalogVideoRepository as repo } from "./catalog-video.repository";
import {
  toVideoCategoryDto,
  toVideoDto,
  toVideoEncryptInput,
} from "./catalog-video.transformer";
import type {
  VideoCategoryDto,
  VideoDto,
  VideoEncryptInput,
} from "./catalog-video.types";

export const VIDEO_MODULE = "catalog-video";
export const isVideoMysql = (): boolean => isMysqlModule(VIDEO_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseVideoId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── videos ──────────────────────────────────────────────────────────────────

export const findVideoById = async (id: number): Promise<VideoDto | null> => {
  const row = await repo.findVideoById(id);
  return row ? toVideoDto(row) : null;
};

export const listActiveVideosByCategory = async (
  videoCategoryId: number
): Promise<VideoDto[]> => {
  const rows = await repo.listActiveVideosByCategory(videoCategoryId);
  return rows.map(toVideoDto);
};

export const countActiveVideosByCategory = (videoCategoryId: number): Promise<number> =>
  repo.countActiveVideosByCategory(videoCategoryId);

/**
 * Fetch a video and return the exact `encryptVideoSource` input object (the URL
 * contract). Returns null if the video is missing/disabled. The CALLER feeds
 * this into the shared `encryptVideoSource` util — encryption is never done here.
 */
export const getVideoEncryptInput = async (
  id: number
): Promise<{ video: VideoDto; encrypt: VideoEncryptInput } | null> => {
  const row = await repo.findVideoById(id);
  if (!row) return null;
  return { video: toVideoDto(row), encrypt: toVideoEncryptInput(row) };
};

// ── video categories ──────────────────────────────────────────────────────

export const findVideoCategoryById = async (
  id: number
): Promise<VideoCategoryDto | null> => {
  const row = await repo.findCategoryById(id);
  return row ? toVideoCategoryDto(row) : null;
};

export const listActiveVideoCategories = async (): Promise<VideoCategoryDto[]> => {
  const rows = await repo.listActiveCategories();
  return rows.map(toVideoCategoryDto);
};
