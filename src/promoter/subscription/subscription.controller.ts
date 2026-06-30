import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  parsePromoterId,
  listPromoterSubscriptions,
} from "../../modules/promoter-data/promoter-data.service";
import { promoterDataRepository } from "../../modules/promoter-data/promoter-data.repository";

// GET /api/v1/promoter/subscriptions — course/package + ebook subscriptions attributed to this promoter
export const listMySubscriptions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("listMySubscriptions invoked", { traceId, path: req.originalUrl, promoterId, type: req.query.type });

  try {
    if (!promoterId) { logger.warn("listMySubscriptions unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { type = "course", fromDate, toDate, page = "1", limit = "20" } =
      req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    const pid = parsePromoterId(promoterId);
    if (!pid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const { items, total } = await listPromoterSubscriptions(pid, {
      type: type === "ebook" ? "ebook" : "course",
      from: fromDate ? new Date(fromDate) : undefined,
      to: toDate ? new Date(toDate) : undefined,
      page: pageNum,
      limit: limitNum,
    });
    logger.info("listMySubscriptions success (sql)", { traceId, promoterId, type, total });
    return res.status(200).json({
      success: true,
      data: items,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listMySubscriptions failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/subscriptions/report — aggregate (by course/package/month)
export const subscriptionReport = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("subscriptionReport invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("subscriptionReport unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const pid = parsePromoterId(promoterId);
    if (!pid) return res.status(401).json({ success: false, message: "Unauthorized." });
    const [byCourseRows, byMonthRows] = await Promise.all([
      promoterDataRepository.reportByCourse(pid),
      promoterDataRepository.reportByMonth(pid),
    ]);
    const byCourse = byCourseRows.map((r: any) => ({
      _id: r.courseId ? String(r.courseId) : null,
      course: r.courseId ? { _id: String(r.courseId), name: r.courseName ?? "" } : null,
      count: Number(r.count) || 0,
      revenue: Number(r.revenue) || 0,
      commission: Math.round(Number(r.commission) || 0),
    }));
    const byMonth = byMonthRows.map((r: any) => {
      const [year, month] = String(r.ym).split("-").map(Number);
      return { _id: { year, month }, count: Number(r.count) || 0, revenue: Number(r.revenue) || 0, commission: Math.round(Number(r.commission) || 0) };
    });
    logger.info("subscriptionReport success (sql)", { traceId, promoterId, courseCount: byCourse.length, monthCount: byMonth.length });
    return res.status(200).json({ success: true, data: { byCourse, byMonth } });
  } catch (e: any) {
    logger.error("subscriptionReport failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
