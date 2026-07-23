import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { signMediaToken } from "../../utils/mediaToken";
import logger from "../../utils/logger";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { pickList, omit, omitList } from "../../utils/pick";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

// GET /api/v1/client/live-courses
export const listLiveCoursesForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listLiveCoursesForClient invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit } = parseListQuery(req.query);

    const r = await liveSql.listClient(liveSql.parseLiveId(String(req.user?.id ?? "")), { search, page, limit });
    const base = resolveBase(req);
    // Slim card DTO: drop toCourseDto fields the RN app never reads (audit).
    const liveCourses = r.liveCourses.map((c: any) =>
      omit({ ...c, shareableLink: buildShareUrl("live-courses", c._id, base) }, [
        "description", "ordered", "withMaterial", "withoutMaterial", "level", "status", "isPaid",
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

// GET /api/v1/client/live-courses/recently-added
// Newest-first active live courses (pure createdAt desc), with the same card
// contract (plans / isPaid / isPurchased / daysLeft / shareableLink) as the
// main listing — a standalone "Recently Added Live Courses" feed.
export const listRecentlyAddedLiveCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listRecentlyAddedLiveCourses invoked", { traceId, path: req.originalUrl, userId: req.user?.id });
  try {
    const { search, page, limit } = parseListQuery(req.query);
    const r = await liveSql.listRecentLiveCourses(liveSql.parseLiveId(String(req.user?.id ?? "")), { search, page, limit });
    const base = resolveBase(req);
    // Slim card DTO — keep level/isPaid (used on this rail), drop other non-card fields.
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

// GET /api/v1/client/live-courses/upcoming-batches
// Powers the home-screen "Upcoming Live Batches" carousel with its
// All / <category> filter tab bar (see the design mockup). An "upcoming
// batch" is an active LiveCourse whose startTime is still in the future.
//
// Filtering:
//   - no categoryId            → "All" tab: every upcoming batch.
//   - categoryId=<PackageCategory _id> → only that category's upcoming batches.
//
// The response also returns the tab bar itself in `categories` — the set of
// PackageCategory rows that actually have ≥1 upcoming batch (so the FE never
// renders an empty tab). The synthetic "All" tab is the FE's responsibility to
// prepend; we just supply the real categories with a per-tab `count`.
//
// Intentionally separate from listLiveCoursesForClient: that endpoint lists the
// full catalogue (including started/evergreen courses) with hero-card ranking;
// this one is the upcoming-only, category-filtered batch feed. Neither touches
// the other.
export const listUpcomingLiveBatches = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listUpcomingLiveBatches invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit } = parseListQuery(req.query);
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : "";

    const catId = categoryId ? liveSql.parseLiveId(categoryId) ?? undefined : undefined;
    const r = await liveSql.listUpcomingBatches(liveSql.parseLiveId(String(req.user?.id ?? "")), { search, categoryId: catId, page, limit });
    // Ultra-slim batch + category cards; drop the unused selectedCategoryId and the
    // per-batch shareableLink (RN reads neither). allCount/total/page/limit kept.
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

// GET /api/v1/client/live-courses/:id
// Includes plans + whether the current customer already has access.
export const getLiveCourseForClient = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? "");
  logger.info("getLiveCourseForClient invoked", { traceId, path: req.originalUrl, userId, id });

  try {
    // Data only — playback URLs never here.
    const lid = liveSql.parseLiveId(id);
    if (!lid) { logger.warn("getLiveCourseForClient invalid id (mysql)", { traceId, id }); return failure(res, "Invalid live course id.", 422); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const r = await liveSql.getLiveCourseDetailForClient(lid, Number.isInteger(cid) ? cid : null, resolveBase(req));
    if (r === "not_found") { logger.warn("getLiveCourseForClient not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    logger.info("getLiveCourseForClient success (mysql)", { traceId, userId, id });
    // Drop unused top-level `scope` + unused plan meta (liveCourseId/status/materialPrice).
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

// GET /api/v1/client/live-courses/:id/sessions
// Filter: upcoming=true → SCHEDULED + scheduledAt >= now.
// Ordering:
//   - upcoming=true → ascending scheduledAt (nearest-to-start at top).
//   - otherwise    → future sessions first (nearest at top), then past sessions
//     most-recent first. Sessions with no scheduledAt sink to the bottom.
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

// GET /api/v1/client/live-courses/:id/recordings
// All recorded lectures for a live course, grouped by folder. These are the
// Videos promoted from past LiveSession recordings (plus any manually added
// videos). The folder/lecture STRUCTURE is always returned so the UI can show
// what the course contains, but a lecture's playable `videoUrl` is only
// included when the customer is entitled (active subscription) or the lecture
// is explicitly free. Non-subscribers also get `purchaseOptions` for the popup.
export const listLiveCourseRecordings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listLiveCourseRecordings invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    // Folders + lectures + per-quality recordings; video-URL via encryptLecture on tap.
    const lid = liveSql.parseLiveId(id);
    if (!lid) { logger.warn("listLiveCourseRecordings invalid id (mysql)", { traceId, id }); return failure(res, "Invalid live course id.", 422); }
    const cid = req.user?.id ? Number(req.user.id) : null;
    const { search, page, limit } = parseListQuery(req.query);
    const r = await liveSql.getRecordingsForClient(lid, Number.isInteger(cid) ? cid : null, { search, page, limit });
    if (r === "not_found") { logger.warn("listLiveCourseRecordings not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    logger.info("listLiveCourseRecordings success (mysql)", { traceId, id, totalLectures: r.totalLectures, folderCount: r.folders.length });
    // Slim folders/lectures metadata; playback fields (mediaToken/qualities/preferredStream) kept.
    const folders = (r.folders ?? []).map((f: any) => ({
      ...omit(f, ["image", "order"]),
      lectures: (f.lectures ?? []).map((l: any) => ({
        ...omit(l, ["topic", "order", "priceType"]),
        progress: l.progress ? omit(l.progress, ["completed", "completedAt"]) : l.progress,
      })),
    }));
    const { liveCourse: _lc, daysLeft: _dl, totalLectures: _tl, purchaseOptions: _po, ...restR } = r;
    return success(res, { ...restR, folders, pagination: buildPagination(r.total, r.page, r.limit) }, "Recorded lectures fetched.");
  } catch (err) {
    logger.error("listLiveCourseRecordings failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list recorded lectures.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/lecture/:videoId
// Gated single-lecture playback for a live course's recorded video. Mirrors
// the recorded-course GET /courses/lecture flow: verifies the video sits in a
// folder of this course, then requires an active subscription unless the
// lecture is free. On 403 the purchase popup data rides along in `data`.
export const getLiveCourseLecture = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const id = String(req.params.id ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("getLiveCourseLecture invoked", { traceId, path: req.originalUrl, userId, id, videoId });

  try {
    // Ownership check in SQL; video-URL via the SAME encryptLecture.
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
    // No inline media: mint a customer-bound media token the client exchanges at
    // /media/resolve. Free lectures → free token; paid → scoped to the live course.
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

// GET /api/v1/client/live-courses/:id/session-recordings
// Live / upcoming classes for a course — every SCHEDULED or CREATED
// LiveSession. Finished classes (ENDED/READY) are intentionally excluded:
// once a session ends and its recording is promoted into a folder Video, it
// surfaces through GET /:id/recordings instead.
//
// Metadata only — playback URLs (hlsUrl / mp4) come from the gated
// GET /api/v1/client/live-sessions/:sessionId endpoint on tap.
export const listLiveCourseSessionRecordings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  logger.info("listLiveCourseSessionRecordings invoked", { traceId, path: req.originalUrl, userId: req.user?.id, id });

  try {
    // Metadata only; playback via gated /live-sessions/:id.
    const lid = liveSql.parseLiveId(id);
    if (!lid) { logger.warn("listLiveCourseSessionRecordings invalid id (mysql)", { traceId, id }); return failure(res, "Invalid live course id.", 422); }
    const { search, page: pageN, limit: limitN } = parseListQuery(req.query);
    const cid = req.user?.id ? Number(req.user.id) : null;
    const r = await liveSql.listSessionRecordingsForClient(lid, Number.isInteger(cid) ? cid : null, pageN, limitN, search);
    if (r === "not_found") { logger.warn("listLiveCourseSessionRecordings not found (mysql)", { traceId, id }); return failure(res, "Live course not found.", 404); }
    logger.info("listLiveCourseSessionRecordings success (mysql)", { traceId, id, total: r.total, returned: r.lectures.length });
    // Live-now rows: keep isLive/sessionId/title/streamId; drop unused session metadata.
    const lectures = omitList(r.lectures, ["status", "subject", "scheduledAt", "scheduledAtDisplay", "endAt", "locked"]);
    const { liveCourse: _lc, subscribed: _sub, ...restR } = r;
    return success(res, { ...restR, lectures, pagination: buildPagination(r.total, r.page, r.limit) }, "Live classes fetched.");
  } catch (err) {
    logger.error("listLiveCourseSessionRecordings failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list live classes.", 500);
  }
};

// GET /api/v1/client/live-courses/my
// The customer's own live course subscriptions. ?status=active|expired|all
// (default all). Only verified subscriptions are returned — pending/failed
// payment attempts are an internal concern, not "my courses".
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
    // My-batches card DTO: drop unused subscription/plan metadata.
    const liveCourses = omitList(r.liveCourses, ["classType", "daysLeft", "plan", "startAt", "endAt", "paymentStatus", "active"]);
    return success(res, { ...r, liveCourses, pagination: buildPagination(r.total, r.page, r.limit) }, "Your live courses fetched.");
  } catch (err) {
    logger.error("listMyLiveCourses failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your live courses.", 500);
  }
};

// GET /api/v1/client/live-courses/my/upcoming-sessions
// Upcoming SCHEDULED sessions across every live course the customer is
// actively entitled to (verified subscription, status on, endAt not yet
// crossed). One call returns the user's whole forward-looking timetable, in
// ascending scheduledAt order, with the source course attached so the UI can
// group or label by course.
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

    // Only currently-active subscriptions feed the "my upcoming" view —
    // the SQL twin filters to owned (active, unexpired) courses and returns the
    // same cross-course session-feed card shape as the sibling SQL handlers
    // (listAllUpcomingSessions / listLiveNowSessions).
    const cid = liveSql.parseLiveId(String(customerId));
    const r = await liveSql.listMyUpcomingSessions(cid, { search, page, limit });

    logger.info("listMyUpcomingSessions success", { traceId, customerId, total: r.total, returned: r.sessions.length });
    const sessions = omitList(r.sessions, ["liveCourseIds", "hlsUrl", "recordings", "createdAt", "updatedAt"]);
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

// GET /api/v1/client/live-courses/upcoming-sessions
// Discovery feed: every upcoming SCHEDULED session across every active live
// course on the platform — visible to non-purchasers too, so a student can
// browse what's coming up before they buy. Each row carries `subscribed`
// (true when the customer holds access to at least one of the session's
// courses). Clicking a session opens GET /client/live-sessions/:id, which
// already enforces the 3-minute preview gate and serves the purchase popup
// once the free window is consumed.
export const listAllUpcomingSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listAllUpcomingSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { search, page, limit } = parseListQuery(req.query);

    const cid = liveSql.parseLiveId(String(customerId ?? ""));
    const r = await liveSql.listAllUpcomingSessions({ search, page, limit });
    const sessions = await Promise.all(r.sessions.map(async (s: any) => ({ ...s, subscribed: cid ? await liveSql.hasAccessToAnyLiveCourse(cid, (s.liveCourseIds ?? []).map(Number)) : false })));
    return success(res, { sessions, total: r.total, page: r.page, limit: r.limit, pagination: buildPagination(r.total, r.page, r.limit) }, "Upcoming sessions fetched.");
  } catch (err) {
    logger.error("listAllUpcomingSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch upcoming sessions.", 500);
  }
};

// GET /api/v1/client/live-courses/live-now-sessions
// Discovery feed for what's airing RIGHT NOW: every session in status
// CREATED across every active live course on the platform. Same shape as
// /upcoming-sessions — each row carries `subscribed` so the UI can route a
// non-purchaser into the 3-minute preview (via /client/live-sessions/:id).
// SCHEDULED-but-not-yet-started sessions belong to /upcoming-sessions;
// ENDED/READY ones belong to the per-course recordings list.
export const listLiveNowSessions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listLiveNowSessions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    const { search, page, limit } = parseListQuery(req.query);

    const cid = liveSql.parseLiveId(String(customerId ?? ""));
    const r = await liveSql.listLiveNowSessions({ search, page, limit });
    const sessions = await Promise.all(r.sessions.map(async (s: any) => omit({ ...s, subscribed: cid ? await liveSql.hasAccessToAnyLiveCourse(cid, (s.liveCourseIds ?? []).map(Number)) : false }, ["hlsUrl", "recordings", "createdAt", "updatedAt"])));
    return success(res, { sessions, total: r.total, page: r.page, limit: r.limit, pagination: buildPagination(r.total, r.page, r.limit) }, "Live-now sessions fetched.");
  } catch (err) {
    logger.error("listLiveNowSessions failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch live-now sessions.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/schedule
// The Schedule tab: a study timetable derived from the course's scheduled
// LiveSessions (subject / educator / date / time slot), plus the course's
// uploaded "Time Table" files. Not entitlement-gated — it's course info shown
// to everyone so they can see what the course covers. ?upcoming=true limits
// to classes from now onward.
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
    // Slim schedule DTO: drop unused timetable + folder metadata + wrapper fields.
    const timetable = omitList(r.timetable, ["sessionId", "endAt", "status", "streamId"]);
    const scheduleFolders = omitList(r.scheduleFolders, ["image", "order", "status"]);
    const { liveCourse: _lc, total: _total, daysLeft: _dl, ...restR } = r;
    return success(res, { ...restR, timetable, scheduleFolders }, "Schedule fetched.");
  } catch (err) {
    logger.error("getLiveCourseSchedule failed", { traceId, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch schedule.", 500);
  }
};

// GET /api/v1/client/live-courses/my/schedule
// Powers the home-screen Schedule list. For every Live Course the customer
// owns (verified + active subscription), returns the course's admin-curated
// schedule folders. The UI renders each owned course as a section header with
// its folders listed underneath; tapping a folder opens GET /:id/schedule-folders/:folderId.
//
// Only active folders are returned (hidden folders are admin-only).
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
    // Nav-only DTO: drop course image/level/daysLeft + folder image/order/entryCount.
    const liveCourses = (r.liveCourses ?? []).map((c: any) => ({
      ...omit(c, ["image", "level", "daysLeft"]),
      scheduleFolders: omitList(c.scheduleFolders, ["image", "order", "entryCount"]),
    }));
    return success(res, { ...r, liveCourses }, "Your schedule fetched.");
  } catch (err) {
    logger.error("listMyScheduleByCategory failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch your schedule.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/schedule-folders/:folderId
// Returns one folder's entries for screen 2 (Date / Subject / Time list).
// Requires the customer to hold a verified + active subscription to the
// course. Hidden folders (status=false) return 404 — they're admin-only.
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
    // folderId is a synthetic/backfilled string id — not validated as ObjectId.
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
