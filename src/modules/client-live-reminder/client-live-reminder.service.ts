/**
 * SQL (Prisma) port of the live-session reminder write paths — set/replace,
 * remove, and the admin sync/cancel hooks. Flag: `client-live-reminder`.
 *
 * Mirrors src/client/live-reminder/live-reminder.service.ts byte-for-byte on
 * the API contract, but reads/writes ws_live_session, ws_live_session_reminder
 * and ws_notification via Prisma instead of Mongoose.
 *
 * What stays untouched (NOT migrated here):
 *   - BullMQ scheduling: scheduleNotificationJob / cancelNotificationJob are
 *     called exactly as on Mongo, just with the SQL notification id stringified.
 *     The notification dispatcher's worker already dual-reads SQL/Mongo, so the
 *     backing row created in ws_notification fires the same FCM path.
 *
 * The session's first liveCourseId comes from the ws_live_session_course join
 * table (the Mongo doc carried liveCourseIds[] inline; SQL normalises it).
 */
import {
  scheduleNotificationJob,
  cancelNotificationJob,
} from "../../admin/notification/scheduler";
import { prisma } from "../../config/prisma";
import logger from "../../utils/logger";

export const CLIENT_LIVE_REMINDER_MODULE = "client-live-reminder";
export const isClientLiveReminderMysql = (): boolean => true;

export const parseReminderId = (id: string | number | null | undefined): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * SQL reminder row → the Mongo-shaped object the live-reminder controller's
 * `publicReminder` shaper consumes (`_id`, `liveSessionId`, `liveCourseId`,
 * `minutesBefore`, `remindAt`, `sessionScheduledAt`, `status`, timestamps).
 * Keeps the set/remove response byte-compatible without touching the controller.
 */
