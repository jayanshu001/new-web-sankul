/**
 * Client lecture notes (text + audio) — SQL branch. Gated behind
 * `isMysqlModule("client-lecture-note")`. Net-new tables ws_lecture_note +
 * ws_lecture_audio_note (2026-06-19). All ids SQL ints. The S3/multer handling
 * for audio stays controller-owned (DB-agnostic); this service does persistence
 * + the auth gates + the saved-materials aggregation.
 *
 * Auth parity with lecture.controller / progress.controller:
 *  - recorded: resolve owning course via the catalog-category-tree DAG resolver;
 *    free → allow; paid+course → require active sub (status=true, no
 *    payment_status col); paid+no-course → allow scoped to the video.
 *  - live: session must have ≥1 live course (ws_live_session_course) AND the
 *    customer holds an active verified LiveCourseSubscription to one of them.
 */
import { prisma } from "../../config/prisma";
import { signMediaToken } from "../../utils/mediaToken";

export const LECTURE_NOTE_MODULE = "client-lecture-note";
export const isLectureNoteMysql = (): boolean => true;

export const parseLnId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

type Guard<T> = T | { error: string; status: number };

/** Recorded-lecture auth gate. Returns { courseId } or an error envelope. */
export const authorizeRecorded = async (
  customerId: number,
  videoId: number
): Promise<Guard<{ courseId: number | null }>> => {
  const video = await prisma.video.findFirst({ where: { id: videoId }, select: { status: true, priceType: true, videoCategoryId: true } });
  if (!video || !video.status) return { error: "Lecture not found.", status: 404 };

  const { resolveVideoCourseId } = await import("../catalog-category-tree/category-tree.service");
  const courseId = await resolveVideoCourseId(video.videoCategoryId);

  if (video.priceType === "free") return { courseId: courseId ?? null };

  if (courseId) {
    const sub = await prisma.packageCourseSubscription.findFirst({
      where: { customerId, courseId, status: true, endAt: { gt: new Date() } }, select: { id: true },
    });
    if (!sub) return { error: "Active subscription required to take notes.", status: 403 };
    return { courseId };
  }
  return { courseId: null };
};

/** Live-session auth gate. Returns { liveCourseIds } or an error envelope. */
export const authorizeLive = async (
  customerId: number,
  liveSessionId: number
): Promise<Guard<{ liveCourseIds: number[] }>> => {
  const session = await prisma.liveSession.findFirst({ where: { id: liveSessionId }, select: { id: true } });
  if (!session) return { error: "Live session not found.", status: 404 };

  const links = await prisma.liveSessionCourse.findMany({ where: { liveSessionId }, select: { liveCourseId: true } });
  const liveCourseIds = links.map((l) => l.liveCourseId);
  if (!liveCourseIds.length) return { error: "Notes are only available for subscribed live courses.", status: 403 };

  const ok = await prisma.liveCourseSubscription.findFirst({
    where: { customerId, liveCourseId: { in: liveCourseIds }, status: true, paymentStatus: "verified", endAt: { gt: new Date() } },
    select: { liveCourseId: true },
  });
  if (!ok) return { error: "Active subscription required to take notes.", status: 403 };
  return { liveCourseIds };
};

// ── DTOs ───────────────────────────────────────────────────────────────────────
const sid = (n: number | null | undefined) => (n == null ? null : String(n));
export const noteDto = (r: any) => ({
  _id: String(r.id), customerId: r.customerId, lectureType: r.lectureType,
  videoId: sid(r.videoId), liveSessionId: sid(r.liveSessionId), courseId: sid(r.courseId),
  liveCourseIds: Array.isArray(r.liveCourseIds) ? r.liveCourseIds.map(String) : [],
  timestampSec: r.timestampSec, content: r.content,
  createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
});
export const audioNoteDto = (r: any) => {
  // No raw audio URL/key. A media token (bound to the owning customer) is
  // exchanged at /media/resolve, which re-fetches the note scoped to that
  // customer (ownership check) and returns a freshly PRESIGNED short-lived URL.
  const mediaToken = r.customerId != null ? signMediaToken({ k: "audioNote", id: r.id, cust: Number(r.customerId) }) : null;
  return {
  _id: String(r.id), customerId: r.customerId, lectureType: r.lectureType,
  videoId: sid(r.videoId), liveSessionId: sid(r.liveSessionId), courseId: sid(r.courseId),
  liveCourseIds: Array.isArray(r.liveCourseIds) ? r.liveCourseIds.map(String) : [],
  timestampSec: r.timestampSec, title: r.title ?? "", mediaToken,
  mimeType: r.mimeType ?? null, sizeBytes: r.sizeBytes ?? null, durationSec: r.durationSec ?? null,
  createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
  };
};

