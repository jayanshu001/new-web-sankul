// Category videos: listings, progress, notes flags and entitlement checks.
/**
 * The encryption envelope stays controller-owned. ws_video has no live-session
 * back-link, so per-row multi-quality recordings are always empty here (the FE
 * falls back to the synthetic ladder).
 */
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { parsePositiveInt } from "../../utils/parseId";
import type { Prisma } from "@prisma/client";

export const parseCvId = parsePositiveInt;

export const findCategory = (id: number) =>
  prisma.videoCategory.findFirst({ where: { id }, select: { id: true, title: true, image: true } });

export const categoryDto = (c: any) => ({ _id: String(c.id), title: c.title ?? null, image: c.image ?? null });

const videoSelect = {
  id: true, title: true, topic: true, platform: true,
  youtube_id: true, aws_id: true, vimeo_id: true, priceType: true, videoCategoryId: true,
} as const;

export const listVideos = async (opts: {
  categoryId: number; search: string | null; priceType: "free" | "paid" | null; skip: number; limitNum: number;
}) => {
  const where: Prisma.VideoWhereInput = { videoCategoryId: opts.categoryId, status: true };
  const search = buildPrismaSearch(opts.search, ["title"]);
  if (search) where.AND = search.AND;
  if (opts.priceType) where.priceType = opts.priceType;
  const [rows, total] = await Promise.all([
    prisma.video.findMany({ where, orderBy: [{ order: "asc" }, { created_at: "asc" }], skip: opts.skip, take: opts.limitNum, select: videoSelect }),
    prisma.video.count({ where }),
  ]);
  return { rows, total };
};

export const findVideoInCategory = (categoryId: number, videoId: number) =>
  prisma.video.findFirst({ where: { id: videoId, videoCategoryId: categoryId, status: true }, select: videoSelect });

export const progressByVideo = async (customerId: number, videoIds: number[]): Promise<Map<number, any>> => {
  if (!videoIds.length) return new Map();
  const rows = await prisma.lectureProgress.findMany({
    where: { customerId, videoId: { in: videoIds } },
    select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true },
  });
  return new Map(rows.map((r) => [r.videoId!, r]));
};

/**
 * Video ids on the page with at least one text or audio note. Deliberately not
 * filtered by `lecture_type` or `course_id`: the notes list keys on
 * (customer, lectureType, videoId) and ignores the container, so a tighter flag
 * would say `hasNotes: false` on a video that opens with notes. `video_id` is only
 * set on recorded-video notes.
 */
export const videosWithNotes = async (customerId: number, videoIds: number[]): Promise<Set<number>> => {
  if (!videoIds.length) return new Set();
  const [text, audio] = await Promise.all([
    prisma.lectureNote.findMany({ where: { customerId, videoId: { in: videoIds } }, select: { videoId: true }, distinct: ["videoId"] }),
    prisma.lectureAudioNote.findMany({ where: { customerId, videoId: { in: videoIds } }, select: { videoId: true }, distinct: ["videoId"] }),
  ]);
  const out = new Set<number>();
  for (const r of [...text, ...audio]) if (r.videoId != null) out.add(r.videoId);
  return out;
};

/** A category may sit under multiple packages; returns every owning container. */
export const scopesForCategory = async (categoryId: number) => {
  const { resolveVideoScopes } = await import("../catalog-category-tree/category-tree.service");
  return resolveVideoScopes(categoryId);
};

/**
 * The first scope (course → live → package priority) the customer holds an active
 * subscription for, or null. Checks every owning container, so a buyer of any of
 * them is entitled, and returns which one so the media token is scoped to a
 * container the customer owns (keeping /media/resolve's single-scope re-check valid).
 */
export const entitledScopeFor = async (
  customerId: number | null,
  scopes: { kind: string; id: string }[],
): Promise<{ kind: string; id: string } | null> => {
  if (customerId == null || !scopes.length) return null;
  const now = new Date();
  const num = (s: { id: string }) => Number(s.id);
  const courseIds = scopes.filter((s) => s.kind === "course").map(num).filter((n) => Number.isInteger(n) && n > 0);
  const packageIds = scopes.filter((s) => s.kind === "package").map(num).filter((n) => Number.isInteger(n) && n > 0);
  const liveIds = scopes.filter((s) => s.kind === "liveCourse").map(num).filter((n) => Number.isInteger(n) && n > 0);

  const [pcSubs, liveSubs] = await Promise.all([
    courseIds.length || packageIds.length
      ? prisma.packageCourseSubscription.findMany({
          where: {
            customerId, status: true, endAt: { gt: now },
            OR: [
              ...(courseIds.length ? [{ courseId: { in: courseIds } }] : []),
              ...(packageIds.length ? [{ packageId: { in: packageIds } }] : []),
            ],
          },
          select: { courseId: true, packageId: true },
        })
      : Promise.resolve([]),
    liveIds.length
      ? prisma.liveCourseSubscription.findMany({
          // Payment lives on ws_live_course_order and a subscription row exists only
          // for a paid order, so `status` is the gate.
          where: { customerId, status: true, endAt: { gt: now }, liveCourseId: { in: liveIds } },
          select: { liveCourseId: true },
        })
      : Promise.resolve([]),
  ]);

  const ownedCourses = new Set(pcSubs.map((s) => s.courseId).filter((x): x is number => x != null));
  const ownedPackages = new Set(pcSubs.map((s) => s.packageId).filter((x): x is number => x != null));
  const ownedLives = new Set(liveSubs.map((s) => s.liveCourseId));

  for (const s of scopes) {
    const idn = Number(s.id);
    if (s.kind === "course" && ownedCourses.has(idn)) return s;
    if (s.kind === "package" && ownedPackages.has(idn)) return s;
    if (s.kind === "liveCourse" && ownedLives.has(idn)) return s;
  }
  return null;
};

/**
 * Uses the same gates as lecture-detail (client-lecture.hasActive*Sub) and the
 * progress heartbeat so all package/course-scoped video endpoints agree. Only
 * paid rows reach here. False for a missing user, unknown scope, or no active sub.
 */
export const isEntitledForScope = async (
  customerId: number | null,
  scope: { kind: string; id: string } | null,
): Promise<boolean> => {
  if (customerId == null || !scope) return false;
  const id = Number(scope.id);
  if (!Number.isInteger(id) || id <= 0) return false;
  const now = new Date();

  if (scope.kind === "course") {
    const sub = await prisma.packageCourseSubscription.findFirst({
      where: { customerId, courseId: id, status: true, endAt: { gt: now } }, select: { id: true },
    });
    return sub !== null;
  }
  if (scope.kind === "package") {
    const sub = await prisma.packageCourseSubscription.findFirst({
      where: { customerId, packageId: id, status: true, endAt: { gt: now } }, select: { id: true },
    });
    return sub !== null;
  }
  if (scope.kind === "liveCourse") {
    const sub = await prisma.liveCourseSubscription.findFirst({
      where: { customerId, liveCourseId: id, status: true, endAt: { gt: now } }, select: { id: true },
    });
    return sub !== null;
  }
  return false;
};
