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
  resolveRecording,
  promoteRecordingToFolder,
} from "./recording.promote";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  syncRemindersForSession,
  cancelRemindersForSession,
} from "../../client/live-reminder/live-reminder.service";
import * as adminLiveSql from "../../modules/admin-live/admin-live.service";
import { isAdminLiveMysql } from "../../modules/admin-live/admin-live.service";

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

// SQL-branch equivalent of resolveLiveCourseIds' body parsing: gather the raw
// id strings from `liveCourseIds` (array) and/or `liveCourseId` (single).
// Returns null if `liveCourseIds` is present but not an array/clear sentinel.
// `provided=false` (caller distinguishes) is signalled by an empty array when
// neither field is present.
function collectLiveCourseIdStrings(body: any): string[] | null {
  const hasMulti = body?.liveCourseIds !== undefined;
  const hasSingle = body?.liveCourseId !== undefined;
  const raw: string[] = [];
  if (hasMulti) {
    if (body.liveCourseIds === null || body.liveCourseIds === "") {
      // explicit clear
    } else if (Array.isArray(body.liveCourseIds)) {
      raw.push(...body.liveCourseIds.map((v: unknown) => String(v)));
    } else {
      return null;
    }
  }
  if (hasSingle && body.liveCourseId !== null && body.liveCourseId !== "") {
    raw.push(String(body.liveCourseId));
  }
  return raw;
}

