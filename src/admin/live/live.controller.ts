import { Request, Response } from "express";
import crypto from "crypto";
import { Types } from "mongoose";
import { LiveSession, ILiveSession, ILiveSessionRecording } from "../../models/course/LiveSession.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { LiveSessionAttendance } from "../../models/customer/LiveSessionAttendance.model";
import {
  createStream as streamosCreateStream,
  getStreamDetails as streamosGetStreamDetails,
  endStream as streamosEndStream,
  getUploadedVideoDetails as streamosGetUploadedVideoDetails,
  getOrgDetails as streamosGetOrgDetails,
  updateWebhook as streamosUpdateWebhook,
  StreamosError,
} from "./streamos.service";
import { io, roomKey } from "../../socket/livechat.socket";
import {
  maybeAutoPromoteRecording,
  validateRecordingTargetFolder,
  resolveRecording,
  promoteRecordingToFolder,
} from "./recording.promote";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  syncRemindersForSession,
  cancelRemindersForSession,
} from "../../client/live-reminder/live-reminder.service";

// Admin must wait until 2 minutes before scheduledAt to actually start the
// Streamos stream. Late starts after scheduledAt remain allowed indefinitely.
export const START_WINDOW_MS = 2 * 60 * 1000;

// Shared secret guarding the public recording webhook. Streamos doesn't sign
// its callbacks, so we register the webhook URL with `?key=<secret>` and
// verify it here. When unset we log a warning but still accept — mirrors the
// Razorpay webhook's "enforce only if configured" behaviour so dev isn't
// blocked, but it MUST be set in production.
const STREAMOS_WEBHOOK_SECRET = process.env.STREAMOS_WEBHOOK_SECRET || "";

function secretMatches(provided: string): boolean {
  if (provided.length !== STREAMOS_WEBHOOK_SECRET.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(STREAMOS_WEBHOOK_SECRET)
  );
}

