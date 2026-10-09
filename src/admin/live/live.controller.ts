// Admin live sessions: HTTP handlers for session lifecycle and StreamOS admin tools.
// The public recording webhook lives in streamos.webhook.controller.ts.
import { Request, Response } from "express";
import {
  getUploadedVideoDetails as streamosGetUploadedVideoDetails,
  getOrgDetails as streamosGetOrgDetails,
  updateWebhook as streamosUpdateWebhook,
  enrichMp4Sizes as streamosEnrichMp4Sizes,
  StreamosError,
} from "../../libs/streamos/streamos.service";
// Dispatches per session (the row's own streamProvider), so legacy sessions keep
// using the legacy API after STREAMOS_PROVIDER is flipped to v1.
import {
  provisionStream as streamosProvision,
  startStream as streamosStartStream,
  endStream as streamosEndStream,
  getDetails as streamosGetDetails,
  pushCredentialsExpired,
  providerOf,
} from "../../libs/streamos/streamos.provider";
import { streamosV1ApiKey, streamosV1WebhookSecret } from "../../config/streamos";
import { isStreamosV1 } from "../../config/streamos";
import {
  registerWebhook as streamosV1RegisterWebhook,
  getAsset as streamosV1GetAsset,
  listWebhooks as streamosV1ListWebhooks,
  type StreamosV1Event,
} from "../../libs/streamos/streamos.v1.service";

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
import { STREAMOS_WEBHOOK_SECRET, parseStreamIdParam } from "./streamos.webhook.controller";

function parseScheduledAt(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;            // omitted → don't change
  if (raw === null || raw === "") return null;        // explicit clear
  const d = new Date(raw as any);
  if (isNaN(d.getTime())) return undefined;           // invalid → caller handles
  return d;
}

// Gathers raw id strings from `liveCourseIds` (array) and/or `liveCourseId` (single).
// Returns null if `liveCourseIds` is present but neither an array nor a clear sentinel;
// an empty array when neither field is present.
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

// Distinguishes "unchanged" from "set to empty" for update handlers.
function liveCourseFieldProvided(body: any): boolean {
  return body?.liveCourseIds !== undefined || body?.liveCourseId !== undefined;
}

// Always persists a SCHEDULED session, even for "go live now" (scheduledAt null);
// the StreamOS stream is created only via POST /:id/start.
// Body: { title, liveCourseIds, liveCourseFolders:[{liveCourseId,folderId}], scheduledAt?, endAt? }.
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

      // Each folderId must belong to its liveCourseId.
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

      const { row, liveCourseIds } = await adminLiveSql.createSession({
        title,
        courseFolders: courseFoldersSql,
        endAt: endAtSql,
        scheduledAt: scheduledAt ?? null,
        status: "SCHEDULED",
      });
      logger.info("createLiveSession scheduled", { traceId, sessionId: row.id });
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
      const linked = await adminLiveSql.getLinkedForSessions(rows.map((r) => r.id));
      const sessions = rows.map((row) => {
        const { courses, courseFolders } = linked.get(row.id)!;
        return adminLiveSql.toPublicView(
          row,
          courses.map((c) => Number(c._id)),
          courses,
          courseFolders
        );
      });
      return success(res, { sessions, total, page, limit }, "Live sessions fetched.");
  } catch (err) {
    logger.error("listLiveSessions failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list live sessions.", 500);
  }
};

