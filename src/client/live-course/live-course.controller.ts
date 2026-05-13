import { Request, Response } from "express";
import mongoose from "mongoose";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { hasAccessToAnyLiveCourse } from "./entitlement";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

// GET /api/v1/client/live-courses
export const listLiveCoursesForClient = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const query: Record<string, any> = { status: true };
    if (search) query.name = { $regex: search, $options: "i" };

    const [rows, total] = await Promise.all([
      LiveCourse.find(query)
        .sort({ ordered: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("courseEducatorId", "name image")
        .populate("courseSubjectCategoryId", "title slug")
        .lean(),
      LiveCourse.countDocuments(query),
    ]);

    return success(res, { liveCourses: rows, total, page, limit }, "Live courses fetched.");
  } catch (err) {
    logger.error("Client live-courses list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list live courses.", 500);
  }
};

// GET /api/v1/client/live-courses/:id
// Includes plans + whether the current customer already has access.
export const getLiveCourseForClient = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid live course id.", 422);

    const [course, plans] = await Promise.all([
      LiveCourse.findOne({ _id: id, status: true })
        .populate("courseEducatorId", "name image about")
        .populate("courseSubjectCategoryId", "title slug")
        .lean(),
      LiveCoursePlan.find({ liveCourseId: id, status: true })
        .sort({ price: 1 })
        .lean(),
    ]);
    if (!course) return failure(res, "Live course not found.", 404);

    const subscribed = await hasAccessToAnyLiveCourse(req.user?.id, [id]);

    return success(
      res,
      { liveCourse: course, plans, subscribed },
      "Live course fetched."
    );
  } catch (err) {
    logger.error("Client live-course detail failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch live course.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/sessions
// Filter: upcoming=true → SCHEDULED + scheduledAt >= now.
export const listSessionsForCourseClient = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid live course id.", 422);

    const exists = await LiveCourse.exists({ _id: id, status: true });
    if (!exists) return failure(res, "Live course not found.", 404);

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const upcoming = req.query.upcoming === "true";
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    const query: Record<string, any> = { liveCourseIds: id };
    if (status) query.status = status;
    if (upcoming) {
      query.status = "SCHEDULED";
      query.scheduledAt = { $gte: new Date() };
    }

    const [rows, total] = await Promise.all([
      LiveSession.find(query)
        .sort({ scheduledAt: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title status scheduledAt streamId hlsUrl recordings liveCourseIds createdAt updatedAt")
        .lean(),
      LiveSession.countDocuments(query),
    ]);

    return success(res, { sessions: rows, total, page, limit }, "Sessions fetched.");
  } catch (err) {
    logger.error("Client live-course sessions list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list sessions.", 500);
  }
};
