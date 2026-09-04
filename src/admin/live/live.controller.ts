import { Request, Response } from "express";
import crypto from "crypto";
import {
  getUploadedVideoDetails as streamosGetUploadedVideoDetails,
  getOrgDetails as streamosGetOrgDetails,
  updateWebhook as streamosUpdateWebhook,
  enrichMp4Sizes as streamosEnrichMp4Sizes,
  StreamosError,
} from "./streamos.service";
// Provider-agnostic StreamOS surface. Dispatches per SESSION (a row's own
// streamProvider), so legacy sessions keep resolving against the legacy API even
// after STREAMOS_PROVIDER is flipped to v1. See streamos.provider.ts.
import {
  provisionStream as streamosProvision,
  startStream as streamosStartStream,
  endStream as streamosEndStream,
  getDetails as streamosGetDetails,
  pushCredentialsExpired,
  providerOf,
} from "./streamos.provider";
import { streamosV1ApiKey, streamosV1WebhookSecret } from "../../config/streamos";
import { verifyStreamosSignature } from "../../utils/streamosSignature";
import {
  resolveSession as resolveV1Session,
  applyEvent as applyV1Event,
  isForeignEnvironment as isForeignV1Environment,
} from "./streamos.v1.webhook";
import { isStreamosV1 } from "../../config/streamos";
import {
  registerWebhook as streamosV1RegisterWebhook,
  getAsset as streamosV1GetAsset,
  listWebhooks as streamosV1ListWebhooks,
  type StreamosV1Event,
} from "./streamos.v1.service";

// The events our recording pipeline depends on. RECORDING_READY stores the asset
// pointer; TRANSCODING_COMPLETED is the one that actually publishes a playable
// recording; FAILED stops us advertising a replay that will never exist.
const REQUIRED_V1_WEBHOOK_EVENTS: StreamosV1Event[] = [
  "LIVESTREAM_ENDED",
  "LIVESTREAM_RECORDING_READY",
  "VIDEO_TRANSCODING_COMPLETED",
  "VIDEO_TRANSCODING_FAILED",
];
import { io, roomKey } from "../../socket/livechat.socket";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  syncRemindersForSession,
  cancelRemindersForSession,
} from "../../client/live-reminder/live-reminder.service";
import * as adminLiveSql from "../../modules/admin-live/admin-live.service";

// Shape of a single StreamOS recording entry (quality ladder / MP4 variant).
// Formerly imported from the (now-removed) Mongo LiveSession model — inlined so
// this controller no longer depends on Mongoose. Field shape is unchanged, so
// the recording JSON persisted/returned is identical.
type ILiveSessionRecording = {
  quality?: string;
  file_size?: number;
  path: string;
};

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