/**
 * Fill each note's `liveCourseIds` with `[liveCourseId]` when the stored row had
 * none. Live-course recorded notes are created with an empty `liveCourseIds`, so
 * the notes-list → player flow had no live-course scope to open with (fell back
 * to the catalog category rail, which 403s). The scoped `liveCourseId` comes
 * from the lecture ref (VideoCategory.liveCourseId). No-op when null or already set.
 */
export const enrichNotesWithLiveCourse = <T extends { liveCourseIds?: string[] }>(
  notes: T[],
  liveCourseId: string | null,
): T[] =>
  liveCourseId
    ? notes.map((n) => (Array.isArray(n.liveCourseIds) && n.liveCourseIds.length ? n : { ...n, liveCourseIds: [liveCourseId] }))
    : notes;

// ── Text notes CRUD ───────────────────────────────────────────────────────────
export const createNote = async (data: {
  customerId: number; lectureType: string; timestampSec: number; content: string;
  videoId?: number | null; courseId?: number | null; liveSessionId?: number | null; liveCourseIds?: number[];
}) => {
  const now = new Date();
  const row = await prisma.lectureNote.create({ data: {
    customerId: data.customerId, lectureType: data.lectureType, timestampSec: data.timestampSec, content: data.content,
    videoId: data.videoId ?? null, courseId: data.courseId ?? null, liveSessionId: data.liveSessionId ?? null,
    liveCourseIds: data.liveCourseIds ?? [], createdAt: now, updatedAt: now,
  }});
  return noteDto(row);
};

