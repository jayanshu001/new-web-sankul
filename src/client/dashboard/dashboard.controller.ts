import { Request, Response } from "express";
import * as clientDashSql from "../../modules/client-dashboard/client-dashboard.service";
import * as clientTrendingSql from "../../modules/client-trending/client-trending.service";
import * as lpHubSql from "../../modules/client-lecture-progress/client-lecture-progress.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { pickList } from "../../utils/pick";

// Home dashboard sections the RN app never renders (course → written to
// popularSubjects with zero selectors; courseCategory → zero FE matches).
const DASHBOARD_DROP_SECTIONS = new Set(["course", "courseCategory"]);
// Free dashboard: RN only renders the free-ebook section (trending-book/
// trending-ebook/video are fetched via dedicated APIs).
const FREE_DASHBOARD_KEEP_SECTIONS = new Set(["free-ebook"]);
const FREE_EBOOK_CARD_FIELDS = [
  "_id", "name", "author", "thumbnail", "image", "isPurchased", "daysLeft",
] as const;

// GET /api/v1/client/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getDashboard invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    const uid = Number(userId);
    const cid = Number.isInteger(uid) ? uid : null;
    const { dashboard, testimonial } = await clientDashSql.buildHomeDashboard(cid);
    // Drop sections RN never renders. Top-level todayDate/logo/unreadNotifications
    // are also dropped (typed-only / write-only; badge uses /notifications/count).
    const slimSections = dashboard.filter((s: any) => !DASHBOARD_DROP_SECTIONS.has(s.type));
    logger.info("getDashboard success (sql)", { traceId, customerId: userId, sections: slimSections.length });
    return res.status(200).json({ dashboard: slimSections, testimonial });
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
    // Reuses the LIVE lecture-progress resume hub.
    const sid = clientDashSql.parseCdId(String(userId));
    if (sid == null) return res.status(200).json({ resumeLecture: null, recentPackage: null, recentCourse: null });
    const { resumeLecture, recentCourse, recentPackage } = await lpHubSql.buildResumeDashboard(sid);
    logger.info("getResumeDashboard success (sql)", { traceId, customerId: userId });
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

// GET /api/v1/client/free-dashboard
export const getFreeDashboard = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getFreeDashboard invoked", { traceId, path: _req.originalUrl });

  try {
    const uid = Number(_req.user?.id);
    const cid = Number.isInteger(uid) ? uid : null;
    const dashboard = await clientTrendingSql.buildFreeDashboard(cid);
    // RN renders only the free-ebook section; keep it, slim its cards, and drop
    // the unused top-level todayDate/logo. See docs/api-optimization Phase 2.
    const slimDashboard = dashboard
      .filter((s: any) => FREE_DASHBOARD_KEEP_SECTIONS.has(s.type))
      .map((s: any) => ({ ...s, data: pickList(s.data as any[], FREE_EBOOK_CARD_FIELDS) }));
    logger.info("getFreeDashboard success (sql)", { traceId, sections: slimDashboard.length });
    return res.status(200).json({ dashboard: slimDashboard });
  } catch (e: any) {
    logger.error("getFreeDashboard failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
