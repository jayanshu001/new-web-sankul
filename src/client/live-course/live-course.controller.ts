// Client live courses: HTTP handlers for catalog, recordings, schedule and session feeds.
import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { signMediaToken } from "../../utils/mediaToken";
import logger from "../../utils/logger";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { pickList, omit, omitList } from "../../utils/pick";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";
import { viewerCount } from "../../socket/livechat.socket";

// Session-feed rows share one card shape. Only an airing session (status CREATED)
// has a chat room to count; the rest report 0 without a cluster-wide
// fetchSockets round trip. Room key = streamId (see live.controller).
const withViewerCount = (sessions: any[]) =>
  Promise.all(sessions.map(async (s) => ({ ...s, viewerCount: s.status === "CREATED" && s.streamId ? await viewerCount(String(s.streamId)) : 0 })));
import { queueCRMLead } from "../../utils/crm";
import { CRM_LEAD_TYPE } from "../../shared/enums";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

/** `?summary=1` and `?summary=true` both mean on — the app sends either. */
const isTruthyFlag = (v: unknown): boolean => {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true";
};

/** Shared by /:id/recordings and /:id/recordings/:folderId so the two never drift. */
const slimRecordingLecture = (l: any) => ({
  ...omit(l, ["topic", "order", "priceType"]),
  progress: l.progress ? omit(l.progress, ["completed", "completedAt"]) : l.progress,
});

export const listLiveCoursesForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveCoursesForClient invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit } = parseListQuery(req.query);

    const r = await liveSql.listClient(liveSql.parseLiveId(String(req.user?.id ?? "")), { search, page, limit });
    const base = resolveBase(req);
    const liveCourses = r.liveCourses.map((c: any) =>
      omit({ ...c, shareableLink: buildShareUrl("live-courses", c._id, base) }, [
        "description", "ordered", "withMaterial", "withoutMaterial", "status", "isPaid",
        "courseEducatorId", "courseSubjectCategoryId", "videoCategoryId", "packageCategoryId",
        "scheduleEntries", "scheduleFolders", "examCountdownCategoryIds", "examCountdownIds",
        "examCategories", "createdAt", "updatedAt", "purchaseCount",
      ])
    );
    return success(res, { liveCourses, total: r.total, page: r.page, limit: r.limit, pagination: buildPagination(r.total, r.page, r.limit) }, "Live courses fetched.");
  } catch (err) {
    logger.error("listLiveCoursesForClient failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list live courses.", 500);
  }
};

export const listRecentlyAddedLiveCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listRecentlyAddedLiveCourses invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const { search, page, limit } = parseListQuery(req.query);
    const r = await liveSql.listRecentLiveCourses(liveSql.parseLiveId(String(req.user?.id ?? "")), { search, page, limit });
    const base = resolveBase(req);
    const liveCourses = r.liveCourses.map((c: any) =>
      omit({ ...c, shareableLink: buildShareUrl("live-courses", c._id, base) }, [
        "description", "ordered", "withMaterial", "withoutMaterial", "status", "courseEducatorId",
        "courseSubjectCategoryId", "videoCategoryId", "packageCategoryId", "scheduleEntries",
        "scheduleFolders", "examCountdownCategoryIds", "examCountdownIds", "examCategories",
        "createdAt", "updatedAt",
      ])
    );
    logger.info("listRecentlyAddedLiveCourses success", { traceId, total: r.total, returned: liveCourses.length });
    return success(res, { liveCourses, total: r.total, page: r.page, limit: r.limit, pagination: buildPagination(r.total, r.page, r.limit) }, "Recently added live courses fetched.");
  } catch (err) {
    logger.error("listRecentlyAddedLiveCourses failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list recently added live courses.", 500);
  }
};