// Streamos stream ids are strings (e.g. "T_17787583234029"). Accept a string
// or a number (legacy / loose callers) and return a trimmed non-empty string.
function parseStreamIdParam(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

function parseScheduledAt(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;            // omitted → don't change
  if (raw === null || raw === "") return null;        // explicit clear
  const d = new Date(raw as any);
  if (isNaN(d.getTime())) return undefined;           // invalid → caller handles
  return d;
}

// Find a session by either Mongo ObjectId (used for SCHEDULED rows that have
// no streamId yet) or the Streamos streamId string.
async function findSessionByAnyId(id: string) {
  if (Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
    const byObjId = await LiveSession.findById(id);
    if (byObjId) return byObjId;
  }
  const streamId = parseStreamIdParam(id);
  if (streamId) {
    return LiveSession.findOne({ streamId });
  }
  return null;
}

function publicView(session: ILiveSession | any) {
  const ids: any[] = Array.isArray(session.liveCourseIds) ? session.liveCourseIds : [];
  // When populated, liveCourseIds is an array of course docs; extract the id list
  // for the canonical field and expose the populated docs under `liveCourses`.
  const isPopulated = ids.length > 0 && typeof ids[0] === "object" && ids[0] && "_id" in ids[0];
  const idList = isPopulated ? ids.map((c: any) => c._id) : ids;
  return {
    id: String(session._id),
    title: session.title,
    liveCourseIds: idList,
    // Legacy single-id field — first/primary linked course. Kept for backwards
    // compatibility with clients reading the old shape.
    liveCourseId: idList[0] ?? null,
    liveCourses: isPopulated ? ids : undefined,
    // Timetable metadata — feeds the Schedule tab.
    subject: session.subject ?? "",
    educatorId: session.educatorId ?? null,
    endAt: session.endAt ?? null,
    recordingTargetFolderId: session.recordingTargetFolderId ?? null,
    status: session.status,
    scheduledAt: session.scheduledAt ?? null,
    streamId: session.streamId ?? null,
    rtmpUrl: session.rtmpUrl ?? null,
    hlsUrl: session.hlsUrl ?? null,
    hlsUrls: session.hlsUrls ?? null,
    recordings: session.recordings ?? [],
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

// Accepts either `liveCourseIds: [...]` (preferred — supports multiple courses
// per session) or `liveCourseId: "..."` (single-id convenience). Returns
// `provided: false` when the caller didn't include either field, so update
// handlers can distinguish "unchanged" from "set to empty".
const MAX_LIVE_COURSES_PER_SESSION = 20;

async function resolveLiveCourseIds(
  body: any
): Promise<{ provided: boolean; ids: Types.ObjectId[]; error?: string }> {
  const hasMulti  = body?.liveCourseIds !== undefined;
  const hasSingle = body?.liveCourseId  !== undefined;
  if (!hasMulti && !hasSingle) return { provided: false, ids: [] };

  const raw: unknown[] = [];
  if (hasMulti) {
    if (body.liveCourseIds === null || body.liveCourseIds === "") {
      // explicit clear
    } else if (Array.isArray(body.liveCourseIds)) {
      raw.push(...body.liveCourseIds);
    } else {
      return { provided: true, ids: [], error: "liveCourseIds must be an array of ObjectIds." };
    }
  }
  if (hasSingle && body.liveCourseId !== null && body.liveCourseId !== "") {
    raw.push(body.liveCourseId);
  }

  const seen = new Set<string>();
  const ids: Types.ObjectId[] = [];
  for (const r of raw) {
    if (typeof r !== "string" || !/^[0-9a-fA-F]{24}$/.test(r)) {
      return { provided: true, ids: [], error: "Each live course id must be a valid ObjectId." };
    }
    if (seen.has(r)) continue;
    seen.add(r);
    ids.push(new Types.ObjectId(r));
  }

  if (ids.length === 0) return { provided: true, ids: [] };
  if (ids.length > MAX_LIVE_COURSES_PER_SESSION) {
    return {
      provided: true,
      ids: [],
      error: `A live session can be linked to at most ${MAX_LIVE_COURSES_PER_SESSION} live courses.`,
    };
  }

  const found = await LiveCourse.find({ _id: { $in: ids } }).select("_id").lean();
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((d: any) => String(d._id)));
    const missing = ids.map(String).filter((id) => !foundSet.has(id));
    return {
      provided: true,
      ids: [],
      error: `Live course(s) not found: ${missing.join(", ")}.`,
    };
  }

  return { provided: true, ids };
}

// POST /api/v1/admin/live-sessions
// Two modes:
//  - `scheduledAt` in the future → store as SCHEDULED, no Streamos call yet.
//  - otherwise → create on Streamos immediately, status = CREATED.
export const createLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createLiveSession invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const titleRaw = req.body?.title;
    const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
    if (!title) return failure(res, "title is required.", 422);
    if (title.length > 500) return failure(res, "title is too long (max 500).", 422);

    const scheduledAt = parseScheduledAt(req.body?.scheduledAt);
    if (req.body?.scheduledAt !== undefined && req.body?.scheduledAt !== null && req.body?.scheduledAt !== "" && scheduledAt === undefined) {
      return failure(res, "scheduledAt must be a valid date.", 422);
    }

    const courseRef = await resolveLiveCourseIds(req.body);
    if (courseRef.error) return failure(res, courseRef.error, 422);
    if (courseRef.ids.length === 0) {
      return failure(res, "liveCourseIds is required (provide at least one live course).", 400);
    }

    // Optional recording target folder. Only valid when the session is
    // attached to at least one liveCourseId AND the folder belongs to one
    // of those courses.
    let recordingTargetFolderId: Types.ObjectId | null = null;
    if (req.body?.recordingTargetFolderId) {
      const folderRef = await validateRecordingTargetFolder(
        String(req.body.recordingTargetFolderId),
        courseRef.ids
      );
      if (folderRef.error) return failure(res, folderRef.error, 422);
      recordingTargetFolderId = folderRef.id;
    }

    // Optional timetable metadata — drives the Schedule tab.
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const endAtParsed = parseScheduledAt(req.body?.endAt);
    if (
      req.body?.endAt !== undefined && req.body?.endAt !== null && req.body?.endAt !== "" &&
      endAtParsed === undefined
    ) {
      return failure(res, "endAt must be a valid date.", 422);
    }
    const endAt = endAtParsed ?? null;
    let educatorId: Types.ObjectId | null = null;
    if (req.body?.educatorId) {
      if (!/^[0-9a-fA-F]{24}$/.test(String(req.body.educatorId))) {
        return failure(res, "educatorId must be a valid ObjectId.", 422);
      }
      educatorId = new Types.ObjectId(String(req.body.educatorId));
    }

    if (scheduledAt && scheduledAt.getTime() > Date.now()) {
      const session = await LiveSession.create({
        title,
        liveCourseIds: courseRef.ids,
        subject,
        educatorId,
        endAt,
        recordingTargetFolderId,
        scheduledAt,
        status: "SCHEDULED",
        recordings: [],
      });

      logger.info("createLiveSession scheduled", {
        traceId,
        sessionId: session._id,
        scheduledAt,
        liveCourseIds: courseRef.ids,
        recordingTargetFolderId,
      });
      return success(res, { session: publicView(session) }, "Live session scheduled.", 201);
    }

    // Immediate create (existing behaviour).
    const created = await streamosCreateStream(title);

    const session = await LiveSession.create({
      title,
      liveCourseIds: courseRef.ids,
      subject,
      educatorId,
      endAt,
      recordingTargetFolderId,
      streamId: created.streamId,
      rtmpUrl: created.rtmpUrl,
      hlsUrl: created.hlsUrl,
      hlsUrls: created.hlsUrls ?? null,
      status: "CREATED",
      recordings: [],
    });

    logger.info("createLiveSession success", { traceId, streamId: session.streamId, sessionId: session._id });
    return success(res, { session: publicView(session) }, "Live stream created.", 201);
  } catch (err) {
    if (err instanceof StreamosError) {
      logger.error("createLiveSession streamos error", {
        traceId,
        message: err.message,
        upstreamStatus: err.upstreamStatus,
      });
      return failure(res, err.message, err.status);
    }
    logger.error("createLiveSession failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create live stream.", 500);
  }
};

