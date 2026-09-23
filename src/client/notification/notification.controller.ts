import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { pickList } from "../../utils/pick";
import * as notifSql from "../../modules/client-notification/client-notification.service";

// Mobile feed reads only these row fields; drop customerId/readAt/broadcast/
// status/updatedAt metadata. Envelope unreadCount + pagination kept.
//
// The second line is the TAP-ROUTING set, added 2026-07-28. Tapping a row in the
// in-app Notification screen must land on the same destination as tapping the
// push that created it, and this projection is what previously made that
// impossible: the service DTO has always carried the routing, but this keep-list
// silently dropped `deepLink`/`data`, so the app could only ever open the detail
// modal. Presence is meaningful to the app's router (first match wins), and
// `pick` skips keys the row does not have — so an announcement with no
// destination still ships zero routing keys rather than a row of nulls.
//
// The raw `data` blob stays OUT: its values are FCM-stringified (`params` as a
// JSON string, ids as numeric strings). The flattened fields below are the same
// information in real JSON types, and exposing both would invite the app to read
// whichever it found first and disagree with the push.
const NOTIFICATION_CLIENT_FIELDS = [
  "_id", "title", "titleHtml", "body", "bodyHtml", "image", "type", "isRead", "createdAt",
  "viewType", "deepLink", "clickAction", "screen", "params", "liveCourseId", "sessionId", "streamId",
] as const;

// Routing keys only. Display fields keep their explicit `null`s — the app already
// renders those and flipping them to "absent" would be a breaking change.
const ROUTING_KEYS = [
  "viewType", "deepLink", "clickAction", "screen", "params", "liveCourseId", "sessionId", "streamId",
] as const;

/**
 * Drop routing keys that came through nullish.
 *
 * The service DTO sets `deepLink: n.deepLink ?? null` unconditionally, so a
 * notification with no destination would otherwise ship `"deepLink": null`.
 * The app's tap router is presence-based, and the FE contract is explicit:
 * "Omit a field when unused; do not invent placeholders."
 */
const dropEmptyRouting = <T extends Record<string, any>>(row: T): T => {
  for (const k of ROUTING_KEYS) {
    if (row[k] === null || row[k] === undefined) delete row[k];
  }
  return row;
};
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
    const items = pickList(data, NOTIFICATION_CLIENT_FIELDS).map(dropEmptyRouting);
    return res.status(200).json({ success: true, data: items, unreadCount, pagination: buildPagination(total, page, limit) });
  } catch (e: any) {
    logger.error("listMyNotifications failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/notifications/count — lightweight unread badge count.
// Purpose-built so the client can refresh the bell badge WITHOUT re-fetching the
// full paginated feed. Stays in sync with every action: it counts only visible,
// unread, NOT-dismissed notifications, so mark-read / mark-all / delete all move it.
export const getUnreadCount = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getUnreadCount invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("getUnreadCount unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const cid = notifSql.parseNotifId(String(userId));
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });
    const unreadCount = await notifSql.unreadCount(cid);
    return res.status(200).json({ success: true, unreadCount });
  } catch (e: any) {
    logger.error("getUnreadCount failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
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

// POST /api/v1/client/notifications/delete — one endpoint for single / multi / all.
//   Body { all: true }        → dismiss the entire visible feed.
//   Body { ids: number[] }    → dismiss those ids (single = a one-element array).
export const deleteNotifications = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("deleteNotifications invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("deleteNotifications unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const cid = notifSql.parseNotifId(String(userId));
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid customer." });

    if (req.body?.all === true) {
      const deleted = await notifSql.deleteAll(cid);
      logger.info("deleteNotifications success (all)", { traceId, customerId: userId, deleted });
      return res.status(200).json({ success: true, deleted, message: "Notifications deleted." });
    }

    const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!raw || raw.length === 0) return res.status(400).json({ success: false, message: "Provide `ids` (non-empty array) or `all: true`." });
    const ids = raw.map((x: any) => notifSql.parseNotifId(String(x))).filter((n: number | null): n is number => n != null);
    if (ids.length === 0) return res.status(400).json({ success: false, message: "No valid ids." });

    const deleted = await notifSql.deleteMany(cid, ids);
    logger.info("deleteNotifications success (ids)", { traceId, customerId: userId, requested: ids.length, deleted });
    return res.status(200).json({ success: true, deleted, message: "Notifications deleted." });
  } catch (e: any) {
    logger.error("deleteNotifications failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
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