// "Upcoming batch" = active LiveCourse whose startTime is in the future.
// No categoryId = "All" tab. `categories` lists only PackageCategory rows with
// at least one upcoming batch (per-tab `count`); the FE prepends the "All" tab.
export const listUpcomingLiveBatches = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listUpcomingLiveBatches invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit } = parseListQuery(req.query);
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : "";

    const catId = categoryId ? liveSql.parseLiveId(categoryId) ?? undefined : undefined;
    const r = await liveSql.listUpcomingBatches(liveSql.parseLiveId(String(req.user?.id ?? "")), { search, categoryId: catId, page, limit });
    const { selectedCategoryId, liveBatches, categories, ...rest } = r as any;
    return success(
      res,
      {
        ...rest,
        liveBatches: pickList(liveBatches, ["_id", "name", "image"]),
        categories: pickList(categories, ["_id", "title", "count"]),
        pagination: buildPagination(r.total, r.page, r.limit),
      },
      "Upcoming live batches fetched."
    );
  } catch (err) {
    logger.error("listUpcomingLiveBatches failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch upcoming live batches.", 500);
  }
};

export const getLiveCourseForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? "");
  logger.info("getLiveCourseForClient invoked", { traceId, path: req.originalUrl, userId, id });

  try {
    const lid = liveSql.parseLiveId(id);
    if (!lid) { logger.warn("getLiveCourseForClient invalid id (mysql)", { traceId, id }); return failure(res, "Invalid live course id.", 422); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const r = await liveSql.getLiveCourseDetailForClient(lid, Number.isInteger(cid) ? cid : null, resolveBase(req));
    if (r === "not_found") { logger.warn("getLiveCourseForClient not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    logger.info("getLiveCourseForClient success (mysql)", { traceId, userId, id });
    if (userId) {
      queueCRMLead({ params: { userId, liveCourseId: lid }, leadType: CRM_LEAD_TYPE.VIEW_LIVE_COURSE }, { traceId, userId, liveCourseId: lid });
    }
    const slimPlanMeta = ["liveCourseId", "status", "materialPrice"];
    const plans = r.plans
      ? { withMaterial: omitList(r.plans.withMaterial, slimPlanMeta), withoutMaterial: omitList(r.plans.withoutMaterial, slimPlanMeta) }
      : r.plans;
    return success(res, { ...omit(r, ["scope"]), plans }, "Live course fetched.");
  } catch (err) {
    logger.error("getLiveCourseForClient failed", { traceId, userId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live course.", 500);
  }
};

// upcoming=true → SCHEDULED + scheduledAt >= now, ascending. Otherwise future
// sessions first (nearest on top), then past most-recent first; null scheduledAt last.
export const listSessionsForCourseClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listSessionsForCourseClient invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    const cid = liveSql.parseLiveId(id);
    if (!cid) return failure(res, "Invalid live course id.", 422);
    const r = await liveSql.listSessionsForCourseClient(cid, { status: req.query.status as string, upcoming: req.query.upcoming as string, search: req.query.search as string, page: req.query.page as string, limit: req.query.limit as string });
    if (r === "not_found") return failure(res, "Live course not found.", 404);
    return success(res, { ...r, pagination: buildPagination(r.total, r.page, r.limit) }, "Sessions fetched.");
  } catch (err) {
    logger.error("listSessionsForCourseClient failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list sessions.", 500);
  }
};

// Folder/lecture structure is always returned; playback is only for entitled
// customers or free lectures. Non-subscribers also get `purchaseOptions`.
export const listLiveCourseRecordings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listLiveCourseRecordings invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    const lid = liveSql.parseLiveId(id);
    if (!lid) { logger.warn("listLiveCourseRecordings invalid id (mysql)", { traceId, id }); return failure(res, "Invalid live course id.", 422); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const { search, page, limit } = parseListQuery(req.query);

    // ?summary=1 → hub mode: folders carry `lectureCount` and no `lectures[]`, so the
    // hub never pays for VOD resolution or media-token signing it won't render.
    if (isTruthyFlag(req.query.summary)) {
      const s = await liveSql.getRecordingFolderSummaryForClient(lid, Number.isInteger(cid) ? cid : null, { search, page, limit });
      if (s === "not_found") { logger.warn("listLiveCourseRecordings not found (mysql)", { traceId, id, summary: true }); return failure(res, "Live course not found.", 404); }
      logger.info("listLiveCourseRecordings summary success (mysql)", { traceId, id, folderCount: s.folders.length });
      const folders = (s.folders ?? []).map((f: any) => omit(f, ["image", "order"]));
      const { liveCourse: _lc, daysLeft: _dl, totalLectures: _tl, purchaseOptions: _po, ...restS } = s;
      return success(res, { ...restS, folders, pagination: buildPagination(s.total, s.page, s.limit) }, "Recording folders fetched.");
    }

    const r = await liveSql.getRecordingsForClient(lid, Number.isInteger(cid) ? cid : null, { search, page, limit });
    if (r === "not_found") { logger.warn("listLiveCourseRecordings not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    logger.info("listLiveCourseRecordings success (mysql)", { traceId, id, totalLectures: r.totalLectures, folderCount: r.folders.length });
    const folders = (r.folders ?? []).map((f: any) => ({
      ...omit(f, ["image", "order"]),
      lectures: (f.lectures ?? []).map(slimRecordingLecture),
    }));
    const { liveCourse: _lc, daysLeft: _dl, totalLectures: _tl, purchaseOptions: _po, ...restR } = r;
    return success(res, { ...restR, folders, pagination: buildPagination(r.total, r.page, r.limit) }, "Recorded lectures fetched.");
  } catch (err) {
    logger.error("listLiveCourseRecordings failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list recorded lectures.", 500);
  }
};

// One folder's lectures, paginated by lecture. Same lecture object as the nested
// `lectures[]` of /:id/recordings; a locked lecture simply carries no `mediaToken`.
export const getLiveCourseRecordingFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("getLiveCourseRecordingFolder invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id, folderId });

  try {
    const lid = liveSql.parseLiveId(id);
    const fid = liveSql.parseLiveId(folderId);
    if (!lid || !fid) { logger.warn("getLiveCourseRecordingFolder invalid ids (mysql)", { traceId, id, folderId }); return failure(res, "Invalid live course or folder id.", 422); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const { search, page, limit } = parseListQuery(req.query);
    const r = await liveSql.getRecordingFolderDetailForClient(lid, fid, Number.isInteger(cid) ? cid : null, { search, page, limit });
    if (r === "not_found") { logger.warn("getLiveCourseRecordingFolder course not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    if (r === "folder_not_found") { logger.warn("getLiveCourseRecordingFolder folder not found (mysql)", { traceId, id, folderId }); return failure(res, "Folder not found.", 404); }
    logger.info("getLiveCourseRecordingFolder success (mysql)", { traceId, id, folderId, lectureCount: r.lectureCount });
    const lectures = (r.lectures ?? []).map(slimRecordingLecture);
    const { liveCourse: _lc, daysLeft: _dl, purchaseOptions: _po, image: _img, order: _ord, ...restR } = r;
    return success(res, { ...restR, lectures, pagination: buildPagination(r.total, r.page, r.limit) }, "Folder lectures fetched.");
  } catch (err) {
    logger.error("getLiveCourseRecordingFolder failed", { traceId, id, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch folder lectures.", 500);
  }
};

// Same `{ parent, list: [{ category }] }` shape as the other directory drill-downs,
// scoped to the live course: a folder id from another course 404s.
export const listLiveCourseRecordingFolderChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("listLiveCourseRecordingFolderChildren invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id, folderId });

  try {
    const lid = liveSql.parseLiveId(id);
    const fid = liveSql.parseLiveId(folderId);
    if (!lid || !fid) { logger.warn("listLiveCourseRecordingFolderChildren invalid ids (mysql)", { traceId, id, folderId }); return failure(res, "Invalid live course or folder id.", 422); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const { search, page, limit } = parseListQuery(req.query);
    const r = await liveSql.getRecordingFolderChildrenForClient(lid, fid, Number.isInteger(cid) ? cid : null, { search, page, limit });
    if (r === "not_found") { logger.warn("listLiveCourseRecordingFolderChildren course not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    if (r === "folder_not_found") { logger.warn("listLiveCourseRecordingFolderChildren folder not found (mysql)", { traceId, id, folderId }); return failure(res, "Folder not found.", 404); }
    logger.info("listLiveCourseRecordingFolderChildren success (mysql)", { traceId, id, folderId, childCount: r.list.length });
    // Slimmed like /recordings so a child row is byte-identical to a hub row.
    const slimFolder = (f: any) => omit(f, ["image", "order"]);
    const { liveCourse: _lc, daysLeft: _dl, purchaseOptions: _po, ...restR } = r;
    return success(
      res,
      { ...restR, parent: slimFolder(r.parent), list: r.list.map((row: any) => ({ category: slimFolder(row.category) })), pagination: buildPagination(r.total, r.page, r.limit) },
      "Folder sub-folders fetched."
    );
  } catch (err) {
    logger.error("listLiveCourseRecordingFolderChildren failed", { traceId, id, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch sub-folders.", 500);
  }
};

// Verifies the video sits in a folder of this course, then requires an active
// subscription unless the lecture is free. On 403 the purchase popup data rides in `data`.
export const getLiveCourseLecture = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("getLiveCourseLecture invoked", { traceId, path: req.originalUrl, userId, id, videoId });

  try {
    const lid = liveSql.parseLiveId(id);
    const vid = liveSql.parseLiveId(videoId);
    if (!lid || !vid) { logger.warn("getLiveCourseLecture invalid ids (mysql)", { traceId, id, videoId }); return failure(res, "Invalid live course or video id.", 422); }
    const r = await liveSql.clientLectureVideoInCourse(lid, vid);
    if (r === "video_not_found") { logger.warn("getLiveCourseLecture video not found (mysql)", { traceId, userId, videoId }); return failure(res, "Lecture not found.", 404); }
    if (r === "mismatch") { logger.warn("getLiveCourseLecture course mismatch (mysql)", { traceId, userId, id, videoId }); return failure(res, "Lecture does not belong to this live course.", 404); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const entitled = await liveSql.isLectureEntitled(lid, Number.isInteger(cid) ? cid : null, r.priceType);
    if (!entitled) {
      logger.warn("getLiveCourseLecture not subscribed (mysql)", { traceId, userId, id, videoId });
      return failure(res, "Subscribe to this live course to watch this lecture.", 403, {}, { purchaseOptions: await liveSql.buildPurchaseOptionsSql([lid]) });
    }
    // No inline media: mint a customer-bound token exchanged at /media/resolve.
    // Free lectures → free token; paid → scoped to the live course.
    const mediaToken = r.priceType === "free"
      ? signMediaToken({ k: "video", id: Number(r._id), free: true, cust: cid! })
      : signMediaToken({ k: "video", id: Number(r._id), scope: { kind: "liveCourse", id: lid }, cust: cid! });
    logger.info("getLiveCourseLecture success (mysql)", { traceId, userId, id, videoId, platform: r.platform });
    return success(res, { _id: String(r._id), title: r.title, topic: r.topic, platform: r.platform, priceType: r.priceType, mediaToken }, "Lecture fetched.");
  } catch (err) {
    logger.error("getLiveCourseLecture failed", { traceId, userId, id, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch lecture.", 500);
  }
};

// SCHEDULED or CREATED sessions only. Ended sessions surface via /:id/recordings
// once promoted. Metadata only — playback comes from gated /client/live-sessions/:sessionId.
export const listLiveCourseSessionRecordings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listLiveCourseSessionRecordings invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    const lid = liveSql.parseLiveId(id);
    if (!lid) { logger.warn("listLiveCourseSessionRecordings invalid id (mysql)", { traceId, id }); return failure(res, "Invalid live course id.", 422); }
    const { search, page: pageN, limit: limitN } = parseListQuery(req.query);
    const cid = req.user?.id ? Number(req.user.id) : null;
    const r = await liveSql.listSessionRecordingsForClient(lid, Number.isInteger(cid) ? cid : null, pageN, limitN, search);
    if (r === "not_found") { logger.warn("listLiveCourseSessionRecordings not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    logger.info("listLiveCourseSessionRecordings success (mysql)", { traceId, id, total: r.total, returned: r.lectures.length });
    const lectures = omitList(r.lectures, ["status", "subject", "scheduledAt", "scheduledAtDisplay", "endAt", "locked"]);
    const { liveCourse: _lc, subscribed: _sub, ...restR } = r;
    return success(res, { ...restR, lectures, pagination: buildPagination(r.total, r.page, r.limit) }, "Live classes fetched.");
  } catch (err) {
    logger.error("listLiveCourseSessionRecordings failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list live classes.", 500);
  }
};

// ?status=active|expired|all (default all). Only verified subscriptions; pending/failed
// payment attempts are not "my courses".
export const listMyLiveCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyLiveCourses invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyLiveCourses unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const filterStatus =
      typeof req.query.status === "string" ? req.query.status : "all";

    const cid = Number(customerId);
    if (!Number.isInteger(cid)) { logger.warn("listMyLiveCourses invalid customer (mysql)", { traceId, customerId }); return failure(res, "Unauthorized.", 401); }
    const { search, page, limit } = parseListQuery(req.query);
    const r = await liveSql.listMyLiveCoursesForClient(cid, filterStatus, resolveBase(req), { search, page, limit });
    logger.info("listMyLiveCourses success (mysql)", { traceId, customerId, count: r.total });
    const liveCourses = omitList(r.liveCourses, ["classType", "daysLeft", "plan", "startAt", "endAt", "paymentStatus", "active"]);
    return success(res, { ...r, liveCourses, pagination: buildPagination(r.total, r.page, r.limit) }, "Your live courses fetched.");
  } catch (err) {
    logger.error("listMyLiveCourses failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your live courses.", 500);
  }
};

// SCHEDULED sessions across courses the customer is actively entitled to
// (verified, status on, endAt not crossed), ascending scheduledAt.
export const listMyUpcomingSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyUpcomingSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyUpcomingSessions unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const { search, page, limit } = parseListQuery(req.query);

    const cid = liveSql.parseLiveId(String(customerId));
    const r = await liveSql.listMyUpcomingSessions(cid, { search, page, limit });

    logger.info("listMyUpcomingSessions success", { traceId, customerId, total: r.total, returned: r.sessions.length });
    const sessions = await withViewerCount(omitList(r.sessions, ["liveCourseIds", "hlsUrl", "recordings", "createdAt", "updatedAt"]));
    return success(
      res,
      { sessions, total: r.total, page: r.page, limit: r.limit, pagination: buildPagination(r.total, r.page, r.limit) },
      "Your upcoming sessions fetched."
    );
  } catch (err) {
    logger.error("listMyUpcomingSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your upcoming sessions.", 500);
  }
};

// Discovery feed visible to non-purchasers. `subscribed` = customer holds any of the
// session's courses. GET /client/live-sessions/:id enforces the 3-minute preview gate.
export const listAllUpcomingSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listAllUpcomingSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { search, page, limit } = parseListQuery(req.query);

    // `subscribed` / `isPurchased` / `accessLevel` are batched per page, not per row.
    const cid = liveSql.parseLiveId(String(customerId ?? ""));
    const r = await liveSql.listAllUpcomingSessions(cid, { search, page, limit });
    const sessions = await withViewerCount(r.sessions);
    return success(res, { sessions, total: r.total, page: r.page, limit: r.limit, pagination: buildPagination(r.total, r.page, r.limit) }, "Upcoming sessions fetched.");
  } catch (err) {
    logger.error("listAllUpcomingSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch upcoming sessions.", 500);
  }
};

// Sessions in status CREATED across all active live courses. Same shape as
// /upcoming-sessions; `subscribed` routes non-purchasers into the 3-minute preview.
export const listLiveNowSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listLiveNowSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { search, page, limit } = parseListQuery(req.query);

    const cid = liveSql.parseLiveId(String(customerId ?? ""));
    const r = await liveSql.listLiveNowSessions(cid, { search, page, limit });
    // A session shared by several courses is one row listing every linked course; the
    // detail endpoint is called without liveCourseId, so owning any course unlocks it.
    const sessions = await withViewerCount(omitList(r.sessions, ["hlsUrl", "recordings", "createdAt", "updatedAt"]));
    return success(res, { sessions, total: r.total, page: r.page, limit: r.limit, pagination: buildPagination(r.total, r.page, r.limit) }, "Live-now sessions fetched.");
  } catch (err) {
    logger.error("listLiveNowSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live-now sessions.", 500);
  }
};

// Timetable from scheduled LiveSessions plus uploaded "Time Table" files. Not
// entitlement-gated. ?upcoming=true limits to classes from now onward.
export const getLiveCourseSchedule = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("getLiveCourseSchedule invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    const cid = liveSql.parseLiveId(id);
    if (cid == null) return failure(res, "Invalid live course id.", 422);
    const r = await liveSql.getScheduleForClient(cid, liveSql.parseLiveId(String(req.user?.id ?? "")), req.query.upcoming === "true");
    if (r === "not_found") return failure(res, "Live course not found.", 404);
    logger.info("getLiveCourseSchedule success (sql)", { traceId, id, timetableCount: r.timetable.length, folderCount: r.scheduleFolders.length });
    const timetable = omitList(r.timetable, ["sessionId", "endAt", "status", "streamId"]);
    const scheduleFolders = omitList(r.scheduleFolders, ["image", "order", "status"]);
    const { liveCourse: _lc, total: _total, daysLeft: _dl, ...restR } = r;
    return success(res, { ...restR, timetable, scheduleFolders }, "Schedule fetched.");
  } catch (err) {
    logger.error("getLiveCourseSchedule failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch schedule.", 500);
  }
};

// Admin-curated schedule folders for every course the customer owns (verified +
// active subscription). Only active folders; hidden ones are admin-only.
export const listMyScheduleByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listMyScheduleByCategory invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) {
      logger.warn("listMyScheduleByCategory unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const cid = liveSql.parseLiveId(String(customerId));
    if (cid == null) return success(res, { liveCourses: [], totalLiveCourses: 0 }, "Your schedule fetched.");
    const r = await liveSql.listMyScheduleForClient(cid);
    logger.info("listMyScheduleByCategory success (sql)", { traceId, customerId, totalLiveCourses: r.totalLiveCourses });
    const liveCourses = (r.liveCourses ?? []).map((c: any) => ({
      ...omit(c, ["image", "daysLeft"]),
      scheduleFolders: omitList(c.scheduleFolders, ["image", "order", "entryCount"]),
    }));
    return success(res, { ...r, liveCourses }, "Your schedule fetched.");
  } catch (err) {
    logger.error("listMyScheduleByCategory failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your schedule.", 500);
  }
};

// Requires a verified + active subscription. Hidden folders (status=false) 404.
export const getMyScheduleFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = String(req.params.id ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("getMyScheduleFolder invoked", { traceId, path: req.originalUrl, customerId, id, folderId });

  try {
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const cid = liveSql.parseLiveId(id);
    if (!cid) return failure(res, "Invalid live course id.", 422);
    const custId = liveSql.parseLiveId(String(customerId));
    if (!custId || !(await liveSql.hasAccessToAnyLiveCourse(custId, [cid]))) return failure(res, "You don't have access to this live course.", 403);
    const r = await liveSql.getScheduleFolderForClient(cid, folderId);
    if (r === "not_found") return failure(res, "Live course not found.", 404);
    if (r === "folder_not_found") return failure(res, "Folder not found.", 404);
    return success(res, r, "Folder fetched.");
  } catch (err) {
    logger.error("getMyScheduleFolder failed", { traceId, customerId, id, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch schedule folder.", 500);
  }
};
