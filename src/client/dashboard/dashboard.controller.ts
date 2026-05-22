import { Request, Response } from "express";
import { BannerSlider } from "../../models/system/BannerSlider.model";
import { Course } from "../../models/course/Course.model";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { Package } from "../../models/course/Package.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Testimonial } from "../../models/system/Testimonial.model";
import { fetchTrendingBookItems } from "../book/book.controller";
import { Video } from "../../models/course/Video.model";
import { resolveFreeCategoryIds } from "../free/free.controller";
import { ExamCountdown } from "../../models/examCountdown/ExamCountdown.model";
import { Notification } from "../../models/system/Notification.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const RECENTLY_ADDED_LIMIT = 5;
const COURSE_CATEGORY_LIMIT = 6;
const EXAM_COUNTDOWN_LIMIT = 2;
const MS_PER_DAY = 86_400_000;

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function daysLeftFor(d: Date): number {
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return Math.ceil((e.getTime() - todayUTC().getTime()) / MS_PER_DAY);
}

async function buildPackageEntry(pkg: any) {
  const [plans, subCount] = await Promise.all([
    PackageCourseEbookPrice.find({ packageId: pkg._id, status: true }).sort({ duration: 1 }).lean(),
    PackageCourseSubscription.countDocuments({ packageId: pkg._id, status: true }),
  ]);
  return {
    ...pkg,
    packageType: pkg.packageTypeId,
    _count: { packageCourseSubscription: subCount },
    plans: {
      withMaterial: plans.filter((p) => p.withMaterial),
      withoutMaterial: plans.filter((p) => !p.withMaterial),
    },
  };
}

