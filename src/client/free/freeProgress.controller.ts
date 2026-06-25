import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { Package } from "../../models/course/Package.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  isLectureProgressMysql,
  parseLpId,
  upsertVideoProgress as sqlUpsertVideoProgress,
  listFreeResume as sqlListFreeResume,
  findLiveVideo as sqlFindLiveVideo,
} from "../../modules/client-lecture-progress/client-lecture-progress.service";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const progressSchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24), // sanity cap: 24h
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
});

// A lecture is treated as completed once the user has watched ~95% of it —
// same threshold the container-scoped heartbeats use, so a free video and a
// course video fill their bars on the same rule.
const COMPLETION_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// POST /api/v1/client/free-videos/:videoId/progress
// Heartbeat for a STANDALONE free video (the /free-videos catalog), which has
// no course / package / live-course container. Unlike the container heartbeat
// (/courses/lectures/:videoId/progress) there is no `scope` — the video being
// priceType:"free" is the entire entitlement, so we only confirm that, then
// upsert a single (customer, video) row stamped `source:"free"`. That marker
// is what the free Resume feed groups on, since there's no container pointer.
// ---------------------------------------------------------------------------
export const reportFreeVideoProgress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("reportFreeVideoProgress invoked", { traceId, path: req.originalUrl, userId, videoId: req.params.videoId });

  try {
    if (!userId) {
      logger.warn("reportFreeVideoProgress unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { positionSec, durationSec } = progressSchema.parse(req.body);

    // ── SQL branch (client-lecture-progress) ──────────────────────────────────
    // Ids are SQL ints at runtime. Self-contained free slice: validate the video
    // is live + free (404 vs 403 split, matching Mongo), then upsert source:"free".
    if (isLectureProgressMysql()) {
      const vid = parseLpId(String(req.params.videoId));
      if (vid == null) {
        return res.status(404).json({ success: false, message: "Lecture not found." });
      }
      const live = await sqlFindLiveVideo(vid);
      if (!live) {
        logger.warn("reportFreeVideoProgress(SQL) video not found", { traceId, userId, videoId: vid });
        return res.status(404).json({ success: false, message: "Lecture not found." });
      }
      if (live.priceType !== "free") {
        logger.warn("reportFreeVideoProgress(SQL) not a free video", { traceId, userId, videoId: vid });
        return res.status(403).json({ success: false, message: "This lecture is not a free video." });
      }
      const row = await sqlUpsertVideoProgress({
        customerId: Number(userId),
        videoId: vid,
        source: "free",
        positionSec,
        durationSec,
      });
      logger.info("reportFreeVideoProgress(SQL) success", { traceId, userId, videoId: vid, positionSec, durationSec });
      return res.status(200).json({ success: true, data: row });
    }

    const videoId = objectId.parse(req.params.videoId);

    const video = await Video.findById(videoId).select("status priceType").lean();
    if (!video || !video.status) {
      logger.warn("reportFreeVideoProgress video not found", { traceId, userId, videoId });
      return res.status(404).json({ success: false, message: "Lecture not found." });
    }
    // Only genuinely-free videos may be tracked here. A paid video belongs to a
    // container and must go through the scoped /courses heartbeat so its
    // subscription is checked — never let it persist as a free row.
    if ((video as any).priceType !== "free") {
      logger.warn("reportFreeVideoProgress not a free video", { traceId, userId, videoId });
      return res.status(403).json({ success: false, message: "This lecture is not a free video." });
    }

    const now = new Date();
    const cid = new mongoose.Types.ObjectId(userId);

    const completedNow =
      durationSec > 0 && positionSec / durationSec >= COMPLETION_THRESHOLD;

    // Keyed on (customer, video). The unique uniq_customer_video index means a
    // free video the user also reached through a container shares this one row,
    // so completion stays consistent everywhere — matching the model's
    // "global per (customer, lecture)" contract. We never *un*complete a
    // lecture; once completed stays completed even if a later heartbeat reports
    // an earlier position.
    const setFields: any = {
      positionSec,
      durationSec,
      lastWatchedAt: now,
      source: "free",
    };
    if (completedNow) {
      setFields.completed = true;
      setFields.completedAt = now;
    }

    const row = await LectureProgress.findOneAndUpdate(
      { customerId: cid, videoId: new mongoose.Types.ObjectId(videoId) },
      {
        $set: setFields,
        $setOnInsert: {
          customerId: cid,
          videoId: new mongoose.Types.ObjectId(videoId),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    logger.info("reportFreeVideoProgress success", { traceId, userId, videoId, positionSec, durationSec, completedNow });
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("reportFreeVideoProgress validation failed", { traceId, userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("reportFreeVideoProgress failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/client/free-videos/resume
// "Resume Learning" feed for standalone free videos. Returns the user's
// started free videos (one LectureProgress row with source:"free"), newest
// activity first, each carrying enough metadata to render the card AND tap
// straight back into the player. Metadata only — the FE fetches the encrypted
// URL from /courses/lecture on tap, exactly as the container resume feeds do.
//
// `resumeNext` is the single most-recent card (the hero "Resume Now"); `cards`
// is the full list. Mirrors the shape of /learning/progress/my so the FE can
// reuse the same resume card.
// ---------------------------------------------------------------------------
interface FreeScope {
  // VideoCategory ids under any free product's tree — a video is "free-parented"
  // iff its videoCategoryId is in here.
  categoryIds: Set<string>;
  // Free product ids, used to match container LectureProgress rows (which carry
  // courseId / packageId / liveCourseId pointers, not source:"free").
  courseIds: Set<string>;
  packageIds: Set<string>;
  liveCourseIds: Set<string>;
}

// Build the set of VideoCategory ids that belong to a FREE product
// (Course/LiveCourse/Package with isPaid:false), PLUS the free product ids
// themselves. Walks each free product's root category tree down childCategoryIds,
// exactly like the free-videos listing — but restricted to free parents.
// Mirrors free.controller.ts steps 1–2.
async function freeProductScope(): Promise<FreeScope> {
  const [freePackages, freeCourses, freeLiveCourses] = await Promise.all([
    Package.find({ active: true, isPaid: false }).select("_id").lean(),
    Course.find({ status: true, isPaid: false }).select("_id videoCategoryId").lean(),
    LiveCourse.find({ status: true, isPaid: false }).select("_id videoCategoryId").lean(),
  ]);

  const courseIds = new Set<string>((freeCourses as any[]).map((c) => String(c._id)));
  const packageIds = new Set<string>((freePackages as any[]).map((p) => String(p._id)));
  const liveCourseIds = new Set<string>((freeLiveCourses as any[]).map((lc) => String(lc._id)));

  const rootIds = new Set<string>();
  for (const c of freeCourses as any[]) if (c.videoCategoryId) rootIds.add(String(c.videoCategoryId));
  for (const lc of freeLiveCourses as any[]) if (lc.videoCategoryId) rootIds.add(String(lc.videoCategoryId));

  // Packages reach roots through their active video-category relations.
  const freePkgIds = (freePackages as any[]).map((p) => p._id);
  if (freePkgIds.length) {
    const pkgRels = await PackageVideoCategoryRelation.find({ packageId: { $in: freePkgIds }, active: true })
      .select("videoCategoryRelationId")
      .lean();
    const relIds = [...new Set((pkgRels as any[]).map((r) => String(r.videoCategoryRelationId)))].map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    if (relIds.length) {
      const rels = await VideoCategoryRelation.find({ _id: { $in: relIds } }).select("parent child").lean();
      for (const r of rels as any[]) {
        if (r.parent) rootIds.add(String(r.parent));
        if (r.child) rootIds.add(String(r.child));
      }
    }
  }

  const categoryIds = new Set<string>(rootIds);
  // Expand each root to its full active subtree (BFS down childCategoryIds).
  let toLoad = [...rootIds].map((id) => new mongoose.Types.ObjectId(id));
  while (toLoad.length) {
    const batch = await VideoCategory.find({ _id: { $in: toLoad }, status: true })
      .select("_id childCategoryIds")
      .lean();
    const next: mongoose.Types.ObjectId[] = [];
    for (const cat of batch as any[]) {
      for (const k of (cat.childCategoryIds ?? []) as any[]) {
        const ks = String(k);
        if (!categoryIds.has(ks)) { categoryIds.add(ks); next.push(new mongoose.Types.ObjectId(ks)); }
      }
    }
    toLoad = next;
  }
  return { categoryIds, courseIds, packageIds, liveCourseIds };
}

export const listFreeVideoResume = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listFreeVideoResume invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("listFreeVideoResume unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    // ── SQL branch (client-lecture-progress) ──────────────────────────────────
    if (isLectureProgressMysql()) {
      const data = await sqlListFreeResume(Number(userId), 20);
      logger.info("listFreeVideoResume(SQL) success", { traceId, userId, cardCount: data.cards.length, hasResume: !!data.resumeNext });
      return res.status(200).json({ success: true, data });
    }

    const cid = new mongoose.Types.ObjectId(userId);

    // The free resume feed shows any video whose PARENT product is free
    // (isPaid:false). That's two kinds of progress rows:
    //   (a) standalone free videos      → source:"free" (no container pointer)
    //   (b) videos watched IN a free     → container heartbeat stamps
    //       course/package/liveCourse      courseId/packageId/liveCourseId
    //                                       (source stays null). Includes PAID
    //                                       videos inside a free parent, which
    //                                       are now allowed to save progress.
    // Build the free-product scope first so we can match both row kinds.
    const freeScope = await freeProductScope();
    const toOids = (s: Set<string>) => [...s].map((id) => new mongoose.Types.ObjectId(id));

    const rows = await LectureProgress.find({
      customerId: cid,
      $or: [
        { source: "free" },
        { courseId: { $in: toOids(freeScope.courseIds) } },
        { packageId: { $in: toOids(freeScope.packageIds) } },
        { liveCourseId: { $in: toOids(freeScope.liveCourseIds) } },
      ],
    })
      .select("videoId positionSec durationSec completed lastWatchedAt")
      .sort({ lastWatchedAt: -1 })
      .limit(20)
      .lean();

    if (rows.length === 0) {
      logger.info("listFreeVideoResume empty", { traceId, userId });
      return res.status(200).json({ success: true, data: { cards: [], resumeNext: null } });
    }

    const videoIds = rows.map((r) => r.videoId).filter(Boolean);

    // Surface videos that are still live and whose category belongs to a free
    // product. We do NOT filter on priceType — a PAID video inside a FREE
    // parent is valid free content (its progress is allowed by the container
    // heartbeat). The free-category gate is what keeps out videos whose parent
    // is paid (e.g. a free video also watched inside a paid course).
    const videos = await Video.find({ _id: { $in: videoIds }, status: true })
      .select("_id title topic videoCategoryId")
      .populate("videoCategoryId", "_id title image")
      .lean();
    // Keep only videos whose category belongs to a free product.
    const videoById = new Map(
      videos
        .filter((v: any) => {
          const catId = v.videoCategoryId && typeof v.videoCategoryId === "object"
            ? String(v.videoCategoryId._id)
            : String(v.videoCategoryId);
          return freeScope.categoryIds.has(catId);
        })
        .map((v: any) => [String(v._id), v])
    );

    const percentOf = (pos: number, dur: number) =>
      dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;

    const cards = rows
      .map((r) => {
        const v = videoById.get(String(r.videoId));
        if (!v) return null; // video deleted / disabled / no longer free — skip
        const cat: any = v.videoCategoryId && typeof v.videoCategoryId === "object" ? v.videoCategoryId : null;
        return {
          type: "free" as const,
          videoId: String(v._id),
          // The category the FE needs to open the player on tap:
          // GET /video-categories/:categoryId/videos/:videoId. Included so the
          // resume card is self-contained (no need to cache it from the list).
          categoryId: cat ? String(cat._id) : null,
          title: v.title ?? null,
          topic: v.topic ?? null,
          chapterTitle: cat?.title ?? null,
          thumbnail: cat?.image ?? null,
          // Free videos never expire — no subscription, so no daysLeft.
          daysLeft: null,
          completed: !!r.completed,
          percentCompleted: percentOf(r.positionSec, r.durationSec),
          lastWatchedAt: r.lastWatchedAt,
          resume: {
            videoId: String(v._id),
            positionSec: r.positionSec,
            durationSec: r.durationSec,
            remainingSec: Math.max(0, r.durationSec - r.positionSec),
          },
        };
      })
      .filter(Boolean);

    const resumeNext = cards[0] ?? null;

    logger.info("listFreeVideoResume success", { traceId, userId, cardCount: cards.length, hasResume: !!resumeNext });
    return res.status(200).json({ success: true, data: { cards, resumeNext } });
  } catch (e: any) {
    logger.error("listFreeVideoResume failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
