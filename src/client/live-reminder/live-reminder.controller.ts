import { Request, Response } from "express";
import {
  upsertReminder,
  removeReminder,
  DEFAULT_MINUTES_BEFORE,
  MAX_MINUTES_BEFORE,
} from "./live-reminder.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { formatScheduledAt } from "../../utils/displayTime";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";

// Shape a reminder (with its session populated, when available) for the client.
function publicReminder(reminder: any) {
  const session =
    reminder.liveSessionId && typeof reminder.liveSessionId === "object"
      ? reminder.liveSessionId
      : null;
  return {
    id: String(reminder._id),
    liveSessionId: session ? String(session._id) : String(reminder.liveSessionId),
    liveCourseId: reminder.liveCourseId ? String(reminder.liveCourseId) : null,
    minutesBefore: reminder.minutesBefore,
    remindAt: reminder.remindAt,
    remindAtDisplay: formatScheduledAt(reminder.remindAt),
    sessionScheduledAt: reminder.sessionScheduledAt,
    sessionScheduledAtDisplay: formatScheduledAt(reminder.sessionScheduledAt),
    status: reminder.status,
    // Derived: the scheduled fire time has already passed (reminder likely sent).
    fired: reminder.remindAt ? new Date(reminder.remindAt).getTime() <= Date.now() : false,
    session: session
      ? {
          id: String(session._id),
          title: session.title,
          status: session.status,
          scheduledAt: session.scheduledAt ?? null,
          scheduledAtDisplay: formatScheduledAt(session.scheduledAt),
          subject: session.subject ?? "",
          streamId: session.streamId ?? null,
          liveCourseIds: (session.liveCourseIds ?? []).map(String),
        }
      : null,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  };
}

// SQL branch: the admin-live-course service returns a flat reminder DTO (id,
// liveSessionId, liveCourseId, minutesBefore, remindAt, sessionScheduledAt,
// status, optional nested `session`). Shape it to the same public contract.
function sqlReminderToPublic(r: any) {
  const session = r.session ?? null;
  return {
    id: String(r.id),
    liveSessionId: r.liveSessionId ? String(r.liveSessionId) : null,
    liveCourseId: r.liveCourseId ? String(r.liveCourseId) : null,
    minutesBefore: r.minutesBefore,
    remindAt: r.remindAt,
    remindAtDisplay: formatScheduledAt(r.remindAt),
    sessionScheduledAt: r.sessionScheduledAt,
    sessionScheduledAtDisplay: formatScheduledAt(r.sessionScheduledAt),
    status: r.status,
    fired: r.remindAt ? new Date(r.remindAt).getTime() <= Date.now() : false,
    session: session
      ? {
          id: String(session._id),
          title: session.title,
          status: session.status,
          scheduledAt: session.scheduledAt ?? null,
          scheduledAtDisplay: formatScheduledAt(session.scheduledAt),
          subject: session.subject ?? "",
          streamId: session.streamId ?? null,
          liveCourseIds: r.liveCourseId ? [String(r.liveCourseId)] : [],
        }
      : null,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

// setLiveSessionReminder / removeLiveSessionReminder delegate to the SQL service
// (`client-live-reminder.service`), which provisions/cancels the scheduled
// notification row + BullMQ job on the migrated tables. No Mongo path remains.
//
// POST /api/v1/client/live-reminders
// Body: { liveSessionId, minutesBefore? }  — set (or replace) a reminder for a
// SCHEDULED live session. minutesBefore defaults to 30; a notification fires
// that many minutes before the session's scheduled start time.
export const setLiveSessionReminder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("setLiveSessionReminder invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("setLiveSessionReminder unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const liveSessionId = String(req.body?.liveSessionId ?? "").trim();
    if (!liveSessionId) { logger.warn("setLiveSessionReminder missing liveSessionId", { traceId, customerId }); return failure(res, "liveSessionId is required.", 422); }

    let minutesBefore = DEFAULT_MINUTES_BEFORE;
    const raw = req.body?.minutesBefore;
    if (raw !== undefined && raw !== null && raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > MAX_MINUTES_BEFORE) {
        logger.warn("setLiveSessionReminder invalid minutesBefore", { traceId, customerId, raw });
        return failure(res, `minutesBefore must be a number between 0 and ${MAX_MINUTES_BEFORE}.`, 422);
      }
      minutesBefore = Math.round(n);
    }

    const result = await upsertReminder(customerId, liveSessionId, minutesBefore, traceId);
    if (!result.ok) { logger.warn("setLiveSessionReminder upsert failed", { traceId, customerId, liveSessionId, message: result.message }); return failure(res, result.message, result.status); }

    // The SQL service already returns a Mongo-shaped, session-populated reminder
    // (`toReminderShape`), so the response is self-contained without a re-read.
    logger.info("setLiveSessionReminder success", { traceId, customerId, liveSessionId, reminderId: result.reminder._id });
    return success(
      res,
      { reminder: publicReminder(result.reminder) },
      "Reminder set — you'll be notified before the class starts.",
      201
    );
  } catch (err) {
    logger.error("setLiveSessionReminder failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to set reminder.", 500);
  }
};

