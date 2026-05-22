import { Request, Response } from "express";
import mongoose from "mongoose";
import { Notification } from "../../models/system/Notification.model";
import { ImageNotification } from "../../models/system/ImageNotification.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GET /api/v1/client/notifications — feed for current customer (personal + broadcast)
export const listMyNotifications = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMyNotifications invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listMyNotifications unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter = { $or: [{ customerId: userId }, { broadcast: true }] };
    // unreadCount must use the SAME visibility filter as the list — otherwise
    // broadcasts (customerId: null) get excluded and the badge under-reports.
    const unreadFilter = { ...filter, isRead: false };

    const [data, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments(unreadFilter),
    ]);

    logger.info("listMyNotifications success", { traceId, customerId: userId, total, unreadCount });
    return res.status(200).json({
      success: true,
      data,
      unreadCount,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    logger.error("listMyNotifications failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/notifications/:id/read
export const markAsRead = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = req.params.id as string;
  logger.info("markAsRead invoked", { traceId, path: req.originalUrl, customerId: userId, notificationId: id });

  try {
    if (!userId) { logger.warn("markAsRead unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    if (!isObjectId(id)) { logger.warn("markAsRead invalid id", { traceId, customerId: userId, notificationId: id }); return res.status(400).json({ success: false, message: "Invalid id." }); }

    const doc = await Notification.findOneAndUpdate(
      { _id: id, $or: [{ customerId: userId }, { broadcast: true }] },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    );
    if (!doc) { logger.warn("markAsRead not found", { traceId, customerId: userId, notificationId: id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("markAsRead success", { traceId, customerId: userId, notificationId: id });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("markAsRead failed", { traceId, customerId: userId, notificationId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/notifications/read-all
export const markAllAsRead = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("markAllAsRead invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("markAllAsRead unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }
    const result = await Notification.updateMany(
      { customerId: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    logger.info("markAllAsRead success", { traceId, customerId: userId, modified: result.modifiedCount });
    return res.status(200).json({ success: true, message: "All marked as read." });
  } catch (e: any) {
    logger.error("markAllAsRead failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/image-notifications — active in-app banners
export const listActiveImageNotifications = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listActiveImageNotifications invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await ImageNotification.find({ active: true }).sort({ createdAt: -1 }).lean();
    logger.info("listActiveImageNotifications success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listActiveImageNotifications failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
