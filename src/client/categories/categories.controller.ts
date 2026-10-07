// Client categories: HTTP handlers for category items, children and exam-countdown products.
import { Request, Response } from "express";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import * as cvSql from "../../modules/client-category-video/client-category-video.service";
import * as clientMatSql from "../../modules/client-material/client-material.service";
import * as clientExamSql from "../../modules/client-exam/client-exam.service";
import { parseEcId } from "../../modules/exam-countdown/exam-countdown.service";
import * as ecClientSql from "../../modules/exam-countdown/exam-countdown.client";
import { signMediaToken, MediaScope } from "../../utils/mediaToken";
import { omit, omitList } from "../../utils/pick";
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

// Media is never returned inline: each playable row carries a short-lived,
// customer-bound `mediaToken` the client exchanges at POST /client/media/resolve.
// Unpurchased paid rows get `mediaToken: null`; free rows get a `free` token.
// The scope mapped here lets /media/resolve re-verify the subscription live;
// unknown kinds fall back to `trusted`.
function toMediaScope(scope: { kind: string; id: string } | null | undefined): MediaScope {
  if (scope && (scope.kind === "course" || scope.kind === "package" || scope.kind === "liveCourse")) {
    return { kind: scope.kind, id: Number(scope.id) } as MediaScope;
  }
  return { kind: "trusted" };
}

// Customer-bound media token for a video row; null when paid and not entitled.
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

