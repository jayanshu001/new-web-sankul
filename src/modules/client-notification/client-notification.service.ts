import { prisma } from "../../config/prisma";

/**
 * Client-facing notification reads on SQL (Wave 7 — net-new ws_notification).
 * Visibility filter: (customer_id = me OR broadcast = true). Unread badge uses
 * the SAME filter (so broadcasts aren't excluded). customer is the SQL int at
 * runtime (customer-auth).
 *
 * ⚠ FLAG-OFF (code-complete, not enabled): the notification WRITE path is a Mongo
 * subsystem — admin dispatcher + scheduler (BullMQ job keyed by the Mongo _id) +
 * FCM push fan-out + per-recipient insertMany keyed by Mongo Customer ObjectIds
 * (resolveAudience). Flipping client reads to SQL while that write path stays Mongo
 * = stale feed. Enable only once the admin notification write subsystem
 * (dispatcher/scheduler/audience) is migrated to SQL Customer ids. Reads + the
 * read-state writes (markRead/markAll) here are correct + verifiable in isolation.
 */
export const NOTIFICATION_MODULE = "client-notification";
export const isNotificationMysql = (): boolean => true;

export const parseNotifId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const visWhere = (customerId: number) => ({ OR: [{ customerId }, { broadcast: true }] });

const dto = (n: any) => ({
  _id: String(n.id), customerId: n.customerId != null ? String(n.customerId) : null,
  title: n.title, body: n.body, image: n.image ?? null, type: n.type, deepLink: n.deepLink ?? null,
  data: n.data ?? {}, isRead: n.isRead, readAt: n.readAt ?? null, broadcast: n.broadcast,
  status: n.status, createdAt: n.createdAt ?? null, updatedAt: n.updatedAt ?? null,
});

export const listNotifications = async (customerId: number, skip: number, take: number) => {
  const where = visWhere(customerId);
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, isRead: false } }),
  ]);
  return { data: rows.map(dto), total, unreadCount: unread };
};

export const unreadCount = (customerId: number): Promise<number> =>
  prisma.notification.count({ where: { ...visWhere(customerId), isRead: false } });

export const markRead = async (customerId: number, id: number): Promise<any | null> => {
  // visibility: own row or a broadcast
  const n = await prisma.notification.findFirst({ where: { id, OR: [{ customerId }, { broadcast: true }] } });
  if (!n) return null;
  const updated = await prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
  return dto(updated);
};

export const markAllRead = async (customerId: number): Promise<number> => {
  const r = await prisma.notification.updateMany({ where: { customerId, isRead: false }, data: { isRead: true, readAt: new Date() } });
  return r.count;
};
