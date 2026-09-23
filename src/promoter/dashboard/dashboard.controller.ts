import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parsePromoterId,
  buildPromoterDashboard,
  buildPromoterOverview as buildPromoterOverviewSql,
} from "../../modules/promoter-data/promoter-data.service";

// GET /api/v1/promoter/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("getDashboard invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("getDashboard unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const pid = parsePromoterId(promoterId);
    if (!pid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const data = await buildPromoterDashboard(pid);
    logger.info("getDashboard success (sql)", { traceId, promoterId, subscriptionCount: data.summary.subscriptionCount });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getDashboard failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/dashboard/overview?range=today|week|month|year|all
// The logged-in promoter sees their own data. Admin views the same screen via
// /api/v1/admin/promoters/:id/dashboard.
export const getDashboardOverview = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("getDashboardOverview invoked", { traceId, path: req.originalUrl, promoterId, range: req.query.range });

  try {
    if (!promoterId) { logger.warn("getDashboardOverview unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { range, startDate, endDate } = req.query as Record<string, string>;

    // promocodeId scope not supported on SQL — see note.
    const pid = parsePromoterId(promoterId);
    if (!pid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const data = await buildPromoterOverviewSql(pid, range, { startDate, endDate });
    logger.info("getDashboardOverview success (sql)", { traceId, promoterId });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getDashboardOverview failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
