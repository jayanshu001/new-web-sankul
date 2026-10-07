// Client live sessions: join handler and 3-minute preview watch-time metering.
import { Request, Response } from "express";
import { enrichMp4Sizes as streamosEnrichMp4Sizes } from "../../admin/live/streamos.service";
// Per-session provider dispatch: a legacy session keeps resolving on the legacy API
// even when STREAMOS_PROVIDER is v1.
import { getDetails as streamosGetDetails, StreamosError } from "../../admin/live/streamos.provider";
import { io, roomKey } from "../../socket/livechat.socket";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { signMediaToken } from "../../utils/mediaToken";
import { buildPreviewTrackingId, isValidPreviewTrackingId } from "../../utils/previewTracking";
import { omitList } from "../../utils/pick";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";
import * as adminLive from "../../modules/admin-live/admin-live.service";

// SCHEDULED → scheduledAt only; CREATED → live; ENDED/READY → recordings, recovered
// from StreamOS here if the webhook was missed.
//
// A session can be linked to several live courses, so access depends on the entry point:
//   ?liveCourseId=C → judge C alone. Owning another course that shares this session
//                     must not unlock it (paid course leaking into an unpaid one). An
//                     unlinked C is 404, never downgraded to the Live Now rule.
//   (omitted)       → Live Now: any actively-owned linked course grants full access.
// The client id is context only; linkage and entitlement are re-derived here and again
// at /client/media/resolve.
export const getLiveSessionForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? req.params.streamId ?? "");
  // Already coerced to a positive int (or undefined) by the route's Zod schema.
  const selectedLiveCourseId = req.query.liveCourseId != null ? Number(req.query.liveCourseId) : null;
  logger.info("getLiveSessionForClient invoked", { traceId, path: req.originalUrl, userId, id, selectedLiveCourseId });

  try {
    const cid = req.user?.id ? Number(req.user.id) : null;
    const customerId = Number.isInteger(cid) ? cid : null;
    const s = await adminLive.findSessionByAnyId(id);
    if (!s) { logger.warn("getLiveSessionForClient not found (mysql)", { traceId, userId, id }); return failure(res, "Live session not found.", 404); }
    const linkedCourseIds = await adminLive.getLinkedCourseIds(s.id);

    if (selectedLiveCourseId != null && !linkedCourseIds.includes(selectedLiveCourseId)) {
      logger.warn("getLiveSessionForClient unlinked liveCourseId", { traceId, userId, sessionId: s.id, selectedLiveCourseId, linkedCourseIds });
      return failure(res, "This live course is not linked to this live session.", 404);
    }
// One id = course-specific scope; all linked ids = Live Now.
    const liveCourseIds = selectedLiveCourseId != null ? [selectedLiveCourseId] : linkedCourseIds;

    let isLive = false;
    let hlsUrl = s.hlsUrl, hlsUrls: any = s.hlsUrls, status = s.status, recordings: any = s.recordings;
    if (s.streamId && (status === "CREATED" || status === "ENDED")) {
      try {
        const details = await streamosGetDetails(s);
        isLive = details.isLive;
        const patch: any = {};
        if (details.hlsUrl && details.hlsUrl !== hlsUrl) { hlsUrl = details.hlsUrl; patch.hlsUrl = details.hlsUrl; }
        if (details.hlsUrls && Object.keys(details.hlsUrls).length > 0) { hlsUrls = details.hlsUrls; patch.hlsUrls = details.hlsUrls; }
        if (status === "ENDED" && details.recordings.length > 0 && (!Array.isArray(recordings) || recordings.length === 0)) {
          recordings = details.recordings; status = "READY"; patch.recordings = details.recordings; patch.status = "READY";
          if (details.mp4Recordings.length > 0) patch.mp4Recordings = await streamosEnrichMp4Sizes(details.mp4Recordings);
          const liveClassId = String(s.streamId);
          io?.to(roomKey(liveClassId)).emit("recordings_ready", { streamId: s.streamId, liveClassId, status: "READY", recordings: details.recordings });
          await liveSql.maybeAutoPromoteRecordingSql({ id: s.id, title: s.title, recordings: details.recordings });
        }
        if (Object.keys(patch).length) await adminLive.updateSession(s.id, patch);
      } catch (err) {
        if (err instanceof StreamosError) logger.warn("getLiveSessionForClient streamos check failed (mysql)", { traceId, sessionId: s.id, message: err.message, upstreamStatus: err.upstreamStatus });
        else logger.warn("getLiveSessionForClient streamos check error (mysql)", { traceId, sessionId: s.id, error: getErrorMessage(err) });
      }
    }

// Don't start the 3-minute trial clock on a session that hasn't aired yet.
    const track = status !== "SCHEDULED";
    const preview = await liveSql.resolveLivePreviewStateSql(customerId, s.id, liveCourseIds, track);
    const exposePlayback = preview.accessLevel === "full" || preview.accessLevel === "preview";
    const purchaseOptions = preview.accessLevel === "full" ? [] : await liveSql.buildPurchaseOptionsSql(liveCourseIds);

// When playback is allowed, mint a customer-bound media token the client exchanges at
// /media/resolve for the HLS URL(s); otherwise null.
// `lc` carries the entry point so resolve applies the same course-scoped decision
// (otherwise a preview token for unpurchased C2 could resolve to a full stream for a
// C1 owner). It is not a `scope` claim, which would reject the preview caller outright.
// A preview token is also clamped to the remaining trial; watch time accrues no faster
// than wall time, so the token cannot outlive the entitlement. Resolve re-checks anyway.
    const mediaToken =
      exposePlayback && customerId != null
        ? signMediaToken(
            { k: "liveSession", id: s.id, cust: customerId, ...(selectedLiveCourseId != null ? { lc: selectedLiveCourseId } : {}) },
            preview.accessLevel === "preview" && track ? preview.previewSecondsRemaining : undefined
          )
        : null;

    logger.info("getLiveSessionForClient success (mysql)", { traceId, userId, sessionId: s.id, status, accessLevel: preview.accessLevel, selectedLiveCourseId, accessGrantedByLiveCourseId: preview.accessGrantedByLiveCourseId });
    return success(res, {
      _id: String(s.id),
      title: s.title, streamId: s.streamId ?? null, isLive,
      mediaToken,
      accessLevel: preview.accessLevel,
      previewSecondsRemaining: preview.previewSecondsRemaining,
      // Non-null only while a trial is running; null tells the app to stop heartbeating.
      previewTrackingId:
        preview.accessLevel === "preview" && customerId != null
          ? buildPreviewTrackingId(customerId, s.id)
          : null,
      // Server-owned so the cadence can be retuned without an app release.
      previewHeartbeatSeconds: liveSql.PREVIEW_HEARTBEAT_SECONDS,
      // Course that unlocked access (null on preview/preview_ended).
      accessGrantedByLiveCourseId: preview.accessGrantedByLiveCourseId != null ? String(preview.accessGrantedByLiveCourseId) : null,
      purchaseOptions: omitList(purchaseOptions, ["plans"]),
    }, "Live session fetched.");
  } catch (err) {
    logger.error("getLiveSessionForClient failed", { traceId, userId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live session.", 500);
  }
};

// The 3-minute trial is 180s of actual watch time, metered from the server clock; a
// client-supplied "seconds watched" is never accepted.
// Both preview endpoints re-validate ?liveCourseId and re-derive entitlement exactly as
// the join endpoint does; judging against every linked course would report `full` for a
// student previewing an unpurchased course and silently stop metering their trial.
const resolvePreviewScope = async (
  req: Request,
  res: Response
): Promise<{ customerId: number; sessionId: number; liveCourseIds: number[] } | null> => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  const cid = req.user?.id ? Number(req.user.id) : null;
  const customerId = Number.isInteger(cid) ? (cid as number) : null;
  if (customerId == null) {
    failure(res, "Authentication required.", 401);
    return null;
  }

  const s = await adminLive.findSessionByAnyId(id);
  if (!s) {
    logger.warn("live preview scope: session not found", { traceId, userId: req.user?.id, id });
    failure(res, "Live session not found.", 404);
    return null;
  }

  const linkedCourseIds = await adminLive.getLinkedCourseIds(s.id);
  const selectedLiveCourseId = req.query.liveCourseId != null ? Number(req.query.liveCourseId) : null;
  if (selectedLiveCourseId != null && !linkedCourseIds.includes(selectedLiveCourseId)) {
    logger.warn("live preview scope: unlinked liveCourseId", { traceId, userId: req.user?.id, sessionId: s.id, selectedLiveCourseId });
    failure(res, "This live course is not linked to this live session.", 404);
    return null;
  }

  // The tracking id proves the app meters the session it was handed. A mismatch is a
  // client bug (422), not a permission failure.
  if (!isValidPreviewTrackingId(String(req.body?.previewTrackingId ?? ""), customerId, s.id)) {
    logger.warn("live preview scope: tracking id mismatch", { traceId, userId: req.user?.id, sessionId: s.id });
    failure(res, "Validation failed.", 422, { previewTrackingId: "previewTrackingId does not match this live session." });
    return null;
  }

  return {
    customerId,
    sessionId: s.id,
    liveCourseIds: selectedLiveCourseId != null ? [selectedLiveCourseId] : linkedCourseIds,
  };
};