// GET /api/v1/admin/live-sessions
// Optional list. Filters: status, upcoming=true (SCHEDULED + scheduledAt>=now).
export const listLiveSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveSessions invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const upcoming = req.query.upcoming === "true";
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);

    const query: Record<string, any> = {};
    if (status) query.status = status;
    if (upcoming) {
      query.status = "SCHEDULED";
      query.scheduledAt = { $gte: new Date() };
    }

    // Course-scoped filtering. `liveCourseId=X` matches sessions where X is in
    // liveCourseIds (multi-course memberships included). `liveCourseIds=X,Y,Z`
    // matches sessions belonging to ANY of the listed courses.
    const courseIdFilters: string[] = [];
    if (typeof req.query.liveCourseId === "string" && req.query.liveCourseId.trim()) {
      courseIdFilters.push(req.query.liveCourseId.trim());
    }
    if (typeof req.query.liveCourseIds === "string" && req.query.liveCourseIds.trim()) {
      for (const part of req.query.liveCourseIds.split(",")) {
        const t = part.trim();
        if (t) courseIdFilters.push(t);
      }
    }
    if (courseIdFilters.length > 0) {
      const valid = courseIdFilters.filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
      if (valid.length === 0) {
        return failure(res, "liveCourseId/liveCourseIds must be valid ObjectIds.", 422);
      }
      query.liveCourseIds = { $in: valid.map((id) => new Types.ObjectId(id)) };
    }

    const [rows, total] = await Promise.all([
      LiveSession.find(query)
        .populate("liveCourseIds", "_id name image thumbnail")
        .sort({ scheduledAt: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      LiveSession.countDocuments(query),
    ]);

    return success(
      res,
      { sessions: rows.map(publicView), total, page, limit },
      "Live sessions fetched."
    );
  } catch (err) {
    logger.error("listLiveSessions failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list live sessions.", 500);
  }
};

