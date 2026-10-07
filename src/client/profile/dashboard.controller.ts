// Client profile dashboard: badge counts for the My Profile screen.
import { Request, Response } from "express";
import { countActiveEbookDownloads } from "../ebook/ebook-downloads.controller";
import * as folderSql from "../../modules/client-folder/client-folder.service";
import * as notifSql from "../../modules/client-notification/client-notification.service";
import * as profileSql from "../../modules/customer-profile/profile-dashboard.sql";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const savedCount = (uid: string, kind: "material" | "video") =>
  folderSql.countSavedItems(folderSql.parseFolderId(uid) ?? 0, kind);

const unreadNotifCount = (uid: string) =>
  notifSql.unreadCount(notifSql.parseNotifId(uid) ?? 0);

// Badge counts for the My Profile screen; a missing source counts as 0.
export const getProfileDashboardCounts = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getProfileDashboardCounts invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("getProfileDashboardCounts unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const now = new Date();
    const uidNum = Number(userId);
    const sqlUid = Number.isInteger(uidNum) ? uidNum : null;

    // A non-integer userId cannot key the counts, so they fall back to zero.
    const savedAddressesP =
      sqlUid != null ? profileSql.savedAddressCount(sqlUid) : Promise.resolve(0);
    const subscriptionsP =
      sqlUid != null
        ? profileSql.countActiveSubscriptions(sqlUid, now)
        : Promise.resolve({ total: 0, course: 0, test_series: 0, ebook: 0 });
    const pastExamsP =
      sqlUid != null ? profileSql.pastExamsCount(sqlUid) : Promise.resolve(0);

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
    // `activePlans` is the deduped total across all types; the per-type breakdown
    // badges each My Subscriptions tab (`course` = course + package, as in the listing).
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
