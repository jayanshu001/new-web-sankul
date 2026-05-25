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
import { computeDaysLeft } from "../../utils/planDuration";
import mongoose, { Types } from "mongoose";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { buildResumeNextCard } from "../learning/resumeCard";

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

// Resolves per-course and per-package "active subscription endAt" maps for a
// single dashboard request. Lifetime (null endAt) wins over any dated sub.
// `undefined` customerId yields empty maps (logged-out → daysLeft = null).
async function resolveOwnedEndAt(
  customerId: string | undefined,
  courseIds: any[],
  packageIds: any[]
): Promise<{
  courseDaysLeft: Map<string, number | null>;
  packageDaysLeft: Map<string, number | null>;
}> {
  const courseDaysLeft = new Map<string, number | null>();
  const packageDaysLeft = new Map<string, number | null>();
  if (!customerId || (courseIds.length === 0 && packageIds.length === 0)) {
    return { courseDaysLeft, packageDaysLeft };
  }
  const now = new Date();

  // Resolve plan rows so we can map sub.packageId (plan) → real Package id.
  const planIds = packageIds.length
    ? await PackageCourseEbookPrice.find({ packageId: { $in: packageIds } })
        .select("_id packageId courseId")
        .lean()
    : [];
  const planToPackage = new Map<string, string>(
    (planIds as any[]).map((p) => [String(p._id), String(p.packageId)])
  );

  const subs = await PackageCourseSubscription.find({
    customerId,
    paymentStatus: "verified",
    status: true,
    $and: [
      { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
      {
        $or: [
          ...(courseIds.length ? [{ courseId: { $in: courseIds } }] : []),
          ...(packageIds.length ? [{ targetPackageId: { $in: packageIds } }] : []),
          ...(planIds.length ? [{ packageId: { $in: (planIds as any[]).map((p) => p._id) } }] : []),
        ],
      },
    ],
  })
    .select("courseId packageId targetPackageId endAt")
    .lean();

  const lifeC = new Set<string>();
  const lifeP = new Set<string>();
  const latestC = new Map<string, Date>();
  const latestP = new Map<string, Date>();
  const upsert = (
    map: Map<string, Date>,
    life: Set<string>,
    key: string,
    endAt: Date | null
  ) => {
    if (endAt === null) { life.add(key); return; }
    if (life.has(key)) return;
    const prev = map.get(key);
    if (!prev || endAt.getTime() > prev.getTime()) map.set(key, endAt);
  };
  for (const s of subs as any[]) {
    const endAt: Date | null = s.endAt ?? null;
    if (s.courseId) upsert(latestC, lifeC, String(s.courseId), endAt);
    if (s.targetPackageId) upsert(latestP, lifeP, String(s.targetPackageId), endAt);
    const viaPlanPackage = planToPackage.get(String(s.packageId));
    if (viaPlanPackage) upsert(latestP, lifeP, viaPlanPackage, endAt);
  }
  for (const key of lifeC) courseDaysLeft.set(key, null);
  for (const [key, endAt] of latestC) if (!lifeC.has(key)) courseDaysLeft.set(key, computeDaysLeft(endAt, now));
  for (const key of lifeP) packageDaysLeft.set(key, null);
  for (const [key, endAt] of latestP) if (!lifeP.has(key)) packageDaysLeft.set(key, computeDaysLeft(endAt, now));
  return { courseDaysLeft, packageDaysLeft };
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

    // Per-entity daysLeft for the logged-in user. `null` for non-owned rows
    // and for everyone when not logged in — frontend hides the chip then.
    const recentPackageIds = recentPackages.map((p: any) => p._id);
    const { courseDaysLeft, packageDaysLeft } = await resolveOwnedEndAt(
      userId,
      courseIds,
      recentPackageIds
    );

    const coursesWithPlans = courses.map((c: any) => ({
      ...c,
      plans: plansByCourse.get(String(c._id)) ?? { withMaterial: [], withoutMaterial: [] },
      daysLeft: courseDaysLeft.has(String(c._id)) ? courseDaysLeft.get(String(c._id)) ?? null : null,
    }));
    const recentlyAddedWithDaysLeft = recentlyAddedData.map((p: any) => ({
      ...p,
      daysLeft: packageDaysLeft.has(String(p._id)) ? packageDaysLeft.get(String(p._id)) ?? null : null,
    }));

    const dashboard: Array<{ title: string; type: string; data: unknown }> = [];

    if (banners.length) dashboard.push({ title: "Banner", type: "banner", data: banners });
    if (examCountdowns.length)
      dashboard.push({ title: "Exam Countdown", type: "exam-countdown", data: examCountdowns });
    if (recentlyAddedWithDaysLeft.length)
      dashboard.push({ title: "Recently Added", type: "package", data: recentlyAddedWithDaysLeft });
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

// GET /api/v1/client/dashboard/resume
//
// Powers the home-screen "Resume" UI: one most-recent live lecture (purple
// card) plus the most-recent package and most-recent recorded course the
// user has touched (My Courses/Subject row). All three derive from
// LectureProgress.lastWatchedAt — the same signal that drives /learning
// progress rollups, so a card here cannot disagree with the rollup the
// frontend gets after the user taps in.
export const getResumeDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getResumeDashboard invoked", { traceId, customerId: userId });

  if (!userId) {
    return res
      .status(200)
      .json({ resumeLecture: null, recentPackage: null, recentCourse: null });
  }

  try {
    const cid = new mongoose.Types.ObjectId(userId);
    const now = new Date();

    // Most-recent row in each scope. Indexes
    // {customerId,liveCourseId|courseId|packageId,lastWatchedAt:-1} make these
    // index-only lookups.
    const [liveRow, courseRow, packageRow] = await Promise.all([
      LectureProgress.findOne({ customerId: cid, liveCourseId: { $ne: null } })
        .sort({ lastWatchedAt: -1 })
        .select("liveCourseId videoId liveSessionId lastWatchedAt")
        .lean<any>(),
      LectureProgress.findOne({ customerId: cid, courseId: { $ne: null } })
        .sort({ lastWatchedAt: -1 })
        .select("courseId videoId lastWatchedAt")
        .lean<any>(),
      LectureProgress.findOne({ customerId: cid, packageId: { $ne: null } })
        .sort({ lastWatchedAt: -1 })
        .select("packageId lastWatchedAt")
        .lean<any>(),
    ]);

    // ---- resumeLecture (purple "Resume Learning" — live course lecture) ----
    let resumeLecture: any = null;
    if (liveRow) {
      if (liveRow.liveSessionId) {
        resumeLecture = await buildResumeNextCard({
          lectureType: "live",
          userId,
          liveSessionId: String(liveRow.liveSessionId),
        });
      } else if (liveRow.videoId) {
        // Live-course recording stored as a Video. Reuse the recorded
        // builder but then re-tag with the live course's identity so the
        // frontend treats it as a live card.
        const card = await buildResumeNextCard({
          lectureType: "recorded",
          userId,
          videoId: String(liveRow.videoId),
        });
        if (card) {
          const lc = await LiveCourse.findOne({
            _id: liveRow.liveCourseId,
            status: true,
          })
            .select("_id name image courseEducatorId")
            .populate({
              path: "courseEducatorId",
              model: CourseEducator,
              select: "name image",
            })
            .lean<any>();
          const lcSub = await LiveCourseSubscription.findOne({
            customerId: cid,
            liveCourseId: liveRow.liveCourseId,
            status: true,
            paymentStatus: "verified",
            endAt: { $gt: now },
          })
            .select("endAt")
            .lean<any>();
          if (lc) {
            resumeLecture = {
              ...card,
              type: "live",
              id: String(lc._id),
              courseId: null,
              liveCourseId: String(lc._id),
              title: lc.name,
              subtitle: lc.courseEducatorId?.name
                ? `By ${lc.courseEducatorId.name}`
                : null,
              educator:
                lc.courseEducatorId && lc.courseEducatorId._id
                  ? {
                      id: String(lc.courseEducatorId._id),
                      name: lc.courseEducatorId.name ?? null,
                      image: lc.courseEducatorId.image ?? null,
                    }
                  : null,
              thumbnail: lc.image ?? null,
              daysLeft: lcSub?.endAt
                ? Math.max(
                    0,
                    Math.ceil(
                      (new Date(lcSub.endAt).getTime() - now.getTime()) / 86_400_000
                    )
                  )
                : null,
              subscriptionEndAt: lcSub?.endAt ?? null,
            };
          }
        }
      }
    }

    // ---- recentCourse (My Courses/Subject — recorded course card) ----
    let recentCourse: any = null;
    if (courseRow?.videoId) {
      recentCourse = await buildResumeNextCard({
        lectureType: "recorded",
        userId,
        videoId: String(courseRow.videoId),
      });
    }

    // ---- recentPackage (My Courses/Subject — package card) ----
    // Mirrors the resume-card shape so the frontend can render one component
    // for all three slots. `lecture` + `resume` are derived from the most
    // recent row inside that package (which may be a recorded video or a
    // live session — either is a valid tap-target into the package).
    let recentPackage: any = null;
    if (packageRow) {
      const pkgId = packageRow.packageId as Types.ObjectId;
      const [pkg, sub, lastRow] = await Promise.all([
        Package.findOne({ _id: pkgId, active: true })
          .select("_id name image")
          .lean<any>(),
        PackageCourseSubscription.findOne({
          customerId: cid,
          targetPackageId: pkgId,
          status: true,
          paymentStatus: "verified",
          $or: [{ endAt: null }, { endAt: { $gt: now } }],
        })
          .select("endAt")
          .lean<any>(),
        LectureProgress.findOne({ customerId: cid, packageId: pkgId })
          .sort({ lastWatchedAt: -1 })
          .select(
            "videoId liveSessionId courseId liveCourseId positionSec durationSec lastWatchedAt"
          )
          .lean<any>(),
      ]);

      if (pkg) {
        // % done across the whole package, mirroring learning rollup logic.
        const [completedCount, totalLecturesRow] = await Promise.all([
          LectureProgress.countDocuments({
            customerId: cid,
            packageId: pkgId,
            completed: true,
          }),
          LectureProgress.aggregate([
            { $match: { customerId: cid, packageId: pkgId } },
            { $count: "total" },
          ]),
        ]);
        const totalTouched = totalLecturesRow[0]?.total ?? 0;
        const pct =
          totalTouched > 0
            ? Math.min(100, Math.round((completedCount / totalTouched) * 100))
            : 0;

        let lecture: any = null;
        if (lastRow?.videoId) {
          const v = await Video.findById(lastRow.videoId)
            .select("title topic videoCategoryId")
            .lean<any>();
          const chapter = v?.videoCategoryId
            ? await VideoCategory.findById(v.videoCategoryId)
                .select("title")
                .lean<any>()
            : null;
          if (v) {
            lecture = {
              _id: String(v._id),
              title: v.title,
              topic: v.topic ?? null,
              videoCategoryId: v.videoCategoryId
                ? String(v.videoCategoryId)
                : null,
              chapterTitle: chapter?.title ?? null,
            };
          }
        } else if (lastRow?.liveSessionId) {
          const s = await LiveSession.findById(lastRow.liveSessionId)
            .select("title subject")
            .lean<any>();
          if (s) {
            lecture = {
              _id: String(s._id),
              title: s.title,
              topic: s.subject ?? null,
              videoCategoryId: null,
              chapterTitle: null,
            };
          }
        }

        recentPackage = {
          type: "package",
          id: String(pkg._id),
          courseId: lastRow?.courseId ? String(lastRow.courseId) : null,
          liveCourseId: lastRow?.liveCourseId
            ? String(lastRow.liveCourseId)
            : null,
          packageId: String(pkg._id),
          title: pkg.name,
          subtitle: null,
          educator: null,
          thumbnail: pkg.image ?? null,
          daysLeft: sub
            ? sub.endAt
              ? Math.max(
                  0,
                  Math.ceil(
                    (new Date(sub.endAt).getTime() - now.getTime()) / 86_400_000
                  )
                )
              : null
            : null,
          subscriptionEndAt: sub?.endAt ?? null,
          percentCompleted: pct,
          completedLectures: completedCount,
          totalLectures: totalTouched,
          lastWatchedAt: lastRow?.lastWatchedAt ?? packageRow.lastWatchedAt,
          lecture,
          resume: {
            videoId: lastRow?.videoId ? String(lastRow.videoId) : null,
            liveSessionId: lastRow?.liveSessionId
              ? String(lastRow.liveSessionId)
              : null,
            positionSec: lastRow?.positionSec ?? 0,
            durationSec: lastRow?.durationSec ?? 0,
          },
        };
      }
    }

    logger.info("getResumeDashboard success", {
      traceId,
      customerId: userId,
      hasLive: !!resumeLecture,
      hasCourse: !!recentCourse,
      hasPackage: !!recentPackage,
    });
    return res
      .status(200)
      .json({ resumeLecture, recentPackage, recentCourse });
  } catch (e: any) {
    logger.error("getResumeDashboard failed", {
      traceId,
      customerId: userId,
      error: getErrorMessage(e),
      stack: e.stack,
    });
    return res.status(500).json({ success: false, message: e.message });
  }
};

const FREE_DASHBOARD_LIMIT = 5;

// GET /api/v1/client/free-dashboard
export const getFreeDashboard = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  const userId = (_req as any).user?.id;
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

    const { packageDaysLeft } = await resolveOwnedEndAt(
      userId,
      [],
      magazinePackages.map((p: any) => p._id)
    );
    const currentAffairsRaw = await Promise.all(magazinePackages.map(buildPackageEntry));
    const currentAffairs = currentAffairsRaw.map((p: any) => ({
      ...p,
      daysLeft: packageDaysLeft.has(String(p._id)) ? packageDaysLeft.get(String(p._id)) ?? null : null,
    }));

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
