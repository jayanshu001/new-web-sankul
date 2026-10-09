// Client catalog tabs: HTTP handlers for the videos / materials / tests tab roots.
import { Request, Response } from "express";
import logger from "../../utils/logger";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import * as catSql from "../../modules/client-catalog/client-catalog.service";
import { omit } from "../../utils/pick";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";

// Drops unused `progress.completedAt` / `lastWatchedAt` from video list items (flat
// course items carry `progress`; grouped items nest videos under `list`).
const stripVideoProgress = (item: any): any => {
  if (!item || typeof item !== "object") return item;
  const out: any = { ...item };
  if (out.progress) out.progress = omit(out.progress, ["completedAt", "lastWatchedAt"]);
  if (Array.isArray(out.list)) out.list = out.list.map(stripVideoProgress);
  return out;
};

// Unified catalog tabs for course / package / live-course: per-type differences in
// how root categories are sourced are hidden behind one shape (docs/client/catalog-tabs.md).
// Material/exam roots come from `materialCategories[]` / `examCategories[]` on all three.
// Video roots differ: package → `specificSubjects[].category`, course → single
// `videoCategoryId`, live-course → flat folders keyed by liveCourseId.

type ParentType = "course" | "package" | "live-course";

const VALID_TYPES: ParentType[] = ["course", "package", "live-course"];

function parseType(raw: string): ParentType | null {
  return (VALID_TYPES as string[]).includes(raw) ? (raw as ParentType) : null;
}

function getSearch(req: Request): string {
  return typeof req.query.search === "string" ? req.query.search.trim() : "";
}

// Pagination windows the top-level category list; `totals` stays the full counts and
// `pagination.total` = total categories. Search is applied in the service first.
function paginateCategories<T extends { list: unknown[] }>(
  req: Request,
  r: T
): T & { pagination: ReturnType<typeof buildPagination> } {
  const { page, limit, skip } = parseListQuery(req.query);
  const list = r.list.slice(skip, skip + limit);
  return { ...r, list, pagination: buildPagination(r.list.length, page, limit) };
}

// Query: ?search=  ?categoryIds=a,b  (categoryIds is video-only)
export const getCatalogVideos = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogVideos invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);

    const idNum = catSql.parseCatId(id);
    if (idNum == null) return failure(res, "Invalid id.", 422);
    const userNum = catSql.parseCatId(String(req.user?.id ?? ""));
    const sp = await catSql.loadParent(type, idNum, userNum);
    if (!sp) return failure(res, `${type} not found.`, 404);
    const search = getSearch(req);
    const catIds = typeof req.query.categoryIds === "string" && req.query.categoryIds.trim()
      ? req.query.categoryIds.split(",").map((s) => catSql.parseCatId(s.trim())).filter((n): n is number => n != null)
      : null;
    // package/live-course responses carry no per-user data (catalogVideos only reads
    // customerId for type=course), so they are cached shared, without customerId in the
    // key. type=course inlines per-user progress + a customer-bound mediaToken, so it
    // stays uncached. Tagged CacheEntity.Categories because admin video and
    // video-category writes already flush "categories" (middlewares/flushGroups.ts).
    const r =
      type === "course"
        ? await catSql.catalogVideos({ type, id: idNum, customerId: userNum, search: search || null, categoryIds: catIds })
        : await cache.aside({
            key: cache.key(CacheDomain.Client, CacheEntity.Categories, `video-tabs:${type}:${idNum}:${cache.hashFilter({ search, catIds })}`),
            ttlSeconds: CACHE_TTL.CATALOG_SHARED,
            load: () => catSql.catalogVideos({ type, id: idNum, customerId: null, search: search || null, categoryIds: catIds }),
          });
    const msg = type === "course" ? "Videos fetched." : "Video categories fetched.";
    const paged = paginateCategories(req, r);
    const list = (paged.list as any[]).map(stripVideoProgress);
    return success(res, { ...paged, list }, msg);
  } catch (err) {
    logger.error("getCatalogVideos failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch video categories.", 500);
  }
};

export const getCatalogMaterials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogMaterials invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);

    const idNum = catSql.parseCatId(id);
    if (idNum == null) return failure(res, "Invalid id.", 422);
    const userNum = catSql.parseCatId(String(req.user?.id ?? ""));
    const sp = await catSql.loadParent(type, idNum, userNum);
    if (!sp) return failure(res, `${type} not found.`, 404);
    const r = await catSql.catalogMaterials({ type, id: idNum, search: getSearch(req) || null, customerId: userNum });
    const paged = paginateCategories(req, r);
    const list = (paged.list as any[]).map((row) =>
      row && row.category ? { ...row, category: omit(row.category, ["ancestors", "__v"]) } : row
    );
    return success(res, { ...paged, list }, "Material categories fetched.");
  } catch (err) {
    logger.error("getCatalogMaterials failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch material categories.", 500);
  }
};

export const getCatalogTests = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogTests invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);

    const idNum = catSql.parseCatId(id);
    if (idNum == null) return failure(res, "Invalid id.", 422);
    const userNum = catSql.parseCatId(String(req.user?.id ?? ""));
    const sp = await catSql.loadParent(type, idNum, userNum);
    if (!sp) return failure(res, `${type} not found.`, 404);
    const r = await catSql.catalogTests({ type, id: idNum, search: getSearch(req) || null });
    return success(res, { ...paginateCategories(req, r) }, "Test categories fetched.");
  } catch (err) {
    logger.error("getCatalogTests failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch test categories.", 500);
  }
};
