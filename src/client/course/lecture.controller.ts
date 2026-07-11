import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { lectureQuerySchema } from "./course.validation";
import * as lecSql from "../../modules/client-lecture/client-lecture.service";
import { signMediaToken, MediaScope } from "../../utils/mediaToken";

export const getLectureHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getLectureHandler invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("getLectureHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    const parsed = lectureQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      logger.warn("getLectureHandler validation failed", { traceId, userId, issues: parsed.error.issues });
      return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }

    const { id: videoId, type } = parsed.data;
    const courseId = parsed.data.course;
    const packageId = parsed.data.package;

    if (type === "course" && !courseId) {
      logger.warn("getLectureHandler missing courseId", { traceId, userId, videoId });
      return failure(res, "course param is required when type is course", 400);
    }
    if (type === "package" && !packageId) {
      logger.warn("getLectureHandler missing packageId", { traceId, userId, videoId });
      return failure(res, "package param is required when type is package", 400);
    }

    const cid = lecSql.parseLecId(String(userId));
    const vid = lecSql.parseLecId(String(videoId));
    if (cid == null || vid == null) return failure(res, "Lecture not found", 404);
    const v = await lecSql.findVideo(vid);
    if (!v) return failure(res, "Lecture not found", 404);
    if (!v.status) return failure(res, "Lecture is not available", 403);

    if (type === "course" && courseId) {
      const courseIdNum = lecSql.parseLecId(courseId);
      if (courseIdNum == null || !(await lecSql.videoBelongsToCourse(v.videoCategoryId, courseIdNum))) {
        return failure(res, "Lecture does not belong to this course", 403);
      }
    }

    // Media is never returned inline. We mint a short-lived, customer-bound
    // media token; the client exchanges it at POST /media/resolve. Free videos
    // get a `free` token; paid videos require an active subscription (403 for
    // unpurchased — no raw id/url ever leaves the server).
    const buildScope = (): MediaScope => {
      if (type === "package" && packageId) return { kind: "package", id: lecSql.parseLecId(packageId)! };
      return { kind: "course", id: lecSql.parseLecId(courseId ?? "")! };
    };

    if (v.priceType === "free") {
      const mediaToken = signMediaToken({ k: "video", id: v.id, free: true, cust: cid });
      return success(res, { _id: String(v.id), title: v.title, platform: v.platform, mediaToken }, "Lecture fetched successfully.", 200);
    }

    let subscribed = false;
    if (type === "course" && courseId) {
      const n = lecSql.parseLecId(courseId);
      subscribed = n != null && (await lecSql.hasActiveCourseSub(cid, n));
    } else if (type === "package" && packageId) {
      const n = lecSql.parseLecId(packageId);
      subscribed = n != null && (await lecSql.hasActivePackageSub(cid, n));
    }
    if (!subscribed) return failure(res, "Active subscription required to access this lecture", 403);

    const mediaToken = signMediaToken({ k: "video", id: v.id, scope: buildScope(), cust: cid });
    return success(res, { _id: String(v.id), title: v.title, platform: v.platform, mediaToken }, "Lecture fetched successfully.", 200);
  } catch (err) {
    logger.error("getLectureHandler failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
