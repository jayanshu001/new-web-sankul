/**
 * Admin LIVE-class DB persistence — MySQL (Prisma) branch.
 *
 * SQL mirror of the Mongo reads/writes in src/admin/live/{live.controller,
 * recording.promote,live.guards}.ts. Those files branch on isAdminLiveMysql()
 * and delegate the DATABASE work here. StreamOS calls + Socket.io emits stay in
 * the controllers and run in BOTH branches (they're not Mongo).
 *
 * Tables: ws_live_session (LiveSession), ws_live_session_course
 * (LiveSessionCourse join — replaces Mongo's embedded liveCourseIds[]),
 * ws_live_session_attendance (LiveSessionAttendance), ws_live_course
 * (LiveCourse), ws_video_category (VideoCategory), ws_video (Video).
 *
 * RECORDING → VIDEO PROMOTION (C7) — now fully on SQL:
 *  - ws_video now has `live_session_id` and ws_video_category has `subject_key`,
 *    so promotion + the promotedVideos back-link query are implemented here
 *    (resolveOrCreateSubjectFolderSql / promoteRecordingToFolderSql /
 *    maybeAutoPromoteRecordingSql / resolvePromotedVideosSql).
 *  - A live course "owns" folders by reachability from its root folder
 *    (ws_live_course.video_category_id) via the ws_video_category_relation DAG —
 *    ws_video_category has no live_course_id column. Subject folders are deduped
 *    by `subject_key` among the course's reachable folders and, on create, are
 *    parented to the course root (folder.parent = root + a relation edge).
 *  - If a live course has NO root folder set, there is nowhere to anchor the
 *    subject folder, so that course is skipped (best-effort, mirrors Mongo's
 *    silent per-course failure). See report.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";
import { descendantsOf } from "../catalog-category-tree/category-tree.service";
import type { LiveSession as SqlLiveSession } from "@prisma/client";

export const ADMIN_LIVE_MODULE = "admin-live";
export const isAdminLiveMysql = (): boolean => isMysqlModule(ADMIN_LIVE_MODULE);

/** Parse a numeric SQL id from a string, else null (rejects 24-hex ObjectIds). */
export const parseAlId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStr = (v: number | null | undefined): string | null =>
  v != null && v > 0 ? String(v) : null;

const jArr = (v: any): any[] => (Array.isArray(v) ? v : []);

// ── public view (matches Mongo publicView shape exactly) ─────────────────────
export interface PublicSessionView {
  id: string;
  title: string | null;
  liveCourseIds: string[];
  liveCourseId: string | null;
  liveCourses?: any[];
  subject: string;
  educatorId: string | null;
  endAt: Date | null;
  status: string;
  scheduledAt: Date | null;
  streamId: string | null;
  rtmpUrl: string | null;
  hlsUrl: string | null;
  hlsUrls: any;
  recordings: any[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Build the Mongo-shaped publicView from a SQL row + its linked course ids.
 * `liveCourses` mirrors Mongo's populated-doc array (id/name/image/thumbnail);
 * pass undefined to omit it (list/non-populated callers).
 */
export const toPublicView = (
  row: SqlLiveSession,
  liveCourseIds: number[],
  liveCourses?: any[]
): PublicSessionView => {
  const idList = liveCourseIds.map(String);
  return {
    id: String(row.id),
    title: row.title ?? null,
    liveCourseIds: idList,
    liveCourseId: idList[0] ?? null,
    liveCourses: liveCourses,
    subject: row.subject ?? "",
    educatorId: idStr(row.educatorId),
    endAt: row.endAt ?? null,
    status: row.status,
    scheduledAt: row.scheduledAt ?? null,
    streamId: row.streamId ?? null,
    rtmpUrl: row.rtmpUrl ?? null,
    hlsUrl: row.hlsUrl ?? null,
    hlsUrls: row.hlsUrls ?? null,
    recordings: jArr(row.recordings),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
};

// ── course-link helpers (ws_live_session_course join) ────────────────────────

/** Linked liveCourse ids for a session, in stable insertion order. */
export const getLinkedCourseIds = async (liveSessionId: number): Promise<number[]> => {
  const rows = await prisma.liveSessionCourse.findMany({
    where: { liveSessionId },
    select: { liveCourseId: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => r.liveCourseId);
};

/** Populated liveCourse docs (id/name/image) for the publicView `liveCourses`. */
export const getLinkedCourses = async (liveSessionId: number): Promise<any[]> => {
  const ids = await getLinkedCourseIds(liveSessionId);
  if (ids.length === 0) return [];
  const courses = await prisma.liveCourse.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, image: true },
  });
  const byId = new Map(courses.map((c) => [c.id, c]));
  // Preserve link order; expose Mongo-ish doc shape.
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ _id: String(c.id), name: c.name, image: c.image ?? null, thumbnail: null }));
};

