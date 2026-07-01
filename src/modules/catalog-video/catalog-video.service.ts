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
export const isVideoMysql = (): boolean => true;

/** Parse a string id to a positive int, else null. */
export const parseVideoId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Numeric video-category id guard (SQL ids are ints). */
export const parseVideoCategoryId = (id: string): number | null => {
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

/**
 * Children-nav drill-down for a video category (client `categories` controller).
 * Returns { parent, list } where each list[].category = { ...categoryDto, count
 * (active videos), havingChildDirectory (≥1 active grandchild) }. Returns null if
 * the parent is missing. ⚠ Mongo gates children via the `childCategoryIds[]` DAG;
 * SQL derives them from the single `parent` FK (same divergence as admin-master).
 * The parent is fetched WITHOUT a status gate, matching the Mongo `findById`
 * (an inactive parent still renders its children).
 */
export const getVideoCategoryChildren = async (
  parentId: number,
  search?: string
): Promise<{ parent: VideoCategoryDto; list: { category: VideoCategoryDto & { count: number; havingChildDirectory: boolean } }[] } | null> => {
  const parentRow = await repo.findCategoryByIdAny(parentId);
  if (!parentRow) return null;

  const children = await repo.listActiveChildren(parentId, { search: search?.trim() || undefined });
  const childIds = children.map((c) => c.id);
  const [counts, parentsWithKids] = await Promise.all([
    Promise.all(childIds.map((cid) => repo.countActiveVideosByCategory(cid))),
    repo.parentsWithChildren(childIds),
  ]);
  const hasKids = new Set(parentsWithKids.map((r) => r.parent));

  const list = children.map((c, i) => ({
    category: { ...toVideoCategoryDto(c), count: counts[i], havingChildDirectory: hasKids.has(c.id) },
  }));
  return { parent: toVideoCategoryDto(parentRow), list };
};
