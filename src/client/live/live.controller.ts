import { Request, Response } from "express";
import { Types } from "mongoose";
import { LiveSession } from "../../models/course/LiveSession.model";
import {
  getStreamDetails as streamosGetStreamDetails,
  StreamosError,
} from "../../admin/live/streamos.service";
import { io, roomKey } from "../../socket/livechat.socket";
import { maybeAutoPromoteRecording } from "../../admin/live/recording.promote";
import {
  resolveLivePreviewState,
  buildPurchaseOptions,
  PREVIEW_SECONDS,
} from "../live-course/entitlement";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

// Streamos stream ids are strings (e.g. "T_17787583234029").
function parseStreamIdParam(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

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

// GET /api/v1/client/live-sessions/:id  (id = Mongo _id or streamId)
// Returns playback info for an authenticated student.
// - SCHEDULED: returns scheduledAt; no playback yet.
// - CREATED:   isLive + hlsUrl/hlsUrls from Streamos.
// - ENDED/READY: recordings[] for replay. If the webhook was missed we'll
//   transparently recover recordings from Streamos `streamDetails` here.
export const getLiveSessionForClient = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? req.params.streamId ?? "");
    const session = await findSessionByAnyId(id);
    if (!session) return failure(res, "Live session not found.", 404);

    let isLive = false;

    if (session.streamId && (session.status === "CREATED" || session.status === "ENDED")) {
      try {
        const details = await streamosGetStreamDetails(session.streamId);
        isLive = details.isLive;

        let dirty = false;
        if (details.hlsUrl && details.hlsUrl !== session.hlsUrl) {
          session.hlsUrl = details.hlsUrl;
          dirty = true;
        }
        if (details.hlsUrls && Object.keys(details.hlsUrls).length > 0) {
          session.hlsUrls = details.hlsUrls;
          dirty = true;
        }
        if (
          session.status === "ENDED" &&
          details.recordings.length > 0 &&
          (session.recordings?.length ?? 0) === 0
        ) {
          session.recordings = details.recordings;
          session.status = "READY";
          dirty = true;
          const liveClassId = String(session.streamId);
          io?.to(roomKey(liveClassId)).emit("recordings_ready", {
            streamId: session.streamId,
            liveClassId,
            status: "READY",
            recordings: details.recordings,
          });
          await maybeAutoPromoteRecording(session);
        }
        if (dirty) await session.save();
      } catch (err) {
        if (err instanceof StreamosError) {
          logger.warn("Client live-session: streamos check failed", {
            sessionId: session._id,
            message: err.message,
            upstreamStatus: err.upstreamStatus,
          });
        } else {
          logger.warn("Client live-session: streamos check error", {
            sessionId: session._id,
            error: getErrorMessage(err),
          });
        }
      }
    }

    // --- Entitlement ------------------------------------------------------
    // A session attached to NO course is treated as "open" (any logged-in
    // customer gets full access — matches the original behaviour before live
    // courses existed). A session attached to one or more courses requires
    // the customer to hold an active subscription to AT LEAST ONE of them;
    // otherwise they get a PER-VIEWER 3-minute trial.
    //
    // The trial clock only starts once there is something to watch, so we
    // don't track SCHEDULED sessions — that would burn a non-subscriber's
    // preview before the stream goes live.
    const liveCourseIds = (session.liveCourseIds ?? []).map(String);
    const track = session.status !== "SCHEDULED";
    const preview = await resolveLivePreviewState(
      req.user?.id,
      session._id as Types.ObjectId,
      liveCourseIds,
      track
    );

    // Playback URLs go to full-access users and to preview users while their
    // trial window is still open. Once it elapses ("preview_ended") we
    // withhold hlsUrl/hlsUrls/recordings entirely — that is what makes the
    // 3-minute cutoff server-enforced rather than client-trusted.
    const exposePlayback =
      preview.accessLevel === "full" || preview.accessLevel === "preview";

    // purchaseOptions drives the "buy to keep watching" popup. We send it for
    // any non-full state (including while still in "preview") so the client
    // already has the data when the timer hits zero — no extra round-trip.
    const purchaseOptions =
      preview.accessLevel === "full"
        ? []
        : await buildPurchaseOptions(liveCourseIds);

    return success(
      res,
      {
        id: String(session._id),
        title: session.title,
        status: session.status,
        // Joinable only while the live room exists on Streamos (status
        // CREATED). The client gates the "Join" button on this.
        canJoin: session.status === "CREATED",
        scheduledAt: session.scheduledAt ?? null,
        streamId: session.streamId ?? null,
        liveCourseIds,
        isLive,
        hlsUrl: exposePlayback ? session.hlsUrl ?? null : null,
        hlsUrls: exposePlayback ? session.hlsUrls ?? null : null,
        recordings: exposePlayback ? session.recordings ?? [] : [],
        // Use this as the Socket.IO room id for chat/polls (only valid once
        // the session has a streamId — i.e. status is CREATED or later).
        liveClassId: session.streamId != null ? String(session.streamId) : null,
        // Entitlement:
        //   - "full"          → no cutoff, play to the end.
        //   - "preview"       → playback URLs included; client should cut at
        //     `previewSecondsRemaining` (or `previewExpiresAt`) and then show
        //     the purchase popup built from `purchaseOptions`.
        //   - "preview_ended" → no playback URLs; show the purchase popup.
        accessLevel: preview.accessLevel,
        previewSeconds: preview.accessLevel === "full" ? null : PREVIEW_SECONDS,
        previewExpiresAt: preview.previewExpiresAt,
        previewSecondsRemaining: preview.previewSecondsRemaining,
        purchaseOptions,
      },
      "Live session fetched."
    );
  } catch (err) {
    logger.error("Client live-session fetch failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch live session.", 500);
  }
};
