import { Request, Response } from "express";
import mongoose from "mongoose";
import { Notification } from "../../models/system/Notification.model";
import { ImageNotification } from "../../models/system/ImageNotification.model";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GET /api/v1/client/notifications — feed for current customer (personal + broadcast)
export const listMyNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter = { $or: [{ customerId: userId }, { broadcast: true }] };

    const [data, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ customerId: userId, isRead: false }),
    ]);

    return res.status(200).json({
      success: true,
      data,
      unreadCount,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/notifications/:id/read
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });

    const doc = await Notification.findOneAndUpdate(
      { _id: id, $or: [{ customerId: userId }, { broadcast: true }] },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/notifications/read-all
export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
    await Notification.updateMany(
      { customerId: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    return res.status(200).json({ success: true, message: "All marked as read." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/image-notifications — active in-app banners
export const listActiveImageNotifications = async (_req: Request, res: Response) => {
  try {
    const data = await ImageNotification.find({ active: true }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
