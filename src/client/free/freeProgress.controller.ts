import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { Package } from "../../models/course/Package.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parseLpId,
  upsertVideoProgress as sqlUpsertVideoProgress,
  listFreeResume as sqlListFreeResume,
  findLiveVideo as sqlFindLiveVideo,
} from "../../modules/client-lecture-progress/client-lecture-progress.service";

const progressSchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24), // sanity cap: 24h
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
});

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

    // Ids are SQL ints at runtime. Self-contained free slice: validate the video
    // is live + free (404 vs 403 split), then upsert source:"free".
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

    const data = await sqlListFreeResume(Number(userId), 20);
    logger.info("listFreeVideoResume(SQL) success", { traceId, userId, cardCount: data.cards.length, hasResume: !!data.resumeNext });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listFreeVideoResume failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