// Polls StreamOS for CREATED (liveness + quality URLs) and ENDED sessions; for
// ENDED it recovers recordings when the webhook was missed and flips to READY.
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
            // file_size is filled from Content-Length.
            if (details.mp4Recordings.length > 0) patch.mp4Recordings = await streamosEnrichMp4Sizes(details.mp4Recordings);
            patch.status = "READY";
            logger.info("getLiveSessionStatus recordings recovered", {
              traceId, sessionId: row.id, streamId: row.streamId, count: details.recordings.length,
            });
            const liveClassId = String(row.streamId);
            io?.to(roomKey(liveClassId)).emit("recordings_ready", {
              streamId: row.streamId,
              liveClassId,
              status: "READY",
              recordings: details.recordings,
            });
            // Mirror the webhook's auto-promote so a missed webhook still files the
            // recording into each course's chosen folder (best-effort).
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
            logger.warn("getLiveSessionStatus streamos error", {
              traceId, sessionId: row.id, message: err.message, upstreamStatus: err.upstreamStatus,
            });
          } else {
            logger.warn("getLiveSessionStatus streamos error", {
              traceId, sessionId: row.id, error: getErrorMessage(err),
            });
          }
        }
      }

      const courses = await adminLiveSql.getLinkedCourses(row.id);
      const courseFolders = await adminLiveSql.getLinkedCourseFolders(row.id);
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

// Files one recording as a Video into any video category folder (live or recorded
// course). Idempotent per folder; the Video keeps a `liveSessionId` back-link.
// Body: { folderId, recordingIndex?, quality?, title?, priceType?, order? }
// recordingIndex (0-based) or quality ("720p") picks the recording; omit both for best quality.
export const promoteSessionRecording = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("promoteSessionRecording invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
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

      logger.info("promoteSessionRecording success", {
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

// One row per join→leave stint plus a summary; leftAt: null = still connected.
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

// Provisions the StreamOS stream for a SCHEDULED session without going live, so
// admins can configure OBS first. Status stays SCHEDULED. Idempotent: an already
// provisioned session is returned as-is (no second stream).
export const provisionLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("provisionLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.id, userId: req.user?.id });

  try {
    const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
    if (!rowSql) return failure(res, "Live session not found.", 404);
    if (rowSql.status !== "SCHEDULED") {
      return failure(res, `Only SCHEDULED sessions can be provisioned (current: ${rowSql.status}).`, 409);
    }

    let updatedSql = rowSql;
    let alreadyProvisioned = false;
    let credentialsExpired = false;
    if (rowSql.streamId) {
      alreadyProvisioned = true;
      // v1 ingest credentials live ~24h; flag stale ones here rather than at
      // go-live. /start re-mints.
      credentialsExpired = pushCredentialsExpired(rowSql.pushExpiresAt);
    } else {
      // Legacy mints non-expiring encoder credentials. v1 only reserves the
      // stream (rtmpUrl stays null) because its credentials die ~24h after
      // minting; /start mints them.
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
      });
    }

    const [coursesSql, courseFoldersSql] = await Promise.all([
      adminLiveSql.getLinkedCourses(updatedSql.id),
      adminLiveSql.getLinkedCourseFolders(updatedSql.id),
    ]);
    logger.info("provisionLiveSession success", { traceId, sessionId: updatedSql.id, streamId: updatedSql.streamId, alreadyProvisioned });
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

// Flips a SCHEDULED session to CREATED at any time (no start window; scheduledAt
// may be null). Reuses an already-provisioned stream so the rtmpUrl configured in
// OBS stays valid; otherwise provisions on the fly.
export const startScheduledLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("startScheduledLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
      const rowSql = await adminLiveSql.findSessionByAnyId(String(req.params.id));
      if (!rowSql) return failure(res, "Live session not found.", 404);
      if (rowSql.status !== "SCHEDULED") {
        return failure(res, `Only SCHEDULED sessions can be started (current: ${rowSql.status}).`, 409);
      }
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

      // v1 mints (or re-mints lapsed) ingest credentials here since they expire
      // ~24h after minting. Legacy returns null: its provision-time credentials
      // never expire, so the configured rtmpUrl stays untouched.
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
      logger.info("startScheduledLiveSession success", { traceId, sessionId: updatedSql.id, streamId: updatedSql.streamId });
      // Fire-and-forget "class is live" push to buyers (idempotent per stream run);
      // must not delay or fail the /start response.
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

      // Courses and per-course folders are recomputed together so a course-only
      // edit keeps folder choices and a folder-only edit keeps the course set.
      let courseIdsToSet: number[] | null = null;
      let folderOverrides: Map<number, number | null> | null = null;

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
          logger.error("updateScheduledLiveSession reminder sync failed", { traceId, error: getErrorMessage(e) })
        );
      }
      const [coursesSql, courseFoldersSql] = await Promise.all([
        adminLiveSql.getLinkedCourses(rowSql.id),
        adminLiveSql.getLinkedCourseFolders(rowSql.id),
      ]);
      logger.info("updateScheduledLiveSession success", { traceId, sessionId: rowSql.id });
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
        logger.error("deleteLiveSession reminder cleanup failed", { traceId, error: getErrorMessage(e) })
      );
      logger.info("deleteLiveSession success", { traceId, sessionId: rowSql.id, status: rowSql.status });
      return success(res, { id: String(rowSql.id) }, "Live session deleted.");
  } catch (err) {
    logger.error("deleteLiveSession failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete live session.", 500);
  }
};