// GET /api/v1/client/live-reminders?upcoming=true&limit=2
// The caller's reminders, soonest first. ?upcoming=true → only still-scheduled
// reminders whose session start time is still in the future, sorted by the
// session's scheduled start time so the next-to-start class is on top.
// ?limit=N caps the response (default 50, max 100).
export const listMyLiveSessionReminders = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyLiveSessionReminders invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("listMyLiveSessionReminders unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const upcomingOnly = req.query.upcoming === "true";

    const cid = liveSql.parseLiveId(String(customerId));
    if (!cid) return success(res, { reminders: [], total: 0, limit: null }, "Reminders fetched.");
    let lim = upcomingOnly ? 50 : 0;
    const raw = req.query.limit;
    if (raw !== undefined && raw !== "") { const n = Number(raw); if (!Number.isFinite(n) || n < 1) return failure(res, "limit must be a positive number.", 422); lim = Math.min(Math.floor(n), 100); }
    const dtos = await liveSql.listRemindersForCustomer(cid);
    let reminders = dtos.map((r: any) => sqlReminderToPublic(r));
    if (upcomingOnly) {
      const now = Date.now();
      reminders = reminders.filter((r) => r.status === "scheduled" && r.session?.scheduledAt && new Date(r.session.scheduledAt).getTime() > now)
        .sort((a, b) => new Date(a.session!.scheduledAt as any).getTime() - new Date(b.session!.scheduledAt as any).getTime());
    } else {
      reminders.sort((a, b) => new Date(a.remindAt as any).getTime() - new Date(b.remindAt as any).getTime());
    }
    const total = reminders.length;
    if (lim > 0) reminders = reminders.slice(0, lim);
    logger.info("listMyLiveSessionReminders success", { traceId, customerId, total, upcomingOnly });
    return success(res, { reminders, total, limit: lim || null }, "Reminders fetched.");
  } catch (err) {
    logger.error("listMyLiveSessionReminders failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch reminders.", 500);
  }
};

// GET /api/v1/client/live-reminders/session/:liveSessionId
// Whether the caller already has a reminder on this session — drives the
// per-session "reminder on/off" toggle in the UI.
export const getMyReminderForSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const liveSessionId = String(req.params.liveSessionId ?? "");
  logger.info("getMyReminderForSession invoked", { traceId, path: req.originalUrl, customerId, liveSessionId });

  try {
    if (!customerId) { logger.warn("getMyReminderForSession unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const cid = liveSql.parseLiveId(String(customerId));
    const sid = liveSql.parseLiveId(liveSessionId);
    if (!sid) return failure(res, "Invalid liveSessionId.", 422);
    const dto = cid ? await liveSql.getReminderForSession(cid, sid) : null;
    return success(res, { reminder: dto ? sqlReminderToPublic(dto) : null }, dto ? "Reminder fetched." : "No reminder set for this session.");
  } catch (err) {
    logger.error("getMyReminderForSession failed", { traceId, customerId, liveSessionId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch reminder.", 500);
  }
};

// DELETE /api/v1/client/live-reminders/:liveSessionId
// Remove the caller's reminder for a session (cancels the pending notification).
export const removeLiveSessionReminder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const liveSessionId = String(req.params.liveSessionId ?? "");
  logger.info("removeLiveSessionReminder invoked", { traceId, path: req.originalUrl, customerId, liveSessionId });

  try {
    if (!customerId) { logger.warn("removeLiveSessionReminder unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    if (!liveSql.parseLiveId(liveSessionId)) {
      logger.warn("removeLiveSessionReminder invalid id", { traceId, customerId, liveSessionId });
      return failure(res, "Invalid liveSessionId.", 422);
    }

    const removed = await removeReminder(customerId, liveSessionId, traceId);
    if (!removed) { logger.warn("removeLiveSessionReminder not found", { traceId, customerId, liveSessionId }); return failure(res, "No reminder found for this session.", 404); }

    logger.info("removeLiveSessionReminder success", { traceId, customerId, liveSessionId });
    return success(res, { removed: true, liveSessionId }, "Reminder removed.");
  } catch (err) {
    logger.error("removeLiveSessionReminder failed", { traceId, customerId, liveSessionId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to remove reminder.", 500);
  }
};