// GET /api/v1/client/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getDashboard invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    const [banners, recentPackages, courses, trending, testimonial, courseCategories, examCountdownsRaw, unreadNotifications] = await Promise.all([
      BannerSlider.find().sort({ orderBy: 1 }).populate("keyId").lean(),
      Package.find({ active: true })
        .populate("packageTypeId", "_id name createdAt updatedAt")
        .sort({ createdAt: -1 })
        .limit(RECENTLY_ADDED_LIMIT)
        .lean(),
      Course.find({ status: true }).sort({ ordered: 1, createdAt: -1 }).lean(),
      fetchTrendingBookItems({ type: "paid" }),
      Testimonial.find().sort({ rating: -1 }).lean(),
      CourseSubjectCategory.find({ status: true })
        .sort({ order: 1, title: 1 })
        .limit(COURSE_CATEGORY_LIMIT)
        .lean(),
      ExamCountdown.find({ status: true, examDate: { $gte: todayUTC() } })
        .populate("categoryId", "_id name colorHex")
        .sort({ examDate: 1, order: 1 })
        .limit(EXAM_COUNTDOWN_LIMIT)
        .lean(),
      // Same visibility filter as GET /client/notifications so the badge here
      // can never disagree with the list.
      userId
        ? Notification.countDocuments({
            $or: [{ customerId: userId }, { broadcast: true }],
            isRead: false,
          })
        : Promise.resolve(0),
    ]);

    const examCountdowns = examCountdownsRaw.map((d: any) => ({
      _id: d._id,
      title: d.title,
      examDate: d.examDate,
      daysLeft: daysLeftFor(d.examDate),
      category:
        d.categoryId && typeof d.categoryId === "object"
          ? { _id: d.categoryId._id, name: d.categoryId.name, colorHex: d.categoryId.colorHex }
          : null,
    }));

    const courseCategoryIds = courseCategories.map((c: any) => c._id);
    const categoryCounts = courseCategoryIds.length
      ? await Course.aggregate([
          { $match: { status: true, courseSubjectCategoryId: { $in: courseCategoryIds } } },
          { $group: { _id: "$courseSubjectCategoryId", count: { $sum: 1 } } },
        ])
      : [];
    const countByCategory = new Map<string, number>();
    for (const row of categoryCounts) countByCategory.set(String(row._id), row.count);
    const courseCategoriesData = courseCategories.map((c: any) => ({
      ...c,
      courseCount: countByCategory.get(String(c._id)) ?? 0,
    }));

    const recentlyAddedData = await Promise.all(recentPackages.map(buildPackageEntry));

    const courseIds = courses.map((c: any) => c._id);
    const coursePlans = courseIds.length
      ? await PackageCourseEbookPrice.find({ courseId: { $in: courseIds }, status: true })
          .sort({ duration: 1 })
          .lean()
      : [];
    const plansByCourse = new Map<string, { withMaterial: any[]; withoutMaterial: any[] }>();
    for (const p of coursePlans as any[]) {
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
      plans: plansByCourse.get(String(c._id)) ?? { withMaterial: [], withoutMaterial: [] },
    }));

    const dashboard: Array<{ title: string; type: string; data: unknown }> = [];

    if (banners.length) dashboard.push({ title: "Banner", type: "banner", data: banners });
    if (examCountdowns.length)
      dashboard.push({ title: "Exam Countdown", type: "exam-countdown", data: examCountdowns });
    if (recentlyAddedData.length)
      dashboard.push({ title: "Recently Added", type: "package", data: recentlyAddedData });
    if (coursesWithPlans.length) dashboard.push({ title: "Course Subjects", type: "course", data: coursesWithPlans });
    if (courseCategoriesData.length)
      dashboard.push({ title: "Course Categories", type: "courseCategory", data: courseCategoriesData });
    if (trending.items.length)
      dashboard.push({ title: "Trending Books", type: "trending-book", data: trending.items });

    logger.info("getDashboard success", { traceId, customerId: userId, sections: dashboard.length, unreadNotifications });
    return res.status(200).json({
      todayDate: new Date().toISOString().slice(0, 10),
      logo: process.env.APP_LOGO_URL ?? "",
      unreadNotifications,
      dashboard,
      testimonial,
    });
  } catch (e: any) {
    logger.error("getDashboard failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

const FREE_DASHBOARD_LIMIT = 5;

// GET /api/v1/client/free-dashboard
export const getFreeDashboard = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getFreeDashboard invoked", { traceId, path: _req.originalUrl });

  try {
    const [trendingFree, magazinePackages, freeCats] = await Promise.all([
      fetchTrendingBookItems({ type: "free", limit: FREE_DASHBOARD_LIMIT }),
      Package.find({ active: true, isMagazine: true, isPaid: false })
        .populate("packageTypeId", "_id name createdAt updatedAt")
        .sort({ order: 1, createdAt: -1 })
        .limit(FREE_DASHBOARD_LIMIT)
        .lean(),
      resolveFreeCategoryIds(),
    ]);

    const currentAffairs = await Promise.all(magazinePackages.map(buildPackageEntry));

    const freeVideos = freeCats.videoCategoryIds.length
      ? await Video.find({ status: true, videoCategoryId: { $in: freeCats.videoCategoryIds } })
          .populate("videoCategoryId", "_id title image")
          .sort({ order: 1, createdAt: -1 })
          .limit(FREE_DASHBOARD_LIMIT)
          .lean()
      : [];

    const dashboard: Array<{ title: string; type: string; data: unknown }> = [];
    if (trendingFree.items.length)
      dashboard.push({
        title: "Trending Free Books",
        type: "trending-book",
        data: trendingFree.items.slice(0, FREE_DASHBOARD_LIMIT),
      });
    if (currentAffairs.length)
      dashboard.push({ title: "Current Affairs", type: "package", data: currentAffairs });
    if (freeVideos.length)
      dashboard.push({ title: "Free Videos", type: "video", data: freeVideos });

    logger.info("getFreeDashboard success", { traceId, sections: dashboard.length });
    return res.status(200).json({
      todayDate: new Date().toISOString().slice(0, 10),
      logo: process.env.APP_LOGO_URL ?? "",
      dashboard,
    });
  } catch (e: any) {
    logger.error("getFreeDashboard failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
