// Client dashboard: HTTP handlers for the home, resume and free dashboards.
import { Request, Response } from "express";
import * as clientDashSql from "../../modules/client-dashboard/client-dashboard.service";
import * as clientTrendingSql from "../../modules/client-trending/client-trending.service";
import * as lpHubSql from "../../modules/client-lecture-progress/client-lecture-progress.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { pickList } from "../../utils/pick";

// Home dashboard sections the app never renders.
const DASHBOARD_DROP_SECTIONS = new Set(["course", "courseCategory"]);
// Free dashboard: the app only renders the free-ebook section.
const FREE_DASHBOARD_KEEP_SECTIONS = new Set(["free-ebook"]);
const FREE_EBOOK_CARD_FIELDS = [
  "_id", "name", "author", "thumbnail", "image", "isPurchased", "daysLeft",
] as const;

export const getDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getDashboard invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    const uid = Number(userId);
    const cid = Number.isInteger(uid) ? uid : null;
    const { dashboard, testimonial } = await clientDashSql.buildHomeDashboard(cid);
    // todayDate/logo/unreadNotifications are dropped too (badge uses /notifications/count).
    const slimSections = dashboard.filter((s: any) => !DASHBOARD_DROP_SECTIONS.has(s.type));
    logger.info("getDashboard success", { traceId, customerId: userId, sections: slimSections.length });
    return res.status(200).json({ dashboard: slimSections, testimonial });
  } catch (e: any) {
    logger.error("getDashboard failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// Home "Resume" UI: the most recent package and recorded course the user touched, both
// from LectureProgress.lastWatchedAt (the same signal as /learning rollups, so they agree).
// Live courses are excluded (a live session is not resumable), so `resumeLecture` is always
// null; the key stays for shape compatibility. See buildResumeDashboard.
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
    const sid = clientDashSql.parseCdId(String(userId));
    if (sid == null) return res.status(200).json({ resumeLecture: null, recentPackage: null, recentCourse: null });
    const { resumeLecture, recentCourse, recentPackage } = await lpHubSql.buildResumeDashboard(sid);
    logger.info("getResumeDashboard success", { traceId, customerId: userId });
    return res.status(200).json({ resumeLecture, recentPackage, recentCourse });
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

export const getFreeDashboard = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getFreeDashboard invoked", { traceId, path: _req.originalUrl });

  try {
    const uid = Number(_req.user?.id);
    const cid = Number.isInteger(uid) ? uid : null;
    const dashboard = await clientTrendingSql.buildFreeDashboard(cid);
    const slimDashboard = dashboard
      .filter((s: any) => FREE_DASHBOARD_KEEP_SECTIONS.has(s.type))
      .map((s: any) => ({ ...s, data: pickList(s.data as any[], FREE_EBOOK_CARD_FIELDS) }));
    logger.info("getFreeDashboard success", { traceId, sections: slimDashboard.length });
    return res.status(200).json({ dashboard: slimDashboard });
  } catch (e: any) {
    logger.error("getFreeDashboard failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