// POST /api/v1/admin/live-sessions
// Always persists a SCHEDULED session — creating never starts the stream, whether
// "schedule for later" (scheduledAt set) or "go live now" (scheduledAt null). The
// StreamOS stream is created only via POST /:id/start. Body: { title, liveCourseIds,
// liveCourseFolders:[{liveCourseId,folderId}], scheduledAt?, endAt? }.
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

      const rawCourseIds = collectLiveCourseIdStrings(req.body);
      if (rawCourseIds === null) {
        return failure(res, "liveCourseIds must be an array of ids.", 422);
      }
      const courseSql = await adminLiveSql.validateLiveCourseIds(rawCourseIds);
      if (courseSql.error) return failure(res, courseSql.error, 422);
      if (courseSql.ids.length === 0) {
        return failure(res, "liveCourseIds is required (provide at least one live course).", 400);
      }

      // Per-course recording folder selection replaces the old `subject` folder.
      // Each folderId must belong to its liveCourseId. `subject` is no longer read.
      const folderValSql = await adminLiveSql.validateLiveCourseFolders(
        req.body?.liveCourseFolders,
        courseSql.ids
      );
      if (folderValSql.error) return failure(res, folderValSql.error, 422);
      const folderByCourseSql = new Map(folderValSql.links.map((l) => [l.liveCourseId, l.folderId]));
      const courseFoldersSql = courseSql.ids.map((liveCourseId) => ({
        liveCourseId,
        folderId: folderByCourseSql.get(liveCourseId) ?? null,
      }));

      const endAtParsedSql = parseScheduledAt(req.body?.endAt);
      if (
        req.body?.endAt !== undefined && req.body?.endAt !== null && req.body?.endAt !== "" &&
        endAtParsedSql === undefined
      ) {
        return failure(res, "endAt must be a valid date.", 422);
      }
      const endAtSql = endAtParsedSql ?? null;

      // Creating NEVER auto-starts the stream. Both "schedule for later" and "go
      // live now" persist a SCHEDULED session (no StreamOS call here). The stream
      // is created only via POST /admin/live-sessions/:id/start ("Go Live").
      const { row, liveCourseIds } = await adminLiveSql.createSession({
        title,
        courseFolders: courseFoldersSql,
        endAt: endAtSql,
        scheduledAt: scheduledAt ?? null,
        status: "SCHEDULED",
      });
      logger.info("createLiveSession scheduled (sql)", { traceId, sessionId: row.id });
      return success(
        res,
        { session: adminLiveSql.toPublicView(row, liveCourseIds, undefined, courseFoldersSql) },
        "Live session scheduled.",
        201
      );
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
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    // Tri-state for the SCHEDULED sub-tabs: true = future ("Scheduled"),
    // false = due/go-live-now ("To start"), undefined = all SCHEDULED. Collapsing
    // to a boolean would merge "false" and "absent", over-counting the tabs.
    const upcoming =
      req.query.upcoming === "true" ? true
      : req.query.upcoming === "false" ? false
      : undefined;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);

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
        search: search || undefined,
        skip: (page - 1) * limit,
        take: limit,
      });
      const sessions = await Promise.all(
        rows.map(async (row) => {
          const [courses, courseFolders] = await Promise.all([
            adminLiveSql.getLinkedCourses(row.id),
            adminLiveSql.getLinkedCourseFolders(row.id),
          ]);
          return adminLiveSql.toPublicView(
            row,
            courses.map((c) => Number(c._id)),
            courses,
            courseFolders
          );
        })
      );
      return success(res, { sessions, total, page, limit }, "Live sessions fetched.");
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

      let row = await adminLiveSql.findSessionByAnyId(id);
      if (!row) return failure(res, "Live session not found.", 404);

      let isLive = false;
      if (row.streamId && (row.status === "CREATED" || row.status === "ENDED")) {
        try {
          const details = await streamosGetDetails(row);
          isLive = details.isLive;

          const patch: { hlsUrl?: string | null; hlsUrls?: any; recordings?: any; mp4Recordings?: any; status?: string } = {};
          if (details.hlsUrl && details.hlsUrl !== row.hlsUrl) patch.hlsUrl = details.hlsUrl;
          if (details.hlsUrls && Object.keys(details.hlsUrls).length > 0) patch.hlsUrls = details.hlsUrls;

          const hadRecordings = (adminLiveSql.hlsRecordingsOf(row).length) > 0;
          if (row.status === "ENDED" && details.recordings.length > 0 && !hadRecordings) {
            patch.recordings = details.recordings;
            // Plain-MP4 variants (StreamOS mp4Links) stored alongside the HLS recordings,
            // with file_size filled from Content-Length.
            if (details.mp4Recordings.length > 0) patch.mp4Recordings = await streamosEnrichMp4Sizes(details.mp4Recordings);
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
            // files the recording into each course's chosen folder (best-effort).
            await adminLiveSql.maybeAutoPromoteRecordingSql({
              sessionId: row.id,
              sessionTitle: row.title ?? null,
              recordings: details.recordings,
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
      const courseFolders = await adminLiveSql.getLinkedCourseFolders(row.id);
      // C7: promotedVideos resolved via ws_video.live_session_id.
      const promotedVideosSql = await adminLiveSql.resolvePromotedVideosSql(row.id);
      return success(
        res,
        {
          session: adminLiveSql.toPublicView(row, courses.map((c) => Number(c._id)), courses, courseFolders),
          isLive,
          promotedVideos: promotedVideosSql,
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
    // C7: full SQL promotion (ws_video.live_session_id + ws_video_category.
    // subject_key now exist).
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      const recsSql = adminLiveSql.hlsRecordingsOf(rowSql);
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
  } catch (err) {
    logger.error("getLiveSessionAttendance failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch attendance.", 500);
  }
};

// POST /api/v1/admin/live-sessions/:id/provision
// Provisions the StreamOS stream (streamId + rtmpUrl + hlsUrl) for a SCHEDULED
// session WITHOUT going live — so admins can configure OBS before Go Live. The
// session STAYS SCHEDULED; only the encoder credentials are populated. Idempotent:
// if the session is already provisioned (has a streamId), returns it as-is without
// creating a second StreamOS stream.
export const provisionLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("provisionLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.id, userId: req.user?.id });

  try {
    const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
    if (!rowSql) return failure(res, "Live session not found.", 404);
    if (rowSql.status !== "SCHEDULED") {
      return failure(res, `Only SCHEDULED sessions can be provisioned (current: ${rowSql.status}).`, 409);
    }

    // Already provisioned → return as-is (no second StreamOS stream).
    let updatedSql = rowSql;
    let alreadyProvisioned = false;
    let credentialsExpired = false;
    if (rowSql.streamId) {
      alreadyProvisioned = true;
      // v1 ingest credentials live ~24h. A stream provisioned last week still
      // has an rtmpUrl on the row, but pushing to it fails — so say so here
      // rather than letting the educator discover it at go-live. /start re-mints.
      credentialsExpired = pushCredentialsExpired(rowSql.pushExpiresAt);
    } else {
      // On legacy this mints full encoder credentials (they never expire).
      // On v1 it only RESERVES the stream — rtmpUrl stays null, because v1 ingest
      // credentials die ~24h after minting, so issuing them days ahead of a
      // scheduled class would guarantee a dead URL at go-live. /start mints them.
      const createdSql = await streamosProvision({
        title: rowSql.title ?? "",
        sessionId: rowSql.id,
        scheduledAt: rowSql.scheduledAt,
      });
      updatedSql = await adminLiveSql.updateSession(rowSql.id, {
        streamId: createdSql.streamId,
        streamProvider: createdSql.provider,
        streamKey: createdSql.streamKey,
        pushExpiresAt: createdSql.pushExpiresAt,
        rtmpUrl: createdSql.rtmpUrl,
        hlsUrl: createdSql.hlsUrl,
        hlsUrls: createdSql.hlsUrls,
        // status stays SCHEDULED — provisioning does NOT go live.
      });
    }

    const [coursesSql, courseFoldersSql] = await Promise.all([
      adminLiveSql.getLinkedCourses(updatedSql.id),
      adminLiveSql.getLinkedCourseFolders(updatedSql.id),
    ]);
    logger.info("provisionLiveSession success (sql)", { traceId, sessionId: updatedSql.id, streamId: updatedSql.streamId, alreadyProvisioned });
    return success(
      res,
      { session: adminLiveSql.toPublicView(updatedSql, coursesSql.map((c) => Number(c._id)), coursesSql, courseFoldersSql) },
      credentialsExpired
        ? "Live session already provisioned, but its encoder credentials have expired — fresh credentials are minted automatically on Go Live."
        : alreadyProvisioned
          ? "Live session already provisioned."
          : "Encoder credentials provisioned."
    );
  } catch (err) {
    if (err instanceof StreamosError) {
      logger.error("provisionLiveSession streamos error", { traceId, message: err.message, upstreamStatus: err.upstreamStatus });
      return failure(res, err.message, err.status);
    }
    logger.error("provisionLiveSession failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to provision live session.", 500);
  }
};

// POST /api/v1/admin/live-sessions/:id/start
// Flips a SCHEDULED session live (status → CREATED). Works at any time (no start
// window). If the session was already provisioned (via /provision), it REUSES that
// StreamOS stream — same streamId/rtmpUrl the admin already configured in OBS — and
// only flips status. Otherwise it provisions on the fly, preserving the original
// "go live now" behavior.
export const startScheduledLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("startScheduledLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      if (rowSql.status !== "SCHEDULED") {
        return failure(res, `Only SCHEDULED sessions can be started (current: ${rowSql.status}).`, 409);
      }
      // "Go Live" starts a SCHEDULED session at ANY time — the previous 2-minute
      // start-window restriction was removed. scheduledAt may be null (sessions
      // created via "go live now"), which is fine.
      //
      // Reuse an already-provisioned stream so the rtmpUrl the admin configured in
      // OBS stays valid; only create a new StreamOS stream when unprovisioned.
      let streamFields: Record<string, any> = {};
      let base = rowSql;

      if (!rowSql.streamId) {
        const createdSql = await streamosProvision({
          title: rowSql.title ?? "",
          sessionId: rowSql.id,
          scheduledAt: rowSql.scheduledAt,
        });
        streamFields = {
          streamId: createdSql.streamId,
          streamProvider: createdSql.provider,
          streamKey: createdSql.streamKey,
          pushExpiresAt: createdSql.pushExpiresAt,
          rtmpUrl: createdSql.rtmpUrl,
          hlsUrl: createdSql.hlsUrl,
          hlsUrls: createdSql.hlsUrls,
        };
        base = { ...rowSql, ...streamFields };
      }

      // v1 mints ingest credentials HERE, not at provision time — they expire
      // ~24h after minting. This also re-mints when a stream provisioned days
      // ago has already lapsed. Legacy returns null: its credentials were issued
      // at provision time and do not expire, so the rtmpUrl the admin already
      // configured in OBS stays untouched.
      const minted = await streamosStartStream(base);
      if (minted) {
        streamFields = {
          ...streamFields,
          streamId: minted.streamId,
          streamProvider: minted.provider,
          streamKey: minted.streamKey,
          pushExpiresAt: minted.pushExpiresAt,
          rtmpUrl: minted.rtmpUrl,
          // Keep the existing hlsUrl when v1 doesn't return a fresh one.
          hlsUrl: minted.hlsUrl ?? base.hlsUrl,
        };
      }

      const updatedSql = await adminLiveSql.updateSession(rowSql.id, {
        ...streamFields,
        status: "CREATED",
      });
      const [coursesSql, courseFoldersSql] = await Promise.all([
        adminLiveSql.getLinkedCourses(updatedSql.id),
        adminLiveSql.getLinkedCourseFolders(updatedSql.id),
      ]);
      logger.info("startScheduledLiveSession success (sql)", { traceId, sessionId: updatedSql.id, streamId: updatedSql.streamId });
      // Side effect: push "class is live now" to buyers of the session's live
      // courses. Non-blocking + idempotent per stream run — must not delay or
      // fail the /start response, so fire-and-forget (errors logged, not thrown).
      void adminLiveSql
        .notifyBuyersOnStart({ sessionId: updatedSql.id, streamId: updatedSql.streamId, title: updatedSql.title })
        .catch((err) =>
          logger.error("startScheduledLiveSession buyer notification failed", {
            traceId, sessionId: updatedSql.id, error: getErrorMessage(err),
          })
        );
      return success(
        res,
        { session: adminLiveSql.toPublicView(updatedSql, coursesSql.map((c) => Number(c._id)), coursesSql, courseFoldersSql) },
        "Live stream started."
      );
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
// Allowed only while SCHEDULED. Editable: title, scheduledAt, liveCourseIds,
// liveCourseFolders, endAt.
export const updateScheduledLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("updateScheduledLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      if (rowSql.status !== "SCHEDULED") {
        return failure(res, `Only SCHEDULED sessions can be edited (current: ${rowSql.status}).`, 409);
      }

      const patch: {
        title?: string;
        endAt?: Date | null;
        scheduledAt?: Date | null;
      } = {};
      let changedSql = false;
      let scheduleChangedSql = false;

      // Course links (liveCourseIds) and per-course folders (liveCourseFolders)
      // are recomputed together below so a pure-course edit preserves existing
      // folder choices and a pure-folder edit preserves the course set.
      let courseIdsToSet: number[] | null = null;      // set when liveCourseIds provided
      let folderOverrides: Map<number, number | null> | null = null; // set when liveCourseFolders provided

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
      if (req.body?.liveCourseFolders !== undefined) {
        // Validate against the effective course set: the newly provided ids, or
        // (when courses aren't changing) the session's existing linked courses.
        const existingLinks = await adminLiveSql.getLinkedCourseFolders(rowSql.id);
        const allowed = courseIdsToSet ?? existingLinks.map((l) => l.liveCourseId);
        const folderVal = await adminLiveSql.validateLiveCourseFolders(req.body.liveCourseFolders, allowed);
        if (folderVal.error) return failure(res, folderVal.error, 422);
        folderOverrides = new Map(folderVal.links.map((l) => [l.liveCourseId, l.folderId]));
        changedSql = true;
      }
      if (req.body?.endAt !== undefined) {
        const parsed = parseScheduledAt(req.body.endAt);
        if (parsed === undefined) return failure(res, "endAt must be a valid date.", 422);
        patch.endAt = parsed;
        changedSql = true;
      }

      if (!changedSql) {
        return failure(
          res,
          "Provide title, scheduledAt, liveCourseIds, liveCourseFolders, or endAt to update.",
          422
        );
      }

      let updatedSql = rowSql;
      if (Object.keys(patch).length > 0) {
        updatedSql = await adminLiveSql.updateSession(rowSql.id, patch);
      }
      if (courseIdsToSet || folderOverrides) {
        const existing = await adminLiveSql.getLinkedCourseFolders(rowSql.id);
        const existingFolderByCourse = new Map(existing.map((l) => [l.liveCourseId, l.folderId]));
        const targetCourses = courseIdsToSet ?? existing.map((l) => l.liveCourseId);
        const links = targetCourses.map((cid) => ({
          liveCourseId: cid,
          folderId: folderOverrides?.has(cid)
            ? folderOverrides.get(cid) ?? null
            : existingFolderByCourse.get(cid) ?? null,
        }));
        await adminLiveSql.setLinkedCourseFolders(rowSql.id, links);
      }
      if (scheduleChangedSql) {
        await syncRemindersForSession(String(rowSql.id)).catch((e) =>
          logger.error("updateScheduledLiveSession reminder sync failed (sql)", { traceId, error: getErrorMessage(e) })
        );
      }
      const [coursesSql, courseFoldersSql] = await Promise.all([
        adminLiveSql.getLinkedCourses(rowSql.id),
        adminLiveSql.getLinkedCourseFolders(rowSql.id),
      ]);
      logger.info("updateScheduledLiveSession success (sql)", { traceId, sessionId: rowSql.id });
      return success(
        res,
        { session: adminLiveSql.toPublicView(updatedSql, coursesSql.map((c) => Number(c._id)), coursesSql, courseFoldersSql) },
        "Live session updated."
      );
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

    // Look the session up first: which API to end the stream on is a property of
    // the SESSION, not of the deploy. An unknown streamId falls through as legacy,
    // preserving the previous behaviour for rows we can't resolve.
    const sessionForEnd = await adminLiveSql.findSessionByAnyId(streamId);
    await streamosEndStream(sessionForEnd ?? { streamId });

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

    // On v1 a past recording is a LIBRARY ASSET, addressed by asset id. The
    // legacy `uploadedVideoDetails` endpoint does not exist there.
    if (isStreamosV1()) {
      const asset = await streamosV1GetAsset(recordingId);
      return success(
        res,
        {
          recordingId: asset.publicId,
          status: asset.status,
          kind: asset.kind,
          hlsUrl: asset.hlsManifestUrl,
          durationSeconds: asset.durationSeconds,
          sizeBytes: asset.sizeBytes,
          recordings: asset.renditions
            .map((r) => ({ quality: r.quality, path: r.url ?? r.dashUrl ?? "" }))
            .filter((r) => r.path),
        },
        "Asset details fetched."
      );
    }

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

    // v1 replaces the legacy "one URL" registration with an event SUBSCRIPTION,
    // and returns a signing secret exactly once. Surface that secret in the
    // response — it cannot be re-read, and without it in
    // STREAMOS_WEBHOOK_SIGNING_SECRET every delivery is rejected as unverifiable.
    if (isStreamosV1()) {
      const reg = await streamosV1RegisterWebhook({
        url: webhook,
        events: REQUIRED_V1_WEBHOOK_EVENTS,
        description: "WebSankul recording pipeline",
      });
      logger.info("updateRecordingWebhook success (v1)", {
        traceId,
        webhook,
        // Never log the secret itself.
        secretReturned: Boolean(reg.signingSecret),
      });
      return success(
        res,
        {
          webhook,
          provider: "v1",
          webhookId: reg.publicId,
          signingSecret: reg.signingSecret,
          note: reg.signingSecret
            ? "Store this signingSecret in STREAMOS_WEBHOOK_SIGNING_SECRET and restart. StreamOS will not show it again."
            : "StreamOS returned no signing secret — deliveries cannot be verified until one is issued.",
        },
        "Webhook registered."
      );
    }

    const result = await streamosUpdateWebhook(webhook);
    logger.info("updateRecordingWebhook success", { traceId, webhook });
    return success(res, { webhook, provider: "legacy", upstream: result }, "Webhook updated.");
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

    // Normalize the session snapshot.
    let snap: {
      status: string;
      streamId: string | null;
      provider: string;
      recordingsOnSession: number;
    } | null = null;
    const row = await adminLiveSql.findSessionByAnyId(id);
    if (row)
      snap = {
        status: String(row.status),
        streamId: row.streamId ?? null,
        provider: providerOf(row),
        recordingsOnSession: adminLiveSql.hlsRecordingsOf(row).length,
      };
    if (!snap || !row) return failure(res, "Live session not found.", 404);
    const isV1Session = snap.provider === "v1";

    type Check = { key: string; label: string; status: "ok" | "warn" | "fail" | "info"; detail: string };
    const checks: Check[] = [];

    // 1) Webhook secret. The two providers authenticate callbacks differently:
    //    legacy has no signing at all (we bolt on a ?key= shared secret), while
    //    v1 signs every delivery with an HMAC secret issued at registration.
    const secretSet = isV1Session
      ? streamosV1WebhookSecret().length > 0
      : STREAMOS_WEBHOOK_SECRET.length > 0;
    checks.push({
      key: "webhookSecret",
      label: isV1Session
        ? "Webhook signing secret (STREAMOS_WEBHOOK_SIGNING_SECRET)"
        : "Webhook secret (STREAMOS_WEBHOOK_SECRET)",
      status: secretSet ? "ok" : isV1Session ? "fail" : "warn",
      detail: secretSet
        ? "Configured."
        : isV1Session
          ? "Not set — StreamOS v1 signs every delivery, so callbacks cannot be verified and will be rejected."
          : "Not set — the public webhook is accepted unauthenticated. Set it in production.",
    });

    // 2) Streamos credentials + 3) webhook registration (orgDetails proves both).
    let webhook: { registeredUrl: string | null; pathOk: boolean; hasKeyParam: boolean } = { registeredUrl: null, pathOk: false, hasKeyParam: false };
    if (isV1Session) {
      // v1 exposes no orgDetails endpoint, and webhook registration cannot be
      // read back (only created). Neither check has a data source, so report
      // that honestly rather than inventing a pass or a failure.
      checks.push({
        key: "streamosCreds",
        label: "StreamOS credentials",
        status: streamosV1ApiKey() ? "ok" : "fail",
        detail: streamosV1ApiKey()
          ? "API key configured. (v1 exposes no org endpoint, so this is not an end-to-end reachability check.)"
          : "STREAMOS_API_KEY is not set — every v1 call will fail.",
      });
      // v1 DOES expose GET /webhooks/, so registration is verifiable — confirm
      // our URL is subscribed AND that it covers the event that actually
      // publishes a recording. A webhook registered for the wrong events looks
      // healthy but never delivers.
      try {
        const hooks = await streamosV1ListWebhooks();
        const ours = hooks.filter((h) => (h.url ?? "").includes("/client/webhook/recording"));
        if (ours.length === 0) {
          checks.push({
            key: "webhookRegistered",
            label: "Recording webhook registered on StreamOS",
            status: "fail",
            detail: hooks.length
              ? `${hooks.length} webhook(s) registered, none pointing at /client/webhook/recording — recordings have nowhere to land.`
              : "No webhooks registered on StreamOS — recordings have nowhere to land.",
          });
        } else {
          const events = new Set(ours.flatMap((h) => h.events));
          const missing = REQUIRED_V1_WEBHOOK_EVENTS.filter((e) => !events.has(e));
          checks.push({
            key: "webhookRegistered",
            label: "Recording webhook registered on StreamOS",
            status: missing.length ? "warn" : "ok",
            detail: missing.length
              ? `Registered (${ours[0].url}) but not subscribed to: ${missing.join(", ")}. VIDEO_TRANSCODING_COMPLETED is the event that publishes a recording.`
              : `Registered and subscribed to all required events: ${ours[0].url}`,
          });
        }
      } catch (err) {
        checks.push({
          key: "webhookRegistered",
          label: "Recording webhook registered on StreamOS",
          status: "warn",
          detail: `Could not read webhook registrations: ${err instanceof StreamosError ? err.message : getErrorMessage(err)}`,
        });
      }
    } else try {
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
      detail: `provider=${snap.provider}, status=${snap.status}, streamId=${snap.streamId ?? "none"}, recordingsOnSession=${snap.recordingsOnSession}`,
    });

    // 5) Does Streamos actually hold the recording for this stream?
    let streamos: { reachable: boolean; isLive?: boolean; recordingsOnStreamos?: number; error?: string } = { reachable: false };
    if (!snap.streamId) {
      checks.push({ key: "recordingDelivery", label: "Recording delivery", status: "warn", detail: "Session has no streamId — it was never created on Streamos." });
    } else {
      try {
        const details = await streamosGetDetails(row);
        streamos = { reachable: true, isLive: details.isLive, recordingsOnStreamos: details.recordings.length };
        if (details.isLive) {
          checks.push({
            key: "recordingDelivery",
            label: "Recording delivery",
            status: "info",
            detail: isV1Session
              ? "Session is marked live locally — recordings are produced after it ends. (v1 reports no liveness signal; this is derived from session status.)"
              : "Stream is still LIVE — recordings are produced after it ends.",
          });
        } else if (details.recordingProcessing) {
          checks.push({
            key: "recordingDelivery",
            label: "Recording delivery",
            status: "info",
            detail: "StreamOS holds the recording but it is still transcoding — it becomes playable on VIDEO_TRANSCODING_COMPLETED.",
          });
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

// ── StreamOS v1 deliveries ───────────────────────────────────────────────────
// Same public endpoint as the legacy callback; the two are told apart by v1's
// headers. Keeping one URL means the cutover needs no route change on either side.
//
// Contract differences that shape this handler:
//   - deliveries are HMAC-signed (legacy was unsigned, guarded by our ?key=)
//   - they retry up to 6× with a stable X-Streamos-Delivery id
//   - a 2xx is expected within 10 seconds
const handleV1RecordingWebhook = async (req: Request, res: Response, traceId?: string) => {
  const event = String(req.headers["x-streamos-event"] ?? "");
  const deliveryId = String(req.headers["x-streamos-delivery"] ?? "");
  const signature = req.headers["x-streamos-signature"] as string | undefined;

  // 1) Authenticate. Unlike the legacy path there is no "accept unauthenticated
  //    and warn" fallback — v1 signs every delivery, so an unverifiable one is
  //    either a misconfiguration or a forgery, and both must be rejected.
  const secret = streamosV1WebhookSecret();
  const verdict = verifyStreamosSignature((req as any).rawBody, signature, secret);
  if (!verdict.ok) {
    logger.warn("StreamOS v1 webhook rejected", { traceId, event, deliveryId, reason: verdict.reason });
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  // Which payload construction matched. The docs don't say; once a real delivery
  // tells us, pin it in utils/streamosSignature.ts and drop the other branch.
  logger.info("StreamOS v1 webhook verified", { traceId, event, deliveryId, scheme: verdict.scheme });

  const body = req.body ?? {};

  // 2) Claim the delivery BEFORE doing any work. Recording handling creates
  //    Video rows, so a retry that re-ran it would duplicate course content.
  //    Missing header → fall back to a key derived from the payload so a retry
  //    still collides instead of processing twice.
  const claimKey =
    deliveryId || `${event}:${String(body?.data?.recording?.asset_id ?? body?.data?.video?.id ?? "")}`;
  if (claimKey) {
    let firstTime = true;
    try {
      firstTime = await adminLiveSql.claimWebhookDelivery(claimKey, event || null);
    } catch (err) {
      // A failed claim must not drop the delivery — process it and accept the
      // (small) duplicate risk rather than losing the recording entirely.
      logger.error("StreamOS v1 delivery claim failed", { traceId, claimKey, error: getErrorMessage(err) });
    }
    if (!firstTime) {
      logger.info("StreamOS v1 webhook replay ignored", { traceId, event, deliveryId });
      return res.status(200).json({ success: true, message: "Already processed." });
    }
  }

  // 3) Is it even ours? Staging and production share one StreamOS organisation
  //    and one API key, so this endpoint can receive the OTHER environment's
  //    recordings. Drop those before correlation — searching for a staging
  //    session among production's rows risks a wrong-class attachment.
  if (isForeignV1Environment(body)) {
    logger.info("StreamOS v1 webhook ignored (other environment)", { traceId, event, deliveryId });
    return res.status(200).json({ success: true, message: "Acknowledged (other environment)." });
  }

  // 4) Correlate. See streamos.v1.webhook.resolveSession — the documented
  //    payloads carry no stream id, so several keys are tried in turn.
  const session = await resolveV1Session(body);
  if (!session) {
    // Ack so StreamOS stops retrying: a payload we cannot attribute will not
    // become attributable on the 6th attempt. Logged at error — this is the Q1
    // gap showing up in production and it needs a human.
    logger.error("StreamOS v1 webhook could not be correlated to a session", {
      traceId,
      event,
      deliveryId,
      dataKeys: Object.keys(body?.data ?? {}),
    });
    return res.status(200).json({ success: true, message: "Acknowledged (no matching session)." });
  }

  // 5) Apply.
  const result = await applyV1Event(body, session);
  if (!result.handled) {
    logger.warn("StreamOS v1 webhook not applied", { traceId, event, sessionId: session.id, reason: result.reason });
    return res.status(200).json({ success: true, message: `Acknowledged (${result.reason}).` });
  }

  // 6) Tell any connected viewers, but only once the recording is playable.
  if (event === "VIDEO_TRANSCODING_COMPLETED" && session.streamId) {
    const liveClassId = String(session.streamId);
    const fresh = await adminLiveSql.findSessionByAnyId(String(session.id));
    io?.to(roomKey(liveClassId)).emit("recordings_ready", {
      streamId: session.streamId,
      liveClassId,
      status: "READY",
      recordings: fresh ? adminLiveSql.hlsRecordingsOf(fresh) : [],
    });
  }

  logger.info("StreamOS v1 webhook applied", { traceId, event, sessionId: session.id, reason: result.reason });
  return res.status(200).json({ success: true, message: result.reason });
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
    // StreamOS v1 deliveries are identified by their own headers. Everything
    // else falls through to the legacy contract below, unchanged.
    if (req.headers["x-streamos-event"] || req.headers["x-streamos-signature"]) {
      return await handleV1RecordingWebhook(req, res, traceId);
    }

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
    const normalizeRecs = (raw: any): ILiveSessionRecording[] =>
      (Array.isArray(raw) ? raw : [])
        .filter((r: any) => r && typeof r.path === "string" && r.path.length > 0)
        .map((r: any) => ({
          quality: typeof r.quality === "string" ? r.quality : undefined,
          file_size: typeof r.file_size === "number" ? r.file_size : Number(r.file_size) || undefined,
          path: stripTrailingQuote(r.path),
        }));

    const recordings: ILiveSessionRecording[] = normalizeRecs(rawRecordings);
    // Plain-MP4 variants when StreamOS includes them in the callback (mp4Links).
    // Stored alongside the DRM-HLS `recordings`; only persisted when present so a
    // callback without mp4Links doesn't clobber an mp4 captured via the poll path.
    // file_size is filled from Content-Length (StreamOS omits it on mp4Links).
    const mp4Recordings: ILiveSessionRecording[] = await streamosEnrichMp4Sizes(
      normalizeRecs(req.body?.mp4Links ?? req.body?.mp4links)
    );

      const updatedSql = await adminLiveSql.updateByStreamId(streamId, {
        recordings,
        status: "READY",
        ...(mp4Recordings.length > 0 ? { mp4Recordings } : {}),
      });
      if (!updatedSql) {
        logger.warn("recordingWebhook stream not found (sql)", { traceId, streamId });
        return res.status(200).json({ success: true, message: "Acknowledged (no matching stream)." });
      }
      // C7: auto-promote the best recording into each linked course's chosen
      // folder (best-effort — never throws).
      await adminLiveSql.maybeAutoPromoteRecordingSql({
        sessionId: updatedSql.id,
        sessionTitle: updatedSql.title ?? null,
        recordings,
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
  } catch (err) {
    logger.error("recordingWebhook failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return res.status(200).json({ success: false, message: "Internal error logged." });
  }
};
