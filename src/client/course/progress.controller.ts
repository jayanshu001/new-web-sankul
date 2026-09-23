import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  parseLpId,
  reportContainerProgress,
  listMyCoursesForResume as sqlListMyCoursesForResume,
} from "../../modules/client-lecture-progress/client-lecture-progress.service";

// SQL id-space variant of the heartbeat body — ids are positive ints, not 24-hex.
const intIdStr = z.string().regex(/^\d+$/, "Invalid id");
const progressSchemaMysql = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24),
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
  scope: z.object({
    kind: z.enum(["course", "liveCourse", "package"]),
    id: intIdStr,
  }),
});

// POST /api/v1/client/courses/lectures/:videoId/progress
// Heartbeat from the mobile player. The first call for a (customer, video)
// pair upserts a new row — that's also what makes the course appear on the
// My Courses screen for the first time. No separate "start course" call.
export const reportLectureProgress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("reportLectureProgress invoked", { traceId, path: req.originalUrl, userId, videoId: req.params.videoId });

  try {
    if (!userId) {
      logger.warn("reportLectureProgress unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = parseLpId(String(userId));
    const vid = parseLpId(String(req.params.videoId));
    if (cid == null || vid == null) {
      return res.status(404).json({ success: false, message: "Lecture not found." });
    }
    const { positionSec, durationSec, scope } = progressSchemaMysql.parse(req.body);
    const scopeId = parseLpId(scope.id);
    if (scopeId == null) {
      return res.status(400).json({ success: false, errors: [{ path: ["scope", "id"], message: "Invalid id" }] });
    }
    const result = await reportContainerProgress({
      customerId: cid, videoId: vid,
      scope: { kind: scope.kind, id: scopeId },
      positionSec, durationSec,
    });
    if (!result.ok) {
      logger.warn("reportLectureProgress (sql) rejected", { traceId, userId, videoId: vid, scope, status: result.status });
      return res.status(result.status).json({ success: false, message: result.message });
    }
    logger.info("reportLectureProgress (sql) success", { traceId, userId, videoId: vid, scope, positionSec, durationSec });
    // Fire-and-forget heartbeat: the mobile player ignores the body. Ack only.
    return res.status(200).json({ success: true, data: null });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("reportLectureProgress validation failed", { traceId, userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("reportLectureProgress failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/courses/my
// Drives the "My Courses / Subject" screen. Returns:
//   - `courses`: the user's *started* courses (any LectureProgress row exists),
//      each annotated with daysLeft, percentCompleted, and the most recently-
//      watched lecture for the small per-card progress hint.
//   - `resumeNext`: the single most recently-watched lecture across all the
//      user's courses, expanded for the big "Resume Now" hero card.
//
// Untouched courses (subscribed but never opened) are intentionally excluded —
// that matches the design (100 enrolled, only 3 shown).
export const listMyCoursesForResume = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMyCoursesForResume invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("listMyCoursesForResume unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const { search, page, limit, skip } = parseListQuery(req.query as Record<string, any>);
    const sid = parseLpId(String(userId));
    if (sid == null) {
      return res.status(200).json({
        success: true,
        data: { courses: [], resumeNext: null, pagination: buildPagination(0, page, limit) },
      });
    }
    const { courses, resumeNext, total } = await sqlListMyCoursesForResume(sid, { search, skip, limit });
    const pagination = buildPagination(total, page, limit);
    logger.info("listMyCoursesForResume (sql) success", { traceId, userId, count: courses.length, total });
    return res.status(200).json({ success: true, data: { courses, resumeNext, pagination } });
  } catch (e: any) {
    logger.error("listMyCoursesForResume failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
