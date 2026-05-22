/**
 * Live-session reminder logic — shared by the client controller (set/remove)
 * and the admin live-session controller (keep reminders consistent when a
 * session is rescheduled or deleted).
 *
 * A reminder is backed by a scheduled `Notification` row + BullMQ job, so
 * delivery reuses the existing notification dispatcher → FCM pipeline. The
 * backing row is a "job carrier" (customerId null, audience targets the one
 * customer); on fire, the dispatcher fans out the per-user feed row — exactly
 * how admin targeted-scheduled notifications already work.
 */
import { Types } from "mongoose";
import {
  LiveSessionReminder,
  ILiveSessionReminder,
} from "../../models/customer/LiveSessionReminder.model";
import { LiveSession, ILiveSession } from "../../models/course/LiveSession.model";
import { Notification } from "../../models/system/Notification.model";
import {
  scheduleNotificationJob,
  cancelNotificationJob,
} from "../../admin/notification/scheduler";
import logger from "../../utils/logger";

export const DEFAULT_MINUTES_BEFORE = 30;
export const MAX_MINUTES_BEFORE = 7 * 24 * 60; // up to a week before

export type UpsertReminderResult =
  | { ok: true; reminder: ILiveSessionReminder; session: ILiveSession }
  | { ok: false; status: number; message: string };

// minutesBefore → the actual fire time, clamped so it never lands in the past:
// if the lecture is sooner than `minutesBefore`, we just remind right away.
function computeRemindAt(scheduledAt: Date, minutesBefore: number): Date {
  const target = scheduledAt.getTime() - minutesBefore * 60_000;
  const soonest = Date.now() + 1_000;
  return new Date(Math.max(target, soonest));
}

// Create the scheduled Notification row + BullMQ job that delivers the reminder.
async function provisionNotification(
  customerId: Types.ObjectId,
  session: ILiveSession,
  remindAt: Date
): Promise<Types.ObjectId> {
  const liveCourseId = session.liveCourseIds?.[0] ?? null;
  const notif = await Notification.create({
    customerId: null, // job-carrier row; audience.userIds does the targeting
    title: "Live class reminder",
    body: `Your live class "${session.title}" is starting soon.`,
    type: "live_reminder",
    deepLink: null,
    data: {
      kind: "live_reminder",
      liveSessionId: String(session._id),
      liveCourseId: liveCourseId ? String(liveCourseId) : null,
      streamId: session.streamId ?? null,
      scheduledAt: session.scheduledAt,
    },
    status: "scheduled",
    scheduledAt: remindAt,
    audience: { all: false, userIds: [customerId] },
  });

  try {
    await scheduleNotificationJob(String(notif._id), remindAt);
  } catch (err) {
    // Couldn't enqueue (e.g. Redis/BullMQ down) — don't leave an orphan row.
    await Notification.deleteOne({ _id: notif._id }).catch(() => {});
    throw err;
  }
  return notif._id as Types.ObjectId;
}

// Cancel a reminder's BullMQ job and drop its scheduled Notification row.
// Safe if the id is missing or the notification already fired — only rows
// still in "scheduled" status are deleted, so a delivered feed row is kept.
async function deprovisionNotification(
  notificationId?: Types.ObjectId | null
): Promise<void> {
  if (!notificationId) return;
  try {
    await cancelNotificationJob(String(notificationId));
  } catch (err) {
    logger.warn("Live reminder: failed to cancel notification job", {
      notificationId: String(notificationId),
      error: (err as Error).message,
    });
  }
  await Notification.deleteOne({ _id: notificationId, status: "scheduled" }).catch(() => {});
}

/**
 * Create or replace the caller's reminder for a SCHEDULED session.
 * Returns a discriminated result so the controller can map validation
 * failures straight to HTTP status codes.
 */
