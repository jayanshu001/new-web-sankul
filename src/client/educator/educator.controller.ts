// Client educators: HTTP handler for an educator profile with their courses.
import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { omit, omitList } from "../../utils/pick";
import {
  parseEducatorId,
  getEducatorWithCourses,
} from "../../modules/client-educator/client-educator.service";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// Educator profile + their active courses (with plans).
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
    const eid = parseEducatorId(educatorId);
    if (!eid) return failure(res, "Please select valid educator", 400);
    const cid = userId ? parseEducatorId(userId) : null;
    const base = resolveBase(req);
    const data = await getEducatorWithCourses(eid, cid, (kind, id) => buildShareUrl(kind, id, base));
    if (!data) return failure(res, "Educator not found", 404);
    logger.info("getEducatorWithCoursesHandler success", { traceId, userId, educatorId, totalCourses: (data as any).totalCourses });
    // Drop fields the app never reads (it uses only the top-level shareableLink).
    const d = data as any;
    const slim = {
      ...omit(d, ["totalCourses"]),
      educator: omit(d.educator, ["view"]),
      courses: omitList(d.courses, ["courseEducatorId", "courseSubjectCategoryId", "shareableLink"]),
    };
    return success(res, slim, "Educator details fetched successfully.", 200);
  } catch (err) {
    logger.error("getEducatorWithCoursesHandler failed", {
      traceId,
      userId,
      educatorId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
