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
  "_id" | "title" | "subject" | "recordings" | "liveCourseIds"
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

/**
 * Normalize a subject string into a stable lookup key. Trim, lowercase, and
 * collapse internal whitespace so "Maths", "maths", "Maths " and "Maths  "
 * all resolve to the same folder.
 */
export function normalizeSubjectKey(subject: string | null | undefined): string | null {
  if (typeof subject !== "string") return null;
  const k = subject.trim().toLowerCase().replace(/\s+/g, " ");
  return k.length > 0 ? k : null;
}

/**
 * Find — or create on demand — the VideoCategory folder that recordings of a
 * given subject under a given live course should land in. The display `title`
 * preserves the admin's original casing on first write; subsequent matches
 * are by `subjectKey` so casing/whitespace drift doesn't fragment the group.
 *
 * Image is intentionally left null on auto-create; admin can set it later.
 */
export async function resolveOrCreateSubjectFolder(params: {
  liveCourseId: Types.ObjectId | string;
  subject: string;
}): Promise<{ id: Types.ObjectId; created: boolean } | null> {
  const subjectKey = normalizeSubjectKey(params.subject);
  if (!subjectKey) return null;

  const liveCourseId = new Types.ObjectId(String(params.liveCourseId));

  const existing = await VideoCategory.findOne({ liveCourseId, subjectKey })
    .select("_id")
    .lean();
  if (existing) return { id: existing._id as Types.ObjectId, created: false };

  // Place at the end of the course's current folder list.
  const last = await VideoCategory.findOne({ liveCourseId })
    .sort({ order_by: -1 })
    .select("order_by")
    .lean();
  const nextOrder = (last?.order_by ?? 0) + 1;

  try {
    const folder = await VideoCategory.create({
      liveCourseId,
      title: params.subject.trim(),
      // Slug isn't user-facing for live-course folders; reuse the subjectKey
      // as a stable, URL-safe-ish slug. Real slug generation can replace this
      // if/when folders grow public URLs.
      slug: subjectKey.replace(/\s+/g, "-"),
      subjectKey,
      image: null,
      order_by: nextOrder,
      status: true,
    } as any);
    return { id: folder._id as Types.ObjectId, created: true };
  } catch (err: any) {
    // Race: a concurrent webhook for the same (course, subject) won the
    // insert. Re-read and return the winner.
    if (err?.code === 11000) {
      const winner = await VideoCategory.findOne({ liveCourseId, subjectKey })
        .select("_id")
        .lean();
      if (winner) return { id: winner._id as Types.ObjectId, created: false };
    }
    throw err;
  }
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

  // Belt-and-braces: webhook ingest already strips trailing quote artifacts,
  // but legacy paths persisted before that fix can still leak in via the
  // backfill script. Strip here too.
  const path = recording.path.replace(/(?:"|%22|%2522)+$/i, "");

  // Dedupe key: a recording is identified by its mp4 path, stored as aws_id.
  const existing = await Video.findOne({
    videoCategoryId: folderId,
    aws_id: path,
  });
  if (existing) return { video: existing, alreadyExisted: true };

  const video = await Video.create({
    videoCategoryId: new Types.ObjectId(String(folderId)),
    liveSessionId: session._id,
    // Title omits the quality suffix — the customer endpoint surfaces the
    // full multi-quality `recordings[]` per lecture, so quality is no longer
    // part of the title's identity.
    title: params.title ?? session.title,
    platform: "aws",
    aws_id: path,
    priceType: params.priceType ?? "paid",
    order: params.order ?? 0,
    status: true,
  });

  return { video, alreadyExisted: false };
}

/**
 * For each linked live course, resolve (or create) the subject folder and
 * file the best-quality recording into it. Subject-based grouping — admin
 * never has to pick a folder id; the session's `subject` field is the key.
 *
 * Silent best-effort: never throws. The recording always remains accessible
 * on the LiveSession itself; this is purely an ergonomic auto-add.
 */
export async function maybeAutoPromoteRecording(session: ILiveSession): Promise<void> {
  try {
    const recording = pickRecording(session.recordings ?? []);
    if (!recording?.path) return;

    const subjectKey = normalizeSubjectKey(session.subject);
    if (!subjectKey) {
      logger.info("LiveSession: skipping auto-promote — no subject set", {
        sessionId: session._id,
      });
      return;
    }

    const courseIds = session.liveCourseIds ?? [];
    if (courseIds.length === 0) return;

    for (const liveCourseId of courseIds) {
      try {
        const folderRef = await resolveOrCreateSubjectFolder({
          liveCourseId,
          subject: session.subject ?? "",
        });
        if (!folderRef) continue;

        const { alreadyExisted } = await promoteRecordingToFolder({
          session,
          recording,
          folderId: folderRef.id,
        });

        if (!alreadyExisted) {
          logger.info("LiveSession: recording auto-promoted into subject folder", {
            sessionId: session._id,
            liveCourseId: String(liveCourseId),
            folderId: String(folderRef.id),
            folderCreated: folderRef.created,
            subject: session.subject,
            quality: recording.quality,
          });
        }
      } catch (innerErr) {
        logger.error("LiveSession: per-course auto-promote failed", {
          sessionId: session._id,
          liveCourseId: String(liveCourseId),
          error: (innerErr as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error("LiveSession: recording auto-promote failed (non-fatal)", {
      sessionId: session._id,
      error: (err as Error).message,
    });
  }
}
