/**
 * Live-session reminders, shared by the client controller and the admin
 * live-session controller (reschedule/delete). A reminder is a scheduled
 * `Notification` "job carrier" row (customerId null, audience = the one customer)
 * plus a BullMQ job; on fire the dispatcher fans out the per-user feed row.
 */
import logger from "../../utils/logger";
import {
  parseReminderId,
  upsertReminderSql,
  removeReminderSql,
  syncRemindersForSessionSql,
  cancelRemindersForSessionSql,
} from "../../modules/client-live-reminder/client-live-reminder.service";

export const DEFAULT_MINUTES_BEFORE = 30;
export const MAX_MINUTES_BEFORE = 7 * 24 * 60;

export type UpsertReminderResult =
  | { ok: true; reminder: any; session: any }
  | { ok: false; status: number; message: string };

/** Create or replace the caller's reminder for a SCHEDULED session. */
export async function upsertReminder(
  customerId: string,
  liveSessionId: string,
  minutesBefore: number,
  traceId?: string
): Promise<UpsertReminderResult> {
  logger.info("upsertReminder service invoked", { traceId, customerId, liveSessionId, minutesBefore });
  return upsertReminderSql(customerId, liveSessionId, minutesBefore, traceId) as Promise<UpsertReminderResult>;
}

export async function removeReminder(
  customerId: string,
  liveSessionId: string,
  traceId?: string
): Promise<any | null> {
  logger.info("removeReminder service invoked", { traceId, customerId, liveSessionId });
  return removeReminderSql(customerId, liveSessionId, traceId) as Promise<any | null>;
}

/** Admin hook: re-point reminders after a reschedule; cancels them if the session is no longer SCHEDULED or lost its scheduledAt. */
export async function syncRemindersForSession(
  liveSessionId: string | number
): Promise<void> {
  const sid = parseReminderId(liveSessionId as any);
  if (sid) await syncRemindersForSessionSql(sid);
}

export async function cancelRemindersForSession(
  liveSessionId: string | number
): Promise<void> {
  const sid = parseReminderId(liveSessionId as any);
  if (sid) await cancelRemindersForSessionSql(sid);
}
