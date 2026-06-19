/**
 * Admin course-scoped Video CRUD — SQL branch for src/admin/course/video.controller.ts
 *   getVideos / getVideoById / createVideo / updateVideo / deleteVideo / reorderVideos
 *
 * Gated behind `isMysqlModule("admin-course-video")`. Reads/writes ws_video +
 * ws_video_category. Response shapes mirror the Mongo controller exactly: each
 * handler returns `{ success, data }` where `data` is a video doc whose
 * `videoCategoryId` is a populated `{ _id, title, slug }` object (list/get) or a
 * bare id string (after create/update, matching an unpopulated Mongo save).
 *
 * NOTE: the controller's createVideoSchema/updateVideoSchema require
 * `videoCategoryId` to be a 24-hex ObjectId, which a numeric SQL id fails. The
 * SQL branch therefore validates the body itself (same field set / coercions)
 * before the Zod parse runs, so numeric category ids are accepted.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const ADMIN_COURSE_VIDEO_MODULE = "admin-course-video";
export const isAdminCourseVideoMysql = (): boolean => isMysqlModule(ADMIN_COURSE_VIDEO_MODULE);

export const parseAcvId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const videoSelect = {
  id: true,
  title: true,
  topic: true,
  slug: true,
  platform: true,
  youtube_id: true,
  aws_id: true,
  vimeo_id: true,
  priceType: true,
  order: true,
  status: true,
  videoCategoryId: true,
  liveSessionId: true,
  created_at: true,
  updated_at: true,
  VideoCategory: { select: { id: true, title: true, slug: true } },
} as const;

/** Shape a ws_video row like the Mongo doc returned by the controller. */
const toDoc = (v: any) => ({
  _id: String(v.id),
  title: v.title,
  topic: v.topic,
  slug: v.slug,
  platform: v.platform,
  youtube_id: v.youtube_id ?? undefined,
  aws_id: v.aws_id ?? undefined,
  vimeo_id: v.vimeo_id ?? undefined,
  priceType: v.priceType,
  order: v.order,
  status: v.status,
  videoCategoryId: v.VideoCategory
    ? { _id: String(v.VideoCategory.id), title: v.VideoCategory.title, slug: v.VideoCategory.slug }
    : v.videoCategoryId != null
    ? String(v.videoCategoryId)
    : null,
  liveSessionId: v.liveSessionId ?? null,
  createdAt: v.created_at ?? null,
  updatedAt: v.updated_at ?? null,
});

// ── list / get ───────────────────────────────────────────────────────────────
export const listVideos = async (opts: { videoCategoryId?: number; status?: boolean; skip: number; take: number }) => {
  const where: any = {};
  if (opts.videoCategoryId !== undefined) where.videoCategoryId = opts.videoCategoryId;
  if (opts.status !== undefined) where.status = opts.status;
  const [rows, total] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy: [{ order: "asc" }, { created_at: "desc" }],
      skip: opts.skip,
      take: opts.take,
      select: videoSelect,
    }),
    prisma.video.count({ where }),
  ]);
  return { data: rows.map(toDoc), total };
};

export const getVideoById = async (id: number) => {
  const v = await prisma.video.findUnique({ where: { id }, select: videoSelect });
  return v ? toDoc(v) : null;
};

// ── create / update / delete / reorder ───────────────────────────────────────
export const categoryExists = async (id: number): Promise<boolean> =>
  !!(await prisma.videoCategory.findUnique({ where: { id }, select: { id: true } }));

export interface VideoCreateInput {
  videoCategoryId: number;
  title: string;
  topic: string;
  slug: string;
  platform: "youtube" | "aws" | "vimeo";
  priceType: "free" | "paid";
  youtube_id?: string | null;
  aws_id?: string | null;
  vimeo_id?: string | null;
  order: number;
  status: boolean;
}

/** Create — returns a bare (unpopulated-category) doc, like the Mongo save(). */
export const createVideo = async (d: VideoCreateInput) => {
  const now = new Date();
  const created = await prisma.video.create({
    data: {
      videoCategoryId: d.videoCategoryId,
      title: d.title,
      topic: d.topic,
      slug: d.slug,
      platform: d.platform,
      priceType: d.priceType,
      youtube_id: d.youtube_id ?? null,
      aws_id: d.aws_id ?? null,
      vimeo_id: d.vimeo_id ?? null,
      order: d.order,
      status: d.status,
      created_at: now,
      updated_at: now,
    },
    select: { ...videoSelect, VideoCategory: false } as any,
  });
  return toDoc(created);
};

/** Update — returns a bare doc, like findByIdAndUpdate({ new: true }). */
export const updateVideo = async (id: number, patch: Partial<VideoCreateInput>): Promise<"not_found" | any> => {
  const existing = await prisma.video.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return "not_found";
  const data: any = { updated_at: new Date() };
  if (patch.videoCategoryId !== undefined) data.videoCategoryId = patch.videoCategoryId;
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.topic !== undefined) data.topic = patch.topic;
  if (patch.slug !== undefined) data.slug = patch.slug;
  if (patch.platform !== undefined) data.platform = patch.platform;
  if (patch.priceType !== undefined) data.priceType = patch.priceType;
  if (patch.youtube_id !== undefined) data.youtube_id = patch.youtube_id ?? null;
  if (patch.aws_id !== undefined) data.aws_id = patch.aws_id ?? null;
  if (patch.vimeo_id !== undefined) data.vimeo_id = patch.vimeo_id ?? null;
  if (patch.order !== undefined) data.order = patch.order;
  if (patch.status !== undefined) data.status = patch.status;
  const updated = await prisma.video.update({
    where: { id },
    data,
    select: { ...videoSelect, VideoCategory: false } as any,
  });
  return toDoc(updated);
};

export const deleteVideo = async (id: number): Promise<boolean> => {
  const existing = await prisma.video.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.video.delete({ where: { id } });
  return true;
};

export const reorderVideos = async (orders: Array<{ id: string; order: number }>): Promise<void> => {
  await Promise.all(
    orders.map(({ id, order }) => {
      const numId = parseAcvId(id);
      return numId
        ? prisma.video.update({ where: { id: numId }, data: { order, updated_at: new Date() } })
        : Promise.resolve();
    })
  );
};
