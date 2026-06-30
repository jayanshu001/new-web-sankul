import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as eduDashSql from "../../modules/educator-dashboard/educator-dashboard.service";

// GET /api/v1/educator/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  logger.info("getDashboard invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("getDashboard unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    // ─── SQL branch (int id-space) ───
    const eid = eduDashSql.parseEduId(String(educatorId));
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    const data = await eduDashSql.buildEducatorDashboard(eid);
    logger.info("getDashboard success (sql)", { traceId, educatorId });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getDashboard failed", { traceId, educatorId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