function toReminderShape(
  r: any,
  session?: { id: number; title: string | null; status: string; scheduledAt: Date | null; streamId: string | null; subject?: string | null } | null,
  liveCourseId?: number | null
): any {
  const lcid = liveCourseId !== undefined ? liveCourseId : r.liveCourseId;
  return {
    _id: String(r.id),
    id: String(r.id),
    customerId: r.customerId != null ? String(r.customerId) : null,
    liveSessionId: session
      ? {
          _id: String(session.id),
          title: session.title,
          status: session.status,
          scheduledAt: session.scheduledAt ?? null,
          subject: session.subject ?? "",
          streamId: session.streamId ?? null,
          liveCourseIds: lcid != null ? [String(lcid)] : [],
        }
      : r.liveSessionId != null
      ? String(r.liveSessionId)
      : null,
    liveCourseId: lcid != null ? String(lcid) : null,
    minutesBefore: r.minutesBefore,
    remindAt: r.remindAt,
    sessionScheduledAt: r.sessionScheduledAt,
    status: r.status,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

// Same clamp as the Mongo service: never fire in the past.
function computeRemindAt(scheduledAt: Date, minutesBefore: number): Date {
  const target = scheduledAt.getTime() - minutesBefore * 60_000;
  const soonest = Date.now() + 1_000;
  return new Date(Math.max(target, soonest));
}

// First liveCourseId for a session, from the normalised join table (or null).
async function firstLiveCourseId(liveSessionId: number): Promise<number | null> {
  const link = await prisma.liveSessionCourse.findFirst({
    where: { liveSessionId },
    orderBy: { id: "asc" },
    select: { liveCourseId: true },
  });
  return link?.liveCourseId ?? null;
}

// Create the scheduled Notification row (ws_notification) + BullMQ job.
async function provisionNotification(
  customerId: number,
  session: { id: number; title: string | null; scheduledAt: Date | null; streamId: string | null },
  liveCourseId: number | null,
  remindAt: Date
): Promise<number> {
  const notif = await prisma.notification.create({
    data: {
      customerId: null, // job-carrier row; audience.userIds does the targeting
      title: "Live class reminder",
      body: `Your live class "${session.title ?? ""}" is starting soon.`,
      type: "live_reminder",
      deepLink: null,
      data: {
        kind: "live_reminder",
        liveSessionId: String(session.id),
        liveCourseId: liveCourseId != null ? String(liveCourseId) : null,
        streamId: session.streamId ?? null,
        scheduledAt: session.scheduledAt ? session.scheduledAt.toISOString() : null,
      },
      status: "scheduled",
      scheduledAt: remindAt,
      audience: { all: false, userIds: [customerId] },
      createdAt: new Date(),
    },
    select: { id: true },
  });

  try {
    await scheduleNotificationJob(String(notif.id), remindAt);
  } catch (err) {
    // Couldn't enqueue (e.g. Redis/BullMQ down) — don't leave an orphan row.
    await prisma.notification.delete({ where: { id: notif.id } }).catch(() => {});
    throw err;
  }
  return notif.id;
}

// Cancel a reminder's BullMQ job and drop its scheduled Notification row.
// Only rows still in "scheduled" status are deleted (a delivered feed row stays).
async function deprovisionNotification(notificationId?: number | null): Promise<void> {
  if (!notificationId) return;
  try {
    await cancelNotificationJob(String(notificationId));
  } catch (err) {
    logger.warn("Live reminder (sql): failed to cancel notification job", {
      notificationId,
      error: (err as Error).message,
    });
  }
  await prisma.notification
    .deleteMany({ where: { id: notificationId, status: "scheduled" } })
    .catch(() => {});
}

export type UpsertReminderSqlResult =
  | { ok: true; reminder: any; session: any }
  | { ok: false; status: number; message: string };

/**
 * Create or replace the caller's reminder for a SCHEDULED session (SQL).
 * `customerId`/`liveSessionId` arrive as the raw strings from the route; the
 * SQL branch parses them to ints (returning the same 422 the Mongo guard would).
 */
export async function upsertReminderSql(
  customerId: string,
  liveSessionId: string,
  minutesBefore: number,
  traceId?: string
): Promise<UpsertReminderSqlResult> {
  logger.info("upsertReminderSql service invoked", { traceId, customerId, liveSessionId, minutesBefore });

  const cid = parseReminderId(customerId);
  const sid = parseReminderId(liveSessionId);
  if (!sid) {
    logger.warn("upsertReminderSql invalid liveSessionId", { traceId, customerId, liveSessionId });
    return { ok: false, status: 422, message: "Invalid liveSessionId." };
  }
  if (!cid) {
    logger.warn("upsertReminderSql invalid customerId", { traceId, customerId });
    return { ok: false, status: 422, message: "Invalid customer." };
  }

  const session = await prisma.liveSession.findUnique({
    where: { id: sid },
    select: { id: true, title: true, status: true, scheduledAt: true, streamId: true, subject: true },
  });
  if (!session) {
    logger.warn("upsertReminderSql session not found", { traceId, liveSessionId });
    return { ok: false, status: 404, message: "Live session not found." };
  }
  if (session.status !== "SCHEDULED") {
    logger.warn("upsertReminderSql session not schedulable", { traceId, liveSessionId, status: session.status });
    return {
      ok: false,
      status: 409,
      message: `Reminders can only be set for SCHEDULED sessions (this one is ${session.status}).`,
    };
  }
  if (!session.scheduledAt || session.scheduledAt.getTime() <= Date.now()) {
    logger.warn("upsertReminderSql session has no upcoming time", { traceId, liveSessionId });
    return { ok: false, status: 409, message: "This session has no upcoming scheduled time." };
  }

  const liveCourseId = await firstLiveCourseId(sid);
  const remindAt = computeRemindAt(session.scheduledAt, minutesBefore);

  // Replace any existing reminder's backing notification before re-provisioning.
  const existing = await prisma.liveSessionReminder.findFirst({
    where: { customerId: cid, liveSessionId: sid },
    select: { id: true, notificationId: true },
  });
  if (existing) await deprovisionNotification(existing.notificationId);

  const notificationId = await provisionNotification(cid, session, liveCourseId, remindAt);

  const now = new Date();
  const data = {
    liveCourseId,
    minutesBefore,
    remindAt,
    sessionScheduledAt: session.scheduledAt,
    notificationId,
    status: "scheduled",
    updatedAt: now,
  };

  const reminder = existing
    ? await prisma.liveSessionReminder.update({ where: { id: existing.id }, data })
    : await prisma.liveSessionReminder.create({
        data: { customerId: cid, liveSessionId: sid, ...data, createdAt: now },
      });

  logger.info("upsertReminderSql service completed", { traceId, customerId, liveSessionId, remindAt, minutesBefore });
  // Mongo-shaped so the existing controller's publicReminder renders it (the
  // controller re-reads via Mongo findById which returns null on the SQL path,
  // then falls back to this object).
  return { ok: true, reminder: toReminderShape(reminder, session, liveCourseId), session };
}

/**
 * Remove the caller's reminder for a session (SQL). Returns the deleted reminder
 * row, or null if there wasn't one.
 */
export async function removeReminderSql(
  customerId: string,
  liveSessionId: string,
  traceId?: string
): Promise<any | null> {
  logger.info("removeReminderSql service invoked", { traceId, customerId, liveSessionId });
  const cid = parseReminderId(customerId);
  const sid = parseReminderId(liveSessionId);
  if (!cid || !sid) {
    logger.warn("removeReminderSql invalid id", { traceId, customerId, liveSessionId });
    return null;
  }
  const reminder = await prisma.liveSessionReminder.findFirst({
    where: { customerId: cid, liveSessionId: sid },
  });
  if (!reminder) {
    logger.info("removeReminderSql no reminder", { traceId, customerId, liveSessionId });
    return null;
  }
  await prisma.liveSessionReminder.delete({ where: { id: reminder.id } });
  await deprovisionNotification(reminder.notificationId);
  logger.info("removeReminderSql service completed", { traceId, customerId, liveSessionId });
  return toReminderShape(reminder);
}

/**
 * Admin hook (SQL) — a session's schedule changed: re-point every reminder's
 * fire time + job, or cancel them if the session is no longer schedulable.
 */
export async function syncRemindersForSessionSql(liveSessionId: number): Promise<void> {
  const reminders = await prisma.liveSessionReminder.findMany({
    where: { liveSessionId, status: "scheduled" },
  });
  if (reminders.length === 0) return;

  const session = await prisma.liveSession.findUnique({
    where: { id: liveSessionId },
    select: { id: true, title: true, status: true, scheduledAt: true, streamId: true },
  });
  const stillSchedulable =
    !!session &&
    session.status === "SCHEDULED" &&
    !!session.scheduledAt &&
    session.scheduledAt.getTime() > Date.now();

  const liveCourseId = stillSchedulable ? await firstLiveCourseId(liveSessionId) : null;

  for (const reminder of reminders) {
    await deprovisionNotification(reminder.notificationId);
    if (!stillSchedulable || !session) {
      await prisma.liveSessionReminder.update({
        where: { id: reminder.id },
        data: { status: "cancelled", notificationId: null, updatedAt: new Date() },
      });
      continue;
    }
    const remindAt = computeRemindAt(session.scheduledAt as Date, reminder.minutesBefore ?? 0);
    const notificationId = await provisionNotification(
      reminder.customerId as number,
      session,
      liveCourseId,
      remindAt
    );
    await prisma.liveSessionReminder.update({
      where: { id: reminder.id },
      data: {
        notificationId,
        remindAt,
        sessionScheduledAt: session.scheduledAt as Date,
        updatedAt: new Date(),
      },
    });
  }

  logger.info("syncRemindersForSessionSql service completed", {
    liveSessionId,
    count: reminders.length,
    cancelled: !stillSchedulable,
  });
}

/**
 * Admin hook (SQL) — a session was deleted: cancel and remove every reminder
 * (and its backing job) for it.
 */
export async function cancelRemindersForSessionSql(liveSessionId: number): Promise<void> {
  const reminders = await prisma.liveSessionReminder.findMany({ where: { liveSessionId } });
  if (reminders.length === 0) return;
  for (const reminder of reminders) {
    await deprovisionNotification(reminder.notificationId);
  }
  await prisma.liveSessionReminder.deleteMany({ where: { liveSessionId } });
  logger.info("cancelRemindersForSessionSql service completed", {
    liveSessionId,
    count: reminders.length,
  });
}
