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
import { ILiveSessionReminder } from "../../models/customer/LiveSessionReminder.model";
import { ILiveSession } from "../../models/course/LiveSession.model";
import logger from "../../utils/logger";
import {
  parseReminderId,
  upsertReminderSql,
  removeReminderSql,
  syncRemindersForSessionSql,
  cancelRemindersForSessionSql,
} from "../../modules/client-live-reminder/client-live-reminder.service";

export const DEFAULT_MINUTES_BEFORE = 30;
export const MAX_MINUTES_BEFORE = 7 * 24 * 60; // up to a week before

export type UpsertReminderResult =
  | { ok: true; reminder: ILiveSessionReminder; session: ILiveSession }
  | { ok: false; status: number; message: string };

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
  return upsertReminderSql(customerId, liveSessionId, minutesBefore, traceId) as Promise<UpsertReminderResult>;
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
  return removeReminderSql(customerId, liveSessionId, traceId) as Promise<ILiveSessionReminder | null>;
}

/**
 * Admin hook — a session's schedule changed: re-point every reminder's fire
 * time + job. If the session is no longer SCHEDULED or lost its scheduledAt,
 * the reminders are cancelled instead.
 */
export async function syncRemindersForSession(
  liveSessionId: Types.ObjectId | string
): Promise<void> {
  const sid = parseReminderId(liveSessionId as any);
  if (sid) await syncRemindersForSessionSql(sid);
}

/**
 * Admin hook — a session was deleted: cancel and remove every reminder (and
 * its backing job) for it.
 */
export async function cancelRemindersForSession(
  liveSessionId: Types.ObjectId | string
): Promise<void> {
  const sid = parseReminderId(liveSessionId as any);
  if (sid) await cancelRemindersForSessionSql(sid);
}
