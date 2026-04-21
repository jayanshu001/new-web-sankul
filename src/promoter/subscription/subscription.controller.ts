import { Request, Response } from "express";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { Customer } from "../../models/customer/Customer.model";
import { Course } from "../../models/course/Course.model";
import { Ebook } from "../../models/ebook/Ebook.model";

// GET /api/v1/promoter/subscriptions — course/package + ebook subscriptions attributed to this promoter
export const listMySubscriptions = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return res.status(401).json({ success: false, message: "Unauthorized." });

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
      return res.status(200).json({
        success: true,
        data,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
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

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/subscriptions/report — aggregate (by course/package/month)
export const subscriptionReport = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const mongoose = await import("mongoose");
    const oid = mongoose.default.Types.ObjectId.createFromHexString(promoterId);

    const [byCourse, byMonth] = await Promise.all([
      PackageCourseSubscription.aggregate([
        { $match: { promoterId: oid } },
        {
          $group: {
            _id: "$courseId",
            count: { $sum: 1 },
            revenue: { $sum: "$paidAmount" },
            commission: {
              $sum: {
                $multiply: [
                  { $ifNull: ["$paidAmount", 0] },
                  { $divide: [{ $ifNull: ["$promoterPercentage", 0] }, 100] },
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
        { $match: { promoterId: oid } },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            },
            count: { $sum: 1 },
            revenue: { $sum: "$paidAmount" },
            commission: {
              $sum: {
                $multiply: [
                  { $ifNull: ["$paidAmount", 0] },
                  { $divide: [{ $ifNull: ["$promoterPercentage", 0] }, 100] },
                ],
              },
            },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 12 },
      ]),
    ]);

    return res.status(200).json({ success: true, data: { byCourse, byMonth } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
