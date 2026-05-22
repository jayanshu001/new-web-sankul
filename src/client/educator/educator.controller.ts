import { Request, Response } from "express";
import { Types } from "mongoose";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";

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
    if (!Types.ObjectId.isValid(educatorId)) {
      logger.warn("getEducatorWithCoursesHandler invalid id", { traceId, userId, educatorId });
      return failure(res, "Please select valid educator", 400);
    }

    const educator = await CourseEducator.findOne({
      _id: educatorId,
      status: true,
    })
      .select("-password")
      .lean();

    if (!educator) {
      logger.warn("getEducatorWithCoursesHandler not found", { traceId, userId, educatorId });
      return failure(res, "Educator not found", 404);
    }

    const courses = await Course.find({
      status: true,
      courseEducatorId: new Types.ObjectId(educatorId),
    })
      .populate("courseEducatorId", "_id name image")
      .populate("courseSubjectCategoryId", "_id title")
      .populate("videoCategoryId", "_id title")
      .sort({ createdAt: -1 })
      .lean();

    const courseIds = courses.map((c: any) => c._id);
    const allPlans = courseIds.length
      ? await PackageCourseEbookPrice.find({
          courseId: { $in: courseIds },
          status: true,
        })
          .sort({ duration: 1 })
          .lean()
      : [];

    const plansByCourse = new Map<
      string,
      { withMaterial: any[]; withoutMaterial: any[] }
    >();
    for (const p of allPlans as any[]) {
      const key = String(p.courseId);
      let bucket = plansByCourse.get(key);
      if (!bucket) {
        bucket = { withMaterial: [], withoutMaterial: [] };
        plansByCourse.set(key, bucket);
      }
      (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(p);
    }

    const coursesWithPlans = courses.map((c: any) => ({
      ...c,
      plans:
        plansByCourse.get(String(c._id)) ?? {
          withMaterial: [],
          withoutMaterial: [],
        },
    }));

    // Fire-and-forget view counter bump
    setImmediate(() => {
      CourseEducator.updateOne(
        { _id: educatorId },
        { $inc: { view: 1 } }
      ).catch((err) => {
        logger.warn("CourseEducator view increment failed", {
          traceId,
          educatorId,
          error: getErrorMessage(err),
        });
      });
    });

    const response = {
      educator,
      courses: coursesWithPlans,
      totalCourses: coursesWithPlans.length,
    };

    logger.info("getEducatorWithCoursesHandler success", {
      traceId,
      userId,
      educatorId,
      totalCourses: coursesWithPlans.length,
    });
    return success(
      res,
      response,
      "Educator details fetched successfully.",
      200
    );
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
