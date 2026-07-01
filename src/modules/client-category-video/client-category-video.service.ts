/**
 * Client category-video reads — SQL branch for
 *   GET /client/video-categories/:id/videos        (listVideosByCategory)
 *   GET /client/video-categories/:id/videos/:vid    (getVideoByCategory)
 *
 * Gated behind `isMysqlModule("client-category-video")`. Reads ws_video +
 * ws_video_category + ws_lecture_progress (per-row resume badge). Scope is
 * resolved by the catalog-category-tree SQL resolver. The encryption envelope
 * (resolveVideoSource + encrypt) stays controller-owned (DB-agnostic).
 *
 * Drift: ws_video has no live-session back-link column → per-row multi-quality
 * recordings are always empty on SQL (FE falls back to the synthetic ladder),
 * matching how SQL videos (not promoted-from-live) behave.
 */
import { prisma } from "../../config/prisma";

export const CATEGORY_VIDEO_MODULE = "client-category-video";
export const isCategoryVideoMysql = (): boolean => true;

export const parseCvId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const findCategory = (id: number) =>
  prisma.videoCategory.findFirst({ where: { id }, select: { id: true, title: true, image: true } });

/** Category DTO shaped like the Mongo `category` object (passthrough-ish). */
export const categoryDto = (c: any) => ({ _id: String(c.id), title: c.title ?? null, image: c.image ?? null });

export type CvVideo = {
  id: number; title: string; topic: string; platform: string;
  youtube_id: string | null; aws_id: string | null; vimeo_id: string | null;
  priceType: string; videoCategoryId: number | null;
};

const videoSelect = {
  id: true, title: true, topic: true, platform: true,
  youtube_id: true, aws_id: true, vimeo_id: true, priceType: true, videoCategoryId: true,
} as const;

/** Paginated active videos in a category (+ optional title search / price filter). */
export const listVideos = async (opts: {
  categoryId: number; search: string | null; priceType: "free" | "paid" | null; skip: number; limitNum: number;
}) => {
  const where: any = { videoCategoryId: opts.categoryId, status: true };
  if (opts.search) where.title = { contains: opts.search };
  if (opts.priceType) where.priceType = opts.priceType;
  const [rows, total] = await Promise.all([
    prisma.video.findMany({ where, orderBy: { order: "asc" }, skip: opts.skip, take: opts.limitNum, select: videoSelect }),
    prisma.video.count({ where }),
  ]);
  return { rows, total };
};

export const findVideoInCategory = (categoryId: number, videoId: number) =>
  prisma.video.findFirst({ where: { id: videoId, videoCategoryId: categoryId, status: true }, select: videoSelect });

/** Per-video resume badges for a customer over a set of videoIds. */
export const progressByVideo = async (customerId: number, videoIds: number[]): Promise<Map<number, any>> => {
  if (!videoIds.length) return new Map();
  const rows = await prisma.lectureProgress.findMany({
    where: { customerId, videoId: { in: videoIds } },
    select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true },
  });
  return new Map(rows.map((r) => [r.videoId!, r]));
};

/** Owning-container scope ({kind, id}) for a category — SQL DAG resolver. */
export const scopeForCategory = async (categoryId: number) => {
  const { resolveVideoScope } = await import("../catalog-category-tree/category-tree.service");
  return resolveVideoScope(categoryId);
};
