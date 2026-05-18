import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { Course } from "../../models/course/Course.model";
import { Customer } from "../../models/customer/Customer.model";

import { buildPromoterOverview } from "./overview.service";

// GET /api/v1/promoter/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const now = new Date();

    const [
      promocodeCount,
      activePromocodeCount,
      subscriptionCount,
      activeSubscriptionCount,
      ebookSubscriptionCount,
      courseRevenueAgg,
      ebookRevenueAgg,
      commissionAgg,
      uniqueCustomers,
      recentSubscriptions,
    ] = await Promise.all([
      PromoCode.countDocuments({ promoterId }),
      PromoCode.countDocuments({
        promoterId,
        status: true,
        promo_expire_at: { $gt: now },
      }),
      PackageCourseSubscription.countDocuments({ promoterId }),
      PackageCourseSubscription.countDocuments({
        promoterId,
        status: true,
        endAt: { $gt: now },
      }),
      EbookSubscription.countDocuments({ promoterId }),
      PackageCourseSubscription.aggregate([
        { $match: { promoterId: mongoose.Types.ObjectId.createFromHexString(promoterId) } },
        { $group: { _id: null, total: { $sum: "$paidAmount" } } },
      ]),
      EbookSubscription.aggregate([
        { $match: { promoterId: mongoose.Types.ObjectId.createFromHexString(promoterId) } },
        { $group: { _id: null, total: { $sum: "$price" } } },
      ]),
      PackageCourseSubscription.aggregate([
        { $match: { promoterId: mongoose.Types.ObjectId.createFromHexString(promoterId) } },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $ifNull: [
                  {
                    $multiply: [
                      { $ifNull: ["$paidAmount", 0] },
                      { $divide: [{ $ifNull: ["$promoterPercentage", 0] }, 100] },
                    ],
                  },
                  0,
                ],
              },
            },
          },
        },
      ]),
      PackageCourseSubscription.distinct("customerId", { promoterId }),
      PackageCourseSubscription.find({ promoterId })
        .populate({ path: "customerId", model: Customer, select: "firstName lastName phoneNumber" })
        .populate({ path: "courseId", model: Course, select: "name" })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          promocodeCount,
          activePromocodeCount,
          subscriptionCount,
          activeSubscriptionCount,
          ebookSubscriptionCount,
          uniqueCustomerCount: uniqueCustomers.length,
          courseRevenue: courseRevenueAgg[0]?.total || 0,
          ebookRevenue: ebookRevenueAgg[0]?.total || 0,
          totalRevenue:
            (courseRevenueAgg[0]?.total || 0) + (ebookRevenueAgg[0]?.total || 0),
          commissionEarned: Math.round(commissionAgg[0]?.total || 0),
        },
        recentSubscriptions,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/dashboard/overview?range=today|week|month|year|all
// The logged-in promoter sees their own data. Admin views the same screen via
// /api/v1/admin/promoters/:id/dashboard.
export const getDashboardOverview = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId)
      return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = await buildPromoterOverview(promoterId, req.query.range as string);
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
