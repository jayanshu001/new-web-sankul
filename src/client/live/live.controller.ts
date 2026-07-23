import { Request, Response } from "express";
import {
  getStreamDetails as streamosGetStreamDetails,
  enrichMp4Sizes as streamosEnrichMp4Sizes,
  StreamosError,
} from "../../admin/live/streamos.service";
import { io, roomKey } from "../../socket/livechat.socket";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { signMediaToken } from "../../utils/mediaToken";
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
export const getLiveSessionForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? req.params.streamId ?? "");
  logger.info("getLiveSessionForClient invoked", { traceId, path: req.originalUrl, userId, id });

  try {
    // SQL session + SQL write-back; StreamOS + Socket.IO kept.
    const cid = req.user?.id ? Number(req.user.id) : null;
    const customerId = Number.isInteger(cid) ? cid : null;
    const s = await adminLive.findSessionByAnyId(id);
    if (!s) { logger.warn("getLiveSessionForClient not found (mysql)", { traceId, userId, id }); return failure(res, "Live session not found.", 404); }
    const liveCourseIds = await adminLive.getLinkedCourseIds(s.id);

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

    const track = status !== "SCHEDULED";
    const preview = await liveSql.resolveLivePreviewStateSql(customerId, s.id, liveCourseIds, track);
    const exposePlayback = preview.accessLevel === "full" || preview.accessLevel === "preview";
    const purchaseOptions = preview.accessLevel === "full" ? [] : await liveSql.buildPurchaseOptionsSql(liveCourseIds);

    // No inline media. When playback is allowed (full OR preview access), mint a
    // customer-bound media token the client exchanges at /media/resolve for the
    // live HLS URL(s). No access → mediaToken null. `streamId`/`liveClassId` are
    // internal identifiers (needed for the socket room), not playable URLs.
    // No scope needed — resolve re-runs the full-OR-preview gate for live sessions.
    const mediaToken =
      exposePlayback && customerId != null
        ? signMediaToken({ k: "liveSession", id: s.id, cust: customerId })
        : null;

    logger.info("getLiveSessionForClient success (mysql)", { traceId, userId, sessionId: s.id, status, accessLevel: preview.accessLevel });
    // Slim playback DTO: keep streamId/isLive/mediaToken/accessLevel/previewSecondsRemaining
    // + purchaseOptions upsell (liveCourseId/name/image). Drop unused metadata + nested plans.
    return success(res, {
      title: s.title, streamId: s.streamId ?? null, isLive,
      mediaToken,
      accessLevel: preview.accessLevel,
      previewSecondsRemaining: preview.previewSecondsRemaining,
      purchaseOptions: omitList(purchaseOptions, ["plans"]),
    }, "Live session fetched.");
  } catch (err) {
    logger.error("getLiveSessionForClient failed", { traceId, userId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live session.", 500);
  }
};
