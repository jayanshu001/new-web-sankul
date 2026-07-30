import { Request, Response } from "express";
import {
  getStreamDetails as streamosGetStreamDetails,
  enrichMp4Sizes as streamosEnrichMp4Sizes,
  StreamosError,
} from "../../admin/live/streamos.service";
import { io, roomKey } from "../../socket/livechat.socket";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { signMediaToken } from "../../utils/mediaToken";
import { buildPreviewTrackingId, isValidPreviewTrackingId } from "../../utils/previewTracking";
import { omitList } from "../../utils/pick";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";
import * as adminLive from "../../modules/admin-live/admin-live.service";

// GET /api/v1/client/live-sessions/:id  (id = Mongo _id or streamId)
// Returns playback info for an authenticated student.
// - SCHEDULED: returns scheduledAt; no playback yet.
// - CREATED:   isLive + hlsUrl/hlsUrls from Streamos.
// - ENDED/READY: recordings[] for replay. If the webhook was missed we'll
//   transparently recover recordings from Streamos `streamDetails` here.
//
// ── Shared sessions and the ?liveCourseId entry point ────────────────────────
// One session can be linked to several live courses, so "does this student have
// access" has no single answer — it depends on where they came FROM:
//
//   ?liveCourseId=C  → judge C ALONE. Owning a different course that happens to
//                      share this session must NOT unlock it, otherwise a paid
//                      course silently leaks into an unpaid one. An unlinked C is
//                      rejected (404), never quietly downgraded to the Live Now
//                      rule — that would be the same leak through a typo.
//   (omitted)        → the Live Now entry point: no course was selected, so ANY
//                      actively-owned linked course grants full access.
//
// The client-sent id is context only; linkage AND entitlement are both re-derived
// here, and again at /client/media/resolve before any URL is produced.
export const getLiveSessionForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? req.params.streamId ?? "");
  // Already coerced to a positive int (or undefined) by the route's Zod schema.
  const selectedLiveCourseId = req.query.liveCourseId != null ? Number(req.query.liveCourseId) : null;
  logger.info("getLiveSessionForClient invoked", { traceId, path: req.originalUrl, userId, id, selectedLiveCourseId });

  try {
    // SQL session + SQL write-back; StreamOS + Socket.IO kept.
    const cid = req.user?.id ? Number(req.user.id) : null;
    const customerId = Number.isInteger(cid) ? cid : null;
    const s = await adminLive.findSessionByAnyId(id);
    if (!s) { logger.warn("getLiveSessionForClient not found (mysql)", { traceId, userId, id }); return failure(res, "Live session not found.", 404); }
    const linkedCourseIds = await adminLive.getLinkedCourseIds(s.id);

    // Reject an entry point that isn't real before it can influence anything.
    if (selectedLiveCourseId != null && !linkedCourseIds.includes(selectedLiveCourseId)) {
      logger.warn("getLiveSessionForClient unlinked liveCourseId", { traceId, userId, sessionId: s.id, selectedLiveCourseId, linkedCourseIds });
      return failure(res, "This live course is not linked to this live session.", 404);
    }
    // THE access scope. One id = course-specific; all ids = Live Now.
    const liveCourseIds = selectedLiveCourseId != null ? [selectedLiveCourseId] : linkedCourseIds;

    let isLive = false;
    let hlsUrl = s.hlsUrl, hlsUrls: any = s.hlsUrls, status = s.status, recordings: any = s.recordings;
    if (s.streamId && (status === "CREATED" || status === "ENDED")) {
      try {
        const details = await streamosGetStreamDetails(s.streamId);
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

    // Don't start the 3-minute clock on a session that hasn't aired yet — there
    // is nothing to watch, so opening its page must not burn the trial.
    const track = status !== "SCHEDULED";
    const preview = await liveSql.resolveLivePreviewStateSql(customerId, s.id, liveCourseIds, track);
    const exposePlayback = preview.accessLevel === "full" || preview.accessLevel === "preview";
    // Upsell exactly what the student can act on: the course they came from, or
    // every purchasable linked course when they arrived from Live Now.
    const purchaseOptions = preview.accessLevel === "full" ? [] : await liveSql.buildPurchaseOptionsSql(liveCourseIds);

    // No inline media. When playback is allowed (full OR preview access), mint a
    // customer-bound media token the client exchanges at /media/resolve for the
    // live HLS URL(s). No access → mediaToken null. `streamId`/`liveClassId` are
    // internal identifiers (needed for the socket room), not playable URLs.
    //
    // `lc` carries the entry point so resolve re-applies the SAME course-scoped
    // decision — without it, a preview token minted for unpurchased C2 would be
    // re-evaluated against all linked courses and hand a full stream to someone
    // who only owns C1. Not a `scope` claim: those are checked ahead of the
    // per-kind switch and would reject the legitimate preview caller outright.
    //
    // A preview token is additionally clamped to the remaining trial. That stays
    // a valid bound now the trial is measured in WATCH time: watch seconds only
    // accrue while wall-clock seconds do, so remaining-watch ≤ remaining-wall and
    // the token still cannot outlive the entitlement that justified it. Resolve
    // re-checks anyway — this is defence-in-depth, not the only guard.
    const mediaToken =
      exposePlayback && customerId != null
        ? signMediaToken(
            { k: "liveSession", id: s.id, cust: customerId, ...(selectedLiveCourseId != null ? { lc: selectedLiveCourseId } : {}) },
            preview.accessLevel === "preview" && track ? preview.previewSecondsRemaining : undefined
          )
        : null;

    logger.info("getLiveSessionForClient success (mysql)", { traceId, userId, sessionId: s.id, status, accessLevel: preview.accessLevel, selectedLiveCourseId, accessGrantedByLiveCourseId: preview.accessGrantedByLiveCourseId });
    // Slim playback DTO: keep streamId/isLive/mediaToken/accessLevel/previewSecondsRemaining
    // + purchaseOptions upsell (liveCourseId/name/image). Drop unused metadata + nested plans.
    return success(res, {
      _id: String(s.id),
      title: s.title, streamId: s.streamId ?? null, isLive,
      mediaToken,
      accessLevel: preview.accessLevel,
      previewSecondsRemaining: preview.previewSecondsRemaining,
      // Handle for the heartbeat/stop endpoints. Non-null ONLY while a trial is
      // actually running: `full` has no trial to meter and `preview_ended` has
      // nothing left, and in both cases a null tells the app to stop heartbeating
      // rather than to keep polling an endpoint that will not move.
      previewTrackingId:
        preview.accessLevel === "preview" && customerId != null
          ? buildPreviewTrackingId(customerId, s.id)
          : null,
      // How often to heartbeat while playing. Server-owned so the cadence can be
      // retuned without an app release.
      previewHeartbeatSeconds: liveSql.PREVIEW_HEARTBEAT_SECONDS,
      // Which course actually unlocked this (null on preview/preview_ended) — lets
      // the app show "included in <course>" and debug entitlement without guessing.
      accessGrantedByLiveCourseId: preview.accessGrantedByLiveCourseId != null ? String(preview.accessGrantedByLiveCourseId) : null,
      purchaseOptions: omitList(purchaseOptions, ["plans"]),
    }, "Live session fetched.");
  } catch (err) {
    logger.error("getLiveSessionForClient failed", { traceId, userId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live session.", 500);
  }
};

// ── preview watch-time tracking ───────────────────────────────────────────────
// The 3-minute trial is 180 seconds of ACTUAL WATCH TIME, metered server-side.
// The app reports *when* it is playing; the server decides *how much* that cost,
// from its own clock — a client-supplied "seconds watched" is never accepted, so
// a patched app cannot lengthen the trial.
//
// Both endpoints resolve the session, re-validate the ?liveCourseId entry point,
// and re-derive entitlement exactly as the join endpoint does. Sharing that
// preamble matters: judging a heartbeat against every linked course would report
// `full` for a student previewing an unpurchased course while owning a different
// one linked to the same session, and silently stop metering their trial.
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

  // The tracking id proves the app is metering the session it was handed, not
  // another one. A mismatch is a client bug (422), never a permission failure —
  // access was already decided from the bearer token.
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

// POST /api/v1/client/live-sessions/:id/preview/heartbeat[?liveCourseId=]
// Sent every `previewHeartbeatSeconds` while the player is playing AND focused.
// `isPlaying: false` is handled exactly like /preview/stop.
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

// POST /api/v1/client/live-sessions/:id/preview/stop[?liveCourseId=]
// Sent on pause / navigate away / backgrounding / player close. Idempotent —
// calling it twice, or without a trial ever having started, returns the same
// remaining time and consumes nothing extra.
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