// GET /api/v1/admin/live-sessions/:id    (id = Mongo _id or streamId)
// For CREATED and ENDED sessions we poll Streamos `streamDetails` because:
//  - CREATED: tells us liveness + current quality URLs.
//  - ENDED:   may already contain recordings — used as a recovery path if the
//             recording webhook was missed. We persist + flip status to READY.
export const getLiveSessionStatus = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getLiveSessionStatus invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const id = String(req.params.id ?? req.params.streamId ?? "");
    const session = await findSessionByAnyId(id);
    if (!session) return failure(res, "Live session not found.", 404);
    await session.populate("liveCourseIds", "_id name image thumbnail");

    let isLive = false;

    if (session.streamId && (session.status === "CREATED" || session.status === "ENDED")) {
      try {
        const details = await streamosGetStreamDetails(session.streamId);
        isLive = details.isLive;

        // Refresh URLs whenever Streamos reports newer ones.
        let dirty = false;
        if (details.hlsUrl && details.hlsUrl !== session.hlsUrl) {
          session.hlsUrl = details.hlsUrl;
          dirty = true;
        }
        if (details.hlsUrls && Object.keys(details.hlsUrls).length > 0) {
          session.hlsUrls = details.hlsUrls;
          dirty = true;
        }

        // Recovery: webhook missed but recordings already exist upstream.
        if (
          session.status === "ENDED" &&
          details.recordings.length > 0 &&
          (session.recordings?.length ?? 0) === 0
        ) {
          session.recordings = details.recordings;
          session.status = "READY";
          dirty = true;
          logger.info("getLiveSessionStatus recordings recovered", { traceId,
            sessionId: session._id,
            streamId: session.streamId,
            count: details.recordings.length,
          });
          // Same notification the webhook would have sent.
          const liveClassId = String(session.streamId);
          io?.to(roomKey(liveClassId)).emit("recordings_ready", {
            streamId: session.streamId,
            liveClassId,
            status: "READY",
            recordings: details.recordings,
          });
          // Mirror the webhook's auto-promote so a missed webhook doesn't
          // skip the configured target folder.
          await maybeAutoPromoteRecording(session);
        }

        if (dirty) await session.save();
      } catch (err) {
        if (err instanceof StreamosError) {
          logger.warn("getLiveSessionStatus streamos error", { traceId,
            sessionId: session._id,
            message: err.message,
            upstreamStatus: err.upstreamStatus,
          });
        } else {
          logger.warn("getLiveSessionStatus streamos error", { traceId,
            sessionId: session._id,
            error: getErrorMessage(err),
          });
        }
      }
    }

    // Every Video promoted from this session's recordings, across ALL folders
    // (a recording can be filed into several). Lets the admin "live section"
    // see at a glance where each recording has landed.
    const promotedVideos = await Video.find({ liveSessionId: session._id })
      .select("_id title videoCategoryId aws_id priceType order status createdAt")
      .sort({ createdAt: 1 })
      .lean();

    return success(
      res,
      {
        session: publicView(session),
        isLive,
        promotedVideos,
      },
      "Stream status fetched."
    );
  } catch (err) {
    logger.error("getLiveSessionStatus failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch stream status.", 500);
  }
};

// POST /api/v1/admin/live-sessions/:id/promote-recording
// Promote one of this session's Streamos recordings into ANY video category
// folder as a Video. The folder may belong to a live course OR a recorded
// course — recordings can be filed wherever they're needed. Idempotent per
// folder (re-promoting returns the existing Video). The created Video keeps a
// `liveSessionId` back-link so it stays traceable.
//
// Body: { folderId, recordingIndex?, quality?, title?, priceType?, order? }
//   - recordingIndex (0-based) OR quality ("720p" …) picks the recording;
//     omit both for the best-quality recording.
export const promoteSessionRecording = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("promoteSessionRecording invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const session = await findSessionByAnyId(String(req.params.id));
    if (!session) return failure(res, "Live session not found.", 404);
    if (!session.recordings || session.recordings.length === 0) {
      return failure(res, "This session has no recordings yet.", 409);
    }

    const folderId =
      typeof req.body?.folderId === "string" ? req.body.folderId.trim() : "";
    if (!Types.ObjectId.isValid(folderId)) {
      return failure(res, "A valid folderId is required.", 422);
    }
    const folder = await VideoCategory.findById(folderId).select("_id").lean();
    if (!folder) return failure(res, "Target folder not found.", 404);

    const rawIndex = req.body?.recordingIndex;
    const recordingIndex =
      rawIndex === undefined || rawIndex === null || rawIndex === ""
        ? undefined
        : Number(rawIndex);
    if (
      recordingIndex !== undefined &&
      (!Number.isInteger(recordingIndex) || recordingIndex < 0)
    ) {
      return failure(res, "recordingIndex must be a non-negative integer.", 422);
    }

    const quality =
      typeof req.body?.quality === "string" && req.body.quality.trim()
        ? req.body.quality.trim()
        : undefined;

    const recording = resolveRecording(session, { recordingIndex, quality });
    if (!recording) {
      return failure(
        res,
        quality
          ? `No recording with quality "${quality}".`
          : "No recording found at that index.",
        404
      );
    }

    const priceTypeRaw = req.body?.priceType;
    const priceType =
      priceTypeRaw === "free" || priceTypeRaw === "paid" ? priceTypeRaw : undefined;

    const title =
      typeof req.body?.title === "string" && req.body.title.trim()
        ? req.body.title.trim()
        : undefined;

    const rawOrder = req.body?.order;
    const order =
      rawOrder === undefined || rawOrder === null || rawOrder === ""
        ? undefined
        : Number(rawOrder);
    if (order !== undefined && !Number.isInteger(order)) {
      return failure(res, "order must be an integer.", 422);
    }

    const { video, alreadyExisted } = await promoteRecordingToFolder({
      session,
      recording,
      folderId,
      title,
      priceType,
      order,
    });

    logger.info("promoteSessionRecording success", { traceId,
      sessionId: session._id,
      folderId,
      quality: recording.quality,
      videoId: video._id,
      alreadyExisted,
    });

    return success(
      res,
      { video: video.toObject(), alreadyExisted },
      alreadyExisted
        ? "Recording already present in that folder."
        : "Recording promoted to folder.",
      alreadyExisted ? 200 : 201
    );
  } catch (err) {
    logger.error("promoteSessionRecording failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to promote recording.", 500);
  }
};

