import { Request, Response } from "express";
import { Types } from "mongoose";
import { LiveSessionReminder } from "../../models/customer/LiveSessionReminder.model";
import {
  upsertReminder,
  removeReminder,
  DEFAULT_MINUTES_BEFORE,
  MAX_MINUTES_BEFORE,
} from "./live-reminder.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

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
    sessionScheduledAt: reminder.sessionScheduledAt,
    status: reminder.status,
    // Derived: the scheduled fire time has already passed (reminder likely sent).
    fired: reminder.remindAt ? new Date(reminder.remindAt).getTime() <= Date.now() : false,
    session: session
      ? {
          id: String(session._id),
          title: session.title,
          status: session.status,
          scheduledAt: session.scheduledAt ?? null,
          subject: session.subject ?? "",
          streamId: session.streamId ?? null,
          liveCourseIds: (session.liveCourseIds ?? []).map(String),
        }
      : null,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  };
}

const SESSION_FIELDS = "title status scheduledAt subject streamId liveCourseIds";

// POST /api/v1/client/live-reminders
// Body: { liveSessionId, minutesBefore? }  — set (or replace) a reminder for a
// SCHEDULED live session. minutesBefore defaults to 30; a notification fires
// that many minutes before the session's scheduled start time.
export const setLiveSessionReminder = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const liveSessionId = String(req.body?.liveSessionId ?? "").trim();
    if (!liveSessionId) return failure(res, "liveSessionId is required.", 422);

    let minutesBefore = DEFAULT_MINUTES_BEFORE;
    const raw = req.body?.minutesBefore;
    if (raw !== undefined && raw !== null && raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > MAX_MINUTES_BEFORE) {
        return failure(res, `minutesBefore must be a number between 0 and ${MAX_MINUTES_BEFORE}.`, 422);
      }
      minutesBefore = Math.round(n);
    }

    const result = await upsertReminder(customerId, liveSessionId, minutesBefore);
    if (!result.ok) return failure(res, result.message, result.status);

    // Re-read with the session populated so the response is self-contained.
    const populated = await LiveSessionReminder.findById(result.reminder._id)
      .populate("liveSessionId", SESSION_FIELDS)
      .lean();

    return success(
      res,
      { reminder: publicReminder(populated ?? result.reminder) },
      "Reminder set — you'll be notified before the class starts.",
      201
    );
  } catch (err) {
    logger.error("Set live reminder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to set reminder.", 500);
  }
};

// GET /api/v1/client/live-reminders?upcoming=true&limit=2
// The caller's reminders, soonest first. ?upcoming=true → only still-scheduled
// reminders whose session start time is still in the future, sorted by the
// session's scheduled start time so the next-to-start class is on top.
// ?limit=N caps the response (default 50, max 100).
export const listMyLiveSessionReminders = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const upcomingOnly = req.query.upcoming === "true";

    let limit = upcomingOnly ? 50 : 0;
    const rawLimit = req.query.limit;
    if (rawLimit !== undefined && rawLimit !== "") {
      const n = Number(rawLimit);
      if (!Number.isFinite(n) || n < 1) {
        return failure(res, "limit must be a positive number.", 422);
      }
      limit = Math.min(Math.floor(n), 100);
    }

    const rows = await LiveSessionReminder.find({ customerId: new Types.ObjectId(customerId) })
      .populate("liveSessionId", SESSION_FIELDS)
      .lean();

    let reminders = rows.map(publicReminder);

    if (upcomingOnly) {
      const now = Date.now();
      reminders = reminders.filter(
        (r) =>
          r.status === "scheduled" &&
          r.session?.scheduledAt &&
          new Date(r.session.scheduledAt).getTime() > now
      );
      // Earliest session start first — so the next class to begin is on top.
      reminders.sort(
        (a, b) =>
          new Date(a.session!.scheduledAt as any).getTime() -
          new Date(b.session!.scheduledAt as any).getTime()
      );
    } else {
      // Fallback ordering for the unfiltered list: by reminder fire time.
      reminders.sort(
        (a, b) =>
          new Date(a.remindAt as any).getTime() - new Date(b.remindAt as any).getTime()
      );
    }

    const total = reminders.length;
    if (limit > 0) reminders = reminders.slice(0, limit);

    return success(res, { reminders, total, limit: limit || null }, "Reminders fetched.");
  } catch (err) {
    logger.error("List live reminders failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch reminders.", 500);
  }
};

// GET /api/v1/client/live-reminders/session/:liveSessionId
// Whether the caller already has a reminder on this session — drives the
// per-session "reminder on/off" toggle in the UI.
export const getMyReminderForSession = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const liveSessionId = String(req.params.liveSessionId ?? "");
    if (!Types.ObjectId.isValid(liveSessionId)) {
      return failure(res, "Invalid liveSessionId.", 422);
    }

    const reminder = await LiveSessionReminder.findOne({
      customerId: new Types.ObjectId(customerId),
      liveSessionId,
    })
      .populate("liveSessionId", SESSION_FIELDS)
      .lean();

    return success(
      res,
      { reminder: reminder ? publicReminder(reminder) : null },
      reminder ? "Reminder fetched." : "No reminder set for this session."
    );
  } catch (err) {
    logger.error("Get live reminder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch reminder.", 500);
  }
};

// DELETE /api/v1/client/live-reminders/:liveSessionId
// Remove the caller's reminder for a session (cancels the pending notification).
export const removeLiveSessionReminder = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const liveSessionId = String(req.params.liveSessionId ?? "");
    if (!Types.ObjectId.isValid(liveSessionId)) {
      return failure(res, "Invalid liveSessionId.", 422);
    }

    const removed = await removeReminder(customerId, liveSessionId);
    if (!removed) return failure(res, "No reminder found for this session.", 404);

    return success(res, { removed: true, liveSessionId }, "Reminder removed.");
  } catch (err) {
    logger.error("Remove live reminder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to remove reminder.", 500);
  }
};