/** Replace the full set of session↔course links (set semantics, deduped). */
export const setLinkedCourseIds = async (liveSessionId: number, courseIds: number[]): Promise<void> => {
  const unique = Array.from(new Set(courseIds));
  await prisma.$transaction([
    prisma.liveSessionCourse.deleteMany({ where: { liveSessionId } }),
    ...(unique.length > 0
      ? [
          prisma.liveSessionCourse.createMany({
            data: unique.map((liveCourseId) => ({ liveSessionId, liveCourseId })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
};

/**
 * Validate a list of liveCourse-id strings: each must be a positive int and
 * exist in ws_live_course. Returns parsed numeric ids or an error message.
 */
export const validateLiveCourseIds = async (
  rawIds: string[]
): Promise<{ ids: number[]; error?: string }> => {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const r of rawIds) {
    const n = parseAlId(String(r));
    if (n == null) return { ids: [], error: "Each live course id must be a valid id." };
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  if (ids.length === 0) return { ids: [] };
  const found = await prisma.liveCourse.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((d) => d.id));
    const missing = ids.filter((id) => !foundSet.has(id)).map(String);
    return { ids: [], error: `Live course(s) not found: ${missing.join(", ")}.` };
  }
  return { ids };
};

// ── session lookups ──────────────────────────────────────────────────────────

/** Find a session by numeric SQL id OR by Streamos streamId string. */
export const findSessionByAnyId = async (id: string): Promise<SqlLiveSession | null> => {
  const numeric = parseAlId(id);
  if (numeric != null) {
    const byId = await prisma.liveSession.findUnique({ where: { id: numeric } });
    if (byId) return byId;
  }
  const streamId = typeof id === "string" ? id.trim() : "";
  if (streamId) {
    return prisma.liveSession.findFirst({ where: { streamId } });
  }
  return null;
};

export const findById = (id: number): Promise<SqlLiveSession | null> =>
  prisma.liveSession.findUnique({ where: { id } });

/**
 * Find a session strictly by Streamos streamId (camera-ingest broadcast lookup).
 * Returns only the fields the camera bridge needs. Mirrors the Mongo
 * LiveSession.findOne({ streamId }).select("streamId rtmpUrl status").
 */
export const findSessionByStreamId = (
  streamId: string
): Promise<{ streamId: string | null; rtmpUrl: string | null; status: string } | null> =>
  prisma.liveSession.findFirst({
    where: { streamId },
    select: { streamId: true, rtmpUrl: true, status: true },
  });

// ── session writes ───────────────────────────────────────────────────────────

export interface CreateSessionInput {
  title: string;
  liveCourseIds: number[];
  subject: string;
  educatorId: number | null;
  endAt: Date | null;
  scheduledAt?: Date | null;
  status: string;
  streamId?: string | null;
  rtmpUrl?: string | null;
  hlsUrl?: string | null;
  hlsUrls?: any;
}

/** Create a session row + its course links; returns row & linked ids. */
export const createSession = async (
  input: CreateSessionInput
): Promise<{ row: SqlLiveSession; liveCourseIds: number[] }> => {
  const now = new Date();
  const row = await prisma.liveSession.create({
    data: {
      title: input.title,
      subject: input.subject,
      educatorId: input.educatorId,
      endAt: input.endAt,
      scheduledAt: input.scheduledAt ?? null,
      status: input.status,
      streamId: input.streamId ?? null,
      rtmpUrl: input.rtmpUrl ?? null,
      hlsUrl: input.hlsUrl ?? null,
      hlsUrls: input.hlsUrls ?? undefined,
      recordings: [],
      createdAt: now,
      updatedAt: now,
    },
  });
  await setLinkedCourseIds(row.id, input.liveCourseIds);
  return { row, liveCourseIds: input.liveCourseIds };
};

/** Patch arbitrary session columns; bumps updatedAt. Returns the fresh row. */
export const updateSession = async (
  id: number,
  data: {
    title?: string;
    subject?: string;
    educatorId?: number | null;
    endAt?: Date | null;
    scheduledAt?: Date | null;
    status?: string;
    streamId?: string | null;
    rtmpUrl?: string | null;
    hlsUrl?: string | null;
    hlsUrls?: any;
    recordings?: any;
  }
): Promise<SqlLiveSession> =>
  prisma.liveSession.update({
    where: { id },
    data: { ...data, hlsUrls: data.hlsUrls ?? undefined, updatedAt: new Date() },
  });

/** Update a session selected by streamId; null when none matched. */
export const updateByStreamId = async (
  streamId: string,
  data: { status?: string; recordings?: any }
): Promise<SqlLiveSession | null> => {
  const found = await prisma.liveSession.findFirst({ where: { streamId }, select: { id: true } });
  if (!found) return null;
  return prisma.liveSession.update({
    where: { id: found.id },
    data: { ...data, updatedAt: new Date() },
  });
};

/** Delete a session and its course links. */
export const deleteSession = async (id: number): Promise<void> => {
  await prisma.$transaction([
    prisma.liveSessionCourse.deleteMany({ where: { liveSessionId: id } }),
    prisma.liveSession.delete({ where: { id } }),
  ]);
};

// ── list ─────────────────────────────────────────────────────────────────────

export interface ListInput {
  status?: string;
  upcoming?: boolean;
  courseIds?: number[]; // ANY-of filter
  skip: number;
  take: number;
}

export const listSessions = async (
  input: ListInput
): Promise<{ rows: SqlLiveSession[]; total: number }> => {
  const where: any = {};
  if (input.status) where.status = input.status;
  if (input.upcoming) {
    where.status = "SCHEDULED";
    where.scheduledAt = { gte: new Date() };
  }
  if (input.courseIds && input.courseIds.length > 0) {
    const links = await prisma.liveSessionCourse.findMany({
      where: { liveCourseId: { in: input.courseIds } },
      select: { liveSessionId: true },
    });
    const sessionIds = Array.from(new Set(links.map((l) => l.liveSessionId)));
    where.id = { in: sessionIds.length > 0 ? sessionIds : [-1] };
  }
  const [rows, total] = await Promise.all([
    prisma.liveSession.findMany({
      where,
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      skip: input.skip,
      take: input.take,
    }),
    prisma.liveSession.count({ where }),
  ]);
  return { rows, total };
};

// ── attendance ───────────────────────────────────────────────────────────────

/**
 * Attendance rows for a stream, newest first, shaped to match the Mongo
 * `.populate("customerId", "firstName middleName lastName phoneNumber")` lean
 * output. NOTE: SQL ws_customer has fullName + phone (no split name columns), so
 * firstName carries the full name and middle/last are null — see report.
 */
export const getAttendance = async (
  streamId: string
): Promise<{
  records: any[];
  summary: { totalJoins: number; uniqueViewers: number; currentlyActive: number };
}> => {
  const rows = await prisma.liveSessionAttendance.findMany({
    where: { streamId },
    orderBy: { joinedAt: "desc" },
  });

  const customerIds = Array.from(
    new Set(rows.map((r) => r.customerId).filter((c): c is number => c != null))
  );
  const customers =
    customerIds.length > 0
      ? await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, fullName: true, phoneNumber: true },
        })
      : [];
  const byId = new Map(customers.map((c) => [c.id, c]));

  const records = rows.map((r) => {
    const cust = r.customerId != null ? byId.get(r.customerId) : undefined;
    return {
      _id: String(r.id),
      streamId: r.streamId ?? null,
      liveSessionId: r.liveSessionId != null ? String(r.liveSessionId) : null,
      customerId: cust
        ? {
            _id: String(cust.id),
            firstName: cust.fullName ?? null,
            middleName: null,
            lastName: null,
            phoneNumber: cust.phoneNumber ?? null,
          }
        : r.customerId != null
        ? String(r.customerId)
        : null,
      userName: r.userName ?? null,
      joinedAt: r.joinedAt ?? null,
      leftAt: r.leftAt ?? null,
      durationSec: r.durationSec ?? null,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    };
  });

  const uniqueViewers = new Set(
    records.map((r) =>
      String(typeof r.customerId === "object" && r.customerId ? r.customerId._id : r.customerId)
    )
  ).size;
  const currentlyActive = records.filter((r) => !r.leftAt).length;

  return {
    records,
    summary: { totalJoins: records.length, uniqueViewers, currentlyActive },
  };
};

/**
 * Close any still-open attendance rows for a stream at `endedAt`, computing
 * durationSec from joinedAt. Mirrors the Mongo aggregation-pipeline updateMany.
 * Returns the number of rows modified.
 */
export const closeOpenAttendance = async (streamId: string, endedAt: Date): Promise<number> => {
  const open = await prisma.liveSessionAttendance.findMany({
    where: { streamId, leftAt: null },
    select: { id: true, joinedAt: true },
  });
  if (open.length === 0) return 0;
  await prisma.$transaction(
    open.map((r) => {
      const durationSec =
        r.joinedAt != null
          ? Math.max(0, Math.round((endedAt.getTime() - r.joinedAt.getTime()) / 1000))
          : 0;
      return prisma.liveSessionAttendance.update({
        where: { id: r.id },
        data: { leftAt: endedAt, durationSec, updatedAt: new Date() },
      });
    })
  );
  return open.length;
};

/**
 * Open a per-socket attendance row for a live-chat stint (the socket
 * openAttendance path). Resolves the owning liveSession by streamId (best-effort
 * — liveSessionId is nullable) and inserts a ws_live_session_attendance row.
 * Returns the new row id as a string (the socket stashes it to close later).
 */
export const openAttendanceSql = async (input: {
  streamId: string;
  customerId: number | null;
  userName: string;
}): Promise<string> => {
  const session = await prisma.liveSession.findFirst({
    where: { streamId: input.streamId },
    select: { id: true },
  });
  const now = new Date();
  const rec = await prisma.liveSessionAttendance.create({
    data: {
      streamId: input.streamId,
      liveSessionId: session?.id ?? null,
      customerId: input.customerId,
      userName: input.userName,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  return String(rec.id);
};

/**
 * Close a single open attendance row by id, computing durationSec from joinedAt.
 * Idempotent: a no-op if the row is missing or already has leftAt. Mirrors the
 * socket closeAttendance path.
 */
export const closeAttendanceSql = async (attendanceId: number, endedAt: Date): Promise<void> => {
  const rec = await prisma.liveSessionAttendance.findUnique({
    where: { id: attendanceId },
    select: { id: true, joinedAt: true, leftAt: true },
  });
  if (!rec || rec.leftAt) return;
  const durationSec = rec.joinedAt
    ? Math.max(0, Math.round((endedAt.getTime() - rec.joinedAt.getTime()) / 1000))
    : 0;
  await prisma.liveSessionAttendance.update({
    where: { id: attendanceId },
    data: { leftAt: endedAt, durationSec, updatedAt: new Date() },
  });
};

// ── live.guards.ts: resolveLiveClassId ───────────────────────────────────────

/**
 * streamId only while the underlying session is CREATED; null otherwise.
 * Mirrors src/admin/live/live.guards.ts on the SQL backend.
 */
export const resolveLiveClassIdSql = async (liveClassId: string): Promise<string | null> => {
  const streamId = liveClassId.trim();
  if (!streamId) return null;
  const session = await prisma.liveSession.findFirst({
    where: { streamId },
    select: { status: true },
  });
  if (!session || session.status !== "CREATED") return null;
  return streamId;
};

// ════════════════════════════════════════════════════════════════════════════
// Recording → Video promotion (C7) — SQL port of recording.promote.ts
// ════════════════════════════════════════════════════════════════════════════

const QUALITY_PREFERENCE = ["1080p", "720p", "480p", "360p", "240p", "144p"];

/** Strip Streamos' stray trailing-quote artifacts from a recording path. */
const stripTrailingQuote = (s: string): string => s.replace(/(?:"|%22|%2522)+$/i, "");

/** Best recording from the JSON array (preference order → first available). */
export const pickRecordingSql = (recordings: any[]): any | null => {
  if (!recordings || recordings.length === 0) return null;
  for (const q of QUALITY_PREFERENCE) {
    const hit = recordings.find((r) => String(r?.quality ?? "").toLowerCase() === q);
    if (hit) return hit;
  }
  return recordings[0] ?? null;
};

/** Resolve a recording by quality → index → best quality. Mirrors resolveRecording. */
export const resolveRecordingSql = (
  recordings: any[],
  opts: { recordingIndex?: number; quality?: string }
): any | null => {
  const recs = Array.isArray(recordings) ? recordings : [];
  if (recs.length === 0) return null;
  if (opts.quality) {
    const q = opts.quality.toLowerCase();
    return recs.find((r) => String(r?.quality ?? "").toLowerCase() === q) ?? null;
  }
  if (typeof opts.recordingIndex === "number") return recs[opts.recordingIndex] ?? null;
  return pickRecordingSql(recs);
};

/** Normalize a subject string into a stable subjectKey (trim/lowercase/collapse). */
export const normalizeSubjectKeySql = (subject: string | null | undefined): string | null => {
  if (typeof subject !== "string") return null;
  const k = subject.trim().toLowerCase().replace(/\s+/g, " ");
  return k.length > 0 ? k : null;
};

const liveSlugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Course root folder id (ws_live_course.video_category_id), or null. */
const liveRootFolderId = async (liveCourseId: number): Promise<number | null> => {
  const lc = await prisma.liveCourse.findFirst({
    where: { id: liveCourseId },
    select: { videoCategoryId: true },
  });
  return lc ? lc.videoCategoryId ?? null : null;
};

/**
 * Find — or create — the subject folder (ws_video_category) recordings of a
 * given subject under a live course should land in. Dedupe is by `subjectKey`
 * among the folders reachable from the course root (the DAG). On create, the new
 * folder is parented to the course root (folder.parent = root + a relation edge)
 * so it joins the course's reachable set. Returns null when the subject is blank
 * OR the course has no root folder to anchor under.
 */
export const resolveOrCreateSubjectFolderSql = async (params: {
  liveCourseId: number;
  subject: string;
}): Promise<{ id: number; created: boolean } | null> => {
  const subjectKey = normalizeSubjectKeySql(params.subject);
  if (!subjectKey) return null;

  const root = await liveRootFolderId(params.liveCourseId);
  if (!root) return null; // nowhere to anchor — skip (best-effort, see report)

  // Look for an existing reachable folder with this subjectKey.
  const reachable = await descendantsOf([root]);
  if (reachable.length) {
    const existing = await prisma.videoCategory.findFirst({
      where: { id: { in: reachable }, subjectKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
  }

  // Place at the end of the root's current child list.
  const last = await prisma.videoCategory.findFirst({
    where: { parent: root },
    orderBy: { order_by: "desc" },
    select: { order_by: true },
  });
  const nextOrder = (last?.order_by ?? 0) + 1;

  const lc = await prisma.liveCourse.findFirst({
    where: { id: params.liveCourseId },
    select: { image: true },
  });
  const now = new Date();
  const folder = await prisma.videoCategory.create({
    data: {
      title: params.subject.trim(),
      slug: subjectKey.replace(/\s+/g, "-"),
      subjectKey,
      parent: root,
      image: lc?.image ?? "",
      order_by: nextOrder,
      status: true,
      created_at: now,
      updated_at: now,
    },
  });
  await prisma.videoCategoryRelation.create({
    data: { parent: root, child: folder.id, order: nextOrder },
  });
  return { id: folder.id, created: true };
};

const promotedVideoSelect = {
  id: true,
  title: true,
  videoCategoryId: true,
  aws_id: true,
  priceType: true,
  order: true,
  status: true,
  created_at: true,
  liveSessionId: true,
} as const;

/** Shape a promoted Video row to the Mongo-ish lean shape the controller emits. */
const promotedVideoDto = (v: any) => ({
  _id: String(v.id),
  title: v.title,
  videoCategoryId: v.videoCategoryId != null ? String(v.videoCategoryId) : null,
  aws_id: v.aws_id ?? null,
  priceType: v.priceType,
  order: v.order ?? 0,
  status: v.status,
  liveSessionId: v.liveSessionId != null ? String(v.liveSessionId) : null,
  createdAt: v.created_at ?? null,
});

/**
 * Promote a single recording into a folder as a Video. Idempotent PER FOLDER:
 * dedupe key is (videoCategoryId, aws_id=path). The created row carries
 * liveSessionId for the back-link. Mirrors promoteRecordingToFolder.
 */
export const promoteRecordingToFolderSql = async (params: {
  liveSessionId: number;
  sessionTitle: string | null;
  recording: any;
  folderId: number;
  title?: string;
  priceType?: "free" | "paid";
  order?: number;
}): Promise<{ video: any; alreadyExisted: boolean }> => {
  const rawPath: string | undefined = params.recording?.path;
  if (!rawPath) throw new Error("Recording has no playable path.");
  const path = stripTrailingQuote(rawPath);

  const existing = await prisma.video.findFirst({
    where: { videoCategoryId: params.folderId, aws_id: path },
    select: promotedVideoSelect,
  });
  if (existing) return { video: promotedVideoDto(existing), alreadyExisted: true };

  const title = params.title ?? params.sessionTitle ?? "Recording";
  const now = new Date();
  const created = await prisma.video.create({
    data: {
      videoCategoryId: params.folderId,
      liveSessionId: params.liveSessionId,
      title,
      topic: "",
      platform: "aws",
      aws_id: path,
      priceType: params.priceType ?? "paid",
      slug: `${liveSlugify(title)}-${Date.now().toString(36)}`,
      order: params.order ?? 0,
      status: true,
      created_at: now,
      updated_at: now,
    },
    select: promotedVideoSelect,
  });
  return { video: promotedVideoDto(created), alreadyExisted: false };
};

/**
 * promoteSessionRecording's SQL core: validate the session has recordings, pick
 * one, validate the target folder exists, then promote. The folder may belong to
 * a live OR recorded course (recordings can be filed anywhere) — we only require
 * it to exist, matching the Mongo handler. Returns discriminated results so the
 * controller can map them to the same status codes.
 */
export const promoteSessionRecordingSql = async (params: {
  sessionId: number;
  folderId: number;
  recordingIndex?: number;
  quality?: string;
  title?: string;
  priceType?: "free" | "paid";
  order?: number;
}): Promise<
  | { video: any; alreadyExisted: boolean }
  | "session_not_found"
  | "no_recordings"
  | "folder_not_found"
  | "recording_not_found"
  | "no_path"
> => {
  const session = await prisma.liveSession.findFirst({
    where: { id: params.sessionId },
    select: { id: true, title: true, recordings: true },
  });
  if (!session) return "session_not_found";
  const recordings = Array.isArray(session.recordings) ? (session.recordings as any[]) : [];
  if (recordings.length === 0) return "no_recordings";

  const folder = await prisma.videoCategory.findFirst({
    where: { id: params.folderId },
    select: { id: true },
  });
  if (!folder) return "folder_not_found";

  const recording = resolveRecordingSql(recordings, {
    recordingIndex: params.recordingIndex,
    quality: params.quality,
  });
  if (!recording) return "recording_not_found";
  if (!recording.path) return "no_path";

  return promoteRecordingToFolderSql({
    liveSessionId: session.id,
    sessionTitle: session.title ?? null,
    recording,
    folderId: params.folderId,
    title: params.title,
    priceType: params.priceType,
    order: params.order,
  });
};

/** Every Video promoted from a session, across all folders (the back-link). */
export const resolvePromotedVideosSql = async (liveSessionId: number): Promise<any[]> => {
  const rows = await prisma.video.findMany({
    where: { liveSessionId },
    orderBy: { created_at: "asc" },
    select: promotedVideoSelect,
  });
  return rows.map(promotedVideoDto);
};

/**
 * Best-effort: for each linked live course, resolve/create the subject folder and
 * file the best recording into it. Never throws. Mirrors maybeAutoPromoteRecording.
 */
export const maybeAutoPromoteRecordingSql = async (params: {
  sessionId: number;
  sessionTitle: string | null;
  subject: string | null;
  recordings: any[];
  liveCourseIds: number[];
}): Promise<void> => {
  try {
    const recording = pickRecordingSql(params.recordings ?? []);
    if (!recording?.path) return;
    if (!normalizeSubjectKeySql(params.subject)) return;
    if (!params.liveCourseIds.length) return;

    for (const liveCourseId of params.liveCourseIds) {
      try {
        const folderRef = await resolveOrCreateSubjectFolderSql({
          liveCourseId,
          subject: params.subject ?? "",
        });
        if (!folderRef) continue;
        await promoteRecordingToFolderSql({
          liveSessionId: params.sessionId,
          sessionTitle: params.sessionTitle,
          recording,
          folderId: folderRef.id,
        });
      } catch {
        // per-course best-effort — swallow (the recording stays on the session)
      }
    }
  } catch {
    // non-fatal
  }
};
