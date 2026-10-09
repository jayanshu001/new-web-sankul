// Client notifications: feed, unread badge, mark-read and dismiss logic.
import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { extractNotificationRouting } from "../../utils/notificationTarget";
import { parsePositiveInt } from "../../utils/parseId";
import type { Prisma } from "@prisma/client";

/** The unread badge uses the same visibility filter as the feed, so broadcasts are counted. */

export const parseNotifId = parsePositiveInt;

/**
 * `signupAt` bounds the broadcast feed and `readBefore` is the read watermark. A missing
 * customer row yields nulls, which degrade to a permissive feed rather than an empty one.
 */
const contextFor = async (customerId: number) => {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { createdAt: true, notificationsReadBefore: true },
  });
  return { signupAt: c?.createdAt ?? null, readBefore: c?.notificationsReadBefore ?? null };
};

/**
 * Own notifications, plus broadcasts sent at or after signup (so a new or re-registered
 * account doesn't inherit the entire broadcast history). `signupAt` null → no bound: losing
 * a whole feed is worse than showing a little extra.
 *
 * Only "sent" rows are visible: "scheduled" rows exist from schedule-create time (so the
 * BullMQ job can be rehydrated on boot) and must not appear before their send time.
 * The cutoff uses `sentAt`, not `createdAt` (composition time, which can predate signup);
 * every "sent" row has `sentAt`.
 */
const visWhere = (customerId: number, signupAt: Date | null) => ({
  status: "sent",
  OR: [
    { customerId },
    signupAt
      ? { broadcast: true, sentAt: { gte: signupAt } }
      : { broadcast: true },
  ],
});

/**
 * Read state is per-customer, never ws_notification.is_read: that column is on the shared
 * broadcast row, so writing it would mark a broadcast read for every customer.
 */
const readIdsFor = async (customerId: number): Promise<Set<number>> => {
  const rows = await prisma.notificationRead.findMany({
    where: { customerId },
    select: { notificationId: true },
  });
  return new Set(rows.map((r) => r.notificationId));
};

/** Read = an explicit mark, or sent at/before the mark-all watermark (`sentAt`, as above). */
const isReadFor = (
  n: { id: number; sentAt: Date | null },
  readIds: Set<number>,
  readBefore: Date | null
): boolean =>
  readIds.has(n.id) || (!!readBefore && !!n.sentAt && n.sentAt <= readBefore);

const unreadWhere = (readIds: Set<number>, readBefore: Date | null) => {
  const clauses: any[] = [];
  if (readBefore) clauses.push({ OR: [{ sentAt: null }, { sentAt: { gt: readBefore } }] });
  if (readIds.size) clauses.push({ id: { notIn: [...readIds] } });
  return clauses;
};

// Broadcasts are shared rows, so "delete" is a per-customer dismissal, excluded from feed + badge.
const dismissedIdsFor = async (customerId: number): Promise<number[]> => {
  const rows = await prisma.notificationDismissal.findMany({
    where: { customerId },
    select: { notificationId: true },
  });
  return rows.map((r) => r.notificationId);
};

// Routing fields are spread in last and only when present: the app's tap router checks
// presence, so a `null` placeholder would read as "this has a destination". The spread
// `deepLink` deliberately overrides the explicit one (it falls back to data.deepLink).
// `isRead`/`readAt` come from the caller (per-customer), never the shared row.
// `createdAt` on the wire is `sentAt` (fallback `createdAt` for legacy rows): a scheduled
// row's created_at is composition time, hours before it actually went out.
const dto = (n: any, read: { isRead: boolean; readAt: Date | null } = { isRead: false, readAt: null }) => ({
  _id: String(n.id), customerId: n.customerId != null ? String(n.customerId) : null,
  title: n.title, titleHtml: n.titleHtml ?? null, body: n.body, bodyHtml: n.bodyHtml ?? null,
  image: n.image ?? null, type: n.type, deepLink: n.deepLink ?? null,
  data: n.data ?? {}, isRead: read.isRead, readAt: read.readAt, broadcast: n.broadcast,
  status: n.status, createdAt: n.sentAt ?? n.createdAt ?? null, updatedAt: n.updatedAt ?? null,
  ...extractNotificationRouting({ deepLink: n.deepLink, data: n.data }),
});