export const listNotes = async (
  customerId: number,
  lectureType: string,
  key: { videoId?: number; liveSessionId?: number },
  opts: { search?: string; skip?: number; take?: number } = {}
) => {
  const where: any = { customerId, lectureType };
  if (key.videoId != null) where.videoId = key.videoId;
  if (key.liveSessionId != null) where.liveSessionId = key.liveSessionId;
  if (opts.search) where.content = { contains: opts.search };
  const [rows, total] = await Promise.all([
    prisma.lectureNote.findMany({ where, orderBy: [{ timestampSec: "asc" }, { createdAt: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.lectureNote.count({ where }),
  ]);
  return { notes: rows.map(noteDto), total };
};

export const findOwnedNote = (id: number, customerId: number) =>
  prisma.lectureNote.findFirst({ where: { id, customerId } });

export const updateNote = async (id: number, patch: { content?: string; timestampSec?: number }) => {
  const data: any = { updatedAt: new Date() };
  if (patch.content !== undefined) data.content = patch.content;
  if (patch.timestampSec !== undefined) data.timestampSec = patch.timestampSec;
  return noteDto(await prisma.lectureNote.update({ where: { id }, data }));
};

export const deleteNote = (id: number) => prisma.lectureNote.delete({ where: { id } });

// ── Audio notes CRUD ──────────────────────────────────────────────────────────
export const createAudioNote = async (data: {
  customerId: number; lectureType: string; timestampSec: number; title: string;
  audioUrl: string; audioKey: string; mimeType?: string | null; sizeBytes?: number | null; durationSec?: number | null;
  videoId?: number | null; courseId?: number | null; liveSessionId?: number | null; liveCourseIds?: number[];
}) => {
  const now = new Date();
  const row = await prisma.lectureAudioNote.create({ data: {
    customerId: data.customerId, lectureType: data.lectureType, timestampSec: data.timestampSec, title: data.title,
    audioUrl: data.audioUrl, audioKey: data.audioKey, mimeType: data.mimeType ?? null, sizeBytes: data.sizeBytes ?? null,
    durationSec: data.durationSec ?? null, videoId: data.videoId ?? null, courseId: data.courseId ?? null,
    liveSessionId: data.liveSessionId ?? null, liveCourseIds: data.liveCourseIds ?? [], createdAt: now, updatedAt: now,
  }});
  return audioNoteDto(row);
};

export const listAudioNotes = async (
  customerId: number,
  lectureType: string,
  key: { videoId?: number; liveSessionId?: number },
  opts: { search?: string; skip?: number; take?: number } = {}
) => {
  const where: any = { customerId, lectureType };
  if (key.videoId != null) where.videoId = key.videoId;
  if (key.liveSessionId != null) where.liveSessionId = key.liveSessionId;
  if (opts.search) where.title = { contains: opts.search };
  const [rows, total] = await Promise.all([
    prisma.lectureAudioNote.findMany({ where, orderBy: [{ timestampSec: "asc" }, { createdAt: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.lectureAudioNote.count({ where }),
  ]);
  return { notes: rows.map(audioNoteDto), total };
};

export const findOwnedAudioNote = (id: number, customerId: number) =>
  prisma.lectureAudioNote.findFirst({ where: { id, customerId } });

export const updateAudioNote = async (id: number, patch: { title?: string; timestampSec?: number }) => {
  const data: any = { updatedAt: new Date() };
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.timestampSec !== undefined) data.timestampSec = patch.timestampSec;
  return audioNoteDto(await prisma.lectureAudioNote.update({ where: { id }, data }));
};

export const deleteAudioNote = (id: number) => prisma.lectureAudioNote.delete({ where: { id } });

// ── Saved-materials grouped listing ───────────────────────────────────────────
/**
 * One row per lecture (video or live session) with the customer's text/voice
 * note counts. Mirrors listSavedMaterialNotes: group text+voice by videoId
 * (recorded) and liveSessionId (live), join titles from ws_video / ws_live_session,
 * drop untitled, sort by last-note desc.
 */
export const savedMaterials = async (
  customerId: number,
  opts: { search?: string; skip?: number; limit?: number } = {}
) => {
  type Bucket = { textNotesCount: number; voiceNotesCount: number; lastNoteAt: Date };
  const recorded = new Map<number, Bucket>();
  const live = new Map<number, Bucket>();
  const bump = (map: Map<number, Bucket>, key: number | null, field: "textNotesCount" | "voiceNotesCount", at: Date | null) => {
    if (key == null) return;
    const ex = map.get(key);
    const when = at ?? new Date(0);
    if (ex) { ex[field] += 1; if (when > ex.lastNoteAt) ex.lastNoteAt = when; }
    else map.set(key, { textNotesCount: field === "textNotesCount" ? 1 : 0, voiceNotesCount: field === "voiceNotesCount" ? 1 : 0, lastNoteAt: when });
  };

  const [textRows, voiceRows] = await Promise.all([
    prisma.lectureNote.findMany({ where: { customerId }, select: { lectureType: true, videoId: true, liveSessionId: true, updatedAt: true } }),
    prisma.lectureAudioNote.findMany({ where: { customerId }, select: { lectureType: true, videoId: true, liveSessionId: true, updatedAt: true } }),
  ]);
  for (const r of textRows) bump(r.lectureType === "recorded" ? recorded : live, r.lectureType === "recorded" ? r.videoId : r.liveSessionId, "textNotesCount", r.updatedAt);
  for (const r of voiceRows) bump(r.lectureType === "recorded" ? recorded : live, r.lectureType === "recorded" ? r.videoId : r.liveSessionId, "voiceNotesCount", r.updatedAt);

  const [videos, sessions] = await Promise.all([
    recorded.size ? prisma.video.findMany({ where: { id: { in: [...recorded.keys()] } }, select: { id: true, title: true } }) : [],
    live.size ? prisma.liveSession.findMany({ where: { id: { in: [...live.keys()] } }, select: { id: true, title: true } }) : [],
  ]);
  const vTitle = new Map(videos.map((v) => [v.id, v.title]));
  const sTitle = new Map(sessions.map((s) => [s.id, s.title]));

  const items = [
    ...[...recorded.entries()].map(([id, b]) => ({ kind: "recorded" as const, videoId: String(id), liveSessionId: null as string | null, title: vTitle.get(id) ?? null, textNotesCount: b.textNotesCount, voiceNotesCount: b.voiceNotesCount, lastNoteAt: b.lastNoteAt })),
    ...[...live.entries()].map(([id, b]) => ({ kind: "live" as const, videoId: null as string | null, liveSessionId: String(id), title: sTitle.get(id) ?? null, textNotesCount: b.textNotesCount, voiceNotesCount: b.voiceNotesCount, lastNoteAt: b.lastNoteAt })),
  ].filter((r) => r.title !== null && r.title !== "").sort((a, b) => b.lastNoteAt.getTime() - a.lastNoteAt.getTime());

  // Grouping/title contract stays intact — `search` (lecture title) filters the
  // top-level group list, then we paginate that list. `total` = full match count.
  const filtered = opts.search
    ? items.filter((r) => (r.title ?? "").toLowerCase().includes(opts.search!.toLowerCase()))
    : items;
  const total = filtered.length;
  const skip = opts.skip ?? 0;
  const limit = opts.limit ?? 20;
  return { items: filtered.slice(skip, skip + limit), total };
};

// ── Bulk delete of a saved-material group (text + audio) ───────────────────────
/**
 * Target of a saved-material bulk delete — mirrors the `kind` + id fields a row
 * in `savedMaterials` carries. `recorded`/`live` are what the listing emits today
 * (grouped by videoId / liveSessionId); `course`/`live_course` are supported for
 * the forward-looking course-scoped rows in the FE contract (notes carry
 * `courseId` and the `liveCourseIds` JSON array respectively).
 */
export type SavedMaterialTarget =
  | { kind: "recorded"; videoId: number }
  | { kind: "live"; liveSessionId: number }
  | { kind: "course"; courseId: number }
  | { kind: "live_course"; liveCourseId: number };

const whereForTarget = (customerId: number, t: SavedMaterialTarget): any => {
  switch (t.kind) {
    case "recorded": return { customerId, lectureType: "recorded", videoId: t.videoId };
    case "live": return { customerId, lectureType: "live", liveSessionId: t.liveSessionId };
    case "course": return { customerId, courseId: t.courseId };
    // liveCourseIds is a JSON array of ints — match rows whose array contains it.
    case "live_course": return { customerId, liveCourseIds: { array_contains: t.liveCourseId } };
  }
};

/**
 * Delete EVERY text + audio note for the authenticated customer under a saved-
 * material group. Scoped to the customer. Idempotent (0 matches ⇒ counts 0, not
 * an error). Returns the deleted audio note urls so the caller can clean the S3
 * objects (same cleanup as single audio delete). Both deletes run in one
 * transaction so a partial wipe can't leave one collection behind.
 */
export const deleteSavedMaterialNotes = async (
  customerId: number,
  target: SavedMaterialTarget
): Promise<{ deletedTextNotes: number; deletedVoiceNotes: number; audioUrls: string[] }> => {
  const where = whereForTarget(customerId, target);
  // Capture audio urls BEFORE deleting so we can clean S3 afterwards.
  const audioRows = await prisma.lectureAudioNote.findMany({ where, select: { audioUrl: true } });
  const [textDel, voiceDel] = await prisma.$transaction([
    prisma.lectureNote.deleteMany({ where }),
    prisma.lectureAudioNote.deleteMany({ where }),
  ]);
  return {
    deletedTextNotes: textDel.count,
    deletedVoiceNotes: voiceDel.count,
    audioUrls: audioRows.map((r) => r.audioUrl).filter((u): u is string => !!u),
  };
};
