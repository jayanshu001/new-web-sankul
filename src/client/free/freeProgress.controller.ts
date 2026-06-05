import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

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

    const videoId = objectId.parse(req.params.videoId);
    const { positionSec, durationSec } = progressSchema.parse(req.body);

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
export const listFreeVideoResume = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listFreeVideoResume invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("listFreeVideoResume unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = new mongoose.Types.ObjectId(userId);

    // Recent free-video activity, newest first. This is a "resume" list, not
    // exhaustive history — cap it like /courses/my does.
    const rows = await LectureProgress.find({ customerId: cid, source: "free" })
      .select("videoId positionSec durationSec completed lastWatchedAt")
      .sort({ lastWatchedAt: -1 })
      .limit(20)
      .lean();

    if (rows.length === 0) {
      logger.info("listFreeVideoResume empty", { traceId, userId });
      return res.status(200).json({ success: true, data: { cards: [], resumeNext: null } });
    }

    const videoIds = rows.map((r) => r.videoId).filter(Boolean);

    // Only surface videos that are still live AND still free — a video flipped
    // to paid or disabled since the user watched it shouldn't appear in the
    // free feed (tapping it would 403 at /courses/lecture). Populate the
    // category for the card thumbnail/chapter, since Video carries no image.
    const videos = await Video.find({ _id: { $in: videoIds }, status: true, priceType: "free" })
      .select("_id title topic videoCategoryId")
      .populate("videoCategoryId", "_id title image")
      .lean();
    const videoById = new Map(videos.map((v: any) => [String(v._id), v]));

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
