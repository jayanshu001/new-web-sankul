import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Notification } from "../../models/system/Notification.model";
import { ImageNotification } from "../../models/system/ImageNotification.model";
import { dispatchAudience } from "./dispatcher";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// ─── Broadcast / send push ──────────────────────────────────────────────────

const broadcastSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  image: z.string().optional(),
  type: z.string().max(50).optional().default("general"),
  deepLink: z.string().optional(),
  data: z.record(z.any()).optional(),
  platforms: z.array(z.enum(["ios", "android"])).optional(),
  courseIds: z.array(z.string()).optional(),
  userIds: z.array(z.string()).optional(),
  customerIds: z.array(z.string()).optional(),
  scheduledAt: z.coerce.date().optional(),
});

// POST /api/v1/admin/notifications/broadcast
// Persists to ws_notifications and fans out via FCM synchronously.
export const broadcastNotification = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = broadcastSchema.parse(req.body);

    const userIdsCombined = [
      ...(data.userIds ?? []),
      ...(data.customerIds ?? []),
    ].filter(isObjectId);

    const audienceFilter = {
      platforms: data.platforms,
      courseIds: data.courseIds?.filter(isObjectId),
      userIds: userIdsCombined.length ? userIdsCombined : undefined,
    };

    const isAll =
      !audienceFilter.platforms?.length &&
      !audienceFilter.courseIds?.length &&
      !audienceFilter.userIds?.length;

    const audienceSnapshot = isAll
      ? { all: true }
      : {
          all: false,
          platforms: audienceFilter.platforms,
          courseIds: audienceFilter.courseIds,
          userIds: audienceFilter.userIds,
        };

    // ─── Scheduled path ───────────────────────────────────────────────────
    if (data.scheduledAt) {
      if (data.scheduledAt.getTime() <= Date.now()) {
        return res.status(400).json({
          success: false,
          message: "scheduledAt must be in the future.",
        });
      }
      const doc = await Notification.create({
        customerId: null,
        broadcast: isAll,
        title: data.title,
        body: data.body,
        image: data.image ?? null,
        type: data.type,
        deepLink: data.deepLink ?? null,
        data: data.data ?? {},
        status: "scheduled",
        scheduledAt: data.scheduledAt,
        audience: audienceSnapshot,
      });
      return res.status(200).json({
        success: true,
        message: "Notification scheduled.",
        data: {
          id: doc._id,
          status: "scheduled",
          scheduledAt: data.scheduledAt,
          audience: audienceSnapshot,
        },
      });
    }

    // ─── Immediate send ───────────────────────────────────────────────────
    const result = await dispatchAudience(
      {
        title: data.title,
        body: data.body,
        image: data.image,
        type: data.type,
        deepLink: data.deepLink,
        data: data.data,
      },
      audienceFilter
    );

    // For broadcast, persist a single row; for targeted, the dispatcher
    // already fanned out per-recipient rows — store an admin-log parent row.
    await Notification.create({
      customerId: null,
      broadcast: result.isBroadcast,
      title: data.title,
      body: data.body,
      image: data.image ?? null,
      type: data.type,
      deepLink: data.deepLink ?? null,
      data: data.data ?? {},
      status: result.status,
      sentAt: new Date(),
      failureReason: result.failureReason,
      recipientCount: result.recipientCount,
      audience: audienceSnapshot,
    });

    return res.status(200).json({
      success: true,
      message: result.status === "sent" ? "Notification sent." : "Notification failed.",
      data: {
        broadcast: result.isBroadcast,
        targetCount: result.isBroadcast ? "all" : result.targetCustomerIds.length,
        successCount: result.recipientCount,
        failureCount: result.failureCount,
        invalidTokensPruned: result.invalidTokensPruned,
        status: result.status,
      },
    });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/admin/notifications/:id/cancel
export const cancelScheduledNotification = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await Notification.findOneAndUpdate(
      { _id: id, status: "scheduled" },
      { $set: { status: "cancelled" } },
      { new: true }
    );
    if (!doc)
      return res.status(404).json({
        success: false,
        message: "Scheduled notification not found.",
      });
    return res.status(200).json({ success: true, message: "Notification cancelled.", data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/notifications — admin-sent notifications log
// Query: ?q=&status=&sortBy=&sortOrder=&page=&limit=
export const listNotifications = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "10",
      q,
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // Admin log shows the parent rows only (customerId: null), not per-recipient fan-out.
    const filter: Record<string, unknown> = { customerId: null };

    if (q && q.trim()) {
      const safe = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: safe, $options: "i" } },
        { body: { $regex: safe, $options: "i" } },
      ];
    }

    if (status && ["sent", "scheduled", "failed", "cancelled"].includes(status)) {
      filter.status = status;
    }

    const allowedSort = new Set(["createdAt", "scheduledAt", "sentAt", "status", "title"]);
    const sortField = allowedSort.has(sortBy) ? sortBy : "createdAt";
    const sortDir: 1 | -1 = sortOrder === "asc" ? 1 : -1;

    const [data, total] = await Promise.all([
      Notification.find(filter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/admin/notifications/bulk-delete
// Body: { ids: string[] }
export const bulkDeleteNotifications = async (req: Request, res: Response) => {
  try {
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ success: false, message: "ids array is required." });
    }
    const ids = raw.filter((v) => typeof v === "string" && isObjectId(v));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "No valid ids provided." });
    }
    const result = await Notification.deleteMany({ _id: { $in: ids } });
    return res.status(200).json({
      success: true,
      message: "Notifications deleted.",
      data: { deletedCount: result.deletedCount },
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
