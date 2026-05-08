import { Request, Response } from "express";
import mongoose from "mongoose";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { Notification } from "../../models/system/Notification.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamType } from "../../models/enums";

// GET /api/v1/client/profile/dashboard
// Aggregator for the My Profile screen — returns just the badge counts the UI needs.
// Each count maps to one row in the design (Saved Addresses, Downloads, My Subscriptions,
// Notifications). Counts are computed in parallel; missing/not-yet-built sources return 0.
export const getProfileDashboardCounts = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const cid = new mongoose.Types.ObjectId(userId);
    const pastDailyExamsAgg = ExamResult.aggregate([
      {
        $match: {
          customerId: cid,
          status: true,
          inProgress: false,
          submittedAt: { $ne: null },
        },
      },
      {
        $lookup: {
          from: "ws_exam",
          localField: "examId",
          foreignField: "_id",
          as: "exam",
        },
      },
      { $unwind: "$exam" },
      { $match: { "exam.type": ExamType.DAILY } },
      { $count: "n" },
    ]);

    const [savedAddresses, packageSubs, ebookSubs, unreadNotifications, pastExamsRows] =
      await Promise.all([
        CustomerAddress.countDocuments({ customerId: userId, status: true }),
        PackageCourseSubscription.countDocuments({
          customerId: userId,
          status: true,
          paymentStatus: "verified",
        }),
        EbookSubscription.countDocuments({ customerId: userId, status: true }),
        Notification.countDocuments({ customerId: userId, isRead: false }),
        pastDailyExamsAgg,
      ]);
    const pastExams = pastExamsRows[0]?.n ?? 0;

    return res.status(200).json({
      success: true,
      data: {
        savedAddresses,
        downloads: 0,
        activePlans: packageSubs + ebookSubs,
        unreadNotifications,
        pastExams,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
