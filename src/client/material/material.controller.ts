// Client materials: HTTP handlers for category contents, detail and downloads.
import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { pick } from "../../utils/pick";
import * as matSql from "../../modules/client-material/client-material.service";

// Returns child `subjects[]`, leaf `materials[]`, and root→current `breadcrumbs[]`.
export const getCategoryContents = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getCategoryContents invoked", { traceId, path: req.originalUrl, userId: req.user?.id, categoryId: id });

  try {
    const catId = matSql.parseMatId(id);
    if (catId == null) return res.status(400).json({ success: false, message: "Invalid category id." });
    const userNum = matSql.parseMatId(String(req.user?.id ?? ""));
    const { search, page, limit, skip } = parseListQuery(req.query);
    // Optional entry-point scope: inside container X, only X may unlock.
    const scope = matSql.parseEntitlementScope(req.query as Record<string, unknown>);
    if (scope === "invalid") return res.status(400).json({ success: false, message: "Invalid entitlement scope id." });
    if (scope === "multiple") return res.status(400).json({ success: false, message: "Pass only one of courseId, packageId, liveCourseId." });
    const result = await matSql.getCategoryContents(catId, userNum, { skip, take: limit, search, scope });
    if (!result) return res.status(404).json({ success: false, message: "Category not found." });
    const { materialsTotal, ...data } = result;
    return res.status(200).json({ success: true, data, pagination: buildPagination(materialsTotal, page, limit) });
  } catch (error: any) {
    logger.error("getCategoryContents failed", { traceId, categoryId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMaterialDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getMaterialDetail invoked", { traceId, path: req.originalUrl, userId: req.user?.id, materialId: id });

  try {
    const mid = matSql.parseMatId(id);
    if (mid == null) return res.status(400).json({ success: false, message: "Invalid material id." });
    const userNum = matSql.parseMatId(String(req.user?.id ?? ""));
    // Same scope as the list — this is the mediaToken-refresh path, so an unscoped
    // call here would re-mint a token the scoped list deliberately withheld.
    const scope = matSql.parseEntitlementScope(req.query as Record<string, unknown>);
    if (scope === "invalid") return res.status(400).json({ success: false, message: "Invalid entitlement scope id." });
    if (scope === "multiple") return res.status(400).json({ success: false, message: "Pass only one of courseId, packageId, liveCourseId." });
    const data = await matSql.getMaterialDetail(mid, userNum, scope);
    if (!data) return res.status(404).json({ success: false, message: "Material not found." });
    // RN reads only mediaToken (+ _id / isDirectLink) on this refresh path (410/401 re-fetch).
    return res.status(200).json({ success: true, data: pick(data as any, ["_id", "mediaToken", "isDirectLink"]) });
  } catch (error: any) {
    logger.error("getMaterialDetail failed", { traceId, materialId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Bump the material's global download counter (not per-user).
export const trackDownload = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("trackDownload invoked", { traceId, path: req.originalUrl, userId: req.user?.id, materialId: id });

  try {
    const mid = matSql.parseMatId(id);
    if (mid == null) return res.status(400).json({ success: false, message: "Invalid material id." });
    const data = await matSql.trackDownload(mid);
    if (!data) return res.status(404).json({ success: false, message: "Material not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("trackDownload failed", { traceId, materialId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Newly added materials (last N days, default 10) across all active categories.
export const getRecentMaterials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getRecentMaterials invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const days = Math.max(parseInt((req.query.days as string) || "10", 10), 1);
    const { search, page, limit, skip } = parseListQuery(req.query);

    const userNum = matSql.parseMatId(String(req.user?.id ?? ""));
    const { materials, total } = await matSql.getRecentMaterials(userNum, days, { skip, take: limit, search });
    return res.status(200).json({ success: true, data: materials, pagination: buildPagination(total, page, limit) });
  } catch (error: any) {
    logger.error("getRecentMaterials failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
