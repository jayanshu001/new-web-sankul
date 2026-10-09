// Live courses: admin recording folders and the videos inside them (lc* helpers).
import { buildPrismaPrefixSearch } from "../../utils/searchFilter";
// Live-course folder + video persistence (ws_video_category + ws_video). Videos have no
// live-session backlink column, so from-recording stores the mp4 path as aws_id +
// platform "aws" and dedupes per folder by (vcategory_id, aws_id).
import { prisma } from "../../config/prisma";
import { descendantsOf } from "../catalog-category-tree/category-tree.service";
import { idStrOrNull } from "./live-course.shared";
import type { Prisma } from "@prisma/client";

function lcSlugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// `_id` is the stringified int.
export const folderDto = (f: any) => ({
  _id: String(f.id),
  title: f.title,
  slug: f.slug ?? null,
  image: f.image ?? null,
  parent: idStrOrNull(f.parent),
  educatorId: idStrOrNull(f.educatorId),
  order_by: f.order_by ?? 0,
  status: f.status,
  createdAt: f.created_at ?? null,
  updatedAt: f.updated_at ?? null,
});

export const relationDto = (r: any) => ({
  _id: String(r.id),
  parent: String(r.parent),
  child: String(r.child),
  order: r.order ?? 0,
});

export const videoDto = (v: any) => ({
  _id: String(v.id),
  title: v.title,
  topic: v.topic ?? "",
  platform: v.platform,
  priceType: v.priceType,
  youtube_id: v.youtube_id ?? null,
  aws_id: v.aws_id ?? null,
  vimeo_id: v.vimeo_id ?? null,
  videoCategoryId: idStrOrNull(v.videoCategoryId),
  order: v.order ?? 0,
  status: v.status,
  createdAt: v.created_at ?? null,
  updatedAt: v.updated_at ?? null,
});

const lcVideoSelect = {
  id: true, title: true, topic: true, platform: true, priceType: true,
  youtube_id: true, aws_id: true, vimeo_id: true, videoCategoryId: true,
  order: true, status: true, created_at: true, updated_at: true,
} as const;

/** ws_live_course.video_category_id, or null. */
const lcRootFolderId = async (liveCourseId: number): Promise<number | null> => {
  const lc = await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { videoCategoryId: true } });
  return lc ? lc.videoCategoryId ?? null : null;
};

export const lcCourseExists = async (liveCourseId: number): Promise<boolean> =>
  !!(await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { id: true } }));

/** Folder ids reachable from the course root (inclusive). Empty if no root set. */
const lcReachableFolderIds = async (liveCourseId: number): Promise<number[]> => {
  const root = await lcRootFolderId(liveCourseId);
  if (!root) return [];
  return descendantsOf([root]);
};

/**
 * Keyed on the flat `live_course_id` column (not the root/DAG) so admin folder ops and
 * the client recordings reader (getRecordingsForClient) agree; lcCreateFolder stamps it
 * on every folder.
 */
export const lcFolderBelongsToCourse = async (folderId: number, liveCourseId: number): Promise<boolean> =>
  !!(await prisma.videoCategory.findFirst({ where: { id: folderId, liveCourseId }, select: { id: true } }));

/**
 * Every folder owned by the course (by liveCourseId) + relation rows. Optional
 * `search` filters by title (used by the admin folder picker).
 */
export const lcListFolders = async (
  liveCourseId: number,
  search?: string
): Promise<{ folders: any[]; relations: any[] }> => {
  const where: Prisma.VideoCategoryWhereInput = { liveCourseId };
  const titleSearch = buildPrismaPrefixSearch(search, ["title"]);
  if (titleSearch) Object.assign(where, titleSearch);
  const folders = await prisma.videoCategory.findMany({
    where,
    orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
  });
  if (!folders.length) return { folders: [], relations: [] };
  const ids = folders.map((f) => f.id);
  const relations = await prisma.videoCategoryRelation.findMany({ where: { OR: [{ parent: { in: ids } }, { child: { in: ids } }] } });
  return { folders: folders.map(folderDto), relations: relations.map(relationDto) };
};