// Videos in a category with per-user progress/notes; paid rows tokenized only when entitled.
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

    // The full response is never route-cached (it embeds per-user progress/notes and
    // a customer-bound mediaToken), but the video list + owning-scope lookup is pure
    // catalog data, so only that slice is cached. Tagged CacheEntity.Video so admin
    // video writes (autoFlushGroup) invalidate it too.
    const [{ rows, total }, scopes] = await cache.aside({
      key: cache.key(CacheDomain.Client, CacheEntity.Video, `${catId}:${cache.hashFilter({ search, priceType, skip, limitNum })}`),
      ttlSeconds: 60,
      load: () =>
        Promise.all([
          cvSql.listVideos({ categoryId: catId, search: search || null, priceType, skip, limitNum }),
          cvSql.scopesForCategory(catId),
        ]),
    });
    // Representative owning container for the response `scope` field
    // (course → live → package priority).
    const scope = scopes[0] ?? null;

    const uid = cvSql.parseCvId(String(req.user?.id ?? ""));
    const videoIds = rows.map((v) => v.id);
    const [progMap, notedVideoIds] = uid != null
      ? await Promise.all([cvSql.progressByVideo(uid, videoIds), cvSql.videosWithNotes(uid, videoIds)])
      : [new Map<number, any>(), new Set<number>()];

    // Paid videos get a playable token only when the caller holds an active subscription
    // for ANY owning container (a video can belong to several packages). The token is
    // scoped to the container they own so /media/resolve's re-check passes.
    const entitledScope = await cvSql.entitledScopeFor(uid, scopes);
    const entitled = entitledScope != null;

    const list = rows.map((v) => {
      const isPaid = v.priceType === "paid";
      const p = progMap.get(v.id);
      return {
        _id: String(v.id), title: v.title, topic: v.topic, platform: v.platform,
        isPaid,
        progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed } : null,
        hasNotes: notedVideoIds.has(v.id),
        recordings: [],
        qualities: defaultListingQualities(),
        mediaToken: mediaTokenForVideo(v, entitled, uid, entitledScope),
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

// Detail call the FE makes on row tap; the list endpoint stays metadata-only.
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

    // Paid videos are gated on an active subscription for ANY owning container; the
    // token is scoped to the one the caller owns so /media/resolve's re-check passes.
    const scopes = await cvSql.scopesForCategory(v.videoCategoryId ?? catId);
    const uid = cvSql.parseCvId(String(req.user?.id ?? ""));
    if (uid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    const entitledScope = v.priceType === "paid" ? await cvSql.entitledScopeFor(uid, scopes) : null;
    if (v.priceType === "paid" && entitledScope == null) {
      return res.status(403).json({ success: false, message: "Active subscription required to access this lecture" });
    }

    const sc = scopes[0] ?? null;
    const mediaToken = v.priceType === "paid"
      ? signMediaToken({ k: "video", id: v.id, scope: toMediaScope(entitledScope), cust: uid })
      : signMediaToken({ k: "video", id: v.id, free: true, cust: uid });
    return res.status(200).json({
      success: true,
      data: { _id: String(v.id), title: v.title ?? "", platform: v.platform, priceType: v.priceType, scope: sc, mediaToken },
      message: "Video fetched.",
    });
  } catch (error: any) {
    logger.error("getVideoByCategory failed", { traceId, categoryId: id, videoId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Materials in a category; isPurchased optionally scoped to one entry-point container.
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
    // Optional entry-point scope: inside container X, only X may unlock.
    const scope = clientMatSql.parseEntitlementScope(req.query as Record<string, unknown>);
    if (scope === "invalid") return res.status(400).json({ success: false, message: "Invalid entitlement scope id." });
    if (scope === "multiple") return res.status(400).json({ success: false, message: "Pass only one of courseId, packageId, liveCourseId." });
    const r = await clientMatSql.listMaterialsByCategoryPaged(catId, userNum, { skip, take: limitNum, search, type, scope });
    if (!r) return res.status(404).json({ success: false, message: "Material category not found." });
    logger.info("listMaterialsByCategory success (sql)", { traceId, categoryId: id, total: r.total, returned: r.list.length });
    return res.status(200).json({
      success: true,
      data: { category: r.category, list: omitList(r.list, ["file", "directLink", "fileSize", "language", "isPreview", "downloadCount", "thumbnail", "order", "status", "createdAt"]) },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listMaterialsByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
      data: { category: omit(r.category, ["_id", "orderBy"]), list: r.list },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listExamsByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// The three children endpoints return { parent, list } where list[].category matches
// the package-detail shape ({ ...category, havingChildDirectory, count }); clients use
// `havingChildDirectory` to decide between drilling deeper and opening the items list.

export const listVideoCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listVideoCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
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

export const listMaterialCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listMaterialCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
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

export const listExamCategoryChildren = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("listExamCategoryChildren invoked", { traceId, path: req.originalUrl, categoryId: id, userId: req.user?.id });

  try {
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

// :id is an ExamCountdown id (one exam event), not a category. Packages and live
// courses linked via `examCountdownIds` are merged into one `list`, each row tagged
// `type: "package" | "live-course"`; plans mirror the
// `/exam-countdown-categories/:id/packages` and `/client/live-courses` shapes.
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
    // Card list only; the app reads _id/name/image/plans/isPurchased/daysLeft.
    const ITEM_DROP = [
      "description", "withMaterial", "withoutMaterial", "withMaterialText", "withoutMaterialText",
      "subtitle", "packageTypeId", "goalId", "examId", "order", "ordered", "isPopular",
      "classType", "educator", "courseEducatorId", "courseSubjectCategoryId", "createdAt", "updatedAt",
    ];
    return res.status(200).json({
      success: true,
      data: { list: omitList(r.list, ITEM_DROP) },
      pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listProductsByExamCountdown failed", { traceId, examCountdownId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

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

// :id is an ExamCountdown id (one exam event), not a category. Same row shape as
// listBooksAndEbooksByExamCountdownCategory so the FE can reuse the same cards.
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

import * as pkgCatSql from "../../modules/package-category/package-category.service";

const resolveBase = (req: Request) =>
  process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;

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
    const { data, ...restResult } = result;
    return res.status(200).json({ success: true, data: omitList(data, ["packageId"]), ...restResult });
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
      tab, search: search || null, skip, take: limitNum, baseUrl: resolveBase(req),
    });
    logger.info("listPackagesByCategory success (sql)", { traceId, categoryId: id, tab, recordedCount: data.recorded.length, liveCount: data.live.length, total: data.total });
    return res.status(200).json({
      success: true,
      data: { tab: data.tab, recorded: omitList(data.recorded, ["packageTypeId", "goalId", "educatorId"]), live: data.live, counts: data.counts },
      pagination: { total: data.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(data.total / limitNum) },
    });
  } catch (error: any) {
    logger.error("listPackagesByCategory failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

