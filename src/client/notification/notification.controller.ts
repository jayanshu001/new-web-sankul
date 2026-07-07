import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import * as notifSql from "../../modules/client-notification/client-notification.service";
import * as adminNotifSql from "../../modules/admin-notification/admin-notification.service";

// GET /api/v1/client/notifications — feed for current customer (personal + broadcast)
export const listMyNotifications = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMyNotifications invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listMyNotifications unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { search, page, limit, skip } = parseListQuery(req.query);

    const cid = notifSql.parseNotifId(String(userId));
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });
    const { data, total, unreadCount } = await notifSql.listNotifications(cid, skip, limit, search);
    return res.status(200).json({ success: true, data, unreadCount, pagination: buildPagination(total, page, limit) });
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

    const cid = notifSql.parseNotifId(String(userId)); const nid = notifSql.parseNotifId(id);
    if (cid == null || nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await notifSql.markRead(cid, nid);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
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

    const cid = notifSql.parseNotifId(String(userId));
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });
    const modified = await notifSql.markAllRead(cid);
    logger.info("markAllAsRead success (sql)", { traceId, customerId: userId, modified });
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
    // No natural text field on banner rows → pagination only (no `search`).
    const { page, limit, skip } = parseListQuery(_req.query);
    const { data, total } = await adminNotifSql.listActiveImageNotifications({ skip, take: limit });
    logger.info("listActiveImageNotifications success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
  } catch (e: any) {
    logger.error("listActiveImageNotifications failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