// GET /api/v1/admin/live-sessions/:id/attendance
// Who joined this live class, when, and for how long — one row per join→leave
// stint — plus a summary. Rows with leftAt: null are viewers still connected.
export const getLiveSessionAttendance = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getLiveSessionAttendance invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const session = await findSessionByAnyId(String(req.params.id));
    if (!session) return failure(res, "Live session not found.", 404);

    if (!session.streamId) {
      return success(
        res,
        { attendance: [], summary: { totalJoins: 0, uniqueViewers: 0, currentlyActive: 0 } },
        "Session has not started — no attendance yet."
      );
    }

    const records = await LiveSessionAttendance.find({ streamId: session.streamId })
      .sort({ joinedAt: -1 })
      .populate("customerId", "firstName middleName lastName phoneNumber")
      .lean();

    const uniqueViewers = new Set(
      records.map((r) => String((r.customerId as any)?._id ?? r.customerId))
    ).size;
    const currentlyActive = records.filter((r) => !r.leftAt).length;

    return success(
      res,
      {
        attendance: records,
        summary: { totalJoins: records.length, uniqueViewers, currentlyActive },
      },
      "Attendance fetched."
    );
  } catch (err) {
    logger.error("getLiveSessionAttendance failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch attendance.", 500);
  }
};

// POST /api/v1/admin/live-sessions/:id/start
// Promotes a SCHEDULED session to CREATED by calling Streamos. Only allowed
// when current time is within 2 minutes of scheduledAt; late starts are fine.
export const startScheduledLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("startScheduledLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const session = await findSessionByAnyId(String(req.params.id));
    if (!session) return failure(res, "Live session not found.", 404);

    if (session.status !== "SCHEDULED") {
      return failure(res, `Only SCHEDULED sessions can be started (current: ${session.status}).`, 409);
    }
    if (!session.scheduledAt) {
      return failure(res, "Session has no scheduledAt; cannot determine start window.", 422);
    }

    const earliest = session.scheduledAt.getTime() - START_WINDOW_MS;
    if (Date.now() < earliest) {
      const secondsRemaining = Math.ceil((earliest - Date.now()) / 1000);
      return failure(
        res,
        `Too early to start. You can start within 2 minutes of the scheduled time (in ${secondsRemaining}s).`,
        409
      );
    }

    const created = await streamosCreateStream(session.title);

    session.streamId = created.streamId;
    session.rtmpUrl = created.rtmpUrl;
    session.hlsUrl = created.hlsUrl;
    session.hlsUrls = created.hlsUrls ?? null;
    session.status = "CREATED";
    await session.save();

    logger.info("startScheduledLiveSession success", { traceId, sessionId: session._id, streamId: session.streamId });
    return success(res, { session: publicView(session) }, "Live stream started.");
  } catch (err) {
    if (err instanceof StreamosError) {
      logger.error("startScheduledLiveSession streamos error", { traceId,
        message: err.message,
        upstreamStatus: err.upstreamStatus,
      });
      return failure(res, err.message, err.status);
    }
    logger.error("startScheduledLiveSession failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to start live stream.", 500);
  }
};