/** Inserts a relation row when parentFolderId is given. */
export const lcCreateFolder = async (
  liveCourseId: number,
  input: { title: string; image?: string; parentFolderId?: number; order_by?: number; educatorId?: number; status?: boolean }
): Promise<{ folder: any } | "bad_parent"> => {
  if (input.parentFolderId != null && !(await lcFolderBelongsToCourse(input.parentFolderId, liveCourseId))) return "bad_parent";
  const lc = await prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { image: true } });
  const fallbackImage = lc?.image ?? "";
  const now = new Date();
  const created = await prisma.videoCategory.create({
    data: {
      title: input.title,
      slug: `${lcSlugify(input.title)}-${Date.now().toString(36)}`,
      image: input.image ?? fallbackImage,
      // ws_video_category.parent is NOT NULL in the DB (0 = top-level) though the model
      // types it `Int?`; default to 0 to avoid a null-constraint error.
      parent: input.parentFolderId ?? 0,
      // Stamp the owning course so the recordings reader (filters by liveCourseId) sees it.
      liveCourseId,
      // educator_id is also NOT NULL (default 0) despite the `Int?` model type.
      educatorId: input.educatorId ?? 0,
      order_by: input.order_by ?? 0,
      status: input.status ?? true,
      created_at: now,
      updated_at: now,
    },
  });
  if (input.parentFolderId != null) {
    await prisma.videoCategoryRelation.create({ data: { parent: input.parentFolderId, child: created.id, order: input.order_by ?? 0 } });
  }
  return { folder: folderDto(created) };
};

/** Returns the DTO, or null if the folder is not in this course. */
export const lcUpdateFolder = async (
  liveCourseId: number,
  folderId: number,
  input: { title?: string; image?: string; order_by?: number; educatorId?: number; status?: boolean }
): Promise<any | null> => {
  if (!(await lcFolderBelongsToCourse(folderId, liveCourseId))) return null;
  const data: Prisma.VideoCategoryUncheckedUpdateInput = { updated_at: new Date() };
  if (input.title !== undefined) data.title = input.title;
  if (input.image !== undefined) data.image = input.image;
  if (input.order_by !== undefined) data.order_by = input.order_by;
  if (input.educatorId !== undefined) data.educatorId = input.educatorId;
  if (input.status !== undefined) data.status = input.status;
  const updated = await prisma.videoCategory.update({ where: { id: folderId }, data });
  return folderDto(updated);
};

/**
 * Refuses the course root folder. Cascades: the folder's videos and relations
 * referencing it, then the folder itself.
 */
export const lcDeleteFolder = async (
  liveCourseId: number,
  folderId: number
): Promise<{ ok: true; deletedVideos: number; deletedRelations: number } | "not_found" | "is_root"> => {
  if (!(await lcFolderBelongsToCourse(folderId, liveCourseId))) return "not_found";
  const root = await lcRootFolderId(liveCourseId);
  if (root != null && root === folderId) return "is_root";
  const [videos, relations] = await Promise.all([
    prisma.video.deleteMany({ where: { videoCategoryId: folderId } }),
    prisma.videoCategoryRelation.deleteMany({ where: { OR: [{ parent: folderId }, { child: folderId }] } }),
  ]);
  await prisma.videoCategory.delete({ where: { id: folderId } });
  return { ok: true, deletedVideos: videos.count, deletedRelations: relations.count };
};

/** Ordered by `order` asc, DB-paginated; each row carries its global `order` so reorder is page-independent. */
export const lcListVideosInFolder = async (
  folderId: number,
  opts?: { skip?: number; take?: number }
): Promise<{ data: any[]; total: number }> => {
  const [rows, total] = await Promise.all([
    prisma.video.findMany({
      where: { videoCategoryId: folderId },
      orderBy: [{ order: "asc" }, { created_at: "asc" }, { id: "asc" }],
      select: lcVideoSelect,
      skip: opts?.skip,
      take: opts?.take,
    }),
    prisma.video.count({ where: { videoCategoryId: folderId } }),
  ]);
  return { data: rows.map(videoDto), total };
};

/** Manual video (youtube/aws/vimeo). */
export const lcCreateVideoInFolder = async (
  folderId: number,
  input: { title: string; topic?: string; platform: "youtube" | "aws" | "vimeo"; priceType?: "free" | "paid"; youtube_id?: string; aws_id?: string; vimeo_id?: string; order?: number; status?: boolean }
): Promise<any> => {
  const now = new Date();
  const created = await prisma.video.create({
    data: {
      videoCategoryId: folderId,
      title: input.title,
      topic: input.topic ?? "",
      platform: input.platform,
      priceType: input.priceType ?? "paid",
      youtube_id: input.youtube_id ?? null,
      aws_id: input.aws_id ?? null,
      vimeo_id: input.vimeo_id ?? null,
      slug: `${lcSlugify(input.title)}-${Date.now().toString(36)}`,
      order: input.order ?? 0,
      status: input.status ?? true,
      created_at: now,
      updated_at: now,
    },
    select: lcVideoSelect,
  });
  return videoDto(created);
};

/** Picks a recording by quality → index → best quality. */
const lcResolveRecording = (recordings: any[], opts: { recordingIndex?: number; quality?: string }): any | null => {
  if (!recordings.length) return null;
  if (opts.quality) {
    const q = opts.quality.toLowerCase();
    return recordings.find((r) => String(r?.quality ?? "").toLowerCase() === q) ?? null;
  }
  if (typeof opts.recordingIndex === "number") return recordings[opts.recordingIndex] ?? null;
  for (const q of ["1080p", "720p", "480p", "360p", "240p", "144p"]) {
    const hit = recordings.find((r) => String(r?.quality ?? "").toLowerCase() === q);
    if (hit) return hit;
  }
  return recordings[0] ?? null;
};

