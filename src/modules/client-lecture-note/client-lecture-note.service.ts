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
export const audioNoteDto = (r: any) => ({
  _id: String(r.id), customerId: r.customerId, lectureType: r.lectureType,
  videoId: sid(r.videoId), liveSessionId: sid(r.liveSessionId), courseId: sid(r.courseId),
  liveCourseIds: Array.isArray(r.liveCourseIds) ? r.liveCourseIds.map(String) : [],
  timestampSec: r.timestampSec, title: r.title ?? "", audioUrl: r.audioUrl, audioKey: r.audioKey,
  mimeType: r.mimeType ?? null, sizeBytes: r.sizeBytes ?? null, durationSec: r.durationSec ?? null,
  createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
});

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

export const listNotes = async (customerId: number, lectureType: string, key: { videoId?: number; liveSessionId?: number }) => {
  const where: any = { customerId, lectureType };
  if (key.videoId != null) where.videoId = key.videoId;
  if (key.liveSessionId != null) where.liveSessionId = key.liveSessionId;
  const rows = await prisma.lectureNote.findMany({ where, orderBy: [{ timestampSec: "asc" }, { createdAt: "asc" }] });
  return rows.map(noteDto);
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

export const listAudioNotes = async (customerId: number, lectureType: string, key: { videoId?: number; liveSessionId?: number }) => {
  const where: any = { customerId, lectureType };
  if (key.videoId != null) where.videoId = key.videoId;
  if (key.liveSessionId != null) where.liveSessionId = key.liveSessionId;
  const rows = await prisma.lectureAudioNote.findMany({ where, orderBy: [{ timestampSec: "asc" }, { createdAt: "asc" }] });
  return rows.map(audioNoteDto);
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
export const savedMaterials = async (customerId: number) => {
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

  return items;
};
