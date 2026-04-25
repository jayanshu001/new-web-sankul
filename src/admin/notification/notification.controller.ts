import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Notification } from "../../models/system/Notification.model";
import { ImageNotification } from "../../models/system/ImageNotification.model";
import { Customer } from "../../models/customer/Customer.model";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// ─── Broadcast / send push ──────────────────────────────────────────────────

const broadcastSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  image: z.string().optional(),
  type: z.string().max(50).optional().default("general"),
  deepLink: z.string().optional(),
  data: z.record(z.any()).optional(),
  customerIds: z.array(z.string()).optional(),
});

// POST /api/v1/admin/notifications/broadcast
// Persists to ws_notifications and fans out Firebase push (placeholder — wire FCM SDK later).
export const broadcastNotification = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = broadcastSchema.parse(req.body);

    let targets: string[] = [];
    let isBroadcast = false;

    if (data.customerIds && data.customerIds.length) {
      targets = data.customerIds.filter(isObjectId);
    } else {
      isBroadcast = true;
    }

    // Persist: one row per recipient OR a single broadcast row.
    if (isBroadcast) {
      await Notification.create({
        customerId: null,
        broadcast: true,
        title: data.title,
        body: data.body,
        image: data.image ?? null,
        type: data.type,
        deepLink: data.deepLink ?? null,
        data: data.data ?? {},
      });
    } else {
      await Notification.insertMany(
        targets.map((id) => ({
          customerId: id,
          broadcast: false,
          title: data.title,
          body: data.body,
          image: data.image ?? null,
          type: data.type,
          deepLink: data.deepLink ?? null,
          data: data.data ?? {},
        }))
      );
    }

    // Fetch FCM tokens to return a count; actual send wires with firebase-admin.
    const tokenQuery: any = {
      firebaseToken: { $nin: [null, ""] },
      isAccountDeleted: false,
      status: true,
    };
    if (!isBroadcast) tokenQuery._id = { $in: targets };
    const recipients = await Customer.find(tokenQuery).select("firebaseToken").lean();
    const tokenCount = recipients.length;

    return res.status(200).json({
      success: true,
      message: "Notification queued.",
      data: {
        broadcast: isBroadcast,
        recipientCount: isBroadcast ? "all" : targets.length,
        fcmTokensAvailable: tokenCount,
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/notifications — recent admin-sent notifications log
export const listNotifications = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Notification.find().sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Notification.countDocuments(),
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

// DELETE /api/v1/admin/notifications/:id
export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await Notification.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Notification deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── ImageNotification CRUD (banners shown inside app) ─────────────────────
const imageCreateSchema = z.object({
  image: z.string().min(1),
  redirectUrl: z.string().optional(),
  active: z.boolean().optional(),
});
const imageUpdateSchema = imageCreateSchema.partial();

export const listImageNotifications = async (_req: Request, res: Response) => {
  try {
    const data = await ImageNotification.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createImageNotification = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.active === "string") req.body.active = req.body.active === "true";
    const data = imageCreateSchema.parse(req.body);
    const doc = await ImageNotification.create(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateImageNotification = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.active === "string") req.body.active = req.body.active === "true";
    const data = imageUpdateSchema.parse(req.body);
    const doc = await ImageNotification.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteImageNotification = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await ImageNotification.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
