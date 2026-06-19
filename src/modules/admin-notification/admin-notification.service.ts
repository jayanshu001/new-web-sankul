/**
 * Admin notification WRITE subsystem — MySQL (Prisma) branch.
 *
 * SQL mirror of the Mongo `src/admin/notification/{audience,dispatcher}.ts` write
 * path, enabling the `client-notification` flag. The legacy files branch on
 * `isAdminNotificationMysql()` and delegate here when on.
 *
 * Coupling resolved vs Mongo:
 *  - tokens: read from ws_customer_device_token (the multi-device table built as
 *    `client-notification` prerequisite (a)), NOT Customer.firebaseTokens[].
 *  - audience: SQL customer ids (int). Course-targeting uses
 *    ws_package_course_subscription — which has NO payment_status column, so the
 *    entitlement signal is status=true (+ endAt null/future), per the migration's
 *    documented drift.
 *  - claim-lock / fanout / persistence: prisma.notification (ws_notification).
 *  - id type: SQL ints; the BullMQ jobId is String(id) — works for int or hex.
 *
 * Runtime ids ARE SQL ints (customer-auth + catalog-* make req ids SQL), so the
 * admin-supplied courseIds/userIds arrive as numeric strings on the SQL path.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";
import { sendPush } from "../../utils/fcm";
import logger from "../../utils/logger";

export const ADMIN_NOTIFICATION_MODULE = "client-notification";
export const isAdminNotificationMysql = (): boolean => isMysqlModule(ADMIN_NOTIFICATION_MODULE);

/** Parse a numeric string id to a positive int, else null. */
export const parseIntId = (v: string): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const intIds = (vals?: string[]): number[] =>
  (vals ?? []).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);

export interface AudienceFilter {
  platforms?: ("ios" | "android")[];
  courseIds?: string[];
  userIds?: string[];
}

export interface ResolvedAudience {
  isAll: boolean;
  customerIds: number[];
}

export interface DispatchResult {
  status: "sent" | "failed";
  recipientCount: number;
  failureCount: number;
  invalidTokensPruned: number;
  failureReason: string | null;
  isBroadcast: boolean;
  targetCustomerIds: number[];
}

/**
 * Resolve a targeted audience to SQL customer ids. Empty filter → isAll.
 * Only customers that (a) match platform/user/course filters AND (b) own at
 * least one device token are returned (token-owning gate mirrors Mongo's
 * `firebaseTokens.0 $exists`).
 */
