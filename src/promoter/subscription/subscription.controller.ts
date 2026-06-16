import { Request, Response } from "express";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { TestSeriesSubscription } from "../../models/testSeries/TestSeriesSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { Customer } from "../../models/customer/Customer.model";
import { Course } from "../../models/course/Course.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { TestSeries } from "../../models/testSeries/TestSeries.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { unionAllPromoterSubsStages, promoterScopeMatch } from "../shared/promoterSubscriptions";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// GET /api/v1/promoter/subscriptions — course/package + ebook subscriptions attributed to this promoter
export const listMySubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("listMySubscriptions invoked", { traceId, path: req.originalUrl, promoterId, type: req.query.type });

  try {
    if (!promoterId) { logger.warn("listMySubscriptions unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { type = "course", fromDate, toDate, page = "1", limit = "20" } =
      req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const dateFilter: any = {};
    if (fromDate || toDate) {
      dateFilter.createdAt = {};
      if (fromDate) dateFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) dateFilter.createdAt.$lte = new Date(toDate);
    }

    const paginate = (total: number) => ({
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });

    if (type === "ebook") {
      const filter = { promoterId, ...dateFilter };
      const [data, total] = await Promise.all([
        EbookSubscription.find(filter)
          .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
          .populate({ path: "ebookId", model: Ebook, select: "name author" })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        EbookSubscription.countDocuments(filter),
      ]);
      logger.info("listMySubscriptions success (ebook)", { traceId, promoterId, total });
      return res.status(200).json({ success: true, data, pagination: paginate(total) });
    }

    if (type === "testSeries") {
      const filter = { promoterId, ...dateFilter };
      const [data, total] = await Promise.all([
        TestSeriesSubscription.find(filter)
          .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
          .populate({ path: "testSeriesId", model: TestSeries, select: "title" })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        TestSeriesSubscription.countDocuments(filter),
      ]);
      logger.info("listMySubscriptions success (testSeries)", { traceId, promoterId, total });
      return res.status(200).json({ success: true, data, pagination: paginate(total) });
    }

    if (type === "liveCourse") {
      const filter = { promoterId, ...dateFilter };
      const [data, total] = await Promise.all([
        LiveCourseSubscription.find(filter)
          .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
          .populate({ path: "liveCourseId", model: LiveCourse, select: "name" })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        LiveCourseSubscription.countDocuments(filter),
      ]);
      logger.info("listMySubscriptions success (liveCourse)", { traceId, promoterId, total });
      return res.status(200).json({ success: true, data, pagination: paginate(total) });
    }

    const filter = { promoterId, ...dateFilter };
    const [data, total] = await Promise.all([
      PackageCourseSubscription.find(filter)
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .populate({ path: "courseId", model: Course, select: "name" })
        .populate({ path: "packageId", model: "PackageCourseEbookPrice" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PackageCourseSubscription.countDocuments(filter),
    ]);

    logger.info("listMySubscriptions success (course)", { traceId, promoterId, total });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listMySubscriptions failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/subscriptions/report — aggregate (by course/package/month)
export const subscriptionReport = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("subscriptionReport invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("subscriptionReport unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const scope = promoterScopeMatch(promoterId);

    // byCourse stays course/package-only (it groups by courseId, which has no
    // analogue for the other product types). byMonth and byType now span ALL 4
    // collections so revenue/commission totals reconcile with the dashboard.
    const [byCourse, byMonth, byType] = await Promise.all([
      PackageCourseSubscription.aggregate([
        { $match: scope },
        {
          $group: {
            _id: "$courseId",
            count: { $sum: 1 },
            revenue: { $sum: "$paidAmount" },
            commission: {
              $sum: {
                $ifNull: [
                  "$promoterCommission",
                  {
                    $multiply: [
                      { $ifNull: ["$paidAmount", 0] },
                      { $divide: [{ $ifNull: ["$promoterPercentage", 0] }, 100] },
                    ],
                  },
                ],
              },
            },
          },
        },
        {
          $lookup: {
            from: "ws_courses",
            localField: "_id",
            foreignField: "_id",
            as: "course",
          },
        },
        { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
        { $sort: { count: -1 } },
      ]),
      PackageCourseSubscription.aggregate([
        ...unionAllPromoterSubsStages(scope),
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
            revenue: { $sum: "$amount" },
            commission: { $sum: "$commission" },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 12 },
      ]),
      PackageCourseSubscription.aggregate([
        ...unionAllPromoterSubsStages(scope),
        {
          $group: {
            _id: "$productType",
            count: { $sum: 1 },
            revenue: { $sum: "$amount" },
            commission: { $sum: "$commission" },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ]);

    logger.info("subscriptionReport success", { traceId, promoterId, courseCount: byCourse.length, monthCount: byMonth.length });
    return res.status(200).json({ success: true, data: { byCourse, byMonth, byType } });
  } catch (e: any) {
    logger.error("subscriptionReport failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