// PATCH /api/v1/admin/live-sessions/:id
// Allowed only while SCHEDULED. Editable fields: title, scheduledAt.
export const updateScheduledLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("updateScheduledLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const session = await findSessionByAnyId(String(req.params.id));
    if (!session) return failure(res, "Live session not found.", 404);

    if (session.status !== "SCHEDULED") {
      return failure(res, `Only SCHEDULED sessions can be edited (current: ${session.status}).`, 409);
    }

    let changed = false;
    // Track scheduledAt edits specifically — a reschedule must re-point reminders.
    let scheduleChanged = false;

    if (req.body?.title !== undefined) {
      const t = typeof req.body.title === "string" ? req.body.title.trim() : "";
      if (!t) return failure(res, "title must be a non-empty string.", 422);
      if (t.length > 500) return failure(res, "title is too long (max 500).", 422);
      session.title = t;
      changed = true;
    }

    if (req.body?.scheduledAt !== undefined) {
      const parsed = parseScheduledAt(req.body.scheduledAt);
      if (parsed === undefined) return failure(res, "scheduledAt must be a valid date.", 422);
      if (parsed === null) return failure(res, "scheduledAt cannot be cleared on a SCHEDULED session.", 422);
      session.scheduledAt = parsed;
      changed = true;
      scheduleChanged = true;
    }

    const courseRef = await resolveLiveCourseIds(req.body);
    if (courseRef.error) return failure(res, courseRef.error, 422);
    if (courseRef.provided) {
      if (courseRef.ids.length === 0) {
        return failure(res, "liveCourseIds cannot be empty — a session must remain linked to at least one live course.", 400);
      }
      session.liveCourseIds = courseRef.ids;
      changed = true;
    }

    if (req.body?.recordingTargetFolderId !== undefined) {
      if (req.body.recordingTargetFolderId === null || req.body.recordingTargetFolderId === "") {
        session.recordingTargetFolderId = null;
      } else {
        // Validate against the about-to-be-saved set of courses (changes above
        // already applied to the in-memory doc).
        const folderRef = await validateRecordingTargetFolder(
          String(req.body.recordingTargetFolderId),
          session.liveCourseIds ?? []
        );
        if (folderRef.error) return failure(res, folderRef.error, 422);
        session.recordingTargetFolderId = folderRef.id;
      }
      changed = true;
    }

    // Timetable metadata.
    if (req.body?.subject !== undefined) {
      session.subject = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
      changed = true;
    }
    if (req.body?.endAt !== undefined) {
      const parsed = parseScheduledAt(req.body.endAt);
      if (parsed === undefined) return failure(res, "endAt must be a valid date.", 422);
      session.endAt = parsed; // Date, or null to clear
      changed = true;
    }
    if (req.body?.educatorId !== undefined) {
      if (req.body.educatorId === null || req.body.educatorId === "") {
        session.educatorId = null;
      } else {
        if (!/^[0-9a-fA-F]{24}$/.test(String(req.body.educatorId))) {
          return failure(res, "educatorId must be a valid ObjectId.", 422);
        }
        session.educatorId = new Types.ObjectId(String(req.body.educatorId));
      }
      changed = true;
    }

    if (!changed) {
      return failure(
        res,
        "Provide title, scheduledAt, liveCourseIds, recordingTargetFolderId, subject, endAt, or educatorId to update.",
        422
      );
    }

    await session.save();
    if (scheduleChanged) {
      // A reschedule must re-point every reminder's fire time + job so users
      // are still notified relative to the *new* start time.
      await syncRemindersForSession(String(session._id)).catch((e) =>
        logger.error("updateScheduledLiveSession reminder sync failed", { traceId, error: getErrorMessage(e) })
      );
    }
    logger.info("updateScheduledLiveSession success", { traceId, sessionId: session._id });
    return success(res, { session: publicView(session) }, "Live session updated.");
  } catch (err) {
    logger.error("updateScheduledLiveSession failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update live session.", 500);
  }
};