// Ends the stream by streamId, closes open attendance and tells the chat room.
export const endLiveSession = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("endLiveSession invoked", { traceId, path: req.originalUrl, sessionId: req.params.sessionId, userId: req.user?.id });

  try {
    const streamId = parseStreamIdParam(req.body?.streamId);
    if (!streamId) return failure(res, "Valid streamId is required.", 422);

    // The provider to end on is a property of the session, not the deploy; an
    // unknown streamId falls through as legacy.
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
      logger.info("endLiveSession success", {
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

export const getUploadedVideoDetails = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getUploadedVideoDetails invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const recordingId = String(req.params.recordingId ?? "").trim();
    if (!recordingId) return failure(res, "recordingId is required.", 422);

    // On v1 a past recording is a library asset addressed by asset id.
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

// Body: { webhook: "https://your-host/api/v1/client/webhook/recording" }
export const updateRecordingWebhook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("updateRecordingWebhook invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const webhook = typeof req.body?.webhook === "string" ? req.body.webhook.trim() : "";
    if (!webhook) return failure(res, "webhook URL is required.", 422);
    try {
      // eslint-disable-next-line no-new
      new URL(webhook);
    } catch {
      return failure(res, "webhook must be a valid URL.", 422);
    }

    // v1 registers an event subscription and returns the signing secret exactly
    // once; surface it, since without it in STREAMOS_WEBHOOK_SIGNING_SECRET every
    // delivery is rejected as unverifiable.
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

// Read-only per-check report (config, webhook registration, session state,
// StreamOS recording) to tell "still processing" from a wiring problem.
export const getRecordingHealth = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getRecordingHealth invoked", { traceId, sessionId: req.params.id, userId: req.user?.id });

  try {
    const id = String(req.params.id ?? "");

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

    // Legacy has no signing (we add a ?key= shared secret); v1 HMAC-signs every
    // delivery with a secret issued at registration.
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

    // On legacy, orgDetails proves both credentials and webhook registration.
    let webhook: { registeredUrl: string | null; pathOk: boolean; hasKeyParam: boolean } = { registeredUrl: null, pathOk: false, hasKeyParam: false };
    if (isV1Session) {
      // v1 has no org endpoint, so credentials can only be checked as configured.
      checks.push({
        key: "streamosCreds",
        label: "StreamOS credentials",
        status: streamosV1ApiKey() ? "ok" : "fail",
        detail: streamosV1ApiKey()
          ? "API key configured. (v1 exposes no org endpoint, so this is not an end-to-end reachability check.)"
          : "STREAMOS_API_KEY is not set — every v1 call will fail.",
      });
      // A webhook subscribed to the wrong events looks healthy but never
      // delivers, so check the event set too.
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

    checks.push({
      key: "sessionState",
      label: "Session state",
      status: "info",
      detail: `provider=${snap.provider}, status=${snap.status}, streamId=${snap.streamId ?? "none"}, recordingsOnSession=${snap.recordingsOnSession}`,
    });

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
