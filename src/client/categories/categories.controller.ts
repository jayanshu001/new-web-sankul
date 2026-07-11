import { Request, Response } from "express";
import * as cvSql from "../../modules/client-category-video/client-category-video.service";
import * as clientMatSql from "../../modules/client-material/client-material.service";
import * as clientExamSql from "../../modules/client-exam/client-exam.service";
import { parseEcId } from "../../modules/exam-countdown/exam-countdown.service";
import * as ecClientSql from "../../modules/exam-countdown/exam-countdown.client";
import { signMediaToken, MediaScope } from "../../utils/mediaToken";
import { defaultListingQualities } from "../../utils/videoQualities";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  getCategoryChildren as getMaterialCategoryChildren,
  parseMaterialCategoryId,
} from "../../modules/catalog-material/catalog-material.service";
import {
  getCategoryChildren as getExamCategoryChildren,
  parseExamCategoryId,
} from "../../modules/catalog-exam/catalog-exam.service";
import {
  getVideoCategoryChildren,
  parseVideoCategoryId,
} from "../../modules/catalog-video/catalog-video.service";

// Media is never returned inline. Each playable row carries a short-lived,
// customer-bound `mediaToken` (utils/mediaToken) that the client exchanges at
// POST /client/media/resolve for the real URL. Unpurchased paid rows get
// `mediaToken: null` — no id/url of any kind. Free rows get a `free` token.
// Map the resolved category scope to a re-checkable media scope so /media/resolve
// can re-verify the subscription live. course/package/liveCourse are all handled
// by the resolver's entitlement switch; anything else falls back to `trusted`.
function toMediaScope(scope: { kind: string; id: string } | null | undefined): MediaScope {
  if (scope && (scope.kind === "course" || scope.kind === "package" || scope.kind === "liveCourse")) {
    return { kind: scope.kind, id: Number(scope.id) } as MediaScope;
  }
  return { kind: "trusted" };
}

function mediaTokenForVideo(v: { id: number; priceType: string }, entitled: boolean, customerId: number | null, scope: { kind: string; id: string } | null | undefined): string | null {
  if (customerId == null) return null;
  const isPaid = v.priceType === "paid";
  if (isPaid && !entitled) return null;
  return isPaid
    ? signMediaToken({ k: "video", id: v.id, scope: toMediaScope(scope), cust: customerId })
    : signMediaToken({ k: "video", id: v.id, free: true, cust: customerId });
}

function parsePaging(req: Request) {
  const { page = "1", limit = "20", search = "" } = req.query as Record<string, string>;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 500);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum, search: search.trim() };
}

