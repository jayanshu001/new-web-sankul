import { Request, Response } from "express";
import {
  parseTrackingId,
  listActivity as sqlListActivity, activitySummary as sqlActivitySummary,
} from "../../modules/tracking/tracking.service";

// GET /api/v1/admin/tracking
export const listActivity = async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      event,
      entityType,
      entityId,
      fromDate,
      toDate,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const { data, total } = await sqlListActivity({
      customerId: customerId ? parseTrackingId(customerId) ?? undefined : undefined,
      event: event || undefined,
      entityType: entityType || undefined,
      entityId: entityId ? parseTrackingId(entityId) ?? undefined : undefined,
      from: fromDate ? new Date(fromDate) : undefined,
      to: toDate ? new Date(toDate) : undefined,
      page: pageNum, limit: limitNum,
    });
    return res.status(200).json({
      success: true, data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/tracking/summary
export const activitySummary = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>;
    const data = await sqlActivitySummary({
      from: fromDate ? new Date(fromDate) : undefined,
      to: toDate ? new Date(toDate) : undefined,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