export async function resolveAudience(filter: AudienceFilter): Promise<ResolvedAudience> {
  const platforms = filter.platforms ?? [];
  const userIds = intIds(filter.userIds);
  const courseIds = intIds(filter.courseIds);
  const hasPlatforms = platforms.length > 0;
  const hasUsers = userIds.length > 0;
  const hasCourses = courseIds.length > 0;

  if (!hasPlatforms && !hasUsers && !hasCourses) {
    return { isAll: true, customerIds: [] };
  }

  // Course-targeting → active subscribers. ws_package_course_subscription has no
  // payment_status; status=true (+ endAt null/future) is the entitlement signal.
  let courseCustomerIds: number[] | null = null;
  if (hasCourses) {
    const now = new Date();
    const subs = await prisma.packageCourseSubscription.findMany({
      where: {
        courseId: { in: courseIds },
        status: true,
        OR: [{ endAt: null }, { endAt: { gt: now } }],
        customerId: { not: null },
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    courseCustomerIds = subs.map((s) => s.customerId!).filter((id) => id != null);
    if (courseCustomerIds.length === 0) return { isAll: false, customerIds: [] };
  }

  // Intersect user + course id sets when both present.
  let idIn: number[] | undefined;
  if (hasUsers && courseCustomerIds) {
    const set = new Set(courseCustomerIds);
    idIn = userIds.filter((id) => set.has(id));
    if (idIn.length === 0) return { isAll: false, customerIds: [] };
  } else if (hasUsers) {
    idIn = userIds;
  } else if (courseCustomerIds) {
    idIn = courseCustomerIds;
  }

  // Only customers owning a device token (multi-device child table).
  const tokenOwners = await prisma.customerDeviceToken.findMany({
    where: { customerId: idIn ? { in: idIn } : undefined },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  let candidateIds = tokenOwners.map((t) => t.customerId);
  if (candidateIds.length === 0) return { isAll: false, customerIds: [] };

  // Apply platform + live-account filters against ws_customer.
  const customers = await prisma.customer.findMany({
    where: {
      id: { in: candidateIds },
      isAccountDeleted: false,
      status: true,
      ...(hasPlatforms ? { os_type: { in: platforms } } : {}),
    },
    select: { id: true },
  });

  return { isAll: false, customerIds: customers.map((c) => c.id) };
}

/** All device tokens for the given customers (broadcast → all live accounts). */
async function collectTokens(audience: ResolvedAudience): Promise<string[]> {
  if (audience.isAll) {
    // Broadcast: every token whose owner is a live, non-deleted customer.
    const liveIds = await prisma.customer.findMany({
      where: { isAccountDeleted: false, status: true },
      select: { id: true },
    });
    const rows = await prisma.customerDeviceToken.findMany({
      where: { customerId: { in: liveIds.map((c) => c.id) } },
      select: { token: true },
    });
    return rows.map((r) => r.token).filter(Boolean);
  }
  if (audience.customerIds.length === 0) return [];
  const rows = await prisma.customerDeviceToken.findMany({
    where: { customerId: { in: audience.customerIds } },
    select: { token: true },
  });
  return rows.map((r) => r.token).filter(Boolean);
}

/**
 * Resolve audience, push via FCM, and (for targeted sends) fan out per-recipient
 * feed rows into ws_notification. Mirrors the Mongo dispatchAudience contract.
 */
export async function dispatchAudience(
  payload: {
    title: string;
    body: string;
    image?: string | null;
    type?: string;
    deepLink?: string | null;
    data?: Record<string, unknown>;
  },
  audienceFilter: AudienceFilter
): Promise<DispatchResult> {
  const resolved = await resolveAudience(audienceFilter);
  const isBroadcast = resolved.isAll;
  const tokens = await collectTokens(resolved);

  const sendResult = await sendPush(tokens, {
    title: payload.title,
    body: payload.body,
    image: payload.image,
    deepLink: payload.deepLink,
    data: payload.data,
  });

  const status: "sent" | "failed" =
    sendResult.skipped || sendResult.successCount > 0 ? "sent" : "failed";
  const failureReason =
    status === "failed"
      ? sendResult.skipped
        ? "FCM not configured."
        : "All sends failed."
      : null;

  if (!isBroadcast && resolved.customerIds.length && status === "sent") {
    try {
      const now = new Date();
      await prisma.notification.createMany({
        data: resolved.customerIds.map((id) => ({
          customerId: id,
          broadcast: false,
          title: payload.title,
          body: payload.body,
          image: payload.image ?? null,
          type: payload.type ?? "general",
          deepLink: payload.deepLink ?? null,
          data: (payload.data ?? {}) as any,
          status: "sent",
          sentAt: now,
          recipientCount: 1,
          audience: { all: false, userIds: [id] } as any,
          createdAt: now,
          updatedAt: now,
        })),
      });
    } catch (err) {
      logger.error("SQL: failed to fan out per-recipient notification rows", {
        error: (err as Error).message,
      });
    }
  }

  return {
    status,
    recipientCount: sendResult.successCount,
    failureCount: sendResult.failureCount,
    invalidTokensPruned: sendResult.invalidTokens.length,
    failureReason,
    isBroadcast,
    targetCustomerIds: resolved.customerIds,
  };
}

/** Audience filter from a stored ws_notification.audience JSON snapshot. */
function audienceFromSnapshot(audience: any): AudienceFilter {
  return {
    platforms: audience?.platforms,
    courseIds: audience?.courseIds?.map((id: unknown) => String(id)),
    userIds: audience?.userIds?.map((id: unknown) => String(id)),
  };
}

/**
 * Dispatch a single scheduled SQL notification by int id (BullMQ worker path).
 * Atomic claim "scheduled" → "sent" via conditional updateMany count, so retries
 * / multi-instance can't double-send. Returns null if already claimed/cancelled
 * OR if the id is not a SQL row (lets the worker fall back to the Mongo path).
 */
export async function dispatchScheduledById(
  notificationId: string,
  now: Date = new Date()
): Promise<DispatchResult | null> {
  const id = parseIntId(notificationId);
  if (id == null) return null; // not a SQL id → caller falls back to Mongo

  // Atomic claim. count===0 → already sent/cancelled by another worker (no-op);
  // the worker only calls this after existsSql() confirmed a SQL row.
  const claim = await prisma.notification.updateMany({
    where: { id, status: "scheduled" },
    data: { status: "sent", sentAt: now, updatedAt: now },
  });
  if (claim.count === 0) return null;

  const claimed = await prisma.notification.findFirst({ where: { id } });
  if (!claimed) return null;

  try {
    const result = await dispatchAudience(
      {
        title: claimed.title,
        body: claimed.body,
        image: claimed.image,
        type: claimed.type,
        deepLink: claimed.deepLink,
        data: (claimed.data ?? {}) as Record<string, unknown>,
      },
      audienceFromSnapshot(claimed.audience)
    );
    await prisma.notification.update({
      where: { id },
      data: {
        status: result.status,
        failureReason: result.failureReason,
        recipientCount: result.recipientCount,
        sentAt: now,
        updatedAt: now,
      },
    });
    return result;
  } catch (err) {
    await prisma.notification.update({
      where: { id },
      data: { status: "scheduled", sentAt: null, updatedAt: new Date() },
    });
    throw err;
  }
}

/** Does a SQL ws_notification row exist for this id? (worker dual-read routing) */
export async function existsSql(notificationId: string): Promise<boolean> {
  const id = parseIntId(notificationId);
  if (id == null) return false;
  const row = await prisma.notification.findFirst({ where: { id }, select: { id: true } });
  return !!row;
}

/** Mark a SQL notification failed permanently (worker final-failure listener). */
export async function markFailed(notificationId: string, reason: string): Promise<void> {
  const id = parseIntId(notificationId);
  if (id == null) return;
  await prisma.notification.updateMany({
    where: { id, status: "scheduled" },
    data: { status: "failed", failureReason: reason, updatedAt: new Date() },
  });
}

/** Boot rehydrate source: ids of all still-"scheduled" SQL notifications. */
export async function listScheduledForRehydrate(): Promise<{ id: string; scheduledAt: Date }[]> {
  const rows = await prisma.notification.findMany({
    where: { status: "scheduled", scheduledAt: { not: null } },
    select: { id: true, scheduledAt: true },
  });
  return rows.map((r) => ({ id: String(r.id), scheduledAt: r.scheduledAt as Date }));
}

// ─── Admin controller persistence (ws_notification parent rows) ──────────────────

/** Create a scheduled parent row; returns its int id (BullMQ jobId = String(id)). */
export async function createScheduled(input: {
  broadcast: boolean;
  title: string;
  body: string;
  image?: string | null;
  type: string;
  deepLink?: string | null;
  data?: Record<string, unknown>;
  scheduledAt: Date;
  audience: unknown;
}): Promise<{ id: number }> {
  const now = new Date();
  const row = await prisma.notification.create({
    data: {
      customerId: null,
      broadcast: input.broadcast,
      title: input.title,
      body: input.body,
      image: input.image ?? null,
      type: input.type,
      deepLink: input.deepLink ?? null,
      data: (input.data ?? {}) as any,
      status: "scheduled",
      scheduledAt: input.scheduledAt,
      audience: input.audience as any,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  return { id: row.id };
}

/** Create the admin-log parent row for an immediate send. */
export async function createImmediateLog(input: {
  broadcast: boolean;
  title: string;
  body: string;
  image?: string | null;
  type: string;
  deepLink?: string | null;
  data?: Record<string, unknown>;
  status: "sent" | "failed";
  failureReason: string | null;
  recipientCount: number;
  audience: unknown;
}): Promise<void> {
  const now = new Date();
  await prisma.notification.create({
    data: {
      customerId: null,
      broadcast: input.broadcast,
      title: input.title,
      body: input.body,
      image: input.image ?? null,
      type: input.type,
      deepLink: input.deepLink ?? null,
      data: (input.data ?? {}) as any,
      status: input.status,
      sentAt: now,
      failureReason: input.failureReason,
      recipientCount: input.recipientCount,
      audience: input.audience as any,
      createdAt: now,
      updatedAt: now,
    },
  });
}

/** Cancel a scheduled row; returns the updated row or null (404 / not scheduled). */
export async function cancelScheduled(id: number): Promise<any | null> {
  const claim = await prisma.notification.updateMany({
    where: { id, status: "scheduled" },
    data: { status: "cancelled", updatedAt: new Date() },
  });
  if (claim.count === 0) return null;
  return prisma.notification.findFirst({ where: { id } });
}

/** Admin log listing (parent rows only: customerId null). */
export async function listAdminLog(opts: {
  q?: string;
  status?: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  skip: number;
  take: number;
}): Promise<{ data: any[]; total: number }> {
  const where: any = { customerId: null };
  if (opts.q && opts.q.trim()) {
    const s = opts.q.trim();
    where.OR = [{ title: { contains: s } }, { body: { contains: s } }];
  }
  if (opts.status && ["sent", "scheduled", "failed", "cancelled"].includes(opts.status)) {
    where.status = opts.status;
  }
  const allowed = new Set(["createdAt", "scheduledAt", "sentAt", "status", "title"]);
  const field = allowed.has(opts.sortBy) ? opts.sortBy : "createdAt";
  const [data, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { [field]: opts.sortOrder },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.notification.count({ where }),
  ]);
  return { data, total };
}

/**
 * Bulk delete by int ids. Returns the deleted count + the ids that were still
 * "scheduled" (so the caller can cancel their BullMQ jobs).
 */
export async function bulkDelete(
  ids: number[]
): Promise<{ deletedCount: number; scheduledIds: string[] }> {
  const scheduled = await prisma.notification.findMany({
    where: { id: { in: ids }, status: "scheduled" },
    select: { id: true },
  });
  const res = await prisma.notification.deleteMany({ where: { id: { in: ids } } });
  return { deletedCount: res.count, scheduledIds: scheduled.map((r) => String(r.id)) };
}

/**
 * Delete a single row by int id. Returns whether it existed + whether it was
 * "scheduled" (caller cancels the BullMQ job in that case).
 */
export async function deleteOne(
  id: number
): Promise<{ existed: boolean; wasScheduled: boolean }> {
  const row = await prisma.notification.findFirst({ where: { id }, select: { status: true } });
  if (!row) return { existed: false, wasScheduled: false };
  await prisma.notification.delete({ where: { id } });
  return { existed: true, wasScheduled: row.status === "scheduled" };
}

// ─── ImageNotification CRUD (in-app banner images; ws_image_notification) ────────
// Same `client-notification` flag. DTO mirrors the Mongo shape (`_id`,
// `redirectUrl`). The SQL table has no timestamps, so the Mongo `sort by
// createdAt desc` becomes `id desc` (newest first — equivalent for autoincrement).
const imageDto = (r: any) => ({
  _id: String(r.id),
  image: r.image,
  redirectUrl: r.redirect_url ?? null,
  active: r.active,
});

export async function listImageNotifications() {
  const rows = await prisma.imageNotification.findMany({ orderBy: { id: "desc" } });
  return rows.map(imageDto);
}

/** Client feed: active in-app banner images, newest first. Same DTO/flag. */
export async function listActiveImageNotifications() {
  const rows = await prisma.imageNotification.findMany({ where: { active: true }, orderBy: { id: "desc" } });
  return rows.map(imageDto);
}

export async function createImageNotification(input: {
  image: string; redirectUrl?: string; active?: boolean;
}) {
  const row = await prisma.imageNotification.create({
    data: { image: input.image, redirect_url: input.redirectUrl ?? null, active: input.active ?? true },
  });
  return imageDto(row);
}

export async function updateImageNotification(
  id: number,
  input: { image?: string; redirectUrl?: string; active?: boolean }
): Promise<any | null> {
  const exists = await prisma.imageNotification.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  const data: any = {};
  if (input.image !== undefined) data.image = input.image;
  if (input.redirectUrl !== undefined) data.redirect_url = input.redirectUrl;
  if (input.active !== undefined) data.active = input.active;
  const row = await prisma.imageNotification.update({ where: { id }, data });
  return imageDto(row);
}

export async function deleteImageNotification(id: number): Promise<boolean> {
  const exists = await prisma.imageNotification.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.imageNotification.delete({ where: { id } });
  return true;
}