// Whether the body provided a liveCourse linkage field at all (update handlers
// need "unchanged" vs "set to empty").
function liveCourseFieldProvided(body: any): boolean {
  return body?.liveCourseIds !== undefined || body?.liveCourseId !== undefined;
}

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

    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const rawCourseIds = collectLiveCourseIdStrings(req.body);
      if (rawCourseIds === null) {
        return failure(res, "liveCourseIds must be an array of ids.", 422);
      }
      const courseSql = await adminLiveSql.validateLiveCourseIds(rawCourseIds);
      if (courseSql.error) return failure(res, courseSql.error, 422);
      if (courseSql.ids.length === 0) {
        return failure(res, "liveCourseIds is required (provide at least one live course).", 400);
      }

      const subjectSql = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
      if (!subjectSql) {
        return failure(
          res,
          "subject is required — recordings are auto-grouped into a folder named after it.",
          422
        );
      }
      if (subjectSql.length > 300) return failure(res, "subject is too long (max 300).", 422);

      const endAtParsedSql = parseScheduledAt(req.body?.endAt);
      if (
        req.body?.endAt !== undefined && req.body?.endAt !== null && req.body?.endAt !== "" &&
        endAtParsedSql === undefined
      ) {
        return failure(res, "endAt must be a valid date.", 422);
      }
      const endAtSql = endAtParsedSql ?? null;

      let educatorIdSql: number | null = null;
      if (req.body?.educatorId) {
        const e = adminLiveSql.parseAlId(String(req.body.educatorId));
        if (e == null) return failure(res, "educatorId must be a valid id.", 422);
        educatorIdSql = e;
      }

      if (scheduledAt && scheduledAt.getTime() > Date.now()) {
        const { row, liveCourseIds } = await adminLiveSql.createSession({
          title,
          liveCourseIds: courseSql.ids,
          subject: subjectSql,
          educatorId: educatorIdSql,
          endAt: endAtSql,
          scheduledAt,
          status: "SCHEDULED",
        });
        logger.info("createLiveSession scheduled (sql)", { traceId, sessionId: row.id });
        return success(
          res,
          { session: adminLiveSql.toPublicView(row, liveCourseIds) },
          "Live session scheduled.",
          201
        );
      }

      // Immediate create — StreamOS first (unchanged), then SQL persist.
      const createdSql = await streamosCreateStream(title);
      const { row, liveCourseIds } = await adminLiveSql.createSession({
        title,
        liveCourseIds: courseSql.ids,
        subject: subjectSql,
        educatorId: educatorIdSql,
        endAt: endAtSql,
        status: "CREATED",
        streamId: createdSql.streamId,
        rtmpUrl: createdSql.rtmpUrl,
        hlsUrl: createdSql.hlsUrl,
        hlsUrls: createdSql.hlsUrls ?? null,
      });
      logger.info("createLiveSession success (sql)", { traceId, streamId: row.streamId, sessionId: row.id });
      return success(
        res,
        { session: adminLiveSql.toPublicView(row, liveCourseIds) },
        "Live stream created.",
        201
      );
    }

    const courseRef = await resolveLiveCourseIds(req.body);
    if (courseRef.error) return failure(res, courseRef.error, 422);
    if (courseRef.ids.length === 0) {
      return failure(res, "liveCourseIds is required (provide at least one live course).", 400);
    }

    // Subject — required. Drives the Schedule tab AND the subject-based
    // auto folder grouping when recordings arrive (one VideoCategory per
    // (liveCourse, normalized subject)).
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    if (!subject) {
      return failure(
        res,
        "subject is required — recordings are auto-grouped into a folder named after it.",
        422
      );
    }
    if (subject.length > 300) {
      return failure(res, "subject is too long (max 300).", 422);
    }
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
        scheduledAt,
        status: "SCHEDULED",
        recordings: [],
      });

      logger.info("createLiveSession scheduled", {
        traceId,
        sessionId: session._id,
        scheduledAt,
        liveCourseIds: courseRef.ids,
        subject,
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

    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const courseIdFiltersSql: string[] = [];
      if (typeof req.query.liveCourseId === "string" && req.query.liveCourseId.trim()) {
        courseIdFiltersSql.push(req.query.liveCourseId.trim());
      }
      if (typeof req.query.liveCourseIds === "string" && req.query.liveCourseIds.trim()) {
        for (const part of req.query.liveCourseIds.split(",")) {
          const t = part.trim();
          if (t) courseIdFiltersSql.push(t);
        }
      }
      let courseIdsSql: number[] | undefined;
      if (courseIdFiltersSql.length > 0) {
        const valid = courseIdFiltersSql
          .map((id) => adminLiveSql.parseAlId(id))
          .filter((n): n is number => n != null);
        if (valid.length === 0) {
          return failure(res, "liveCourseId/liveCourseIds must be valid ids.", 422);
        }
        courseIdsSql = valid;
      }

      const { rows, total } = await adminLiveSql.listSessions({
        status,
        upcoming,
        courseIds: courseIdsSql,
        skip: (page - 1) * limit,
        take: limit,
      });
      const sessions = await Promise.all(
        rows.map(async (row) => {
          const courses = await adminLiveSql.getLinkedCourses(row.id);
          return adminLiveSql.toPublicView(
            row,
            courses.map((c) => Number(c._id)),
            courses
          );
        })
      );
      return success(res, { sessions, total, page, limit }, "Live sessions fetched.");
    }

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

    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      let row = await adminLiveSql.findSessionByAnyId(id);
      if (!row) return failure(res, "Live session not found.", 404);

      let isLive = false;
      if (row.streamId && (row.status === "CREATED" || row.status === "ENDED")) {
        try {
          const details = await streamosGetStreamDetails(row.streamId);
          isLive = details.isLive;

          const patch: { hlsUrl?: string | null; hlsUrls?: any; recordings?: any; status?: string } = {};
          if (details.hlsUrl && details.hlsUrl !== row.hlsUrl) patch.hlsUrl = details.hlsUrl;
          if (details.hlsUrls && Object.keys(details.hlsUrls).length > 0) patch.hlsUrls = details.hlsUrls;

          const hadRecordings = (adminLiveSql.toPublicView(row, []).recordings.length) > 0;
          if (row.status === "ENDED" && details.recordings.length > 0 && !hadRecordings) {
            patch.recordings = details.recordings;
            patch.status = "READY";
            logger.info("getLiveSessionStatus recordings recovered (sql)", {
              traceId, sessionId: row.id, streamId: row.streamId, count: details.recordings.length,
            });
            const liveClassId = String(row.streamId);
            io?.to(roomKey(liveClassId)).emit("recordings_ready", {
              streamId: row.streamId,
              liveClassId,
              status: "READY",
              recordings: details.recordings,
            });
            // C7: mirror the webhook's auto-promote so a missed webhook still
            // files the recording into the subject folder (best-effort).
            const courseIdsForPromote = await adminLiveSql.getLinkedCourseIds(row.id);
            await adminLiveSql.maybeAutoPromoteRecordingSql({
              sessionId: row.id,
              sessionTitle: row.title ?? null,
              subject: row.subject ?? null,
              recordings: details.recordings,
              liveCourseIds: courseIdsForPromote,
            });
          }
          if (Object.keys(patch).length > 0) {
            row = await adminLiveSql.updateSession(row.id, patch);
          }
        } catch (err) {
          if (err instanceof StreamosError) {
            logger.warn("getLiveSessionStatus streamos error (sql)", {
              traceId, sessionId: row.id, message: err.message, upstreamStatus: err.upstreamStatus,
            });
          } else {
            logger.warn("getLiveSessionStatus streamos error (sql)", {
              traceId, sessionId: row.id, error: getErrorMessage(err),
            });
          }
        }
      }

      const courses = await adminLiveSql.getLinkedCourses(row.id);
      // C7: promotedVideos resolved via ws_video.live_session_id.
      const promotedVideosSql = await adminLiveSql.resolvePromotedVideosSql(row.id);
      return success(
        res,
        {
          session: adminLiveSql.toPublicView(row, courses.map((c) => Number(c._id)), courses),
          isLive,
          promotedVideos: promotedVideosSql,
        },
        "Stream status fetched."
      );
    }

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
    // ── MySQL branch ─────────────────────────────────────────────────────────
    // C7: full SQL promotion (ws_video.live_session_id + ws_video_category.
    // subject_key now exist). Validate the request the same way as Mongo, then
    // delegate the DB work to the service.
    if (isAdminLiveMysql()) {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      const recsSql = adminLiveSql.toPublicView(rowSql, []).recordings;
      if (recsSql.length === 0) {
        return failure(res, "This session has no recordings yet.", 409);
      }

      const folderIdRawSql =
        typeof req.body?.folderId === "string" || typeof req.body?.folderId === "number"
          ? String(req.body.folderId).trim()
          : "";
      const folderIdSql = adminLiveSql.parseAlId(folderIdRawSql);
      if (folderIdSql == null) {
        return failure(res, "A valid folderId is required.", 422);
      }

      const rawIndexSql = req.body?.recordingIndex;
      const recordingIndexSql =
        rawIndexSql === undefined || rawIndexSql === null || rawIndexSql === ""
          ? undefined
          : Number(rawIndexSql);
      if (
        recordingIndexSql !== undefined &&
        (!Number.isInteger(recordingIndexSql) || recordingIndexSql < 0)
      ) {
        return failure(res, "recordingIndex must be a non-negative integer.", 422);
      }

      const qualitySql =
        typeof req.body?.quality === "string" && req.body.quality.trim()
          ? req.body.quality.trim()
          : undefined;

      const priceTypeRawSql = req.body?.priceType;
      const priceTypeSql =
        priceTypeRawSql === "free" || priceTypeRawSql === "paid" ? priceTypeRawSql : undefined;

      const titleSql =
        typeof req.body?.title === "string" && req.body.title.trim()
          ? req.body.title.trim()
          : undefined;

      const rawOrderSql = req.body?.order;
      const orderSql =
        rawOrderSql === undefined || rawOrderSql === null || rawOrderSql === ""
          ? undefined
          : Number(rawOrderSql);
      if (orderSql !== undefined && !Number.isInteger(orderSql)) {
        return failure(res, "order must be an integer.", 422);
      }

      const resultSql = await adminLiveSql.promoteSessionRecordingSql({
        sessionId: rowSql.id,
        folderId: folderIdSql,
        recordingIndex: recordingIndexSql,
        quality: qualitySql,
        title: titleSql,
        priceType: priceTypeSql,
        order: orderSql,
      });

      if (resultSql === "session_not_found") return failure(res, "Live session not found.", 404);
      if (resultSql === "no_recordings")
        return failure(res, "This session has no recordings yet.", 409);
      if (resultSql === "folder_not_found")
        return failure(res, "Target folder not found.", 404);
      if (resultSql === "recording_not_found")
        return failure(
          res,
          qualitySql ? `No recording with quality "${qualitySql}".` : "No recording found at that index.",
          404
        );
      if (resultSql === "no_path")
        return failure(res, "Recording has no playable path.", 422);

      logger.info("promoteSessionRecording success (sql)", {
        traceId,
        sessionId: rowSql.id,
        folderId: folderIdSql,
        videoId: resultSql.video._id,
        alreadyExisted: resultSql.alreadyExisted,
      });
      return success(
        res,
        { video: resultSql.video, alreadyExisted: resultSql.alreadyExisted },
        resultSql.alreadyExisted
          ? "Recording already present in that folder."
          : "Recording promoted to folder.",
        resultSql.alreadyExisted ? 200 : 201
      );
    }

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
    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      if (!rowSql.streamId) {
        return success(
          res,
          { attendance: [], summary: { totalJoins: 0, uniqueViewers: 0, currentlyActive: 0 } },
          "Session has not started — no attendance yet."
        );
      }
      const { records: recsSql, summary } = await adminLiveSql.getAttendance(rowSql.streamId);
      return success(res, { attendance: recsSql, summary }, "Attendance fetched.");
    }

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
    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      if (rowSql.status !== "SCHEDULED") {
        return failure(res, `Only SCHEDULED sessions can be started (current: ${rowSql.status}).`, 409);
      }
      if (!rowSql.scheduledAt) {
        return failure(res, "Session has no scheduledAt; cannot determine start window.", 422);
      }
      const earliestSql = rowSql.scheduledAt.getTime() - START_WINDOW_MS;
      if (Date.now() < earliestSql) {
        const secondsRemaining = Math.ceil((earliestSql - Date.now()) / 1000);
        return failure(
          res,
          `Too early to start. You can start within 2 minutes of the scheduled time (in ${secondsRemaining}s).`,
          409
        );
      }
      const createdSql = await streamosCreateStream(rowSql.title ?? "");
      const updatedSql = await adminLiveSql.updateSession(rowSql.id, {
        streamId: createdSql.streamId,
        rtmpUrl: createdSql.rtmpUrl,
        hlsUrl: createdSql.hlsUrl,
        hlsUrls: createdSql.hlsUrls ?? null,
        status: "CREATED",
      });
      const coursesSql = await adminLiveSql.getLinkedCourses(updatedSql.id);
      logger.info("startScheduledLiveSession success (sql)", { traceId, sessionId: updatedSql.id, streamId: updatedSql.streamId });
      return success(
        res,
        { session: adminLiveSql.toPublicView(updatedSql, coursesSql.map((c) => Number(c._id)), coursesSql) },
        "Live stream started."
      );
    }

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
    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      if (rowSql.status !== "SCHEDULED") {
        return failure(res, `Only SCHEDULED sessions can be edited (current: ${rowSql.status}).`, 409);
      }

      const patch: {
        title?: string;
        subject?: string;
        educatorId?: number | null;
        endAt?: Date | null;
        scheduledAt?: Date | null;
      } = {};
      let changedSql = false;
      let scheduleChangedSql = false;
      let courseIdsToSet: number[] | null = null;

      if (req.body?.title !== undefined) {
        const t = typeof req.body.title === "string" ? req.body.title.trim() : "";
        if (!t) return failure(res, "title must be a non-empty string.", 422);
        if (t.length > 500) return failure(res, "title is too long (max 500).", 422);
        patch.title = t;
        changedSql = true;
      }
      if (req.body?.scheduledAt !== undefined) {
        const parsed = parseScheduledAt(req.body.scheduledAt);
        if (parsed === undefined) return failure(res, "scheduledAt must be a valid date.", 422);
        if (parsed === null) return failure(res, "scheduledAt cannot be cleared on a SCHEDULED session.", 422);
        patch.scheduledAt = parsed;
        changedSql = true;
        scheduleChangedSql = true;
      }
      if (liveCourseFieldProvided(req.body)) {
        const rawIds = collectLiveCourseIdStrings(req.body);
        if (rawIds === null) return failure(res, "liveCourseIds must be an array of ids.", 422);
        const courseSql = await adminLiveSql.validateLiveCourseIds(rawIds);
        if (courseSql.error) return failure(res, courseSql.error, 422);
        if (courseSql.ids.length === 0) {
          return failure(res, "liveCourseIds cannot be empty — a session must remain linked to at least one live course.", 400);
        }
        courseIdsToSet = courseSql.ids;
        changedSql = true;
      }
      if (req.body?.subject !== undefined) {
        const next = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
        if (!next) return failure(res, "subject cannot be empty.", 422);
        if (next.length > 300) return failure(res, "subject is too long (max 300).", 422);
        patch.subject = next;
        changedSql = true;
      }
      if (req.body?.endAt !== undefined) {
        const parsed = parseScheduledAt(req.body.endAt);
        if (parsed === undefined) return failure(res, "endAt must be a valid date.", 422);
        patch.endAt = parsed;
        changedSql = true;
      }
      if (req.body?.educatorId !== undefined) {
        if (req.body.educatorId === null || req.body.educatorId === "") {
          patch.educatorId = null;
        } else {
          const e = adminLiveSql.parseAlId(String(req.body.educatorId));
          if (e == null) return failure(res, "educatorId must be a valid id.", 422);
          patch.educatorId = e;
        }
        changedSql = true;
      }

      if (!changedSql) {
        return failure(
          res,
          "Provide title, scheduledAt, liveCourseIds, subject, endAt, or educatorId to update.",
          422
        );
      }

      let updatedSql = rowSql;
      if (Object.keys(patch).length > 0) {
        updatedSql = await adminLiveSql.updateSession(rowSql.id, patch);
      }
      if (courseIdsToSet) {
        await adminLiveSql.setLinkedCourseIds(rowSql.id, courseIdsToSet);
      }
      if (scheduleChangedSql) {
        await syncRemindersForSession(String(rowSql.id)).catch((e) =>
          logger.error("updateScheduledLiveSession reminder sync failed (sql)", { traceId, error: getErrorMessage(e) })
        );
      }
      const coursesSql = await adminLiveSql.getLinkedCourses(rowSql.id);
      logger.info("updateScheduledLiveSession success (sql)", { traceId, sessionId: rowSql.id });
      return success(
        res,
        { session: adminLiveSql.toPublicView(updatedSql, coursesSql.map((c) => Number(c._id)), coursesSql) },
        "Live session updated."
      );
    }

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

    // Timetable metadata. Subject can't be cleared — it's the grouping key
    // for recordings, so changing it is allowed but blanking it isn't.
    if (req.body?.subject !== undefined) {
      const next = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
      if (!next) {
        return failure(res, "subject cannot be empty.", 422);
      }
      if (next.length > 300) {
        return failure(res, "subject is too long (max 300).", 422);
      }
      session.subject = next;
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
        "Provide title, scheduledAt, liveCourseIds, subject, endAt, or educatorId to update.",
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
    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      if (rowSql.status === "CREATED") {
        return failure(res, "End the live stream before deleting.", 409);
      }
      await adminLiveSql.deleteSession(rowSql.id);
      await cancelRemindersForSession(String(rowSql.id)).catch((e) =>
        logger.error("deleteLiveSession reminder cleanup failed (sql)", { traceId, error: getErrorMessage(e) })
      );
      logger.info("deleteLiveSession success (sql)", { traceId, sessionId: rowSql.id, status: rowSql.status });
      return success(res, { id: String(rowSql.id) }, "Live session deleted.");
    }

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

    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const updatedSql = await adminLiveSql.updateByStreamId(streamId, { status: "ENDED" });

      const endedAtSql = new Date();
      const liveClassIdSql = String(streamId);
      io?.to(roomKey(liveClassIdSql)).emit("live_session_ended", {
        streamId,
        liveClassId: liveClassIdSql,
        status: "ENDED",
        endedAt: endedAtSql.toISOString(),
      });

      const closedSql = await adminLiveSql.closeOpenAttendance(streamId, endedAtSql);
      logger.info("endLiveSession success (sql)", {
        traceId, streamId, found: Boolean(updatedSql), attendanceClosed: closedSql,
      });
      return success(res, { streamId, status: "ENDED" }, "Live stream ended.");
    }

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

