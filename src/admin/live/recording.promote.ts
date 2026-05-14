import { Types } from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video, IVideo } from "../../models/course/Video.model";
import { ILiveSession, ILiveSessionRecording } from "../../models/course/LiveSession.model";
import logger from "../../utils/logger";

/**
 * Pick the recording to auto-promote into a video. Streamos returns
 * multi-bitrate recordings; we prefer the explicit highest tier we know
 * about, falling back to whatever's available. The aim is to land the
 * best-quality MP4 in the target folder without configuration.
 */
function pickRecording(recordings: ILiveSessionRecording[]): ILiveSessionRecording | null {
  if (!recordings || recordings.length === 0) return null;
  const preferenceOrder = ["1080p", "720p", "480p", "360p", "240p", "144p"];
  for (const q of preferenceOrder) {
    const hit = recordings.find((r) => r.quality?.toLowerCase() === q);
    if (hit) return hit;
  }
  return recordings[0] ?? null;
}

// The subset of a LiveSession the promotion helpers actually read. Accepting
// this shape (rather than the full ILiveSession Document) lets callers pass
// either a hydrated doc or a .lean() result.
export type RecordingSource = Pick<
  ILiveSession,
  "_id" | "title" | "recordings" | "liveCourseIds"
>;

/**
 * Resolve a single recording on a session, by 0-based index or by quality
 * label ("720p", "480p" …). When neither is given, falls back to the
 * best-quality recording. Returns null if nothing matches.
 */
export function resolveRecording(
  session: Pick<RecordingSource, "recordings">,
  opts: { recordingIndex?: number; quality?: string }
): ILiveSessionRecording | null {
  const recordings = session.recordings ?? [];
  if (recordings.length === 0) return null;

  if (opts.quality) {
    const q = opts.quality.toLowerCase();
    return recordings.find((r) => r.quality?.toLowerCase() === q) ?? null;
  }
  if (typeof opts.recordingIndex === "number") {
    return recordings[opts.recordingIndex] ?? null;
  }
  return pickRecording(recordings);
}

export interface PromoteResult {
  video: IVideo;
  // true when the recording was already present in the target folder — the
  // existing Video is returned untouched rather than a duplicate created.
  alreadyExisted: boolean;
}

/**
 * Promote a single recording into ANY VideoCategory folder as a Video.
 *
 * The folder may belong to a live course OR a recorded course — recordings
 * can be filed wherever they're needed, so this helper deliberately does NOT
 * constrain the folder to the session's own courses. Callers that want a
 * narrower scope validate the folder themselves first.
 *
 * Idempotent PER FOLDER: the same recording can be filed into several folders,
 * but re-filing it into a folder it's already in returns the existing Video
 * instead of creating a duplicate. The created Video carries `liveSessionId`
 * so the recording can always be traced back to its source session.
 */
export async function promoteRecordingToFolder(params: {
  session: Pick<RecordingSource, "_id" | "title">;
  recording: ILiveSessionRecording;
  folderId: Types.ObjectId | string;
  title?: string;
  priceType?: "free" | "paid";
  order?: number;
}): Promise<PromoteResult> {
  const { session, recording, folderId } = params;
  if (!recording?.path) {
    throw new Error("Recording has no playable path.");
  }

  // Dedupe key: a recording is identified by its mp4 path, stored as aws_id.
  const existing = await Video.findOne({
    videoCategoryId: folderId,
    aws_id: recording.path,
  });
  if (existing) return { video: existing, alreadyExisted: true };

  const video = await Video.create({
    videoCategoryId: new Types.ObjectId(String(folderId)),
    liveSessionId: session._id,
    title:
      params.title ??
      `${session.title}${recording.quality ? ` (${recording.quality})` : ""}`,
    platform: "aws",
    aws_id: recording.path,
    priceType: params.priceType ?? "paid",
    order: params.order ?? 0,
    status: true,
  });

  return { video, alreadyExisted: false };
}

/**
 * If the session has a recordingTargetFolderId set, file the best-quality
 * recording into that folder automatically.
 *
 * Silent best-effort: never throws. The recording always remains accessible
 * on the LiveSession itself; this is purely an ergonomic auto-add.
 */
export async function maybeAutoPromoteRecording(session: ILiveSession): Promise<void> {
  try {
    if (!session.recordingTargetFolderId) return;
    const recording = pickRecording(session.recordings ?? []);
    if (!recording?.path) return;

    // Validate the folder is still around AND still belongs to one of the
    // session's live courses. If admin reassigned the session or deleted the
    // folder in the meantime, skip silently.
    const folder = await VideoCategory.findById(session.recordingTargetFolderId)
      .select("_id liveCourseId")
      .lean();
    if (!folder) return;
    if (
      folder.liveCourseId &&
      session.liveCourseIds?.length > 0 &&
      !session.liveCourseIds.map(String).includes(String(folder.liveCourseId))
    ) {
      logger.warn("LiveSession: recordingTargetFolderId no longer belongs to a linked course; skipping auto-promote", {
        sessionId: session._id,
        folderId: folder._id,
      });
      return;
    }

    const { alreadyExisted } = await promoteRecordingToFolder({
      session,
      recording,
      folderId: folder._id as Types.ObjectId,
    });

    if (!alreadyExisted) {
      logger.info("LiveSession: recording auto-promoted into folder", {
        sessionId: session._id,
        folderId: folder._id,
        quality: recording.quality,
      });
    }
  } catch (err) {
    logger.error("LiveSession: recording auto-promote failed (non-fatal)", {
      sessionId: session._id,
      error: (err as Error).message,
    });
  }
}

/**
 * Validate that a folderId is usable as a recordingTargetFolderId for a
 * session attached to the given courses. The folder must exist and belong
 * to one of those courses (since folders live under live courses).
 */
export async function validateRecordingTargetFolder(
  folderId: string,
  liveCourseIds: Array<Types.ObjectId | string>
): Promise<{ id: Types.ObjectId | null; error?: string }> {
  if (!Types.ObjectId.isValid(folderId)) {
    return { id: null, error: "recordingTargetFolderId must be a valid ObjectId." };
  }
  if (!liveCourseIds || liveCourseIds.length === 0) {
    return {
      id: null,
      error: "Pick at least one liveCourseId before setting a recordingTargetFolderId — folders live under live courses.",
    };
  }
  const folder = await VideoCategory.findById(folderId).select("_id liveCourseId").lean();
  if (!folder) return { id: null, error: "recordingTargetFolderId folder not found." };

  const allowed = liveCourseIds.map(String);
  if (!folder.liveCourseId || !allowed.includes(String(folder.liveCourseId))) {
    return {
      id: null,
      error: "recordingTargetFolderId must belong to one of the session's liveCourseIds.",
    };
  }
  return { id: folder._id as Types.ObjectId };
}
