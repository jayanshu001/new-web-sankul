// Client learning: live-session progress heartbeat and Resume Learning feed.
import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  parseLpId,
  reportLiveSessionProgress as sqlReportLiveSession,
  listMyLearningProgress as sqlListMyLearningProgress,
  toProgressDto,
} from "../../modules/client-lecture-progress/client-lecture-progress.service";

const progressBodySchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24),
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
  // Accepted for older app builds; ignored — progress is global per (customer, liveSession).
  scope: z
    .object({
      kind: z.enum(["liveCourse", "package"]),
      
      id: z.string().min(1),
    })
    .optional(),
});

// Recorded live-session heartbeat; gated on an active live-course subscription for
// at least one course the session is published under.
export const reportLiveSessionProgress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("reportLiveSessionProgress invoked", { traceId, path: req.originalUrl, customerId: userId, liveSessionId: req.params.liveSessionId });

  try {
    if (!userId) { logger.warn("reportLiveSessionProgress unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const cid = parseLpId(String(userId));
    const lsid = parseLpId(String(req.params.liveSessionId));
    if (cid == null || lsid == null) return res.status(404).json({ success: false, message: "Live session not found." });
    const { positionSec, durationSec } = progressBodySchema.parse(req.body);
    const r = await sqlReportLiveSession({ customerId: cid, liveSessionId: lsid, positionSec, durationSec });
    if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
    logger.info("reportLiveSessionProgress success", { traceId, customerId: userId, liveSessionId: lsid });
    return res.status(200).json({ success: true, data: toProgressDto(r.row) });
  } catch (e: any) {
    if (e.issues) { logger.warn("reportLiveSessionProgress validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("reportLiveSessionProgress failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Unified "Resume Learning" feed: started Course and Package cards, most recent first.
// Live courses are excluded at the source (listMyLearningProgress): a live session is
// not a resumable lecture.
export const listMyLearningProgress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMyLearningProgress invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listMyLearningProgress unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { search, page, limit, skip } = parseListQuery(req.query);
    const sid = parseLpId(String(userId));
    if (sid == null) return res.status(200).json({ success: true, data: { cards: [], resumeNext: null, pagination: buildPagination(0, page, limit) } });
    const { cards, resumeNext, total } = await sqlListMyLearningProgress(sid, { search, skip, limit });
    logger.info("listMyLearningProgress success", { traceId, customerId: userId, cardCount: cards.length });
    return res.status(200).json({ success: true, data: { cards, resumeNext, pagination: buildPagination(total, page, limit) } });
  } catch (e: any) {
    logger.error("listMyLearningProgress failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
