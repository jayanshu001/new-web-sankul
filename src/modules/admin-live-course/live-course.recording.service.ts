// Live courses: client recording reads (VOD metadata, recording folders, session recordings) and recording auto-promotion.
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import type { Prisma } from "@prisma/client";
import { getVodStreamMeta } from "../../libs/streamos/streamos.service";
import { providerOf, getRecordingByAssetId } from "../../libs/streamos/streamos.provider";
import { redisClient } from "../../config/redis";
import { buildPrismaSearch, matchesAllTokens } from "../../utils/searchFilter";
// Same DAG source the admin category pickers use, so the FE maps one shape everywhere.
import { primaryParentMap } from "../../utils/videoCategoryRelation";
import { qualitiesFromSessionRecordings } from "../../utils/videoQualities";
import { signMediaToken } from "../../utils/mediaToken";
import { formatScheduledAt } from "../../utils/displayTime";
import { prisma } from "../../config/prisma";
import { sanitizeRecPath } from "./live-course.shared";
import { buildPurchaseOptionsSql, getDaysLeftMap, hasAccessToAnyLiveCourse } from "./live-course.client.service";
import { folderDto } from "./live-course.vod.service";

// Recordings are immutable once StreamOS produces them; the TTL still picks up a
// re-processed/late recording within the hour.
const VOD_META_CACHE_TTL_SEC = 3600;

type VodRec = { quality: string | null; file_size: number | null; path: string };
interface CachedVodMeta {
  hlsUrl: string | null;
  hls: VodRec[];
  mp4: VodRec[];
}

/** What resolveVodMeta needs off a session row to know where to resolve. */
type VodSessionRef = {
  streamId: string | null;
  streamProvider?: string | null;
  recordedAssetId?: string | null;
};

/**
 * Resolve a session's StreamOS VOD into playable URLs via get-vod-stream-meta,
 * Redis-cached per id. null on any failure so the caller falls back to stored webhook
 * recordings. The accessKey never leaves the server; only CDN URLs reach the client.
 */