// DELETE /api/v1/admin/live-sessions/:id
// CREATED (currently live on Streamos) must be ended first.
export const deleteLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("deleteLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const session = await findSessionByAnyId(String(req.params.id));
    if (!session) return failure(res, "Live session not found.", 404);

    if (session.status === "CREATED") {
      return failure(res, "End the live stream before deleting.", 409);
    }

    await LiveSession.deleteOne({ _id: session._id });
    // Drop any user reminders + their pending notifications for this session.
    await cancelRemindersForSession(String(session._id)).catch((e) =>
      logger.error("deleteLiveSession reminder cleanup failed", { traceId, error: getErrorMessage(e) })
    );
    logger.info("deleteLiveSession success", { traceId, sessionId: session._id, status: session.status });
    return success(res, { id: String(session._id) }, "Live session deleted.");
  } catch (err) {
    logger.error("deleteLiveSession failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete live session.", 500);
  }
};

// POST /api/v1/admin/live-sessions/end
export const endLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("endLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const streamId = parseStreamIdParam(req.body?.streamId);
    if (!streamId) return failure(res, "Valid streamId is required.", 422);

    await streamosEndStream(streamId);

    const updated = await LiveSession.findOneAndUpdate(
      { streamId },
      { $set: { status: "ENDED" } },
      { new: true }
    );

    // Notify everyone in the live class room so their UI closes the player
    // and stops chat/poll input. liveClassId === String(streamId).
    const endedAt = new Date();
    const liveClassId = String(streamId);
    io?.to(roomKey(liveClassId)).emit("live_session_ended", {
      streamId,
      liveClassId,
      status: "ENDED",
      endedAt: endedAt.toISOString(),
    });

    // Close any still-open attendance rows — viewers' sockets may not
    // disconnect immediately when the stream ends.
    const closed = await LiveSessionAttendance.updateMany(
      { streamId, leftAt: null },
      [
        {
          $set: {
            leftAt: endedAt,
            durationSec: {
              $max: [
                0,
                { $round: [{ $divide: [{ $subtract: [endedAt, "$joinedAt"] }, 1000] }, 0] },
              ],
            },
          },
        },
      ]
    );

    logger.info("endLiveSession success", { traceId,
      streamId,
      found: Boolean(updated),
      attendanceClosed: closed.modifiedCount,
    });

    return success(
      res,
      { streamId, status: "ENDED" },
      "Live stream ended."
    );
  } catch (err) {
    if (err instanceof StreamosError) {
      logger.error("endLiveSession streamos error", { traceId,
        message: err.message,
        upstreamStatus: err.upstreamStatus,
      });
      return failure(res, err.message, err.status);
    }
    logger.error("endLiveSession failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to end live stream.", 500);
  }
};

// GET /api/v1/admin/live-sessions/streamos/recordings/:recordingId
// Wraps Streamos `uploadedVideoDetails` — used to look up a single past
// recording by its id (from the Streamos dashboard).
export const getUploadedVideoDetails = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getUploadedVideoDetails invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const recordingId = String(req.params.recordingId ?? "").trim();
    if (!recordingId) return failure(res, "recordingId is required.", 422);

    const details = await streamosGetUploadedVideoDetails(recordingId);
    return success(res, details, "Uploaded video details fetched.");
  } catch (err) {
    if (err instanceof StreamosError) {
      return failure(res, err.message, err.status);
    }
    logger.error("getUploadedVideoDetails failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch uploaded video details.", 500);
  }
};

// GET /api/v1/admin/live-sessions/streamos/org
// Returns the connected Streamos org — handy to verify accessKey + which
// webhook URL Streamos thinks it should post to.
export const getOrgDetails = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getOrgDetails invoked", { traceId, userId: _req.user?.id });

  try {
    const details = await streamosGetOrgDetails();
    // Don't leak accessSecret even though Streamos echoes it back.
    return success(
      res,
      {
        name: details.name,
        accessKey: details.accessKey,
        recordingWebhook: details.recordingWebhook,
      },
      "Org details fetched."
    );
  } catch (err) {
    if (err instanceof StreamosError) {
      return failure(res, err.message, err.status);
    }
    logger.error("getOrgDetails failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch org details.", 500);
  }
};

