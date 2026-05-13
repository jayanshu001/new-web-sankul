import { Request, Response } from "express";
import { Types } from "mongoose";
import { LiveSession } from "../../models/course/LiveSession.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import {
  getStreamDetails as streamosGetStreamDetails,
  StreamosError,
} from "../../admin/live/streamos.service";
import { io, roomKey } from "../../socket/livechat.socket";
import { maybeAutoPromoteRecording } from "../../admin/live/recording.promote";
import { hasAccessToAnyLiveCourse, PREVIEW_SECONDS } from "../live-course/entitlement";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

function parseStreamIdParam(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
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
    // otherwise they get a preview window and a list of purchasable courses.
    const liveCourseIds = (session.liveCourseIds ?? []).map(String);
    let accessLevel: "full" | "preview" = "full";
    let purchaseOptions: Array<{
      liveCourseId: string;
      name: string;
      image: string;
      plans: Array<{ planId: string; name: string | null; duration: number; price: number; isDefault: boolean }>;
    }> = [];

    if (liveCourseIds.length > 0) {
      const subscribed = await hasAccessToAnyLiveCourse(req.user?.id, liveCourseIds);
      if (!subscribed) {
        accessLevel = "preview";

        const [courses, plans] = await Promise.all([
          LiveCourse.find({ _id: { $in: liveCourseIds }, status: true })
            .select("_id name image")
            .lean(),
          LiveCoursePlan.find({ liveCourseId: { $in: liveCourseIds }, status: true })
            .sort({ price: 1 })
            .lean(),
        ]);
        const plansByCourse = new Map<string, typeof plans>();
        for (const p of plans) {
          const key = String(p.liveCourseId);
          if (!plansByCourse.has(key)) plansByCourse.set(key, []);
          plansByCourse.get(key)!.push(p);
        }
        purchaseOptions = courses.map((c) => ({
          liveCourseId: String(c._id),
          name: c.name,
          image: c.image,
          plans: (plansByCourse.get(String(c._id)) ?? []).map((p) => ({
            planId: String(p._id),
            name: p.name ?? null,
            duration: p.duration,
            price: p.price,
            isDefault: p.isDefault,
          })),
        }));
      }
    }

    return success(
      res,
      {
        id: String(session._id),
        title: session.title,
        status: session.status,
        scheduledAt: session.scheduledAt ?? null,
        streamId: session.streamId ?? null,
        liveCourseIds,
        isLive,
        hlsUrl: session.hlsUrl ?? null,
        hlsUrls: session.hlsUrls ?? null,
        recordings: session.recordings ?? [],
        // Use this as the Socket.IO room id for chat/polls (only valid once
        // the session has a streamId — i.e. status is CREATED or later).
        liveClassId: session.streamId != null ? String(session.streamId) : null,
        // Entitlement:
        //   - "full"    → no cutoff, play to the end.
        //   - "preview" → client should cut playback at `previewSeconds` and
        //     surface `purchaseOptions` so the user can buy any one of the
        //     attached courses to unlock the rest.
        accessLevel,
        previewSeconds: accessLevel === "preview" ? PREVIEW_SECONDS : null,
        purchaseOptions,
      },
      "Live session fetched."
    );
  } catch (err) {
    logger.error("Client live-session fetch failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch live session.", 500);
  }
};