const resolveVodMeta = async (session: VodSessionRef): Promise<CachedVodMeta | null> => {
  const streamId = String(session.streamId ?? "");
  if (!streamId) return null;

  const isV1 = providerOf(session) === "v1";
  // v1 recordings are library assets addressed by asset id. Without one the recording
  // hasn't landed or is still transcoding; the caller falls back to stored recs.
  const assetId = session.recordedAssetId ?? null;
  if (isV1 && !assetId) return null;

  // Namespaced per provider: independent id spaces, so a shared key could serve a
  // legacy resolution for a v1 id.
  const cacheKey = isV1 ? `vodmeta:v1:${assetId}` : `vodmeta:${streamId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached) as CachedVodMeta;
  } catch {
    /* cache read best-effort */
  }
  try {
    const meta = isV1
      ? await getRecordingByAssetId(String(assetId))
      : await getVodStreamMeta(streamId);
    const norm = (r: { quality: string; path: string }): VodRec => ({
      quality: r.quality || null,
      file_size: null,
      path: sanitizeRecPath(r.path),
    });
    const out: CachedVodMeta = { hlsUrl: meta.hlsUrl ?? null, hls: meta.hls.map(norm), mp4: meta.mp4.map(norm) };
    // Only cache a non-empty resolution so a transient blip isn't pinned.
    if (out.hlsUrl || out.hls.length || out.mp4.length) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(out), "EX", VOD_META_CACHE_TTL_SEC);
      } catch {
        /* cache write best-effort */
      }
    }
    return out;
  } catch {
    return null;
  }
};

type RecordingVideo = Prisma.VideoGetPayload<Record<string, never>>;

const shapeStoredRecs = (raw: unknown): VodRec[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((r: any) => typeof r?.path === "string" && r.path.length > 0)
    .map((r: any) => ({
      quality: typeof r.quality === "string" ? r.quality : null,
      file_size: typeof r.file_size === "number" ? r.file_size : null,
      path: sanitizeRecPath(r.path),
    }));

/**
 * Recording Videos → client lecture DTOs (VOD resolution with stored-webhook fallback,
 * media token, resume progress). Shared by all three recordings reads so they emit
 * byte-identical lectures; never fork it per endpoint.
 */
const shapeRecordingLectures = async (
  courseId: number,
  customerId: number | null,
  subscribed: boolean,
  videos: RecordingVideo[]
): Promise<any[]> => {
  if (!videos.length) return [];

  // Per-quality recordings from the source live session.
  const sessionIds = [...new Set(videos.map((v) => v.liveSessionId).filter((n): n is number => n != null))];
  const recBySession = new Map<number, VodRec[]>();
  // VOD-meta-resolved playable URLs per session (get-vod-stream-meta, cached).
  const vodBySession = new Map<number, CachedVodMeta | null>();
  if (sessionIds.length) {
    const sessions = await prisma.liveSession.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
        streamId: true,
        recordings: true,
        // Needed to pick the right StreamOS API and address a v1 recording.
        streamProvider: true,
        recordedAssetId: true,
      },
    });
    for (const s of sessions) recBySession.set(s.id, shapeStoredRecs(s.recordings));
    // Playable URLs via StreamOS get-vod-stream-meta (cached), failure-isolated per
    // session: one that can't resolve falls back to its stored webhook recordings.
    await Promise.all(
      sessions
        .filter((s) => !!s.streamId)
        .map(async (s) => {
          vodBySession.set(s.id, await resolveVodMeta(s));
        })
    );
  }

  const progByVideo = new Map<number, any>();
  if (customerId) {
    const rows = await prisma.lectureProgress.findMany({
      where: { customerId, videoId: { in: videos.map((v) => v.id) } },
      select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true },
    });
    for (const r of rows) if (r.videoId != null) progByVideo.set(r.videoId, r);
  }

  return videos.map((v) => {
    const canPlay = subscribed || v.priceType === "free";
    const p = progByVideo.get(v.id);
    // Only cleartext metadata the list screen needs (qualities, preferred stream hint).
    // No playable URL / source id: the client exchanges `mediaToken` at /media/resolve.
    const vod = v.liveSessionId ? vodBySession.get(v.liveSessionId) ?? null : null;
    const storedHls = v.liveSessionId ? recBySession.get(v.liveSessionId) ?? [] : [];
    const hlsList = vod?.hls?.length ? vod.hls : storedHls;
    const hasHls = !!(vod?.hlsUrl || hlsList.length);
    // Locked (unpurchased paid) → no token. Free → free token; purchased → scoped to the
    // live course so resolve can re-check entitlement.
    const mediaToken =
      !canPlay || customerId == null
        ? null
        : v.priceType === "free"
        ? signMediaToken({ k: "liveRecording", id: v.id, free: true, cust: customerId })
        : signMediaToken({ k: "liveRecording", id: v.id, scope: { kind: "liveCourse", id: courseId }, cust: customerId });
    return {
      _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, isFree: v.priceType === "free", order: v.order,
      locked: !canPlay,
      preferredStream: (hasHls ? "hls" : "mp4") as "hls" | "mp4",
      qualities: qualitiesFromSessionRecordings(hlsList),
      mediaToken,
      progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
    };
  });
};

/**
 * Course + entitlement preamble for the recordings reads. A deactivated live course
 * still serves recordings to active subscribers but 404s for everyone else.
 */
const loadRecordingsContext = async (
  courseId: number,
  customerId: number | null
): Promise<"not_found" | { course: any; subscribed: boolean; daysLeft: number | null }> => {
  const course = await repo.findById(courseId);
  if (!course) return "not_found";
  const subscribed = await hasAccessToAnyLiveCourse(customerId, [courseId]);
  if (!course.status && !subscribed) return "not_found";
  const daysLeftMap = await getDaysLeftMap(customerId, [courseId]);
  return { course, subscribed, daysLeft: daysLeftMap.has(String(courseId)) ? daysLeftMap.get(String(courseId)) ?? null : null };
};

const recordingFolderWhere = (courseId: number) => ({ liveCourseId: courseId, status: true });
const RECORDING_FOLDER_ORDER = [{ order_by: "asc" as const }, { created_at: "asc" as const }];
const RECORDING_FOLDER_SELECT = { id: true, title: true, image: true, order_by: true };

type RecordingFolderRow = { id: number; title: string | null; slug?: string | null; image?: string | null; order_by?: number | null; status?: boolean | null; created_at?: Date | null; updated_at?: Date | null };

/**
 * Hierarchy overlay for recording folder rows (folders nest via
 * ws_video_category_relation, see lcCreateFolder). Emits the catalog directory
 * contract: `parent` / `childCategoryIds` / `havingChildDirectory` / `count`, as
 * client-catalog.catalogMaterials/catalogVideos and the /children drill-downs do.
 * `count`: a directory reports its child-folder count, a leaf its subtree lecture count.
 * Edges are scoped to this course's folders on both ends, so a folder shared with
 * another course never leaks a foreign parent or child.
 */
const buildRecordingFolderTree = async (folders: RecordingFolderRow[]) => {
  const ids = folders.map((f) => f.id);
  const edges = ids.length
    ? await prisma.videoCategoryRelation.findMany({
        where: { parent: { in: ids }, child: { in: ids } },
        select: { parent: true, child: true, order: true },
      })
    : [];
  // The relation table is a DAG; collapse to one parent per folder so `parent` stays
  // single-valued (same rule as the admin pickers).
  const primaryParent = primaryParentMap(edges);
  const childrenOf = new Map<number, number[]>();
  for (const e of [...edges].sort((a, b) => a.order - b.order || a.child - b.child)) {
    // Only the primary edge counts, else a multi-parent folder is listed twice.
    if (!e.parent || !e.child || primaryParent.get(e.child) !== e.parent) continue;
    const arr = childrenOf.get(e.parent) ?? [];
    if (!arr.includes(e.child)) arr.push(e.child);
    childrenOf.set(e.parent, arr);
  }
  const childIds = (id: number): number[] => childrenOf.get(id) ?? [];
  /** Self + every descendant, cycle-guarded. */
  const subtree = (id: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      stack.push(...childIds(cur));
    }
    return out;
  };
  return {
    childIds,
    subtree,
    /** Top-level folders of this course: no parent inside the course. */
    isRoot: (id: number) => (primaryParent.get(id) ?? 0) <= 0,
    meta: (id: number) => {
      const parent = primaryParent.get(id) ?? null;
      const kids = childIds(id);
      return {
        parent: parent ? String(parent) : null,
        childCategoryIds: kids.map(String),
        havingChildDirectory: kids.length > 0,
      };
    },
  };
};

/** Catalog directory `count`: directory → child-folder count, leaf → lectures in its subtree. */
const folderCatalogCount = (
  tree: { childIds: (id: number) => number[]; subtree: (id: number) => number[] },
  lecturesByFolder: Map<number, number>,
  id: number
): number => {
  const kids = tree.childIds(id);
  return kids.length
    ? kids.length
    : tree.subtree(id).reduce((n, fid) => n + (lecturesByFolder.get(fid) ?? 0), 0);
};

export const getRecordingsForClient = async (
  courseId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number; parentId?: string } = { page: 1, limit: 20 }
): Promise<"not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  const folders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folderIds = folders.map((f) => f.id);
  const videos = folderIds.length
    ? await prisma.video.findMany({ where: { videoCategoryId: { in: folderIds }, status: true }, orderBy: [{ order: "asc" }, { created_at: "asc" }] })
    : [];

  const shaped = await shapeRecordingLectures(courseId, customerId, subscribed, videos);
  const byFolder = new Map<number, any[]>();
  videos.forEach((v, i) => {
    const a = byFolder.get(v.videoCategoryId as number) ?? [];
    a.push(shaped[i]);
    byFolder.set(v.videoCategoryId as number, a);
  });

  const tree = await buildRecordingFolderTree(folders);
  const lecturesByFolder = new Map<number, number>();
  for (const v of videos) {
    const fid = v.videoCategoryId as number;
    lecturesByFolder.set(fid, (lecturesByFolder.get(fid) ?? 0) + 1);
  }
  // Deliberately flat (sub-folders included): this reader ships each folder's
  // `lectures[]`, so hiding sub-folders would hide lectures. Callers can group by
  // `parent`. The tree screen uses ?summary=1, which is roots-only.
  const allFolders = folders.map((f) => ({
    folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
    ...tree.meta(f.id),
    count: folderCatalogCount(tree, lecturesByFolder, f.id),
    lectures: byFolder.get(f.id) ?? [],
  }));

  // Lecture-title search drops non-matching lectures (and now-empty folders);
  // pagination is over folders. totalLectures reflects the filtered set.
  const filteredFolders = q.search
    ? allFolders
        .map((f) => ({ ...f, lectures: f.lectures.filter((l) => matchesAllTokens(q.search, [l.title])) }))
        .filter((f) => f.lectures.length > 0)
    : allFolders;
  const totalLectures = filteredFolders.reduce((n, f) => n + f.lectures.length, 0);
  const totalFolders = filteredFolders.length;
  const folderPayload = filteredFolders.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    subscribed, daysLeft, totalLectures, folders: folderPayload,
    total: totalFolders, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

/**
 * Hub variant of getRecordingsForClient: folder name + lecture count only, from a SQL
 * groupBy (no Video rows, VOD resolution or token signing). Paginated over folders.
 */
export const getRecordingFolderSummaryForClient = async (
  courseId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number; parentId?: string } = { page: 1, limit: 20 }
): Promise<"not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  const folders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folderIds = folders.map((f) => f.id);
  const counts = folderIds.length
    ? await prisma.video.groupBy({
        by: ["videoCategoryId"],
        where: { videoCategoryId: { in: folderIds }, status: true, ...(buildPrismaSearch(q.search, ["title"]) ?? {}) },
        _count: { _all: true },
      })
    : [];
  const countByFolder = new Map(counts.map((c) => [c.videoCategoryId as number, c._count._all]));

  const tree = await buildRecordingFolderTree(folders);
  // Roots only: sub-folders are reached through GET /recordings/:folderId/children,
  // like material categories. Listing children beside their parent broke the tree.
  const allFolders = folders
    .filter((f) => tree.isRoot(f.id))
    .map((f) => ({
      folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
      ...tree.meta(f.id),
      count: folderCatalogCount(tree, countByFolder, f.id),
      lectureCount: countByFolder.get(f.id) ?? 0,
    }));
  // Search keeps a folder if anything in its subtree matches, so the path to a hit stays
  // walkable. Without a search every root is kept, including empty ones (count 0).
  const matchCount = (f: { folderId: string }) =>
    tree.subtree(Number(f.folderId)).reduce((n, id) => n + (countByFolder.get(id) ?? 0), 0);
  const filteredFolders = q.search ? allFolders.filter((f) => matchCount(f) > 0) : allFolders;
  const totalLectures = filteredFolders.reduce((n, f) => n + matchCount(f), 0);

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    subscribed, daysLeft, totalLectures,
    folders: filteredFolders.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit),
    total: filteredFolders.length, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

/**
 /**
  * One folder's lectures, paginated by lecture (the "open folder" screen). Same
  * entitlement rules as the full response: locked lectures carry no media token.
  */
export const getRecordingFolderDetailForClient = async (
  courseId: number,
  folderId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
): Promise<"not_found" | "folder_not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  // The whole course folder set feeds the hierarchy overlay and proves the folder
  // belongs to this course; otherwise any folder id would be readable via any course.
  const allFolders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folder = allFolders.find((f) => f.id === folderId);
  if (!folder) return "folder_not_found";
  const tree = await buildRecordingFolderTree(allFolders);

  const where = { videoCategoryId: folder.id, status: true, ...(buildPrismaSearch(q.search, ["title"]) ?? {}) };
  // Subtree counts drive the catalog-contract `count` on the folder itself.
  const subtreeIds = tree.subtree(folder.id);
  const [subtreeCounts, videos, total] = await Promise.all([
    prisma.video.groupBy({ by: ["videoCategoryId"], where: { videoCategoryId: { in: subtreeIds }, status: true }, _count: { _all: true } }),
    prisma.video.findMany({ where, orderBy: [{ order: "asc" }, { created_at: "asc" }], skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.video.count({ where }),
  ]);
  const countByFolder = new Map(subtreeCounts.map((c) => [c.videoCategoryId as number, c._count._all]));

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    folderId: String(folder.id), title: folder.title, image: folder.image, order: folder.order_by,
    // `havingChildDirectory` cues the FE to call GET /recordings/:folderId/children;
    // sub-folders are not inlined because they page separately.
    ...tree.meta(folder.id),
    count: folderCatalogCount(tree, countByFolder, folder.id),
    lectureCount: total,
    lectures: await shapeRecordingLectures(courseId, customerId, subscribed, videos),
    subscribed, daysLeft,
    total, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

/**
 * GET /:id/recordings/:folderId/children: sub-folders of one recording folder, paginated.
 * Same `{ parent, list: [{ category }] }` composition as catalog-material.getCategoryChildren
 * and catalog-video.getVideoCategoryChildren, but course-scoped: a folder id from another
 * course 404s here instead of resolving.
 */
export const getRecordingFolderChildrenForClient = async (
  courseId: number,
  folderId: number,
  customerId: number | null,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
): Promise<"not_found" | "folder_not_found" | any> => {
  const ctx = await loadRecordingsContext(courseId, customerId);
  if (ctx === "not_found") return "not_found";
  const { course, subscribed, daysLeft } = ctx;

  const allFolders = await prisma.videoCategory.findMany({
    where: recordingFolderWhere(courseId),
    orderBy: RECORDING_FOLDER_ORDER,
    select: RECORDING_FOLDER_SELECT,
  });
  const folder = allFolders.find((f) => f.id === folderId);
  if (!folder) return "folder_not_found";
  const tree = await buildRecordingFolderTree(allFolders);

  const byId = new Map(allFolders.map((f) => [f.id, f]));
  // Children keep their admin order (RECORDING_FOLDER_ORDER), not the edge order, so a
  // folder sorts the same here as on the hub.
  const orderedChildIds = allFolders.map((f) => f.id).filter((id) => tree.childIds(folder.id).includes(id));
  const matching = orderedChildIds.filter((id) => matchesAllTokens(q.search, [byId.get(id)?.title ?? ""]));
  const pageIds = matching.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);

  // One groupBy over the page's subtrees plus the parent: leaf `count` is a subtree
  // lecture count, and the parent row reports its own `lectureCount` like any hub row.
  const countIds = [...new Set([folder.id, ...pageIds.flatMap((id) => tree.subtree(id))])];
  const counts = countIds.length
    ? await prisma.video.groupBy({ by: ["videoCategoryId"], where: { videoCategoryId: { in: countIds }, status: true }, _count: { _all: true } })
    : [];
  const countByFolder = new Map(counts.map((c) => [c.videoCategoryId as number, c._count._all]));

  const folderDto = (id: number) => {
    const f = byId.get(id)!;
    return {
      folderId: String(f.id), title: f.title, image: f.image, order: f.order_by,
      ...tree.meta(f.id),
      count: folderCatalogCount(tree, countByFolder, f.id),
      lectureCount: countByFolder.get(f.id) ?? 0,
    };
  };

  return {
    liveCourse: { _id: String(course.id), name: course.name, image: course.image },
    parent: folderDto(folder.id),
    list: pageIds.map((id) => ({ category: folderDto(id) })),
    subscribed, daysLeft,
    total: matching.length, page: q.page, limit: q.limit,
    purchaseOptions: subscribed ? [] : await buildPurchaseOptionsSql([courseId]),
  };
};

// Ownership check only; the controller does encryptLecture.
export const clientLectureVideoInCourse = async (
  courseId: number,
  videoId: number
): Promise<"video_not_found" | "mismatch" | { _id: number; platform: string; youtube_id: string | null; aws_id: string | null; vimeo_id: string | null; title: string; topic: string; priceType: "free" | "paid" }> => {
  const v = await prisma.video.findFirst({ where: { id: videoId, status: true } });
  if (!v) return "video_not_found";
  const folder = await prisma.videoCategory.findFirst({ where: { id: v.videoCategoryId ?? -1, liveCourseId: courseId }, select: { id: true } });
  if (!folder) return "mismatch";
  return { _id: v.id, platform: v.platform, youtube_id: v.youtube_id ?? null, aws_id: v.aws_id ?? null, vimeo_id: v.vimeo_id ?? null, title: v.title ?? "", topic: v.topic ?? "", priceType: v.priceType };
};

export const isLectureEntitled = async (courseId: number, customerId: number | null, priceType: "free" | "paid"): Promise<boolean> =>
  priceType === "free" ? true : hasAccessToAnyLiveCourse(customerId, [courseId]);

export const listSessionRecordingsForClient = async (
  courseId: number,
  customerId: number | null,
  page: number,
  limit: number,
  search?: string
): Promise<"not_found" | { liveCourse: any; subscribed: boolean; total: number; page: number; limit: number; lectures: any[] }> => {
  const course = await repo.findById(courseId);
  if (!course) return "not_found";
  // A deactivated live course still serves its session recordings to active
  // subscribers; 404 for everyone else.
  if (!course.status && !(await hasAccessToAnyLiveCourse(customerId, [courseId]))) return "not_found";

  const links = await prisma.liveSessionCourse.findMany({ where: { liveCourseId: courseId }, select: { liveSessionId: true } });
  const sessionIds = [...new Set(links.map((l) => l.liveSessionId).filter((n): n is number => n != null))];
  const where: Prisma.LiveSessionWhereInput = { id: { in: sessionIds.length ? sessionIds : [-1] }, status: { in: ["SCHEDULED", "CREATED"] }, ...(buildPrismaSearch(search, ["title"]) ?? {}) };
  const [sessions, total, subscribed] = await Promise.all([
    prisma.liveSession.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }], skip: (page - 1) * limit, take: limit }),
    prisma.liveSession.count({ where }),
    hasAccessToAnyLiveCourse(customerId, [courseId]),
  ]);

  const lectures = sessions.map((s) => ({
    sessionId: String(s.id), title: s.title, status: s.status, isLive: s.status === "CREATED" && !!s.hlsUrl,
    subject: s.subject ?? null, streamId: s.streamId ?? null, scheduledAt: s.scheduledAt ?? null,
    scheduledAtDisplay: formatScheduledAt(s.scheduledAt), endAt: s.endAt ?? null, locked: !subscribed,
  }));
  return { liveCourse: { _id: String(course.id), name: course.name, image: course.image }, subscribed, total, page, limit, lectures };
};

const normalizeSubjectKey = (s?: string | null): string | null => {
  if (typeof s !== "string") return null;
  const k = s.trim().toLowerCase().replace(/\s+/g, " ");
  return k.length ? k : null;
};
const pickRecording = (recs: any[]): any | null => {
  if (!recs?.length) return null;
  for (const q of ["1080p", "720p", "480p", "360p", "240p", "144p"]) {
    const hit = recs.find((r) => r?.quality?.toLowerCase() === q);
    if (hit) return hit;
  }
  return recs[0] ?? null;
};
/**
 * Best-effort, never throws: files the best recording into each linked course's chosen
 * folder (ws_live_session_course.folder_id). Courses without a folder are skipped.
 * Idempotent per folder (dedupe by aws_id = path).
 */
export const maybeAutoPromoteRecordingSql = async (session: {
  id: number; title: string | null; recordings: any;
}): Promise<void> => {
  try {
    const recs = Array.isArray(session.recordings) ? session.recordings : [];
    const rec = pickRecording(recs);
    if (!rec?.path) return;
    const path = String(rec.path).replace(/(?:"|%22|%2522)+$/i, "");
    const links = await prisma.liveSessionCourse.findMany({
      where: { liveSessionId: session.id },
      select: { folderId: true },
    });
    const folderIds = Array.from(
      new Set(links.map((l) => l.folderId).filter((f): f is number => f != null))
    );
    for (const folderId of folderIds) {
      try {
        const folder = await prisma.videoCategory.findFirst({ where: { id: folderId }, select: { id: true } });
        if (!folder) continue;
        const dup = await prisma.video.findFirst({ where: { videoCategoryId: folderId, aws_id: path }, select: { id: true } });
        if (dup) continue;
        await prisma.video.create({
          data: { videoCategoryId: folderId, liveSessionId: session.id, title: session.title ?? "", topic: "", platform: "aws", slug: `rec-${Date.now().toString(36)}`, aws_id: path, priceType: "paid", order: 0, status: true } as any,
        });
      } catch { /* per-course best-effort */ }
    }
  } catch { /* non-fatal */ }
};
