import { Request, Response } from "express";
import { Types } from "mongoose";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { computeDaysLeft } from "../../utils/planDuration";

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

    // Per-course daysLeft: latest active sub wins; lifetime (null endAt) wins
    // over all dated subs. Same rule as the rest of the courses API.
    const now = new Date();
    const life = new Set<string>();
    const latest = new Map<string, Date>();
    if (userId && courseIds.length) {
      const planIdsArr = (allPlans as any[]).map((p) => p._id);
      const planToCourse = new Map<string, string>(
        (allPlans as any[]).map((p) => [String(p._id), String(p.courseId)])
      );
      const subs = await PackageCourseSubscription.find({
        customerId: userId,
        paymentStatus: "verified",
        status: true,
        $and: [
          { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
          { $or: [{ courseId: { $in: courseIds } }, { packageId: { $in: planIdsArr } }] },
        ],
      }).select("courseId packageId endAt").lean();
      const upsert = (key: string, endAt: Date | null) => {
        if (endAt === null) { life.add(key); return; }
        if (life.has(key)) return;
        const prev = latest.get(key);
        if (!prev || endAt.getTime() > prev.getTime()) latest.set(key, endAt);
      };
      for (const s of subs as any[]) {
        const endAt: Date | null = s.endAt ?? null;
        if (s.courseId) upsert(String(s.courseId), endAt);
        const viaPlan = planToCourse.get(String(s.packageId));
        if (viaPlan) upsert(viaPlan, endAt);
      }
    }

    const coursesWithPlans = courses.map((c: any) => {
      const key = String(c._id);
      const isLifetime = life.has(key);
      const endAt = latest.get(key);
      return {
        ...c,
        plans:
          plansByCourse.get(key) ?? {
            withMaterial: [],
            withoutMaterial: [],
          },
        daysLeft: isLifetime ? null : (endAt ? computeDaysLeft(endAt, now) : null),
      };
    });

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
