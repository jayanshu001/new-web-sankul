import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

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

// Ids the customer has dismissed ("deleted from my feed"). Excluded from the feed
// list + unread badge. Broadcasts are shared rows, so deletion is per-customer here
// rather than a hard delete of the source notification.
const dismissedIdsFor = async (customerId: number): Promise<number[]> => {
  const rows = await prisma.notificationDismissal.findMany({
    where: { customerId },
    select: { notificationId: true },
  });
  return rows.map((r) => r.notificationId);
};

const dto = (n: any) => ({
  _id: String(n.id), customerId: n.customerId != null ? String(n.customerId) : null,
  title: n.title, titleHtml: n.titleHtml ?? null, body: n.body, bodyHtml: n.bodyHtml ?? null,
  image: n.image ?? null, type: n.type, deepLink: n.deepLink ?? null,
  data: n.data ?? {}, isRead: n.isRead, readAt: n.readAt ?? null, broadcast: n.broadcast,
  status: n.status, createdAt: n.createdAt ?? null, updatedAt: n.updatedAt ?? null,
});

export const listNotifications = async (
  customerId: number,
  skip: number,
  take: number,
  search?: string
) => {
  const dismissed = await dismissedIdsFor(customerId);
  // Dismissed ("deleted") notifications drop out of the feed, its total, AND the
  // unread badge — a deleted item must not keep the badge lit.
  const notDismissed = dismissed.length ? { id: { notIn: dismissed } } : {};
  const base = { AND: [visWhere(customerId), notDismissed] };
  // `search` narrows the paginated list + its total by title/body; the unread
  // badge stays over the FULL visible set (base) so it remains a true count.
  const searchFilter = buildPrismaSearch(search, ["title", "body"]);
  const where: any = searchFilter
    ? { AND: [...base.AND, ...searchFilter.AND] }
    : base;
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { AND: [...base.AND, { isRead: false }] } }),
  ]);
  return { data: rows.map(dto), total, unreadCount: unread };
};

export const unreadCount = async (customerId: number): Promise<number> => {
  const dismissed = await dismissedIdsFor(customerId);
  const notDismissed = dismissed.length ? { id: { notIn: dismissed } } : {};
  return prisma.notification.count({ where: { AND: [visWhere(customerId), notDismissed, { isRead: false }] } });
};

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

// ── Delete ("dismiss from my feed") ────────────────────────────────────────────
// A delete never touches ws_notification; it records a per-customer dismissal so
// broadcast rows survive for other recipients. Idempotent (skipDuplicates / upsert).

// Multi (also serves single = a one-element array). Only ids visible to the customer
// are dismissed; returns rows newly inserted.
export const deleteMany = async (customerId: number, ids: number[]): Promise<number> => {
  const visible = await prisma.notification.findMany({
    where: { id: { in: ids }, OR: [{ customerId }, { broadcast: true }] },
    select: { id: true },
  });
  if (!visible.length) return 0;
  const now = new Date();
  const r = await prisma.notificationDismissal.createMany({
    data: visible.map((v) => ({ customerId, notificationId: v.id, createdAt: now })),
    skipDuplicates: true,
  });
  return r.count;
};

// All currently-visible, not-yet-dismissed notifications for the customer.
export const deleteAll = async (customerId: number): Promise<number> => {
  const dismissed = new Set(await dismissedIdsFor(customerId));
  const rows = await prisma.notification.findMany({ where: visWhere(customerId), select: { id: true } });
  const toInsert = rows.map((r) => r.id).filter((id) => !dismissed.has(id));
  if (!toInsert.length) return 0;
  const now = new Date();
  const r = await prisma.notificationDismissal.createMany({
    data: toInsert.map((id) => ({ customerId, notificationId: id, createdAt: now })),
    skipDuplicates: true,
  });
  return r.count;
};
