import { Request, Response } from "express";
import mongoose from "mongoose";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { FolderItem } from "../../models/customer/FolderItem.model";
import { Notification } from "../../models/system/Notification.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamType } from "../../models/enums";
import { countActiveEbookDownloads } from "../ebook/ebook-downloads.controller";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// GET /api/v1/client/profile/dashboard
// Aggregator for the My Profile screen — returns just the badge counts the UI needs.
// Each count maps to one row in the design (Saved Addresses, Downloads, My Subscriptions,
// Notifications). Counts are computed in parallel; missing/not-yet-built sources return 0.
export const getProfileDashboardCounts = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getProfileDashboardCounts invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("getProfileDashboardCounts unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

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

    const [
      savedAddresses,
      activePlans,
      savedMaterials,
      savedVideos,
      activeEbookDownloads,
      unreadNotifications,
      pastExamsRows,
    ] = await Promise.all([
      CustomerAddress.countDocuments({ customerId: userId, status: true }),
      PackageCourseSubscription.countDocuments({
        customerId: userId,
        status: true,
        paymentStatus: "verified",
      }),
      FolderItem.aggregate([
        { $match: { customerId: cid, kind: "material" } },
        { $lookup: { from: "ws_materials", localField: "refId", foreignField: "_id", as: "ref" } },
        { $unwind: "$ref" },
        { $count: "n" },
      ]).then((r) => r[0]?.n ?? 0),
      FolderItem.aggregate([
        { $match: { customerId: cid, kind: "video" } },
        { $lookup: { from: "ws_videos", localField: "refId", foreignField: "_id", as: "ref" } },
        { $unwind: "$ref" },
        { $count: "n" },
      ]).then((r) => r[0]?.n ?? 0),
      countActiveEbookDownloads(userId),
      Notification.countDocuments({
        $or: [{ customerId: userId }, { broadcast: true }],
        isRead: false,
      }),
      pastDailyExamsAgg,
    ]);
    const pastExams = pastExamsRows[0]?.n ?? 0;
    const downloads = savedMaterials + savedVideos + activeEbookDownloads;

    logger.info("getProfileDashboardCounts success", { traceId, customerId: userId, savedAddresses, downloads, activePlans, unreadNotifications, pastExams });
    return res.status(200).json({
      success: true,
      data: {
        savedAddresses,
        downloads,
        activePlans,
        unreadNotifications,
        pastExams,
      },
    });
  } catch (e: any) {
    logger.error("getProfileDashboardCounts failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
