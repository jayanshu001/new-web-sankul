import { Request, Response } from "express";
import mongoose from "mongoose";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Customer } from "../../models/customer/Customer.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GET /api/v1/educator/courses
export const listMyCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  logger.info("listMyCourses invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("listMyCourses unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const courses = await Course.find({ courseEducatorId: educatorId })
      .populate("courseSubjectCategoryId")
      .populate("courseEducatorId", "_id name image")
      .sort({ ordered: 1 })
      .lean();

    const courseIds = courses.map((c) => c._id);

    const [plans, subCounts] = await Promise.all([
      PackageCourseEbookPrice.find({
        courseId: { $in: courseIds },
        status: true,
      })
        .sort({ duration: 1 })
        .lean(),
      PackageCourseSubscription.aggregate([
        { $match: { courseId: { $in: courseIds } } },
        { $group: { _id: "$courseId", total: { $sum: 1 }, active: { $sum: { $cond: ["$status", 1, 0] } } } },
      ]),
    ]);

    const planByCourse: Record<string, any[]> = {};
    plans.forEach((p) => {
      const k = String(p.courseId);
      (planByCourse[k] ||= []).push(p);
    });

    const countByCourse: Record<string, { total: number; active: number }> = {};
    subCounts.forEach((r: any) => {
      countByCourse[String(r._id)] = { total: r.total, active: r.active };
    });

    const data = courses.map((c: any) => {
      const coursePlans = planByCourse[String(c._id)] || [];
      const withMaterial = coursePlans.filter((p) => p.withMaterial);
      const withoutMaterial = coursePlans.filter((p) => !p.withMaterial);
      return {
        ...c,
        subscriptionCount: countByCourse[String(c._id)]?.total || 0,
        activeSubscriptions: countByCourse[String(c._id)]?.active || 0,
        plans: { withMaterial, withoutMaterial },
      };
    });

    logger.info("listMyCourses success", { traceId, educatorId, count: data.length });
    return res.status(200).json({ success: true, data: { courses: data } });
  } catch (error: any) {
    logger.error("listMyCourses failed", { traceId, educatorId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/courses/:id
export const getMyCourseDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyCourseDetail invoked", { traceId, path: req.originalUrl, educatorId, courseId: id });

  try {
    if (!educatorId) { logger.warn("getMyCourseDetail unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isObjectId(id)) { logger.warn("getMyCourseDetail invalid id", { traceId, educatorId, courseId: id }); return res.status(400).json({ success: false, message: "Invalid course id." }); }

    const course = await Course.findOne({ _id: id, courseEducatorId: educatorId })
      .populate("courseSubjectCategoryId")
      .populate("courseEducatorId", "_id name image")
      .lean();

    if (!course) { logger.warn("getMyCourseDetail not found", { traceId, educatorId, courseId: id }); return res.status(404).json({ success: false, message: "Course not found or not yours." }); }

    const plans = await PackageCourseEbookPrice.find({ courseId: id, status: true })
      .sort({ duration: 1 })
      .lean();

    logger.info("getMyCourseDetail success", { traceId, educatorId, courseId: id, planCount: plans.length });
    return res.status(200).json({ success: true, data: { ...course, plans } });
  } catch (error: any) {
    logger.error("getMyCourseDetail failed", { traceId, educatorId, courseId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/courses/:id/dashboard
export const getCourseDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getCourseDashboard invoked", { traceId, path: req.originalUrl, educatorId, courseId: id });

  try {
    if (!educatorId) { logger.warn("getCourseDashboard unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isObjectId(id)) { logger.warn("getCourseDashboard invalid id", { traceId, educatorId, courseId: id }); return res.status(400).json({ success: false, message: "Invalid course id." }); }

    const course = await Course.findOne({ _id: id, courseEducatorId: educatorId });
    if (!course) { logger.warn("getCourseDashboard not found", { traceId, educatorId, courseId: id }); return res.status(404).json({ success: false, message: "Course not found or not yours." }); }

    const now = new Date();
    const [totalSubs, activeSubs, expiredSubs, plansCount, recentSubs] = await Promise.all([
      PackageCourseSubscription.countDocuments({ courseId: id }),
      PackageCourseSubscription.countDocuments({
        courseId: id,
        status: true,
        endAt: { $gt: now },
      }),
      PackageCourseSubscription.countDocuments({
        courseId: id,
        endAt: { $lte: now },
      }),
      PackageCourseEbookPrice.countDocuments({ courseId: id, status: true }),
      PackageCourseSubscription.find({ courseId: id })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    logger.info("getCourseDashboard success", { traceId, educatorId, courseId: id, totalSubs, activeSubs });
    return res.status(200).json({
      success: true,
      data: {
        totalSubscriptions: totalSubs,
        activeSubscriptions: activeSubs,
        expiredSubscriptions: expiredSubs,
        plansCount,
        recentSubscriptions: recentSubs,
      },
    });
  } catch (error: any) {
    logger.error("getCourseDashboard failed", { traceId, educatorId, courseId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/courses/:id/subscribers
export const getCourseSubscribers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getCourseSubscribers invoked", { traceId, path: req.originalUrl, educatorId, courseId: id });

  try {
    if (!educatorId) { logger.warn("getCourseSubscribers unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isObjectId(id)) { logger.warn("getCourseSubscribers invalid id", { traceId, educatorId, courseId: id }); return res.status(400).json({ success: false, message: "Invalid course id." }); }

    const course = await Course.findOne({ _id: id, courseEducatorId: educatorId }).select("_id");
    if (!course) { logger.warn("getCourseSubscribers not found", { traceId, educatorId, courseId: id }); return res.status(404).json({ success: false, message: "Course not found or not yours." }); }

    const pageNum = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      PackageCourseSubscription.find({ courseId: id })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber emailAddress" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PackageCourseSubscription.countDocuments({ courseId: id }),
    ]);

    logger.info("getCourseSubscribers success", { traceId, educatorId, courseId: id, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("getCourseSubscribers failed", { traceId, educatorId, courseId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