/**
 * Picks a recording from the live session's recordings JSON by index/quality and
 * files its mp4 path into the folder as an aws video, deduped per folder by
 * (vcategory_id, aws_id).
 */
export const lcCreateVideoFromRecording = async (
  folderId: number,
  input: { liveSessionId: number; recordingIndex?: number; quality?: string; title?: string; priceType?: "free" | "paid"; order?: number }
): Promise<{ video: any; alreadyExisted: boolean } | "session_not_found" | "no_recordings" | "recording_not_found" | "no_path"> => {
  const session = await prisma.liveSession.findFirst({ where: { id: input.liveSessionId }, select: { id: true, title: true, recordings: true } });
  if (!session) return "session_not_found";
  const recordings = Array.isArray(session.recordings) ? (session.recordings as any[]) : [];
  if (recordings.length === 0) return "no_recordings";
  const recording = lcResolveRecording(recordings, { recordingIndex: input.recordingIndex, quality: input.quality });
  if (!recording) return "recording_not_found";
  const rawPath: string | undefined = recording.path;
  if (!rawPath) return "no_path";
  const path = rawPath.replace(/(?:"|%22|%2522)+$/i, "");
  const existing = await prisma.video.findFirst({ where: { videoCategoryId: folderId, aws_id: path }, select: lcVideoSelect });
  if (existing) return { video: videoDto(existing), alreadyExisted: true };
  const title = input.title ?? session.title ?? "Recording";
  const now = new Date();
  const created = await prisma.video.create({
    data: {
      videoCategoryId: folderId,
      title,
      topic: "",
      platform: "aws",
      aws_id: path,
      priceType: input.priceType ?? "paid",
      slug: `${lcSlugify(title)}-${Date.now().toString(36)}`,
      order: input.order ?? 0,
      status: true,
      created_at: now,
      updated_at: now,
    },
    select: lcVideoSelect,
  });
  return { video: videoDto(created), alreadyExisted: false };
};

/** Scoped to the folder. Returns whether a row was deleted. */
export const lcDeleteVideoInFolder = async (folderId: number, videoId: number): Promise<boolean> => {
  const res = await prisma.video.deleteMany({ where: { id: videoId, videoCategoryId: folderId } });
  return res.count > 0;
};

/** Returns the DTO, or null if not in this folder. */
export const lcGetVideoInFolder = async (folderId: number, videoId: number): Promise<any | null> => {
  const row = await prisma.video.findFirst({ where: { id: videoId, videoCategoryId: folderId }, select: lcVideoSelect });
  return row ? videoDto(row) : null;
};

/** Scoped to the folder. Returns the DTO or null (not found). */
export const lcUpdateVideoInFolder = async (
  folderId: number,
  videoId: number,
  input: { title?: string; topic?: string; platform?: "youtube" | "aws" | "vimeo"; priceType?: "free" | "paid"; youtube_id?: string; aws_id?: string; vimeo_id?: string; order?: number; status?: boolean }
): Promise<any | null> => {
  const existing = await prisma.video.findFirst({ where: { id: videoId, videoCategoryId: folderId }, select: { id: true } });
  if (!existing) return null;
  const data: Prisma.VideoUncheckedUpdateInput = { updated_at: new Date() };
  if (input.title !== undefined) data.title = input.title;
  if (input.topic !== undefined) data.topic = input.topic;
  if (input.platform !== undefined) data.platform = input.platform;
  if (input.priceType !== undefined) data.priceType = input.priceType;
  if (input.youtube_id !== undefined) data.youtube_id = input.youtube_id;
  if (input.aws_id !== undefined) data.aws_id = input.aws_id;
  if (input.vimeo_id !== undefined) data.vimeo_id = input.vimeo_id;
  if (input.order !== undefined) data.order = input.order;
  if (input.status !== undefined) data.status = input.status;
  const updated = await prisma.video.update({ where: { id: videoId }, data, select: lcVideoSelect });
  return videoDto(updated);
};

/** Only videos in this folder are touched (other ids are ignored). Returns matched/modified. */
export const lcReorderVideosInFolder = async (
  folderId: number,
  orders: { id: number; order: number }[]
): Promise<{ matched: number; modified: number }> => {
  let matched = 0;
  for (const { id, order } of orders) {
    const res = await prisma.video.updateMany({ where: { id, videoCategoryId: folderId }, data: { order, updated_at: new Date() } });
    matched += res.count;
  }
  return { matched, modified: matched };
};
