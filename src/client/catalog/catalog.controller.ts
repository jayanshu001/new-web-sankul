import { Request, Response } from "express";
import logger from "../../utils/logger";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import * as catSql from "../../modules/client-catalog/client-catalog.service";

// ─────────────────────────────────────────────────────────────────────────────
// Unified catalog tabs for the three product types (course / package /
// live-course). One contract for the FE; the per-type differences in HOW the
// root categories are sourced are resolved here and hidden behind a single
// response shape. See docs/client/catalog-tabs.md.
//
//   Material/Exam roots: all three products store `materialCategories[]` /
//   `examCategories[]` ref arrays → identical resolution.
//   Video roots differ:
//     package      → `specificSubjects[].category`
//     course       → single `videoCategoryId` (one group)
//     live-course  → flat folders VideoCategory.find({ liveCourseId })
// ─────────────────────────────────────────────────────────────────────────────

type ParentType = "course" | "package" | "live-course";

const VALID_TYPES: ParentType[] = ["course", "package", "live-course"];

function parseType(raw: string): ParentType | null {
  return (VALID_TYPES as string[]).includes(raw) ? (raw as ParentType) : null;
}

function getSearch(req: Request): string {
  return typeof req.query.search === "string" ? req.query.search.trim() : "";
}

// The catalog tabs return a category-grouped `list` + full `totals`. Pagination
// windows that top-level category list (the unit the FE renders as sections);
// `totals` stays the full counts and `pagination.total` = total categories.
// Search is already applied in the service before this slice.
function paginateCategories<T extends { list: unknown[] }>(
  req: Request,
  r: T
): T & { pagination: ReturnType<typeof buildPagination> } {
  const { page, limit, skip } = parseListQuery(req.query);
  const list = r.list.slice(skip, skip + limit);
  return { ...r, list, pagination: buildPagination(r.list.length, page, limit) };
}

// ─── VIDEOS ──────────────────────────────────────────────────────────────────
// GET /api/v1/client/catalog/:type/:id/videos
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
    const sp = await catSql.loadParent(type, idNum);
    if (!sp) return failure(res, `${type} not found.`, 404);
    const search = getSearch(req);
    const catIds = typeof req.query.categoryIds === "string" && req.query.categoryIds.trim()
      ? req.query.categoryIds.split(",").map((s) => catSql.parseCatId(s.trim())).filter((n): n is number => n != null)
      : null;
    const userNum = catSql.parseCatId(String(req.user?.id ?? ""));
    const r = await catSql.catalogVideos({ type, id: idNum, customerId: userNum, search: search || null, categoryIds: catIds });
    const msg = type === "course" ? "Videos fetched." : "Video categories fetched.";
    return success(res, { parent: { _id: id, type, name: sp.name }, ...paginateCategories(req, r) }, msg);
  } catch (err) {
    logger.error("getCatalogVideos failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch video categories.", 500);
  }
};

// ─── MATERIALS ─────────────────────────────────────────────────────────────
// GET /api/v1/client/catalog/:type/:id/materials   ?search=
export const getCatalogMaterials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogMaterials invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);

    const idNum = catSql.parseCatId(id);
    if (idNum == null) return failure(res, "Invalid id.", 422);
    const sp = await catSql.loadParent(type, idNum);
    if (!sp) return failure(res, `${type} not found.`, 404);
    const userNum = catSql.parseCatId(String(req.user?.id ?? ""));
    const r = await catSql.catalogMaterials({ type, id: idNum, search: getSearch(req) || null, customerId: userNum });
    return success(res, { parent: { _id: id, type, name: sp.name }, ...paginateCategories(req, r) }, "Material categories fetched.");
  } catch (err) {
    logger.error("getCatalogMaterials failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch material categories.", 500);
  }
};

// ─── TESTS ───────────────────────────────────────────────────────────────────
// GET /api/v1/client/catalog/:type/:id/tests   ?search=
export const getCatalogTests = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogTests invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);

    const idNum = catSql.parseCatId(id);
    if (idNum == null) return failure(res, "Invalid id.", 422);
    const sp = await catSql.loadParent(type, idNum);
    if (!sp) return failure(res, `${type} not found.`, 404);
    const r = await catSql.catalogTests({ type, id: idNum, search: getSearch(req) || null });
    return success(res, { parent: { _id: id, type, name: sp.name }, ...paginateCategories(req, r) }, "Test categories fetched.");
  } catch (err) {
    logger.error("getCatalogTests failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch test categories.", 500);
  }
};
