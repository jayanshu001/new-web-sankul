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
  // Container hint, accepted for back-compat with older app builds. No
  // longer affects storage — progress is global per (customer, liveSession).
  scope: z
    .object({
      kind: z.enum(["liveCourse", "package"]),
      // Accept either an ObjectId (Mongo build) or an int-string (SQL build).
      // Back-compat hint only — no longer affects storage.
      id: z.string().min(1),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// POST /api/v1/client/learning/progress/live-sessions/:liveSessionId
// Heartbeat for a recorded live session playback. Mirrors the video heartbeat:
// upserts a (customer, liveSessionId) row, gated on an active live-course
// subscription for at least one course the session is published under.
// ---------------------------------------------------------------------------
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
    logger.info("reportLiveSessionProgress (sql) success", { traceId, customerId: userId, liveSessionId: lsid });
    return res.status(200).json({ success: true, data: toProgressDto(r.row) });
  } catch (e: any) {
    if (e.issues) { logger.warn("reportLiveSessionProgress validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("reportLiveSessionProgress failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/client/learning/progress/my
// Unified "Resume Learning" feed. Returns one flat list of cards covering
// Course and Package entries the user has actually started (i.e. has at least
// one LectureProgress row for). The list is sorted by most-recent activity
// across both types so the FE renders them as one vertical stream — matching
// the UI in the design.
//
// LIVE COURSES ARE EXCLUDED (2026-07-30, FE request): a live session is not a
// resumable lecture, so no `type: "live"` card is ever emitted here, and
// `resumeNext` can never be a live card. Enforced at the source in
// client-lecture-progress.service.listMyLearningProgress.
// ---------------------------------------------------------------------------
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
    logger.info("listMyLearningProgress (sql) success", { traceId, customerId: userId, cardCount: cards.length });
    return res.status(200).json({ success: true, data: { cards, resumeNext, pagination: buildPagination(total, page, limit) } });
  } catch (e: any) {
    logger.error("listMyLearningProgress failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