export const listNotifications = async (
  customerId: number,
  skip: number,
  take: number,
  search?: string
) => {
  const [dismissed, readIds, ctx] = await Promise.all([
    dismissedIdsFor(customerId),
    readIdsFor(customerId),
    contextFor(customerId),
  ]);
  // Dismissed rows drop out of the feed, its total, and the unread badge.
  const notDismissed = dismissed.length ? { id: { notIn: dismissed } } : {};
  const base = { AND: [visWhere(customerId, ctx.signupAt), notDismissed] };
  // `search` narrows the list + total only; the unread badge stays over the full visible set.
  const searchFilter = buildPrismaSearch(search, ["title", "body"]);
  const where: Prisma.NotificationWhereInput = searchFilter
    ? { AND: [...base.AND, ...searchFilter.AND] }
    : base;
  const [rows, total, unread] = await Promise.all([
    // sentAt, not createdAt (see dto()); createdAt breaks ties for legacy rows.
    prisma.notification.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { AND: [...base.AND, ...unreadWhere(readIds, ctx.readBefore)] },
    }),
  ]);
  const readRows = await prisma.notificationRead.findMany({
    where: { customerId, notificationId: { in: rows.map((r) => r.id) } },
    select: { notificationId: true, readAt: true },
  });
  const readAtById = new Map(readRows.map((r) => [r.notificationId, r.readAt ?? null]));
  return {
    data: rows.map((n) =>
      dto(n, {
        isRead: isReadFor(n, readIds, ctx.readBefore),
        // A watermark-covered row has no exact readAt; the watermark is the best answer.
        readAt: readAtById.get(n.id) ?? (isReadFor(n, readIds, ctx.readBefore) ? ctx.readBefore : null),
      })
    ),
    total,
    unreadCount: unread,
  };
};

export const unreadCount = async (customerId: number): Promise<number> => {
  const [dismissed, readIds, ctx] = await Promise.all([
    dismissedIdsFor(customerId),
    readIdsFor(customerId),
    contextFor(customerId),
  ]);
  const notDismissed = dismissed.length ? { id: { notIn: dismissed } } : {};
  return prisma.notification.count({
    where: {
      AND: [visWhere(customerId, ctx.signupAt), notDismissed, ...unreadWhere(readIds, ctx.readBefore)],
    },
  });
};

/**
 * Writes a per-customer row, never UPDATEs ws_notification (a broadcast would be marked read
 * for every customer). Idempotent via the (customer_id, notification_id) unique key.
 */
export const markRead = async (customerId: number, id: number): Promise<any | null> => {
  const ctx = await contextFor(customerId);
  const n = await prisma.notification.findFirst({ where: { AND: [{ id }, visWhere(customerId, ctx.signupAt)] } });
  if (!n) return null;
  const readAt = new Date();
  await prisma.notificationRead.upsert({
    where: { uniq_notif_read: { customerId, notificationId: id } },
    create: { customerId, notificationId: id, readAt },
    update: {},
  });
  return dto(n, { isRead: true, readAt });
};

/**
 * Moves the watermark to now (O(1) whatever the feed size). Per-row marks at or before it
 * are pruned, which keeps ws_notification_read bounded. Returns how many were cleared.
 */
export const markAllRead = async (customerId: number): Promise<number> => {
  const [dismissed, readIds, ctx] = await Promise.all([
    dismissedIdsFor(customerId),
    readIdsFor(customerId),
    contextFor(customerId),
  ]);
  const notDismissed = dismissed.length ? { id: { notIn: dismissed } } : {};
  const cleared = await prisma.notification.count({
    where: {
      AND: [visWhere(customerId, ctx.signupAt), notDismissed, ...unreadWhere(readIds, ctx.readBefore)],
    },
  });
  const now = new Date();
  await prisma.customer.update({
    where: { id: customerId },
    data: { notificationsReadBefore: now },
  });
  await prisma.notificationRead.deleteMany({
    where: { customerId, OR: [{ readAt: null }, { readAt: { lte: now } }] },
  });
  return cleared;
};

// Deletes never touch ws_notification; they record idempotent per-customer dismissals so
// broadcast rows survive for other recipients. Only ids visible to the customer are
// dismissed; returns rows newly inserted.
export const deleteMany = async (customerId: number, ids: number[]): Promise<number> => {
  const ctx = await contextFor(customerId);
  const visible = await prisma.notification.findMany({
    where: { AND: [{ id: { in: ids } }, visWhere(customerId, ctx.signupAt)] },
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

export const deleteAll = async (customerId: number): Promise<number> => {
  const [dismissedIds, ctx] = await Promise.all([dismissedIdsFor(customerId), contextFor(customerId)]);
  const dismissed = new Set(dismissedIds);
  const rows = await prisma.notification.findMany({ where: visWhere(customerId, ctx.signupAt), select: { id: true } });
  const toInsert = rows.map((r) => r.id).filter((id) => !dismissed.has(id));
  if (!toInsert.length) return 0;
  const now = new Date();
  const r = await prisma.notificationDismissal.createMany({
    data: toInsert.map((id) => ({ customerId, notificationId: id, createdAt: now })),
    skipDuplicates: true,
  });
  return r.count;
};
