import { Types } from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
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

/**
 * If the session has a recordingTargetFolderId set, create a Video record in
 * that folder pointing at the recording — but only if a Video for the same
 * url isn't already there (dedupe across webhook + recovery paths).
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

    // Dedupe: don't create a second Video pointing at the same recording.
    const exists = await Video.exists({
      videoCategoryId: folder._id,
      aws_id: recording.path,
    });
    if (exists) return;

    await Video.create({
      videoCategoryId: folder._id,
      title: `${session.title}${recording.quality ? ` (${recording.quality})` : ""}`,
      platform: "aws",
      aws_id: recording.path,
      priceType: "paid",
      order: 0,
      status: true,
    });

    logger.info("LiveSession: recording auto-promoted into folder", {
      sessionId: session._id,
      folderId: folder._id,
      quality: recording.quality,
    });
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