export async function upsertReminder(
  customerId: string,
  liveSessionId: string,
  minutesBefore: number,
  traceId?: string
): Promise<UpsertReminderResult> {
  logger.info("upsertReminder service invoked", { traceId, customerId, liveSessionId, minutesBefore });

  if (!Types.ObjectId.isValid(liveSessionId)) {
    logger.warn("upsertReminder service invalid id", { traceId, customerId, liveSessionId });
    return { ok: false, status: 422, message: "Invalid liveSessionId." };
  }

  const session = await LiveSession.findById(liveSessionId);
  if (!session) { logger.warn("upsertReminder service session not found", { traceId, liveSessionId }); return { ok: false, status: 404, message: "Live session not found." }; }
  if (session.status !== "SCHEDULED") {
    logger.warn("upsertReminder service session not schedulable", { traceId, liveSessionId, status: session.status });
    return {
      ok: false,
      status: 409,
      message: `Reminders can only be set for SCHEDULED sessions (this one is ${session.status}).`,
    };
  }
  if (!session.scheduledAt || session.scheduledAt.getTime() <= Date.now()) {
    logger.warn("upsertReminder service session has no upcoming time", { traceId, liveSessionId });
    return { ok: false, status: 409, message: "This session has no upcoming scheduled time." };
  }

  const remindAt = computeRemindAt(session.scheduledAt, minutesBefore);
  const customerObjId = new Types.ObjectId(customerId);

  // Replace any existing reminder's backing notification before re-provisioning.
  const existing = await LiveSessionReminder.findOne({
    customerId: customerObjId,
    liveSessionId,
  });
  if (existing) await deprovisionNotification(existing.notificationId);

  const notificationId = await provisionNotification(customerObjId, session, remindAt);

  const reminder = await LiveSessionReminder.findOneAndUpdate(
    { customerId: customerObjId, liveSessionId },
    {
      $set: {
        liveCourseId: session.liveCourseIds?.[0] ?? null,
        minutesBefore,
        remindAt,
        sessionScheduledAt: session.scheduledAt,
        notificationId,
        status: "scheduled",
      },
    },
    { new: true, upsert: true }
  );

  logger.info("upsertReminder service completed", { traceId, customerId, liveSessionId, remindAt, minutesBefore });
  return { ok: true, reminder: reminder as ILiveSessionReminder, session };
}

/**
 * Remove the caller's reminder for a session. Returns the deleted reminder,
 * or null if there wasn't one.
 */
export async function removeReminder(
  customerId: string,
  liveSessionId: string,
  traceId?: string
): Promise<ILiveSessionReminder | null> {
  logger.info("removeReminder service invoked", { traceId, customerId, liveSessionId });
  if (!Types.ObjectId.isValid(liveSessionId)) {
    logger.warn("removeReminder service invalid id", { traceId, customerId, liveSessionId });
    return null;
  }
  const reminder = await LiveSessionReminder.findOneAndDelete({
    customerId: new Types.ObjectId(customerId),
    liveSessionId,
  });
  if (!reminder) { logger.info("removeReminder service no reminder", { traceId, customerId, liveSessionId }); return null; }
  await deprovisionNotification(reminder.notificationId);
  logger.info("removeReminder service completed", { traceId, customerId, liveSessionId });
  return reminder;
}

/**
 * Admin hook — a session's schedule changed: re-point every reminder's fire
 * time + job. If the session is no longer SCHEDULED or lost its scheduledAt,
 * the reminders are cancelled instead.
 */
export async function syncRemindersForSession(
  liveSessionId: Types.ObjectId | string
): Promise<void> {
  const reminders = await LiveSessionReminder.find({ liveSessionId, status: "scheduled" });
  if (reminders.length === 0) return;

  const session = await LiveSession.findById(liveSessionId);
  const stillSchedulable =
    !!session &&
    session.status === "SCHEDULED" &&
    !!session.scheduledAt &&
    session.scheduledAt.getTime() > Date.now();

  for (const reminder of reminders) {
    await deprovisionNotification(reminder.notificationId);
    if (!stillSchedulable) {
      reminder.status = "cancelled";
      reminder.notificationId = null;
      await reminder.save();
      continue;
    }
    const remindAt = computeRemindAt(session!.scheduledAt as Date, reminder.minutesBefore);
    reminder.notificationId = await provisionNotification(
      reminder.customerId,
      session as ILiveSession,
      remindAt
    );
    reminder.remindAt = remindAt;
    reminder.sessionScheduledAt = session!.scheduledAt as Date;
    await reminder.save();
  }

  logger.info("syncRemindersForSession service completed", {
    liveSessionId: String(liveSessionId),
    count: reminders.length,
    cancelled: !stillSchedulable,
  });
}

/**
 * Admin hook — a session was deleted: cancel and remove every reminder (and
 * its backing job) for it.
 */
export async function cancelRemindersForSession(
  liveSessionId: Types.ObjectId | string
): Promise<void> {
  const reminders = await LiveSessionReminder.find({ liveSessionId });
  if (reminders.length === 0) return;
  for (const reminder of reminders) {
    await deprovisionNotification(reminder.notificationId);
  }
  await LiveSessionReminder.deleteMany({ liveSessionId });
  logger.info("cancelRemindersForSession service completed", {
    liveSessionId: String(liveSessionId),
    count: reminders.length,
  });
}
