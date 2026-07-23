import { Request, Response } from "express";
import { countActiveEbookDownloads } from "../ebook/ebook-downloads.controller";
import * as folderSql from "../../modules/client-folder/client-folder.service";
import * as notifSql from "../../modules/client-notification/client-notification.service";
import * as profileSql from "../../modules/customer-profile/profile-dashboard.sql";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// Saved-item counts via the SQL folder module. countActiveEbookDownloads already
// dispatches internally.
const savedCount = (uid: string, kind: "material" | "video") =>
  folderSql.countSavedItems(folderSql.parseFolderId(uid) ?? 0, kind);

const unreadNotifCount = (uid: string) =>
  notifSql.unreadCount(notifSql.parseNotifId(uid) ?? 0);

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

    const now = new Date();
    const uidNum = Number(userId);
    const sqlUid = Number.isInteger(uidNum) ? uidNum : null;

    // userId is the numeric customer id (SQL). If it is not an integer we cannot
    // key the SQL counts, so fall back to empty/zero counts.
    const savedAddressesP =
      sqlUid != null ? profileSql.savedAddressCount(sqlUid) : Promise.resolve(0);
    const subscriptionsP =
      sqlUid != null
        ? profileSql.countActiveSubscriptions(sqlUid, now)
        : Promise.resolve({ total: 0, course: 0, test_series: 0, ebook: 0 });
    const pastExamsP =
      sqlUid != null ? profileSql.pastDailyExamsCount(sqlUid) : Promise.resolve(0);

    const [
      savedAddresses,
      subscriptions,
      savedMaterials,
      savedVideos,
      activeEbookDownloads,
      unreadNotifications,
      pastExams,
    ] = await Promise.all([
      savedAddressesP,
      subscriptionsP,
      savedCount(String(userId), "material"),
      savedCount(String(userId), "video"),
      countActiveEbookDownloads(userId),
      unreadNotifCount(String(userId)),
      pastExamsP,
    ]);
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
        pastExams,
      },
    });
  } catch (e: any) {
    logger.error("getProfileDashboardCounts failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