// GET /api/v1/admin/live-sessions/:id/recording-health
// Read-only end-to-end diagnostic of the Streamos recording pipeline for one
// session: config → webhook registration → session state → whether Streamos
// actually holds the recording. Returns a per-check pass/warn/fail report so an
// admin can tell whether "Waiting for Streamos webhook" is normal (still
// processing) or a real wiring problem — without trawling logs by hand.
export const getRecordingHealth = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getRecordingHealth invoked", { traceId, sessionId: req.params.id, userId: req.user?.id });

  try {
    const id = String(req.params.id ?? "");

    // Normalize the session snapshot across the MySQL / Mongo branches.
    let snap: { status: string; streamId: string | null; recordingsOnSession: number } | null = null;
    if (isAdminLiveMysql()) {
      const row = await adminLiveSql.findSessionByAnyId(id);
      if (row) snap = { status: String(row.status), streamId: row.streamId ?? null, recordingsOnSession: adminLiveSql.toPublicView(row, []).recordings.length };
    } else {
      const session = await findSessionByAnyId(id);
      if (session) snap = { status: String(session.status), streamId: session.streamId ?? null, recordingsOnSession: session.recordings?.length ?? 0 };
    }
    if (!snap) return failure(res, "Live session not found.", 404);

    type Check = { key: string; label: string; status: "ok" | "warn" | "fail" | "info"; detail: string };
    const checks: Check[] = [];

    // 1) Webhook shared secret configured.
    const secretSet = STREAMOS_WEBHOOK_SECRET.length > 0;
    checks.push({
      key: "webhookSecret",
      label: "Webhook secret (STREAMOS_WEBHOOK_SECRET)",
      status: secretSet ? "ok" : "warn",
      detail: secretSet ? "Configured." : "Not set — the public webhook is accepted unauthenticated. Set it in production.",
    });

    // 2) Streamos credentials + 3) webhook registration (orgDetails proves both).
    let webhook: { registeredUrl: string | null; pathOk: boolean; hasKeyParam: boolean } = { registeredUrl: null, pathOk: false, hasKeyParam: false };
    try {
      const org = await streamosGetOrgDetails();
      checks.push({ key: "streamosCreds", label: "Streamos credentials", status: "ok", detail: `Connected to org "${org.name ?? "unknown"}".` });

      const url = org.recordingWebhook ?? "";
      const pathOk = url.includes("/client/webhook/recording");
      const hasKeyParam = /[?&]key=/.test(url);
      webhook = { registeredUrl: url || null, pathOk, hasKeyParam };

      let regStatus: Check["status"] = "ok";
      let detail = `Registered: ${url}`;
      if (!url) {
        regStatus = "fail";
        detail = "No recording webhook registered — Streamos has nowhere to deliver recordings. Register via POST /admin/live-sessions/streamos/webhook.";
      } else if (!pathOk) {
        regStatus = "warn";
        detail = `Registered URL does not point at /client/webhook/recording: ${url}`;
      } else if (secretSet && !hasKeyParam) {
        regStatus = "warn";
        detail = `Registered without a ?key= but STREAMOS_WEBHOOK_SECRET is set — Streamos callbacks will be 401-rejected: ${url}`;
      }
      checks.push({ key: "webhookRegistered", label: "Recording webhook registered on Streamos", status: regStatus, detail });
    } catch (err) {
      const msg = err instanceof StreamosError ? err.message : getErrorMessage(err);
      checks.push({ key: "streamosCreds", label: "Streamos credentials", status: "fail", detail: msg });
      checks.push({ key: "webhookRegistered", label: "Recording webhook registered on Streamos", status: "fail", detail: "Skipped — could not reach Streamos." });
    }

    // 4) Session state (informational).
    checks.push({
      key: "sessionState",
      label: "Session state",
      status: "info",
      detail: `status=${snap.status}, streamId=${snap.streamId ?? "none"}, recordingsOnSession=${snap.recordingsOnSession}`,
    });

    // 5) Does Streamos actually hold the recording for this stream?
    let streamos: { reachable: boolean; isLive?: boolean; recordingsOnStreamos?: number; error?: string } = { reachable: false };
    if (!snap.streamId) {
      checks.push({ key: "recordingDelivery", label: "Recording delivery", status: "warn", detail: "Session has no streamId — it was never created on Streamos." });
    } else {
      try {
        const details = await streamosGetStreamDetails(snap.streamId);
        streamos = { reachable: true, isLive: details.isLive, recordingsOnStreamos: details.recordings.length };
        if (details.isLive) {
          checks.push({ key: "recordingDelivery", label: "Recording delivery", status: "info", detail: "Stream is still LIVE — recordings are produced after it ends." });
        } else if (details.recordings.length === 0) {
          checks.push({ key: "recordingDelivery", label: "Recording delivery", status: snap.status === "READY" ? "ok" : "warn", detail: "No recording on Streamos yet — still processing, or the stream was too short / not recorded." });
        } else if (snap.recordingsOnSession === 0) {
          checks.push({ key: "recordingDelivery", label: "Recording delivery", status: "warn", detail: `Streamos has ${details.recordings.length} recording(s) but they are not on the session — the webhook was missed. Open/reload the session to trigger the recovery sync.` });
        } else {
          checks.push({ key: "recordingDelivery", label: "Recording delivery", status: "ok", detail: "Recording present on both Streamos and the session." });
        }
      } catch (err) {
        const msg = err instanceof StreamosError ? err.message : getErrorMessage(err);
        streamos = { reachable: false, error: msg };
        checks.push({ key: "recordingDelivery", label: "Recording delivery", status: "fail", detail: `Could not query Streamos for this stream: ${msg}` });
      }
    }

    const hasFail = checks.some((c) => c.status === "fail");
    const hasWarn = checks.some((c) => c.status === "warn");
    const overall: "ok" | "warn" | "fail" = hasFail ? "fail" : hasWarn ? "warn" : "ok";
    const summary =
      overall === "ok" ? "Recording pipeline looks healthy."
      : overall === "warn" ? "Pipeline is wired but something needs attention — see checks."
      : "Recording pipeline has a blocking problem — see checks.";
    const recommendations = checks.filter((c) => c.status === "warn" || c.status === "fail").map((c) => `${c.label}: ${c.detail}`);

    return success(
      res,
      { sessionId: id, session: snap, webhook, streamos, checks, verdict: { overall, summary, recommendations } },
      "Recording health computed."
    );
  } catch (err) {
    logger.error("getRecordingHealth failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to compute recording health.", 500);
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

    // Streamos has shipped paths with a stray trailing quote (raw `"`,
    // URL-encoded `%22`, or even `%2522` from double-encoding). Strip
    // defensively so we don't persist unplayable URLs.
    const stripTrailingQuote = (s: string) => s.replace(/(?:"|%22|%2522)+$/i, "");
    const recordings: ILiveSessionRecording[] = rawRecordings
      .filter((r: any) => r && typeof r.path === "string" && r.path.length > 0)
      .map((r: any) => ({
        quality: typeof r.quality === "string" ? r.quality : undefined,
        file_size: typeof r.file_size === "number" ? r.file_size : Number(r.file_size) || undefined,
        path: stripTrailingQuote(r.path),
      }));

    // ── MySQL branch ─────────────────────────────────────────────────────────
    if (isAdminLiveMysql()) {
      const updatedSql = await adminLiveSql.updateByStreamId(streamId, {
        recordings,
        status: "READY",
      });
      if (!updatedSql) {
        logger.warn("recordingWebhook stream not found (sql)", { traceId, streamId });
        return res.status(200).json({ success: true, message: "Acknowledged (no matching stream)." });
      }
      // C7: auto-promote the best recording into each linked course's subject
      // folder (best-effort — never throws).
      const courseIdsForPromoteSql = await adminLiveSql.getLinkedCourseIds(updatedSql.id);
      await adminLiveSql.maybeAutoPromoteRecordingSql({
        sessionId: updatedSql.id,
        sessionTitle: updatedSql.title ?? null,
        subject: updatedSql.subject ?? null,
        recordings,
        liveCourseIds: courseIdsForPromoteSql,
      });
      const liveClassIdSql = String(streamId);
      io?.to(roomKey(liveClassIdSql)).emit("recordings_ready", {
        streamId,
        liveClassId: liveClassIdSql,
        status: "READY",
        recordings,
      });
      logger.info("recordingWebhook success (sql)", { traceId, streamId, recordingCount: recordings.length });
      return res.status(200).json({ success: true, message: "Recording saved." });
    }

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
