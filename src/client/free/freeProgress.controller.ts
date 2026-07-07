import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
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
export const listFreeVideoResume = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listFreeVideoResume invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("listFreeVideoResume unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { search, page, limit, skip } = parseListQuery(req.query);
    const { cards, resumeNext, total } = await sqlListFreeResume(Number(userId), { search, skip, limit });
    const data = { cards, resumeNext };
    logger.info("listFreeVideoResume(SQL) success", { traceId, userId, total, cardCount: cards.length, hasResume: !!resumeNext });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
  } catch (e: any) {
    logger.error("listFreeVideoResume failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
