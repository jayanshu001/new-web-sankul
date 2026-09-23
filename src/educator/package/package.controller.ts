import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as epSql from "../../modules/educator-portal/educator-portal.service";

// GET /api/v1/educator/packages
export const listMyPackages = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  logger.info("listMyPackages invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("listMyPackages unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const eid = epSql.parseEpId(String(educatorId));
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    const packages = await epSql.listMyPackages(eid);
    return res.status(200).json({ success: true, data: { packages } });
  } catch (error: any) {
    logger.error("listMyPackages failed", { traceId, educatorId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/packages/:id
export const getMyPackageDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyPackageDetail invoked", { traceId, path: req.originalUrl, educatorId, packageId: id });

  try {
    if (!educatorId) { logger.warn("getMyPackageDetail unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const eid = epSql.parseEpId(String(educatorId)); const pid = epSql.parseEpId(id);
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (pid == null) return res.status(400).json({ success: false, message: "Invalid package id." });
    const data = await epSql.getMyPackageDetail(eid, pid);
    if (!data) return res.status(404).json({ success: false, message: "Package not found or not yours." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getMyPackageDetail failed", { traceId, educatorId, packageId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/packages/:id/dashboard
export const getPackageDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getPackageDashboard invoked", { traceId, path: req.originalUrl, educatorId, packageId: id });

  try {
    if (!educatorId) { logger.warn("getPackageDashboard unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const eid = epSql.parseEpId(String(educatorId)); const pid = epSql.parseEpId(id);
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (pid == null) return res.status(400).json({ success: false, message: "Invalid package id." });
    const data = await epSql.getPackageDashboard(eid, pid);
    if (!data) return res.status(404).json({ success: false, message: "Package not found or not yours." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getPackageDashboard failed", { traceId, educatorId, packageId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/packages/:id/subscribers
export const getPackageSubscribers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getPackageSubscribers invoked", { traceId, path: req.originalUrl, educatorId, packageId: id });

  try {
    if (!educatorId) { logger.warn("getPackageSubscribers unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const pageNum = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const eid = epSql.parseEpId(String(educatorId)); const pid = epSql.parseEpId(id);
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (pid == null) return res.status(400).json({ success: false, message: "Invalid package id." });
    const r = await epSql.getPackageSubscribers(eid, pid, skip, limitNum);
    if (!r) return res.status(404).json({ success: false, message: "Package not found or not yours." });
    return res.status(200).json({ success: true, data: r.data, pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) } });
  } catch (error: any) {
    logger.error("getPackageSubscribers failed", { traceId, educatorId, packageId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
