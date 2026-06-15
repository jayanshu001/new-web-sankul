import { Request, Response } from "express";
import mongoose from "mongoose";
import { CustomerAddress } from "../../models/customer/CustomerAddress.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { TestSeriesSubscription } from "../../models/testSeries/TestSeriesSubscription.model";
import { FolderItem } from "../../models/customer/FolderItem.model";
import { Notification } from "../../models/system/Notification.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamType } from "../../models/enums";
import { countActiveEbookDownloads } from "../ebook/ebook-downloads.controller";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// Active-subscription counts that MATCH the My Subscriptions screen exactly
// (GET /client/my-subscriptions). The badge must equal what the user sees when
// they open the screen, so we apply the SAME rules: active-only (status:true +
// endAt > now; course/package additionally require verified payment) AND the
// same per-target dedup (a customer can hold more than one active row per target
// from legacy data or a validity-extend that landed as a new row).
//   - course = combined course + package tab  (deduped by courseId / targetPackageId)
//   - test_series                             (deduped by testSeriesId)
//   - ebook                                   (deduped by ebookId)
// Returns { total, course, test_series, ebook }. Keep this in lockstep with
// my-subscriptions.controller.ts.
async function countActiveSubscriptions(cid: mongoose.Types.ObjectId, now: Date) {
  const [cpRows, tsRows, ebRows] = await Promise.all([
    PackageCourseSubscription.find({
      customerId: cid,
      paymentStatus: "verified",
      status: true,
      endAt: { $gt: now },
    })
      .select("courseId targetPackageId")
      .lean(),
    TestSeriesSubscription.find({
      customerId: cid,
      status: true,
      endAt: { $gt: now },
    })
      .select("testSeriesId")
      .lean(),
    EbookSubscription.find({
      customerId: cid,
      status: true,
      endAt: { $gt: now },
    })
      .select("ebookId")
      .lean(),
  ]);

  const dedupCount = (rows: any[], keyOf: (r: any) => string) => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(keyOf(r));
    return seen.size;
  };

  // Course + package collapse into one "course" bucket, keyed the same way the
  // listing dedups: course subs by courseId, package subs by targetPackageId,
  // falling back to the row id so an untargeted row is never dropped.
  const course = dedupCount(cpRows, (s) =>
    s.courseId
      ? `c:${String(s.courseId)}`
      : s.targetPackageId
      ? `p:${String(s.targetPackageId)}`
      : `s:${String(s._id)}`
  );
  const test_series = dedupCount(tsRows, (s) => `t:${String(s.testSeriesId)}`);
  const ebook = dedupCount(ebRows, (s) => `e:${String(s.ebookId)}`);

  return { total: course + test_series + ebook, course, test_series, ebook };
}

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

    const now = new Date();
    const [
      savedAddresses,
      subscriptions,
      savedMaterials,
      savedVideos,
      activeEbookDownloads,
      unreadNotifications,
      pastExamsRows,
    ] = await Promise.all([
      CustomerAddress.countDocuments({ customerId: userId, status: true }),
      countActiveSubscriptions(cid, now),
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
    // `activePlans` stays as the single headline number (now the correct
    // deduped active total across all three types), with a per-type breakdown
    // alongside so the FE can badge each My Subscriptions tab. `course` is the
    // combined course+package tab, matching the listing endpoint.
    const activePlans = subscriptions.total;

    logger.info("getProfileDashboardCounts success", { traceId, customerId: userId, savedAddresses, downloads, activePlans, subscriptions, unreadNotifications, pastExams });
    return res.status(200).json({
      success: true,
      data: {
        savedAddresses,
        downloads,
        activePlans,
        subscriptionsByType: {
          course: subscriptions.course,
          test_series: subscriptions.test_series,
          ebook: subscriptions.ebook,
        },
        unreadNotifications,
        pastExams,
      },
    });
  } catch (e: any) {
    logger.error("getProfileDashboardCounts failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