// GET /client/video-categories/:id/videos
export const listVideosByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listVideosByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const catId = cvSql.parseCvId(id);
    if (catId == null) return res.status(400).json({ success: false, message: "Invalid category id." });
    const category = await cvSql.findCategory(catId);
    if (!category) return res.status(404).json({ success: false, message: "Video category not found." });

    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const typeQ = String(req.query.type ?? "").toLowerCase();
    const priceType = typeQ === "free" || typeQ === "paid" ? (typeQ as "free" | "paid") : null;

    const [{ rows, total }, scope] = await Promise.all([
      cvSql.listVideos({ categoryId: catId, search: search || null, priceType, skip, limitNum }),
      cvSql.scopeForCategory(catId),
    ]);

    const uid = cvSql.parseCvId(String(req.user?.id ?? ""));
    const progMap = uid != null ? await cvSql.progressByVideo(uid, rows.map((v) => v.id)) : new Map<number, any>();

    // Entitlement gate: paid videos only get a (playable) media token when the
    // caller holds an active subscription for this category's owning container.
    // Unpurchased paid rows get `mediaToken: null` — no id/url at all. Free rows
    // get a free token. Resolution happens later at /media/resolve, so the list
    // no longer pays a per-row resolve cost.
    const entitled = await cvSql.isEntitledForScope(uid, scope);

    const list = rows.map((v) => {
      const isPaid = v.priceType === "paid";
      const p = progMap.get(v.id);
      return {
        _id: String(v.id), title: v.title, topic: v.topic, platform: v.platform,
        isPaid,
        progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
        recordings: [], // SQL videos carry no live-session back-link
        qualities: defaultListingQualities(),
        mediaToken: mediaTokenForVideo(v, entitled, uid, scope),
      };
    });

    logger.info("listVideosByCategory success (sql)", { traceId, categoryId: id, total, returned: list.length, scopeKind: scope?.kind ?? null });
    return res.status(200).json({
      success: true,
      data: { category: cvSql.categoryDto(category), scope, list },
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listVideosByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/video-categories/:id/videos/:videoId
// Resolves a single recorded video through ytdl-core (YouTube) or VideoCrypt
// (AWS) and returns the encrypted multi-resolution envelope. The list endpoint
// stays metadata-only; this is the detail call the FE makes on row tap.
export const getVideoByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = String(req.params.id ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("getVideoByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, videoId, userId: req.user?.id });

  try {
    const catId = cvSql.parseCvId(id);
    const vidId = cvSql.parseCvId(videoId);
    if (catId == null || vidId == null) return res.status(422).json({ success: false, message: "Invalid category or video id." });
    const v = await cvSql.findVideoInCategory(catId, vidId);
    if (!v) return res.status(404).json({ success: false, message: "Video not found in this category." });

    // Resolve scope up front, then gate paid videos on an active subscription
    // for the owning container — same rule (and 403) as the lecture-detail and
    // progress endpoints, so this playback source can't hand out decryptable
    // URLs the other two would refuse. Free videos skip the gate.
    const sc = await cvSql.scopeForCategory(v.videoCategoryId ?? catId);
    const uid = cvSql.parseCvId(String(req.user?.id ?? ""));
    if (uid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (v.priceType === "paid") {
      const entitled = await cvSql.isEntitledForScope(uid, sc);
      if (!entitled) return res.status(403).json({ success: false, message: "Active subscription required to access this lecture" });
    }

    // No inline media — mint a media token the client resolves at /media/resolve.
    const mediaToken = v.priceType === "paid"
      ? signMediaToken({ k: "video", id: v.id, scope: toMediaScope(sc), cust: uid })
      : signMediaToken({ k: "video", id: v.id, free: true, cust: uid });
    return res.status(200).json({
      success: true,
      data: { _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, scope: sc, mediaToken },
      message: "Video fetched.",
    });
  } catch (error: any) {
    logger.error("getVideoByCategory failed", { traceId, categoryId: id, videoId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/material-categories/:id/materials
export const listMaterialsByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listMaterialsByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const catId = clientMatSql.parseMatId(id);
    if (catId == null) return res.status(400).json({ success: false, message: "Invalid category id." });
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const typeQ = String(req.query.type ?? "").toLowerCase();
    const type = typeQ === "free" || typeQ === "paid" ? (typeQ as "free" | "paid") : null;
    const userNum = clientMatSql.parseMatId(String(req.user?.id ?? ""));
    const r = await clientMatSql.listMaterialsByCategoryPaged(catId, userNum, { skip, take: limitNum, search, type });
    if (!r) return res.status(404).json({ success: false, message: "Material category not found." });
    logger.info("listMaterialsByCategory success (sql)", { traceId, categoryId: id, total: r.total, returned: r.list.length });
    return res.status(200).json({
      success: true,
      data: { category: r.category, list: r.list },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listMaterialsByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-categories/:id/exams
export const listExamsByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listExamsByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const catId = clientExamSql.parseExamId(id);
    if (catId == null) return res.status(400).json({ success: false, message: "Invalid category id." });
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const userNum = clientExamSql.parseExamId(String(req.user?.id ?? ""));
    const r = await clientExamSql.listExamsByCategoryPaged(catId, userNum, { skip, take: limitNum, search });
    if (!r) return res.status(404).json({ success: false, message: "Exam category not found." });
    logger.info("listExamsByCategory success (sql)", { traceId, categoryId: id, total: r.total, returned: r.list.length });
    return res.status(200).json({
      success: true,
      data: { category: r.category, list: r.list },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listExamsByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Category children (drill-down) ──────────────────────────────────────────
// All three return { parent, list } where list[].category carries the same
// shape used in the package detail: { ...categoryDoc, havingChildDirectory, count }.
// Use `havingChildDirectory` on the client to decide whether tapping a card
// should drill deeper or open the items list.

// GET /client/video-categories/:id/children
export const listVideoCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listVideoCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    // A MySQL category id is an int. Children resolve via the SQL `parent`
    // self-FK.
    const catId = parseVideoCategoryId(id);
    if (catId == null) {
      logger.warn("listVideoCategoryChildren invalid id (mysql)", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const result = await getVideoCategoryChildren(catId, search || undefined, { skip, take: limitNum });
    if (!result) {
      logger.warn("listVideoCategoryChildren parent not found (mysql)", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Video category not found." });
    }
    const { total, ...data } = result;
    logger.info("listVideoCategoryChildren success", { traceId, categoryId: id, childCount: result.list.length, total, source: "mysql" });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listVideoCategoryChildren failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/material-categories/:id/children
export const listMaterialCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listMaterialCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    // A MySQL category id is an int. Children resolve via the SQL `parent`
    // self-FK.
    const catId = parseMaterialCategoryId(id);
    if (catId == null) {
      logger.warn("listMaterialCategoryChildren invalid id (mysql)", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const result = await getMaterialCategoryChildren(catId, search || undefined, { skip, take: limitNum });
    if (!result) {
      logger.warn("listMaterialCategoryChildren parent not found (mysql)", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Material category not found." });
    }
    const { total, ...data } = result;
    logger.info("listMaterialCategoryChildren success", { traceId, categoryId: id, childCount: result.list.length, total, source: "mysql" });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listMaterialCategoryChildren failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-categories/:id/children
export const listExamCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listExamCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    // A MySQL category id is an int. Children resolve via the SQL `parent_id`
    // self-FK.
    const catId = parseExamCategoryId(id);
    if (catId == null) {
      logger.warn("listExamCategoryChildren invalid id (mysql)", { traceId, categoryId: id });
      return res.status(400).json({ success: false, message: "Invalid category id." });
    }
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const result = await getExamCategoryChildren(catId, search || undefined, { skip, take: limitNum });
    if (!result) {
      logger.warn("listExamCategoryChildren parent not found (mysql)", { traceId, categoryId: id });
      return res.status(404).json({ success: false, message: "Exam category not found." });
    }
    const { total, ...data } = result;
    logger.info("listExamCategoryChildren success", { traceId, categoryId: id, childCount: result.list.length, total, source: "mysql" });
    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listExamCategoryChildren failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdown-categories/:id/packages
export const listPackagesByExamCountdownCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listPackagesByExamCountdownCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const catId = parseEcId(id);
    if (catId == null) return res.status(400).json({ success: false, message: "Invalid category id." });
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const userNum = parseEcId(String(req.user?.id ?? ""));
    const r = await ecClientSql.listPackagesByCountdownCategory(catId, userNum, { skip, take: limitNum, search });
    if (!r) return res.status(404).json({ success: false, message: "Exam countdown category not found." });
    return res.status(200).json({
      success: true,
      data: { category: r.category, list: r.list },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listPackagesByExamCountdownCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdown/:id/packages
// :id is an ExamCountdown _id (a single exam event), NOT a category. Returns the
// packages AND live courses tied to that exam, merged into one `list` where each
// row is tagged `type: "package"` or `type: "live-course"` so the FE can split
// the listing by type. Matching is by the exam's `examCountdownIds` membership
// (both Package and LiveCourse carry that array); package plans mirror the
// `/exam-countdown-categories/:id/packages` shape and live-course plans mirror
// `/client/live-courses`.
export const listProductsByExamCountdown = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listProductsByExamCountdown invoked", { traceId, path: req.originalUrl, examCountdownId: id, userId: req.user?.id });

  try {
    const ecId = parseEcId(id);
    if (ecId == null) return res.status(400).json({ success: false, message: "Invalid exam countdown id." });
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const userNum = parseEcId(String(req.user?.id ?? ""));
    const r = await ecClientSql.listProductsByCountdown(ecId, userNum, { skip, take: limitNum, search });
    if (!r) return res.status(404).json({ success: false, message: "Exam countdown not found." });
    return res.status(200).json({
      success: true,
      data: { examCountdown: r.examCountdown, list: r.list },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listProductsByExamCountdown failed", { traceId, examCountdownId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdown-categories/:id/books-ebooks
// Returns books + ebooks merged into a single `list`, each row tagged with `type`.
export const listBooksAndEbooksByExamCountdownCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listBooksAndEbooksByExamCountdownCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const catId = parseEcId(id);
    if (catId == null) return res.status(400).json({ success: false, message: "Invalid category id." });
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const userNum = parseEcId(String(req.user?.id ?? ""));
    const r = await ecClientSql.listBooksEbooksByCountdownCategory(catId, userNum, { skip, take: limitNum, search });
    if (!r) return res.status(404).json({ success: false, message: "Exam countdown category not found." });
    return res.status(200).json({
      success: true,
      data: { category: r.category, list: r.list },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listBooksAndEbooksByExamCountdownCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /client/exam-countdown/:id/books-ebooks
// :id is an ExamCountdown _id (a single exam event), NOT a category. Returns the
// books + ebooks linked to that exam via their `examCountdownIds` array, merged
// into one `list` where each row is tagged `type: "book"` or `type: "ebook"`.
// Shape mirrors listBooksAndEbooksByExamCountdownCategory (ebook rows get joined
// pricing + isPaid/isPurchased/daysLeft) so the FE can reuse the same cards.
export const listBooksAndEbooksByExamCountdown = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listBooksAndEbooksByExamCountdown invoked", { traceId, path: req.originalUrl, examCountdownId: id, userId: req.user?.id });

  try {
    const ecId = parseEcId(id);
    if (ecId == null) return res.status(400).json({ success: false, message: "Invalid exam countdown id." });
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const userNum = parseEcId(String(req.user?.id ?? ""));
    const r = await ecClientSql.listBooksEbooksByCountdown(ecId, userNum, { skip, take: limitNum, search });
    if (!r) return res.status(404).json({ success: false, message: "Exam countdown not found." });
    return res.status(200).json({
      success: true,
      data: { examCountdown: r.examCountdown, list: r.list },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listBooksAndEbooksByExamCountdown failed", { traceId, examCountdownId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Package Categories ──────────────────────────────────────────────────────
import * as pkgCatSql from "../../modules/package-category/package-category.service";

export const listPackageCategories = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveOnly = String(req.query.live ?? "").toLowerCase() === "true";
  const { pageNum, limitNum, skip, search } = parsePaging(req);
  logger.info("listPackageCategories invoked", { traceId, path: req.originalUrl, liveOnly });

  try {
    const result = await pkgCatSql.listClientPackageCategories({
      liveOnly, search: search || null, skip, limitNum, pageNum,
    });
    logger.info("listPackageCategories success (sql)", { traceId, total: result.pagination.total, returned: result.data.length, liveOnly });
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    logger.error("listPackageCategories failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const listPackagesByCategory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { id } = req.params as { id: string };
  logger.info("listPackagesByCategory invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
    const catId = pkgCatSql.parsePkgCatId(id);
    if (catId == null) return res.status(400).json({ success: false, message: "Invalid package category id" });
    const customerId = pkgCatSql.parsePkgCatId(String(req.user?.id ?? ""));
    const { pageNum, limitNum, skip, search } = parsePaging(req);
    const tab = String(req.query.tab ?? "").toLowerCase() === "live" ? "live" : "recorded";
    const data = await pkgCatSql.listPackagesAndLiveByCategory(catId, customerId, {
      tab, search: search || null, skip, take: limitNum,
    });
    logger.info("listPackagesByCategory success (sql)", { traceId, categoryId: id, tab, recordedCount: data.recorded.length, liveCount: data.live.length, total: data.total });
    return res.status(200).json({
      success: true,
      data: { tab: data.tab, recorded: data.recorded, live: data.live, counts: data.counts },
      pagination: { total: data.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(data.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listPackagesByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

