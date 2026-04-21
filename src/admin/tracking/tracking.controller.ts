import { Request, Response } from "express";
import mongoose from "mongoose";
import { ActivityLog } from "../../models/system/ActivityLog.model";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

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

    const filter: any = {};
    if (customerId && isObjectId(customerId)) filter.customerId = customerId;
    if (event) filter.event = event;
    if (entityType) filter.entityType = entityType;
    if (entityId && isObjectId(entityId)) filter.entityId = entityId;
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      ActivityLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
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
    const match: any = {};
    if (fromDate || toDate) {
      match.createdAt = {};
      if (fromDate) match.createdAt.$gte = new Date(fromDate);
      if (toDate) match.createdAt.$lte = new Date(toDate);
    }

    const [byEvent, dailyCount, totalEvents, uniqueUsers] = await Promise.all([
      ActivityLog.aggregate([
        { $match: match },
        { $group: { _id: "$event", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      ActivityLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
        { $limit: 30 },
      ]),
      ActivityLog.countDocuments(match),
      ActivityLog.distinct("customerId", { ...match, customerId: { $ne: null } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalEvents,
        uniqueUsers: uniqueUsers.length,
        byEvent,
        dailyCount,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
