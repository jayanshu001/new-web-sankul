import { Request, Response } from "express";
import { z } from "zod";
import { dispatchAudience } from "./dispatcher";
import { scheduleNotificationJob, cancelNotificationJob } from "./scheduler";
import {
  parseIntId,
  createScheduled as sqlCreateScheduled,
  createImmediateLog as sqlCreateImmediateLog,
  cancelScheduled as sqlCancelScheduled,
  listAdminLog as sqlListAdminLog,
  bulkDelete as sqlBulkDelete,
  deleteOne as sqlDeleteOne,
  listImageNotifications as sqlListImages,
  createImageNotification as sqlCreateImage,
  updateImageNotification as sqlUpdateImage,
  deleteImageNotification as sqlDeleteImage,
} from "../../modules/admin-notification/admin-notification.service";

// Admin-supplied ids are numeric strings on the SQL path.
const isValidId = (v: string) => parseIntId(v) != null;

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

    // Audience ids are numeric strings on the SQL path.
    const idValid = (v: string) => parseIntId(v) != null;

    const userIdsCombined = [
      ...(data.userIds ?? []),
      ...(data.customerIds ?? []),
    ].filter(idValid);

    const audienceFilter = {
      platforms: data.platforms,
      courseIds: data.courseIds?.filter(idValid),
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
      const row = await sqlCreateScheduled({
        broadcast: isAll,
        title: data.title,
        body: data.body,
        image: data.image ?? null,
        type: data.type,
        deepLink: data.deepLink ?? null,
        data: data.data,
        scheduledAt: data.scheduledAt,
        audience: audienceSnapshot,
      });
      const scheduledId = String(row.id);
      await scheduleNotificationJob(scheduledId, data.scheduledAt);
      return res.status(200).json({
        success: true,
        message: "Notification scheduled.",
        data: {
          id: scheduledId,
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
    await sqlCreateImmediateLog({
      broadcast: result.isBroadcast,
      title: data.title,
      body: data.body,
      image: data.image ?? null,
      type: data.type,
      deepLink: data.deepLink ?? null,
      data: data.data,
      status: result.status,
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
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await sqlCancelScheduled(parseIntId(id)!);
    if (!doc)
      return res.status(404).json({
        success: false,
        message: "Scheduled notification not found.",
      });
    await cancelNotificationJob(id);
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

    const { data, total } = await sqlListAdminLog({
      q,
      status,
      sortBy,
      sortOrder: sortOrder === "asc" ? "asc" : "desc",
      skip,
      take: limitNum,
    });
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
    const ids = raw.filter((v) => typeof v === "string" && isValidId(v));
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: "No valid ids provided." });
    }
    const r = await sqlBulkDelete(ids.map((v) => parseIntId(v)!));
    const deletedCount = r.deletedCount;
    await Promise.all(r.scheduledIds.map((sid) => cancelNotificationJob(sid)));
    return res.status(200).json({
      success: true,
      message: "Notifications deleted.",
      data: { deletedCount },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/admin/notifications/:id
export const deleteNotification = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const r = await sqlDeleteOne(parseIntId(id)!);
    if (!r.existed) return res.status(404).json({ success: false, message: "Not found." });
    if (r.wasScheduled) await cancelNotificationJob(id);
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
    return res.status(200).json({ success: true, data: await sqlListImages() });
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
    return res.status(201).json({ success: true, data: await sqlCreateImage(data) });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateImageNotification = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.active === "string") req.body.active = req.body.active === "true";
    const data = imageUpdateSchema.parse(req.body);
    const nid = parseIntId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const updated = await sqlUpdateImage(nid, data);
    if (!updated) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: updated });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteImageNotification = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nid = parseIntId(id);
    if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const ok = await sqlDeleteImage(nid);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
