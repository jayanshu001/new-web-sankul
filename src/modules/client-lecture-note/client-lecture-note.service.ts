/**
 * Lecture notes: text + audio notes and saved materials. Audio S3/multer handling is controller-owned.
 *
 * Auth gates (parity with lecture/progress controllers):
 *  - recorded: owning course resolved via the category-tree DAG; free → allow;
 *    paid+course → require an active sub; paid+no-course → allow scoped to the video.
 *  - live: session must link ≥1 live course and the customer must hold an active
 *    LiveCourseSubscription to one of them.
 */
import { prisma } from "../../config/prisma";
import { signMediaToken } from "../../utils/mediaToken";
import { buildPrismaSearch, matchesAllTokens } from "../../utils/searchFilter";
import { parsePositiveInt } from "../../utils/parseId";
import type { Prisma } from "@prisma/client";

export const parseLnId = parsePositiveInt;

type Guard<T> = T | { error: string; status: number };

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
    // A live-course subscription row exists only for a paid order, so `status` + the window is the entitlement.
    where: { customerId, liveCourseId: { in: liveCourseIds }, status: true, endAt: { gt: new Date() } },
    select: { liveCourseId: true },
  });
  if (!ok) return { error: "Active subscription required to take notes.", status: 403 };
  return { liveCourseIds };
};

const sid = (n: number | null | undefined) => (n == null ? null : String(n));
export const noteDto = (r: any) => ({
  _id: String(r.id), customerId: r.customerId, lectureType: r.lectureType,
  videoId: sid(r.videoId), liveSessionId: sid(r.liveSessionId), courseId: sid(r.courseId),
  liveCourseIds: Array.isArray(r.liveCourseIds) ? r.liveCourseIds.map(String) : [],
  timestampSec: r.timestampSec, content: r.content,
  createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
});
export const audioNoteDto = (r: any) => {
  // No raw audio URL/key: the customer-bound media token is exchanged at /media/resolve,
  // which re-checks ownership and returns a freshly presigned short-lived URL.
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
 * Fills an empty `liveCourseIds` with `[liveCourseId]` (from VideoCategory.liveCourseId).
 * Live-course recorded notes are stored with none, and without a scope the notes → player
 * flow falls back to the catalog category rail, which 403s.
 */
export const enrichNotesWithLiveCourse = <T extends { liveCourseIds?: string[] }>(
  notes: T[],
  liveCourseId: string | null,
): T[] =>
  liveCourseId
    ? notes.map((n) => (Array.isArray(n.liveCourseIds) && n.liveCourseIds.length ? n : { ...n, liveCourseIds: [liveCourseId] }))
    : notes;

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
  const where: Prisma.LectureNoteWhereInput = { customerId, lectureType };
  if (key.videoId != null) where.videoId = key.videoId;
  if (key.liveSessionId != null) where.liveSessionId = key.liveSessionId;
  const contentSearch = buildPrismaSearch(opts.search, ["content"]);
  if (contentSearch) where.AND = contentSearch.AND;
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
  const titleSearch = buildPrismaSearch(opts.search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;
  const [rows, total] = await Promise.all([
    prisma.lectureAudioNote.findMany({ where, orderBy: [{ timestampSec: "asc" }, { createdAt: "asc" }], skip: opts.skip, take: opts.take }),
    prisma.lectureAudioNote.count({ where }),
  ]);
  return { notes: rows.map(audioNoteDto), total };
};

export const findOwnedAudioNote = (id: number, customerId: number) =>
  prisma.lectureAudioNote.findFirst({ where: { id, customerId } });

export const updateAudioNote = async (id: number, patch: { title?: string; timestampSec?: number }) => {
  const data: Prisma.LectureAudioNoteUncheckedUpdateInput = { updatedAt: new Date() };
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.timestampSec !== undefined) data.timestampSec = patch.timestampSec;
  return audioNoteDto(await prisma.lectureAudioNote.update({ where: { id }, data }));
};

export const deleteAudioNote = (id: number) => prisma.lectureAudioNote.delete({ where: { id } });

/**
 * One row per lecture (video or live session) with text/voice note counts, titled from
 * ws_video / ws_live_session; untitled rows dropped; newest note first.
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

  // `search` filters the grouped list by lecture title before paging.
  const filtered = opts.search
    ? items.filter((r) => matchesAllTokens(opts.search, [r.title]))
    : items;
  const total = filtered.length;
  const skip = opts.skip ?? 0;
  const limit = opts.limit ?? 20;
  return { items: filtered.slice(skip, skip + limit), total };
};

/**
 * The listing emits `recorded`/`live`; `course`/`live_course` are accepted for the
 * course-scoped rows in the FE contract (matched on `courseId` / the `liveCourseIds` JSON).
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
    case "live_course": return { customerId, liveCourseIds: { array_contains: t.liveCourseId } };
  }
};

/**
 * Deletes every text + audio note in a saved-material group for the customer. Idempotent.
 * Returns the deleted audio urls so the caller can clean S3. One transaction, so a partial
 * wipe can't leave one table behind.
 */
export const deleteSavedMaterialNotes = async (
  customerId: number,
  target: SavedMaterialTarget
): Promise<{ deletedTextNotes: number; deletedVoiceNotes: number; audioUrls: string[] }> => {
  const where = whereForTarget(customerId, target);
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