// Sent while the player is playing and focused. `isPlaying: false` behaves like /preview/stop.
export const livePreviewHeartbeat = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  try {
    const scope = await resolvePreviewScope(req, res);
    if (!scope) return; // response already sent

    const isPlaying = req.body?.isPlaying !== false; // Zod defaults this to true
    const state = await liveSql.previewHeartbeatSql(scope.customerId, scope.sessionId, scope.liveCourseIds, isPlaying);

    logger.info("livePreviewHeartbeat", { traceId, userId, sessionId: scope.sessionId, isPlaying, accessLevel: state.accessLevel, previewSecondsRemaining: state.previewSecondsRemaining });
    return success(res, {
      accessLevel: state.accessLevel,
      previewSecondsRemaining: state.previewSecondsRemaining,
      previewTrackingId: state.previewTrackingId,
      previewHeartbeatSeconds: liveSql.PREVIEW_HEARTBEAT_SECONDS,
    }, "Preview heartbeat recorded.");
  } catch (err) {
    logger.error("livePreviewHeartbeat failed", { traceId, userId, id: req.params.id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to record preview heartbeat.", 500);
  }
};

// Idempotent: repeat calls, or calls with no trial started, consume nothing.
export const livePreviewStop = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  try {
    const scope = await resolvePreviewScope(req, res);
    if (!scope) return; // response already sent

    const state = await liveSql.previewStopSql(scope.customerId, scope.sessionId, scope.liveCourseIds);

    logger.info("livePreviewStop", { traceId, userId, sessionId: scope.sessionId, accessLevel: state.accessLevel, previewSecondsRemaining: state.previewSecondsRemaining });
    return success(res, {
      accessLevel: state.accessLevel,
      previewSecondsRemaining: state.previewSecondsRemaining,
      previewTrackingId: state.previewTrackingId,
      previewHeartbeatSeconds: liveSql.PREVIEW_HEARTBEAT_SECONDS,
    }, "Preview tracking stopped.");
  } catch (err) {
    logger.error("livePreviewStop failed", { traceId, userId, id: req.params.id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to stop preview tracking.", 500);
  }
};