// POST /api/v1/admin/live-sessions/streamos/webhook
// Registers (or updates) the recording webhook URL Streamos will POST to.
// Body: { webhook: "https://your-host/api/v1/client/webhook/recording" }
export const updateRecordingWebhook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("updateRecordingWebhook invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const webhook = typeof req.body?.webhook === "string" ? req.body.webhook.trim() : "";
    if (!webhook) return failure(res, "webhook URL is required.", 422);
    try {
      // Reject anything that doesn't parse as a valid URL.
      // eslint-disable-next-line no-new
      new URL(webhook);
    } catch {
      return failure(res, "webhook must be a valid URL.", 422);
    }

    const result = await streamosUpdateWebhook(webhook);
    logger.info("updateRecordingWebhook success", { traceId, webhook });
    return success(res, { webhook, upstream: result }, "Webhook updated.");
  } catch (err) {
    if (err instanceof StreamosError) {
      return failure(res, err.message, err.status);
    }
    logger.error("updateRecordingWebhook failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update webhook.", 500);
  }
};

// POST /api/v1/client/webhook/recording  (public — called by Streamos)
// Authenticated via the STREAMOS_WEBHOOK_SECRET shared secret, passed either
// as `?key=` on the URL or in the `x-webhook-secret` header. Without this an
// attacker who guesses a streamId could inject arbitrary recording URLs and
// even auto-create Video records in a course folder.
export const recordingWebhook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("recordingWebhook invoked", { traceId, path: req.originalUrl });

  try {
    if (STREAMOS_WEBHOOK_SECRET) {
      const provided =
        (typeof req.query.key === "string" ? req.query.key : "") ||
        (typeof req.headers["x-webhook-secret"] === "string"
          ? (req.headers["x-webhook-secret"] as string)
          : "");
      if (!provided || !secretMatches(provided)) {
        logger.warn("recordingWebhook rejected missing secret", { traceId });
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }
    } else {
      logger.warn(
        "Recording webhook: STREAMOS_WEBHOOK_SECRET is not set — accepting request unauthenticated. Set it in production."
      );
    }

    const streamId = parseStreamIdParam(req.body?.streamId);
    const rawRecordings = req.body?.recordings;

    if (!streamId) {
      logger.warn("recordingWebhook invalid streamId", { traceId, body: req.body });
      return res.status(400).json({ success: false, message: "Invalid streamId." });
    }
    if (!Array.isArray(rawRecordings)) {
      logger.warn("recordingWebhook recordings not array", { traceId, streamId });
      return res.status(400).json({ success: false, message: "recordings must be an array." });
    }

    const recordings: ILiveSessionRecording[] = rawRecordings
      .filter((r: any) => r && typeof r.path === "string" && r.path.length > 0)
      .map((r: any) => ({
        quality: typeof r.quality === "string" ? r.quality : undefined,
        file_size: typeof r.file_size === "number" ? r.file_size : Number(r.file_size) || undefined,
        path: r.path,
      }));

    const updated = await LiveSession.findOneAndUpdate(
      { streamId },
      { $set: { recordings, status: "READY" } },
      { new: true }
    );

    if (!updated) {
      logger.warn("recordingWebhook stream not found", { traceId, streamId });
      return res.status(200).json({ success: true, message: "Acknowledged (no matching stream)." });
    }

    // If the admin pre-selected a target folder when scheduling, drop the
    // best-quality recording into it automatically. Non-fatal — admin can
    // still promote manually from the live tab if this fails.
    await maybeAutoPromoteRecording(updated);

    // Tell anyone still connected to the room that recordings are now
    // available. Clients can replace the "ended" UI with a "watch recording"
    // view without polling the GET endpoint.
    const liveClassId = String(streamId);
    io?.to(roomKey(liveClassId)).emit("recordings_ready", {
      streamId,
      liveClassId,
      status: "READY",
      recordings,
    });

    logger.info("recordingWebhook success", { traceId,
      streamId,
      recordingCount: recordings.length,
    });

    return res.status(200).json({ success: true, message: "Recording saved." });
  } catch (err) {
    logger.error("recordingWebhook failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return res.status(200).json({ success: false, message: "Internal error logged." });
  }
};
