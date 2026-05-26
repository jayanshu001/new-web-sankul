import { Request, Response } from "express";
import mongoose from "mongoose";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { hasAccessToAnyLiveCourse, buildPurchaseOptions, getDaysLeftForLiveCourses, getDaysLeftMapForLiveCourses } from "./entitlement";
import { computeDaysLeft } from "../../utils/planDuration";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import cache from "../../libs/cache";
import { generateToken, generateKey, generateVector, encrypt } from "../../utils/videoEncryption";
import { resolveVideoSource } from "../../utils/videoResolver";
import logger from "../../utils/logger";
import { buildShareUrl } from "../../deeplinking/shareRedirect";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// Streamos historically delivered some recording paths with stray quote
// characters (raw `"`, URL-encoded `%22`, or `%2522`) tacked onto the end of
// the URL — an upstream JSON-quoting bug. We strip those defensively so the
// client never sees an unplayable URL.
function sanitizeRecordingPath<T extends string | null | undefined>(p: T): T {
  if (typeof p !== "string") return p;
  return p.replace(/(?:"|%22|%2522)+$/i, "") as T;
}

// Builds the multi-resolution playback envelope a lecture detail endpoint
// returns. The shape mirrors the legacy "encryptLecture" contract:
//   { files: {
//       hls:         { default_cdn, cdns: { primary: { url } } },
//       progressive: [{ qualityLabel, quality, height, url }],
//       token,
//     } }
// Every URL is AES-encrypted using the same {token, ciphertext} pattern as
// /v1/lecture, so the FE decryption helper is unchanged.
async function encryptLecture(v: {
  platform: string;
  youtube_id?: string | null;
  aws_id?: string | null;
  vimeo_id?: string | null;
}) {
  const resolved = await resolveVideoSource(v);
  const token = generateToken(16);
  const key = generateKey(token);
  const vector = generateVector(token);

  const encryptedProgressive = resolved.progressive.map((p) => ({
    qualityLabel: p.qualityLabel,
    quality: p.quality,
    height: p.height,
    bitrate: p.bitrate,
    hasAudio: p.hasAudio,
    hasVideo: p.hasVideo,
    url: encrypt(p.url, key, vector),
  }));

  // hlsUrl can be null (e.g. YouTube path has no real master playlist) — the
  // FE picks the first progressive entry in that case. Keep the structure
  // present either way so the FE doesn't branch on its existence.
  const encryptedHls = resolved.hlsUrl ? encrypt(resolved.hlsUrl, key, vector) : "";

  // Wrapped under `request.files` per the FE contract (mapLessonItem reads
  // request.files.progressive / request.files.token). The extra nesting is
  // load-bearing — don't flatten it.
  return {
    request: {
      files: {
        token,
        hls: {
          default_cdn: "primary",
          cdns: {
            primary: {
              url: encryptedHls,
              allow720: resolved.allow720,
            },
          },
        },
        progressive: encryptedProgressive,
      },
    },
  };
}

// Verified-subscription counts per live course. Cached for 5min — it powers
// a popularity ranking, not entitlement, so slight staleness is fine.
const getPurchaseCountMap = async (courseIds: mongoose.Types.ObjectId[]): Promise<Map<string, number>> => {
  if (courseIds.length === 0) return new Map();
  return cache.aside({
    key: cache.key("client", "live-course", `purchase-counts:${cache.hashFilter({ ids: courseIds.map(String).sort() })}`),
    ttlSeconds: 300,
    load: async () => {
      const rows = await LiveCourseSubscription.aggregate([
        { $match: { liveCourseId: { $in: courseIds }, paymentStatus: "verified" } },
        { $group: { _id: "$liveCourseId", count: { $sum: 1 } } },
      ]);
      return rows.map((r: any) => [String(r._id), r.count] as [string, number]);
    },
  }).then((entries) => new Map(entries));
};

// Customer's currently-active live-course subscription set. Used to stamp
// `isPurchased` on listing/detail rows. Returns an empty set for guests.
const getOwnedLiveCourseIds = async (customerId: string | undefined): Promise<Set<string>> => {
  if (!customerId) return new Set();
  const now = new Date();
  const subs = await LiveCourseSubscription.find({
    customerId,
    paymentStatus: "verified",
    status: true,
    $or: [{ endAt: null }, { endAt: { $gte: now } }],
  })
    .select("liveCourseId")
    .lean();
  return new Set(subs.map((s) => String(s.liveCourseId)));
};

// GET /api/v1/client/live-courses
export const listLiveCoursesForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveCoursesForClient invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const query: Record<string, any> = { status: true };
    if (search) query.name = { $regex: search, $options: "i" };

    const [rows, total] = await Promise.all([
      LiveCourse.find(query)
        .sort({ ordered: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("courseEducatorId", "name image")
        .populate("packageCategoryId", "title slug image")
        .lean(),
      LiveCourse.countDocuments(query),
    ]);

    const rowIds = rows.map((r: any) => r._id);
    const [daysLeftMap, purchaseCountMap, ownedIds] = await Promise.all([
      getDaysLeftMapForLiveCourses(req.user?.id, rowIds),
      getPurchaseCountMap(rowIds),
      getOwnedLiveCourseIds(req.user?.id),
    ]);

    // Both hero cards require startTime > now. Among upcoming batches, the
    // top-purchased course gets "featured" (red), the second-highest gets
    // "coming_soon" (blue). Courses with no future startTime never appear as
    // a hero card.
    const now = Date.now();
    const upcoming = (rows as any[])
      .filter((r) => r.startTime && new Date(r.startTime).getTime() > now)
      .map((r) => ({ id: String(r._id), score: purchaseCountMap.get(String(r._id)) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const featuredId: string | null = upcoming[0]?.id ?? null;
    const comingSoonId: string | null = upcoming[1]?.id ?? null;

    const base = resolveBase(req);
    const liveCourses = rows.map((r: any) => {
      const key = String(r._id);
      let cardVariant: "featured" | "coming_soon" | null = null;
      if (key === featuredId) cardVariant = "featured";
      else if (key === comingSoonId) cardVariant = "coming_soon";
      return {
        ...r,
        daysLeft: daysLeftMap.has(key) ? daysLeftMap.get(key) ?? null : null,
        isPurchased: ownedIds.has(key),
        purchaseCount: purchaseCountMap.get(key) ?? 0,
        cardVariant,
        shareableLink: buildShareUrl("live-courses", key, base),
      };
    });

    logger.info("listLiveCoursesForClient success", { traceId, total, returned: rows.length });
    return success(res, { liveCourses, total, page, limit }, "Live courses fetched.");
  } catch (err) {
    logger.error("listLiveCoursesForClient failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list live courses.", 500);
  }
};

// GET /api/v1/client/live-courses/:id
// Includes plans + whether the current customer already has access.
export const getLiveCourseForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? "");
  logger.info("getLiveCourseForClient invoked", { traceId, path: req.originalUrl, userId, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getLiveCourseForClient invalid id", { traceId, id });
      return failure(res, "Invalid live course id.", 422);
    }

    const [course, plans] = await Promise.all([
      LiveCourse.findOne({ _id: id, status: true })
        .populate("courseEducatorId", "name image about")
        .populate("packageCategoryId", "title slug image")
        .lean(),
      LiveCoursePlan.find({ liveCourseId: id, status: true })
        .sort({ price: 1 })
        .lean(),
    ]);
    if (!course) {
      logger.warn("getLiveCourseForClient not found", { traceId, id });
      return failure(res, "Live course not found.", 404);
    }

    const [subscribed, subjectsCount, daysLeft] = await Promise.all([
      hasAccessToAnyLiveCourse(req.user?.id, [id]),
      // "Subjects" on the header stat bar = folders under this live course.
      VideoCategory.countDocuments({ liveCourseId: id }),
      getDaysLeftForLiveCourses(req.user?.id, [id]),
    ]);

    // Header stat bar.
    const stats = {
      subjectsCount,
      materialsCount: course.materialCategories?.length ?? 0,
      classType: course.classType ?? "live",
    };

    // Plans enriched with the strikethrough-price math the UI needs.
    const plansOut = plans.map((p) => {
      const original =
        typeof p.originalPrice === "number" && p.originalPrice > p.price
          ? p.originalPrice
          : null;
      const discountPercent = original
        ? Math.round(((original - p.price) / original) * 100)
        : 0;
      return { ...p, originalPrice: original, discountPercent };
    });

    logger.info("getLiveCourseForClient success", { traceId, userId, id, subscribed });
    const shareableLink = buildShareUrl("live-courses", id, resolveBase(req));
    return success(
      res,
      { liveCourse: { ...course, shareableLink }, stats, plans: plansOut, subscribed, isPurchased: subscribed, daysLeft, shareableLink },
      "Live course fetched."
    );
  } catch (err) {
    logger.error("getLiveCourseForClient failed", { traceId, userId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live course.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/sessions
// Filter: upcoming=true → SCHEDULED + scheduledAt >= now.
// Ordering:
//   - upcoming=true → ascending scheduledAt (nearest-to-start at top).
//   - otherwise    → future sessions first (nearest at top), then past sessions
//     most-recent first. Sessions with no scheduledAt sink to the bottom.
export const listSessionsForCourseClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listSessionsForCourseClient invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listSessionsForCourseClient invalid id", { traceId, id });
      return failure(res, "Invalid live course id.", 422);
    }

    const exists = await LiveCourse.exists({ _id: id, status: true });
    if (!exists) {
      logger.warn("listSessionsForCourseClient course not found", { traceId, id });
      return failure(res, "Live course not found.", 404);
    }

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const upcoming = req.query.upcoming === "true";
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    const query: Record<string, any> = { liveCourseIds: id };
    if (status) query.status = status;
    if (upcoming) {
      query.status = "SCHEDULED";
      query.scheduledAt = { $gte: new Date() };
    }

    const now = new Date();
    // 0 = upcoming (still in the future), 1 = past, 2 = unscheduled (null).
    // Within each bucket we sort by proximity to "now" so the next-to-start
    // session is on top and the most-recent past session leads the past group.
    const sortStage = upcoming
      ? { scheduledAt: 1 as 1, createdAt: -1 as -1 }
      : { _bucket: 1 as 1, _proximity: 1 as 1, createdAt: -1 as -1 };

    const pipeline: any[] = [{ $match: query }];
    if (!upcoming) {
      pipeline.push({
        $addFields: {
          _bucket: {
            $switch: {
              branches: [
                { case: { $eq: ["$scheduledAt", null] }, then: 2 },
                { case: { $gte: ["$scheduledAt", now] }, then: 0 },
              ],
              default: 1,
            },
          },
          _proximity: {
            $cond: [
              { $eq: ["$scheduledAt", null] },
              Number.MAX_SAFE_INTEGER,
              { $abs: { $subtract: ["$scheduledAt", now] } },
            ],
          },
        },
      });
    }
    pipeline.push({ $sort: sortStage });
    pipeline.push({ $skip: (page - 1) * limit });
    pipeline.push({ $limit: limit });
    pipeline.push({
      $project: {
        title: 1, status: 1, scheduledAt: 1, streamId: 1,
        recordings: 1, liveCourseIds: 1, createdAt: 1, updatedAt: 1,
      },
    });

    const [rows, total] = await Promise.all([
      LiveSession.aggregate(pipeline),
      LiveSession.countDocuments(query),
    ]);

    // The list is metadata only — playback URLs (hlsUrl/recordings) are never
    // returned here. They come from GET /client/live-sessions/:id, which
    // applies the per-viewer preview / subscription gate. We expose just a
    // `hasRecordings` flag so the UI can show a "watch recording" affordance.
    const sessions = rows.map((s) => ({
      _id: s._id,
      title: s.title,
      status: s.status,
      scheduledAt: s.scheduledAt ?? null,
      streamId: s.streamId ?? null,
      liveCourseIds: s.liveCourseIds ?? [],
      hasRecordings: Array.isArray(s.recordings) && s.recordings.length > 0,
      // The session is joinable (the live room exists on Streamos) only while
      // status is CREATED. The client should enable the "Join" button on this
      // and disable it otherwise (SCHEDULED = not started, ENDED/READY = over).
      canJoin: s.status === "CREATED",
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    logger.info("listSessionsForCourseClient success", { traceId, id, total, returned: sessions.length });
    return success(res, { sessions, total, page, limit }, "Sessions fetched.");
  } catch (err) {
    logger.error("listSessionsForCourseClient failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list sessions.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/recordings
// All recorded lectures for a live course, grouped by folder. These are the
// Videos promoted from past LiveSession recordings (plus any manually added
// videos). The folder/lecture STRUCTURE is always returned so the UI can show
// what the course contains, but a lecture's playable `videoUrl` is only
// included when the customer is entitled (active subscription) or the lecture
// is explicitly free. Non-subscribers also get `purchaseOptions` for the popup.
export const listLiveCourseRecordings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listLiveCourseRecordings invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listLiveCourseRecordings invalid id", { traceId, id });
      return failure(res, "Invalid live course id.", 422);
    }

    const course = await LiveCourse.findOne({ _id: id, status: true })
      .select("_id name image")
      .lean();
    if (!course) {
      logger.warn("listLiveCourseRecordings course not found", { traceId, id });
      return failure(res, "Live course not found.", 404);
    }

    const folders = await VideoCategory.find({ liveCourseId: id, status: true })
      .sort({ order_by: 1, createdAt: 1 })
      .select("_id title image order_by")
      .lean();

    const folderIds = folders.map((f) => f._id);
    const videos = folderIds.length
      ? await Video.find({ videoCategoryId: { $in: folderIds }, status: true })
          .sort({ order: 1, createdAt: 1 })
          .lean()
      : [];

    const [subscribed, daysLeft] = await Promise.all([
      hasAccessToAnyLiveCourse(req.user?.id, [id]),
      getDaysLeftForLiveCourses(req.user?.id, [id]),
    ]);

    const videosByFolder = new Map<string, typeof videos>();
    for (const v of videos) {
      const key = String(v.videoCategoryId);
      if (!videosByFolder.has(key)) videosByFolder.set(key, []);
      videosByFolder.get(key)!.push(v);
    }

    // Per-video resume state — drives the red progress sliver / completed
    // checkmark on each lecture row. Null when the user has never started
    // that video (or isn't logged in).
    const userId = req.user?.id;
    let progressByVideo = new Map<string, any>();
    if (userId && videos.length) {
      const progressRows = await LectureProgress.find({
        customerId: new mongoose.Types.ObjectId(userId),
        videoId: { $in: videos.map((v: any) => v._id) },
      })
        .select("videoId positionSec durationSec completed completedAt lastWatchedAt")
        .lean();
      progressByVideo = new Map(progressRows.map((r: any) => [String(r.videoId), r]));
    }

    // Multi-quality recordings live on the source LiveSession (Streamos
    // returns 5 tiers per stream). Each Video derived from a live recording
    // carries a `liveSessionId` back-link; batch-fetch the sessions and surface
    // the full per-quality array on the lecture row so the FE can offer a
    // resolution switcher. Manually-uploaded Videos (no liveSessionId) get an
    // empty array and continue to play via `aws_id` alone.
    const liveSessionIds = videos
      .map((v: any) => v.liveSessionId)
      .filter((id: any): id is mongoose.Types.ObjectId => !!id);
    let recordingsBySession = new Map<string, Array<{ quality: string | null; file_size: number | null; path: string }>>();
    if (liveSessionIds.length) {
      const sessions = await LiveSession.find({ _id: { $in: liveSessionIds } })
        .select("_id recordings")
        .lean();
      for (const s of sessions as any[]) {
        const shaped = (s.recordings ?? [])
          .filter((r: any) => typeof r?.path === "string" && r.path.length > 0)
          .map((r: any) => ({
            quality: typeof r.quality === "string" ? r.quality : null,
            file_size: typeof r.file_size === "number" ? r.file_size : null,
            path: sanitizeRecordingPath(r.path),
          }));
        recordingsBySession.set(String(s._id), shaped);
      }
    }

    const shapeLecture = (v: (typeof videos)[number]) => {
      const canPlay = subscribed || v.priceType === "free";
      const p = progressByVideo.get(String(v._id));
      const recordings = v.liveSessionId
        ? recordingsBySession.get(String(v.liveSessionId)) ?? []
        : [];
      return {
        _id: String(v._id),
        title: v.title ?? "",
        topic: v.topic ?? "",
        platform: v.platform,
        priceType: v.priceType,
        order: v.order,
        locked: !canPlay,
        // Raw platform identifiers are returned for UI purposes (thumbnails,
        // labels). They're NOT directly playable — the FE must call
        // GET /lecture/:videoId on tap to get the resolved+encrypted envelope.
        youtube_id: v.youtube_id ?? null,
        aws_id: sanitizeRecordingPath(v.aws_id ?? null),
        vimeo_id: v.vimeo_id ?? null,
        // Per-quality MP4 list from the source LiveSession. Empty for
        // manually-uploaded videos (no associated live session).
        recordings,
        progress: p
          ? {
              positionSec: p.positionSec ?? 0,
              durationSec: p.durationSec ?? 0,
              completed: !!p.completed,
              completedAt: p.completedAt ?? null,
              lastWatchedAt: p.lastWatchedAt ?? null,
            }
          : null,
      };
    };

    const folderPayload = folders.map((f) => ({
      folderId: String(f._id),
      title: f.title,
      image: f.image,
      order: f.order_by,
      lectures: (videosByFolder.get(String(f._id)) ?? []).map(shapeLecture),
    }));

    logger.info("listLiveCourseRecordings success", { traceId, id, subscribed, totalLectures: videos.length, folderCount: folderPayload.length });
    return success(
      res,
      {
        liveCourse: { _id: String(course._id), name: course.name, image: course.image },
        subscribed,
        daysLeft,
        totalLectures: videos.length,
        folders: folderPayload,
        purchaseOptions: subscribed ? [] : await buildPurchaseOptions([id]),
      },
      "Recorded lectures fetched."
    );
  } catch (err) {
    logger.error("listLiveCourseRecordings failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list recorded lectures.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/lecture/:videoId
// Gated single-lecture playback for a live course's recorded video. Mirrors
// the recorded-course GET /courses/lecture flow: verifies the video sits in a
// folder of this course, then requires an active subscription unless the
// lecture is free. On 403 the purchase popup data rides along in `data`.
export const getLiveCourseLecture = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("getLiveCourseLecture invoked", { traceId, path: req.originalUrl, userId, id, videoId });

  try {
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(videoId)) {
      logger.warn("getLiveCourseLecture invalid ids", { traceId, id, videoId });
      return failure(res, "Invalid live course or video id.", 422);
    }

    const video = await Video.findById(videoId).lean();
    if (!video || !video.status) { logger.warn("getLiveCourseLecture video not found", { traceId, userId, videoId }); return failure(res, "Lecture not found.", 404); }

    // The video must belong to a folder owned by THIS live course.
    const folder = await VideoCategory.findOne({
      _id: video.videoCategoryId,
      liveCourseId: id,
    })
      .select("_id")
      .lean();
    if (!folder) { logger.warn("getLiveCourseLecture course mismatch", { traceId, userId, id, videoId }); return failure(res, "Lecture does not belong to this live course.", 404); }

    if (video.priceType !== "free") {
      const subscribed = await hasAccessToAnyLiveCourse(req.user?.id, [id]);
      if (!subscribed) {
        logger.warn("getLiveCourseLecture not subscribed", { traceId, userId, id, videoId });
        return failure(
          res,
          "Subscribe to this live course to watch this lecture.",
          403,
          {},
          { purchaseOptions: await buildPurchaseOptions([id]) }
        );
      }
    }

    // Reached here only when entitled (or the lecture is free). Resolve via
    // the per-platform transcoder (ytdl-core for youtube, VideoCrypt for aws)
    // and ship the AES-encrypted multi-resolution envelope. The resolver caches
    // upstream responses in Redis so repeat hits don't re-pay the round-trip.
    let envelope;
    try {
      envelope = await encryptLecture(video);
    } catch (err) {
      logger.error("getLiveCourseLecture resolve/encrypt failed", {
        traceId,
        videoId: String(video._id),
        platform: video.platform,
        error: getErrorMessage(err),
      });
      return failure(res, "Failed to resolve playable URLs for this lecture.", 502);
    }

    logger.info("getLiveCourseLecture success", { traceId, userId, id, videoId, platform: video.platform });
    return success(
      res,
      {
        _id: String(video._id),
        title: video.title ?? "",
        topic: video.topic ?? "",
        platform: video.platform,
        priceType: video.priceType,
        ...envelope,
      },
      "Lecture fetched."
    );
  } catch (err) {
    logger.error("getLiveCourseLecture failed", { traceId, userId, id, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch lecture.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/session-recordings
// Live / upcoming classes for a course — every SCHEDULED or CREATED
// LiveSession. Finished classes (ENDED/READY) are intentionally excluded:
// once a session ends and its recording is promoted into a folder Video, it
// surfaces through GET /:id/recordings instead.
//
// Metadata only — playback URLs (hlsUrl / mp4) come from the gated
// GET /api/v1/client/live-sessions/:sessionId endpoint on tap.
export const listLiveCourseSessionRecordings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listLiveCourseSessionRecordings invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("listLiveCourseSessionRecordings invalid id", { traceId, id });
      return failure(res, "Invalid live course id.", 422);
    }

    const course = await LiveCourse.findOne({ _id: id, status: true })
      .select("_id name image")
      .lean();
    if (!course) {
      logger.warn("listLiveCourseSessionRecordings course not found", { traceId, id });
      return failure(res, "Live course not found.", 404);
    }

    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    // Upcoming + currently-live only. CREATED = stream provisioned (live or
    // ready to go), SCHEDULED = on the timetable but stream not yet started.
    const query = {
      liveCourseIds: id,
      status: { $in: ["SCHEDULED", "CREATED"] },
    };

    const [sessions, total] = await Promise.all([
      LiveSession.find(query)
        // Ascending — soonest first, ongoing live classes float to the top.
        .sort({ scheduledAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title status scheduledAt endAt subject streamId hlsUrl createdAt updatedAt")
        .lean(),
      LiveSession.countDocuments(query),
    ]);

    const subscribed = await hasAccessToAnyLiveCourse(req.user?.id, [id]);

    const lectures = sessions.map((s) => ({
      sessionId: String(s._id),
      title: s.title,
      // CREATED with an hlsUrl means the stream is live right now; the FE can
      // also infer this from streamId being present.
      status: s.status,
      isLive: s.status === "CREATED" && !!s.hlsUrl,
      subject: s.subject ?? null,
      streamId: s.streamId ?? null,
      scheduledAt: s.scheduledAt ?? null,
      endAt: s.endAt ?? null,
      locked: !subscribed,
    }));

    logger.info("listLiveCourseSessionRecordings success", { traceId, id, subscribed, total, returned: lectures.length });
    return success(
      res,
      {
        liveCourse: { _id: String(course._id), name: course.name, image: course.image },
        subscribed,
        total,
        page,
        limit,
        lectures,
        purchaseOptions: subscribed ? [] : await buildPurchaseOptions([id]),
      },
      "Live classes fetched."
    );
  } catch (err) {
    logger.error("listLiveCourseSessionRecordings failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list live classes.", 500);
  }
};

// GET /api/v1/client/live-courses/my
// The customer's own live course subscriptions. ?status=active|expired|all
// (default all). Only verified subscriptions are returned — pending/failed
// payment attempts are an internal concern, not "my courses".
export const listMyLiveCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyLiveCourses invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyLiveCourses unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const filterStatus =
      typeof req.query.status === "string" ? req.query.status : "all";
    const now = new Date();

    const query: Record<string, any> = { customerId, paymentStatus: "verified" };
    if (filterStatus === "active") {
      query.status = true;
      query.$or = [{ endAt: null }, { endAt: { $gte: now } }];
    } else if (filterStatus === "expired") {
      // Verified but no longer usable: switched off, or past its endAt.
      query.$or = [{ status: false }, { endAt: { $lt: now } }];
    }

    const subs = await LiveCourseSubscription.find(query)
      .sort({ createdAt: -1 })
      .populate("liveCourseId", "name image level isPaid status")
      .populate("planId", "name duration price")
      .lean();

    const base = resolveBase(req);
    const liveCourses = subs.map((s) => {
      const active =
        s.status === true &&
        (s.endAt == null || new Date(s.endAt).getTime() >= now.getTime());
      const lc: any = s.liveCourseId ?? null;
      const lcWithShare = lc
        ? { ...lc, shareableLink: buildShareUrl("live-courses", String(lc._id), base) }
        : null;
      return {
        subscriptionId: String(s._id),
        liveCourse: lcWithShare,
        plan: s.planId ?? null,
        startAt: s.startAt ?? null,
        endAt: s.endAt ?? null,
        paymentStatus: s.paymentStatus,
        active,
        daysLeft: active ? computeDaysLeft(s.endAt ?? null, now) : 0,
      };
    });

    logger.info("listMyLiveCourses success", { traceId, customerId, count: liveCourses.length });
    return success(
      res,
      { liveCourses, total: liveCourses.length },
      "Your live courses fetched."
    );
  } catch (err) {
    logger.error("listMyLiveCourses failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your live courses.", 500);
  }
};

// GET /api/v1/client/live-courses/my/upcoming-sessions
// Upcoming SCHEDULED sessions across every live course the customer is
// actively entitled to (verified subscription, status on, endAt not yet
// crossed). One call returns the user's whole forward-looking timetable, in
// ascending scheduledAt order, with the source course attached so the UI can
// group or label by course.
export const listMyUpcomingSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyUpcomingSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyUpcomingSessions unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const now = new Date();

    // Only currently-active subscriptions feed the "my upcoming" view —
    // expired ones shouldn't surface their courses' future sessions.
    const subs = await LiveCourseSubscription.find({
      customerId,
      paymentStatus: "verified",
      status: true,
      $or: [{ endAt: null }, { endAt: { $gte: now } }],
    })
      .select("liveCourseId")
      .lean();

    if (subs.length === 0) {
      return success(
        res,
        { sessions: [], total: 0, page, limit },
        "Your upcoming sessions fetched."
      );
    }

    const courseIds = subs.map((s) => s.liveCourseId);

    const query = {
      liveCourseIds: { $in: courseIds },
      status: "SCHEDULED",
      scheduledAt: { $ne: null, $gte: now },
    };

    const [rows, total] = await Promise.all([
      LiveSession.find(query)
        .sort({ scheduledAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title subject educatorId scheduledAt endAt status streamId liveCourseIds")
        .populate("educatorId", "name image")
        .populate("liveCourseIds", "name image")
        .lean(),
      LiveSession.countDocuments(query),
    ]);

    const sessions = rows.map((s: any) => ({
      sessionId: String(s._id),
      title: s.title,
      subject: s.subject || s.title,
      educator: s.educatorId ?? null,
      // A session can belong to multiple courses; surface them all so the UI
      // can show "Course A / Course B" when overlapping.
      liveCourses: Array.isArray(s.liveCourseIds) ? s.liveCourseIds : [],
      scheduledAt: s.scheduledAt ?? null,
      endAt: s.endAt ?? null,
      status: s.status,
      streamId: s.streamId ?? null,
      canJoin: s.status === "CREATED",
    }));

    logger.info("listMyUpcomingSessions success", { traceId, customerId, total, returned: sessions.length });
    return success(
      res,
      { sessions, total, page, limit },
      "Your upcoming sessions fetched."
    );
  } catch (err) {
    logger.error("listMyUpcomingSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your upcoming sessions.", 500);
  }
};

// GET /api/v1/client/live-courses/upcoming-sessions
// Discovery feed: every upcoming SCHEDULED session across every active live
// course on the platform — visible to non-purchasers too, so a student can
// browse what's coming up before they buy. Each row carries `subscribed`
// (true when the customer holds access to at least one of the session's
// courses). Clicking a session opens GET /client/live-sessions/:id, which
// already enforces the 3-minute preview gate and serves the purchase popup
// once the free window is consumed.
export const listAllUpcomingSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listAllUpcomingSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const now = new Date();

    // Only sessions whose source courses are still active should surface in the
    // discovery feed — a disabled course shouldn't advertise classes.
    const activeCourseIds = await LiveCourse.find({ status: true })
      .select("_id")
      .lean();
    if (activeCourseIds.length === 0) {
      return success(
        res,
        { sessions: [], total: 0, page, limit },
        "Upcoming sessions fetched."
      );
    }
    const courseIdList = activeCourseIds.map((c) => c._id);

    const query = {
      liveCourseIds: { $in: courseIdList },
      status: "SCHEDULED",
      scheduledAt: { $ne: null, $gte: now },
    };

    // Pull the customer's currently-active subscriptions in parallel so we can
    // stamp each session row with `subscribed`. Anonymous viewers (no token /
    // no subscriptions) just get `subscribed: false` everywhere.
    const [rows, total, subs] = await Promise.all([
      LiveSession.find(query)
        .sort({ scheduledAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title subject educatorId scheduledAt endAt status streamId liveCourseIds")
        .populate("educatorId", "name image")
        .populate("liveCourseIds", "name image")
        .lean(),
      LiveSession.countDocuments(query),
      customerId
        ? LiveCourseSubscription.find({
            customerId,
            paymentStatus: "verified",
            status: true,
            $or: [{ endAt: null }, { endAt: { $gte: now } }],
          })
            .select("liveCourseId")
            .lean()
        : Promise.resolve([] as Array<{ liveCourseId: mongoose.Types.ObjectId }>),
    ]);

    const ownedCourseIds = new Set(subs.map((s) => String(s.liveCourseId)));

    const sessions = rows.map((s: any) => {
      const courseList = Array.isArray(s.liveCourseIds) ? s.liveCourseIds : [];
      // Subscribed to ANY of the session's courses is enough — multi-course
      // sessions unlock as soon as the student owns one of them (same rule
      // as `hasAccessToAnyLiveCourse`).
      const subscribed = courseList.some(
        (c: any) => c && ownedCourseIds.has(String(c._id ?? c))
      );
      return {
        sessionId: String(s._id),
        title: s.title,
        subject: s.subject || s.title,
        educator: s.educatorId ?? null,
        liveCourses: courseList,
        scheduledAt: s.scheduledAt ?? null,
        endAt: s.endAt ?? null,
        status: s.status,
        streamId: s.streamId ?? null,
        canJoin: s.status === "CREATED",
        // UI uses this to label the row: paid users see "Join", others see
        // "Preview 3 min / Buy". The actual gate runs on
        // GET /api/v1/client/live-sessions/:id.
        subscribed,
      };
    });

    logger.info("listAllUpcomingSessions success", { traceId, customerId, total, returned: sessions.length });
    return success(
      res,
      { sessions, total, page, limit },
      "Upcoming sessions fetched."
    );
  } catch (err) {
    logger.error("listAllUpcomingSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch upcoming sessions.", 500);
  }
};

// GET /api/v1/client/live-courses/live-now-sessions
// Discovery feed for what's airing RIGHT NOW: every session in status
// CREATED across every active live course on the platform. Same shape as
// /upcoming-sessions — each row carries `subscribed` so the UI can route a
// non-purchaser into the 3-minute preview (via /client/live-sessions/:id).
// SCHEDULED-but-not-yet-started sessions belong to /upcoming-sessions;
// ENDED/READY ones belong to the per-course recordings list.
export const listLiveNowSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listLiveNowSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const now = new Date();

    const activeCourseIds = await LiveCourse.find({ status: true })
      .select("_id")
      .lean();
    if (activeCourseIds.length === 0) {
      return success(
        res,
        { sessions: [], total: 0, page, limit },
        "Live-now sessions fetched."
      );
    }
    const courseIdList = activeCourseIds.map((c) => c._id);

    const query = {
      liveCourseIds: { $in: courseIdList },
      status: "CREATED",
    };

    const [rows, total, subs] = await Promise.all([
      LiveSession.find(query)
        // Earliest-started first: a class that's been live longer floats up
        // before one that just kicked off.
        .sort({ scheduledAt: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title subject educatorId scheduledAt endAt status streamId liveCourseIds")
        .populate("educatorId", "name image")
        .populate("liveCourseIds", "name image")
        .lean(),
      LiveSession.countDocuments(query),
      customerId
        ? LiveCourseSubscription.find({
            customerId,
            paymentStatus: "verified",
            status: true,
            $or: [{ endAt: null }, { endAt: { $gte: now } }],
          })
            .select("liveCourseId")
            .lean()
        : Promise.resolve([] as Array<{ liveCourseId: mongoose.Types.ObjectId }>),
    ]);

    const ownedCourseIds = new Set(subs.map((s) => String(s.liveCourseId)));

    const sessions = rows.map((s: any) => {
      const courseList = Array.isArray(s.liveCourseIds) ? s.liveCourseIds : [];
      const subscribed = courseList.some(
        (c: any) => c && ownedCourseIds.has(String(c._id ?? c))
      );
      return {
        sessionId: String(s._id),
        title: s.title,
        subject: s.subject || s.title,
        educator: s.educatorId ?? null,
        liveCourses: courseList,
        scheduledAt: s.scheduledAt ?? null,
        endAt: s.endAt ?? null,
        status: s.status,
        streamId: s.streamId ?? null,
        // status === CREATED guarantees this is true; keeping the flag for
        // shape parity with /upcoming-sessions.
        canJoin: true,
        subscribed,
      };
    });

    logger.info("listLiveNowSessions success", { traceId, customerId, total, returned: sessions.length });
    return success(
      res,
      { sessions, total, page, limit },
      "Live-now sessions fetched."
    );
  } catch (err) {
    logger.error("listLiveNowSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live-now sessions.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/schedule
// The Schedule tab: a study timetable derived from the course's scheduled
// LiveSessions (subject / educator / date / time slot), plus the course's
// uploaded "Time Table" files. Not entitlement-gated — it's course info shown
// to everyone so they can see what the course covers. ?upcoming=true limits
// to classes from now onward.
export const getLiveCourseSchedule = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("getLiveCourseSchedule invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getLiveCourseSchedule invalid id", { traceId, id });
      return failure(res, "Invalid live course id.", 422);
    }

    const course = await LiveCourse.findOne({ _id: id, status: true })
      .select("_id name scheduleFolders")
      .lean();
    if (!course) {
      logger.warn("getLiveCourseSchedule course not found", { traceId, id });
      return failure(res, "Live course not found.", 404);
    }

    // Only sessions that carry a scheduledAt belong on a timetable.
    const upcoming = req.query.upcoming === "true";
    const query: Record<string, any> = { liveCourseIds: id, scheduledAt: { $ne: null } };
    if (upcoming) {
      query.scheduledAt = { $ne: null, $gte: new Date() };
    }

    // upcoming=true → ascending scheduledAt puts the next-to-start class on top.
    // Otherwise → future classes first (nearest at top), then past classes
    // most-recent-first, so the timetable always opens on "what's next".
    const now = new Date();
    let sessions;
    if (upcoming) {
      sessions = await LiveSession.find(query)
        .sort({ scheduledAt: 1 })
        .select("title subject educatorId scheduledAt endAt status streamId")
        .populate("educatorId", "name image")
        .lean();
    } else {
      sessions = await LiveSession.aggregate([
        { $match: query },
        {
          $addFields: {
            _bucket: { $cond: [{ $gte: ["$scheduledAt", now] }, 0, 1] },
            _proximity: { $abs: { $subtract: ["$scheduledAt", now] } },
          },
        },
        { $sort: { _bucket: 1, _proximity: 1 } },
        {
          $project: {
            title: 1, subject: 1, educatorId: 1,
            scheduledAt: 1, endAt: 1, status: 1, streamId: 1,
          },
        },
        {
          $lookup: {
            from: "ws_course_educators",
            localField: "educatorId",
            foreignField: "_id",
            as: "educatorId",
            pipeline: [{ $project: { name: 1, image: 1 } }],
          },
        },
        { $addFields: { educatorId: { $ifNull: [{ $arrayElemAt: ["$educatorId", 0] }, null] } } },
      ]);
    }

    const timetable = sessions.map((s) => ({
      sessionId: String(s._id),
      // `subject` falls back to the session title when not separately set.
      subject: s.subject || s.title,
      title: s.title,
      educator: s.educatorId ?? null, // populated { _id, name, image } or null
      date: s.scheduledAt ?? null,
      startAt: s.scheduledAt ?? null,
      endAt: s.endAt ?? null,
      status: s.status,
      streamId: s.streamId ?? null,
    }));

    const scheduleFolders = ((course as any).scheduleFolders ?? [])
      .slice()
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
      .map((f: any) => ({
        _id: f._id,
        title: f.title,
        image: f.image ?? null,
        order: f.order ?? 0,
        status: f.status !== false,
        entries: (f.entries ?? [])
          .slice()
          .sort(
            (a: any, b: any) =>
              ((a.order ?? 0) - (b.order ?? 0)) ||
              (new Date(a.date).getTime() - new Date(b.date).getTime())
          ),
      }))
      // Clients only see active folders.
      .filter((f: any) => f.status);

    const daysLeft = await getDaysLeftForLiveCourses(req.user?.id, [id]);

    logger.info("getLiveCourseSchedule success", { traceId, id, timetableCount: timetable.length, folderCount: scheduleFolders.length });
    return success(
      res,
      {
        liveCourse: { _id: String(course._id), name: course.name },
        timetable,
        scheduleFolders,
        total: timetable.length,
        daysLeft,
      },
      "Schedule fetched."
    );
  } catch (err) {
    logger.error("getLiveCourseSchedule failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch schedule.", 500);
  }
};

// GET /api/v1/client/live-courses/my/schedule
// Powers the home-screen Schedule list. For every Live Course the customer
// owns (verified + active subscription), returns the course's admin-curated
// schedule folders. The UI renders each owned course as a section header with
// its folders listed underneath; tapping a folder opens GET /:id/schedule-folders/:folderId.
//
// Only active folders are returned (hidden folders are admin-only).
export const listMyScheduleByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyScheduleByCategory invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyScheduleByCategory unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const now = new Date();

    const subs = await LiveCourseSubscription.find({
      customerId,
      paymentStatus: "verified",
      status: true,
      $or: [{ endAt: null }, { endAt: { $gte: now } }],
    })
      .sort({ createdAt: -1 })
      .populate({
        path: "liveCourseId",
        select: "name image level status scheduleFolders",
        match: { status: true },
      })
      .lean();

    type PopulatedCourse = {
      _id: any;
      name: string;
      image: string;
      level: string;
      scheduleFolders?: any[];
    };

    // For each course, pick the longest-lived sub's endAt — same lifetime-wins
    // rule as getDaysLeftForLiveCourses (lifetime null beats any date).
    const endAtByCourse = new Map<string, Date | null>();
    let hasLifetimeByCourse = new Map<string, boolean>();
    for (const s of subs as any[]) {
      if (!s.liveCourseId) continue;
      const key = String(s.liveCourseId._id ?? s.liveCourseId);
      const endAt: Date | null = s.endAt ?? null;
      if (endAt === null) {
        hasLifetimeByCourse.set(key, true);
        endAtByCourse.set(key, null);
        continue;
      }
      if (hasLifetimeByCourse.get(key)) continue;
      const prev = endAtByCourse.get(key);
      if (!prev || endAt.getTime() > (prev as Date).getTime()) endAtByCourse.set(key, endAt);
    }

    const populated = (subs
      .map((s) => s.liveCourseId)
      .filter(Boolean) as unknown) as PopulatedCourse[];

    // De-dup: extension subs can populate the same course twice.
    const uniqueById = new Map<string, PopulatedCourse>();
    for (const c of populated) {
      const key = String(c._id);
      if (!uniqueById.has(key)) uniqueById.set(key, c);
    }

    const liveCourses = Array.from(uniqueById.values()).map((c) => {
      const folders = (c.scheduleFolders ?? [])
        .filter((f: any) => f.status !== false)
        .slice()
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((f: any) => ({
          _id: String(f._id),
          title: f.title,
          image: f.image ?? null,
          order: f.order ?? 0,
          entryCount: Array.isArray(f.entries) ? f.entries.length : 0,
        }));

      const key = String(c._id);
      const endAt = hasLifetimeByCourse.get(key) ? null : (endAtByCourse.get(key) ?? null);
      return {
        _id: String(c._id),
        name: c.name,
        image: c.image,
        level: c.level,
        scheduleFolders: folders,
        daysLeft: hasLifetimeByCourse.get(key) ? null : computeDaysLeft(endAt, now),
      };
    });

    logger.info("listMyScheduleByCategory success", {
      traceId,
      customerId,
      totalLiveCourses: liveCourses.length,
      totalFolders: liveCourses.reduce((n, c) => n + c.scheduleFolders.length, 0),
    });
    return success(
      res,
      {
        liveCourses,
        totalLiveCourses: liveCourses.length,
      },
      "Your schedule fetched."
    );
  } catch (err) {
    logger.error("listMyScheduleByCategory failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your schedule.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/schedule-folders/:folderId
// Returns one folder's entries for screen 2 (Date / Subject / Time list).
// Requires the customer to hold a verified + active subscription to the
// course. Hidden folders (status=false) return 404 — they're admin-only.
export const getMyScheduleFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = String(req.params.id ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("getMyScheduleFolder invoked", { traceId, path: req.originalUrl, customerId, id, folderId });

  try {
    if (!customerId) return failure(res, "Unauthorized.", 401);
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid live course id.", 422);
    if (!mongoose.Types.ObjectId.isValid(folderId)) return failure(res, "Invalid folder id.", 422);

    const now = new Date();
    const owned = await LiveCourseSubscription.exists({
      customerId,
      liveCourseId: id,
      paymentStatus: "verified",
      status: true,
      $or: [{ endAt: null }, { endAt: { $gte: now } }],
    });
    if (!owned) {
      logger.warn("getMyScheduleFolder forbidden", { traceId, customerId, id });
      return failure(res, "You don't have access to this live course.", 403);
    }

    const course = await LiveCourse.findOne({ _id: id, status: true })
      .select("_id name scheduleFolders")
      .lean();
    if (!course) return failure(res, "Live course not found.", 404);

    const folder = ((course as any).scheduleFolders ?? []).find(
      (f: any) => String(f._id) === folderId && f.status !== false
    );
    if (!folder) return failure(res, "Schedule folder not found.", 404);

    const entries = (folder.entries ?? [])
      .slice()
      .sort(
        (a: any, b: any) =>
          ((a.order ?? 0) - (b.order ?? 0)) ||
          (new Date(a.date).getTime() - new Date(b.date).getTime())
      )
      .map((e: any) => ({
        _id: String(e._id),
        date: e.date,
        subject: e.subject,
        time: e.time,
        order: e.order ?? 0,
      }));

    const daysLeft = await getDaysLeftForLiveCourses(customerId, [id]);

    return success(
      res,
      {
        liveCourse: { _id: String(course._id), name: course.name },
        scheduleFolder: {
          _id: String(folder._id),
          title: folder.title,
          image: folder.image ?? null,
          order: folder.order ?? 0,
        },
        entries,
        total: entries.length,
        daysLeft,
      },
      "Schedule folder fetched."
    );
  } catch (err) {
    logger.error("getMyScheduleFolder failed", { traceId, customerId, id, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch schedule folder.", 500);
  }
};
