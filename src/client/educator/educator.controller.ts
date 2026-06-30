import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import {
  isClientEducatorMysql,
  parseEducatorId,
  getEducatorWithCourses,
} from "../../modules/client-educator/client-educator.service";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// GET /api/v1/client/educators/:id
// Returns educator profile + list of active courses taught by them (with plans).
export const getEducatorWithCoursesHandler = async (
  req: Request,
  res: Response
) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const educatorId = req.params.id as string;

  logger.info("getEducatorWithCoursesHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId,
    educatorId,
  });

  try {
    // ─── ws_course_educator + ws_course + plans + subs ──────
    const eid = parseEducatorId(educatorId);
    if (!eid) return failure(res, "Please select valid educator", 400);
    const cid = userId ? parseEducatorId(userId) : null;
    const base = resolveBase(req);
    const data = await getEducatorWithCourses(eid, cid, (kind, id) => buildShareUrl(kind, id, base));
    if (!data) return failure(res, "Educator not found", 404);
    logger.info("getEducatorWithCoursesHandler success (sql)", { traceId, userId, educatorId, totalCourses: data.totalCourses });
    return success(res, data, "Educator details fetched successfully.", 200);
  } catch (err) {
    logger.error("getEducatorWithCoursesHandler failed", {
      traceId,
      userId,
      educatorId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};
