import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { extractNotificationRouting } from "../../utils/notificationTarget";

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

/**
 * Per-customer notification context, resolved once per request.
 *
 * `signupAt` bounds the broadcast feed and `readBefore` is the read watermark;
 * both come off ws_customer. A missing customer row yields nulls, which degrade to
 * the old permissive behaviour rather than an empty feed.
 */
const contextFor = async (customerId: number) => {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { createdAt: true, notificationsReadBefore: true },
  });
  return { signupAt: c?.createdAt ?? null, readBefore: c?.notificationsReadBefore ?? null };
};

/**
 * Visibility: own notifications always, plus broadcasts — but ONLY those sent at or
 * after the customer signed up.
 *
 * The cut-off is the fix for "a new account sees every notification ever sent": the
 * filter used to be a bare `OR broadcast = true` with no date bound, so a freshly
 * created account (including one re-registered after an account deletion) inherited
 * the entire broadcast history — 63 items reaching back months, on staging.
 *
 * It is naturally a no-op for existing users: a broadcast sent after they joined still
 * passes. Only history that predates the account disappears.
 *
 * `signupAt` null (legacy rows with no created_at) → no bound, i.e. the old behaviour.
 * Losing a customer's whole feed is a worse failure than showing a little extra.
 */
const visWhere = (customerId: number, signupAt: Date | null) => ({
  OR: [
    { customerId },
    signupAt
      ? { broadcast: true, createdAt: { gte: signupAt } }
      : { broadcast: true },
  ],
});

/**
 * Ids this customer has explicitly marked read.
 *
 * Read state deliberately does NOT live on ws_notification.is_read any more: that
 * column is on the SHARED broadcast row, so `markRead` marked a broadcast read for
 * every customer on the platform (60 of 63 broadcasts were already globally read
 * before this changed). Mirrors how dismissals have always worked.
 */
const readIdsFor = async (customerId: number): Promise<Set<number>> => {
  const rows = await prisma.notificationRead.findMany({
    where: { customerId },
    select: { notificationId: true },
  });
  return new Set(rows.map((r) => r.notificationId));
};

/** Read = an explicit mark, or created at/before the customer's mark-all watermark. */
const isReadFor = (
  n: { id: number; createdAt: Date | null },
  readIds: Set<number>,
  readBefore: Date | null
): boolean =>
  readIds.has(n.id) || (!!readBefore && !!n.createdAt && n.createdAt <= readBefore);

/** Prisma `where` for the unread half of the feed — the watermark + explicit marks. */
const unreadWhere = (readIds: Set<number>, readBefore: Date | null) => {
  const clauses: any[] = [];
  if (readBefore) clauses.push({ OR: [{ createdAt: null }, { createdAt: { gt: readBefore } }] });
  if (readIds.size) clauses.push({ id: { notIn: [...readIds] } });
  return clauses;
};

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

// Routing fields (viewType / deepLink / clickAction / screen / params / live ids)
// are spread in LAST and only when the row actually carries them, so a plain
// announcement has no routing keys at all — the app's tap router checks presence,
// and a `null` placeholder would read as "this has a destination".
//
// `deepLink` is intentionally spread over the explicit `deepLink: n.deepLink`
// below it: extract() already prefers the column and falls back to data.deepLink,
// so the spread is the more complete value, never a weaker one.
// `isRead`/`readAt` are supplied by the CALLER (per-customer), never read off the row —
// n.isRead / n.readAt on a broadcast are the shared, cross-user values this change
// exists to stop trusting. Same key + type on the wire either way.
const dto = (n: any, read: { isRead: boolean; readAt: Date | null } = { isRead: false, readAt: null }) => ({
  _id: String(n.id), customerId: n.customerId != null ? String(n.customerId) : null,
  title: n.title, titleHtml: n.titleHtml ?? null, body: n.body, bodyHtml: n.bodyHtml ?? null,
  image: n.image ?? null, type: n.type, deepLink: n.deepLink ?? null,
  data: n.data ?? {}, isRead: read.isRead, readAt: read.readAt, broadcast: n.broadcast,
  status: n.status, createdAt: n.createdAt ?? null, updatedAt: n.updatedAt ?? null,
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
  // Dismissed ("deleted") notifications drop out of the feed, its total, AND the
  // unread badge — a deleted item must not keep the badge lit.
  const notDismissed = dismissed.length ? { id: { notIn: dismissed } } : {};
  const base = { AND: [visWhere(customerId, ctx.signupAt), notDismissed] };
  // `search` narrows the paginated list + its total by title/body; the unread
  // badge stays over the FULL visible set (base) so it remains a true count.
  const searchFilter = buildPrismaSearch(search, ["title", "body"]);
  const where: any = searchFilter
    ? { AND: [...base.AND, ...searchFilter.AND] }
    : base;
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
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
        // A watermark-covered row has no per-row mark, so it has no exact readAt —
        // the watermark itself is the best available answer.
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
 * Mark ONE notification read for THIS customer.
 *
 * Writes a per-customer row instead of UPDATEing ws_notification — the old code did
 * the latter, which on a broadcast marked it read for the entire user base. Idempotent
 * via the (customer_id, notification_id) unique key.
 */
export const markRead = async (customerId: number, id: number): Promise<any | null> => {
  const ctx = await contextFor(customerId);
  // visibility: own row, or a broadcast sent since signup
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
 * Mark EVERYTHING read for this customer by moving the watermark to now — O(1),
 * whatever the feed size.
 *
 * The old version updated `{ customerId, isRead: false }`, so it silently skipped
 * broadcasts (they have customer_id NULL) — the exact opposite of markRead, which hit
 * every customer. Now both agree.
 *
 * Per-row marks at or before the new watermark become redundant, so they are pruned;
 * that is what stops ws_notification_read growing without bound.
 *
 * Returns the number of notifications this actually cleared, for the API's count.
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

// ── Delete ("dismiss from my feed") ────────────────────────────────────────────
// A delete never touches ws_notification; it records a per-customer dismissal so
// broadcast rows survive for other recipients. Idempotent (skipDuplicates / upsert).

// Multi (also serves single = a one-element array). Only ids visible to the customer
// are dismissed; returns rows newly inserted.
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

// All currently-visible, not-yet-dismissed notifications for the customer.
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
