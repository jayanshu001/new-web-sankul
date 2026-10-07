// Client free content: free-video progress heartbeat and resume feed.
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

// Heartbeat for a standalone free video, which has no container and so no `scope`:
// priceType "free" is the whole entitlement. The row is stamped `source:"free"`,
// which is what the free Resume feed groups on.
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

    // Live + free check splits 404 (missing) from 403 (not free).
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
    await sqlUpsertVideoProgress({
      customerId: Number(userId),
      videoId: vid,
      source: "free",
      positionSec,
      durationSec,
    });
    logger.info("reportFreeVideoProgress(SQL) success", { traceId, userId, videoId: vid, positionSec, durationSec });
    // The free player ignores the body; ack only.
    return res.status(200).json({ success: true, data: null });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("reportFreeVideoProgress validation failed", { traceId, userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("reportFreeVideoProgress failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// "Resume Learning" for standalone free videos, metadata only: the FE fetches the
// encrypted URL from /courses/lecture on tap, as the container resume feeds do.
// `resumeNext` mirrors the /learning/progress/my card shape.
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
    // The FE reads only `resumeNext`.
    const data = { resumeNext };
    logger.info("listFreeVideoResume(SQL) success", { traceId, userId, total, cardCount: cards.length, hasResume: !!resumeNext });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
  } catch (e: any) {
    logger.error("listFreeVideoResume failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
