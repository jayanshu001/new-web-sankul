import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import * as epSql from "../../modules/educator-portal/educator-portal.service";

// GET /api/v1/educator/courses
export const listMyCourses = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  logger.info("listMyCourses invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("listMyCourses unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const eid = epSql.parseEpId(String(educatorId));
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    const courses = await epSql.listMyCourses(eid);
    return res.status(200).json({ success: true, data: { courses } });
  } catch (error: any) {
    logger.error("listMyCourses failed", { traceId, educatorId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/courses/:id
export const getMyCourseDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getMyCourseDetail invoked", { traceId, path: req.originalUrl, educatorId, courseId: id });

  try {
    if (!educatorId) { logger.warn("getMyCourseDetail unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const eid = epSql.parseEpId(String(educatorId)); const cid = epSql.parseEpId(id);
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid course id." });
    const data = await epSql.getMyCourseDetail(eid, cid);
    if (!data) return res.status(404).json({ success: false, message: "Course not found or not yours." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getMyCourseDetail failed", { traceId, educatorId, courseId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/courses/:id/dashboard
export const getCourseDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getCourseDashboard invoked", { traceId, path: req.originalUrl, educatorId, courseId: id });

  try {
    if (!educatorId) { logger.warn("getCourseDashboard unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const eid = epSql.parseEpId(String(educatorId)); const cid = epSql.parseEpId(id);
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid course id." });
    const data = await epSql.getCourseDashboard(eid, cid);
    if (!data) return res.status(404).json({ success: false, message: "Course not found or not yours." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getCourseDashboard failed", { traceId, educatorId, courseId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/educator/courses/:id/subscribers
export const getCourseSubscribers = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getCourseSubscribers invoked", { traceId, path: req.originalUrl, educatorId, courseId: id });

  try {
    if (!educatorId) { logger.warn("getCourseSubscribers unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const pageNum = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const eid = epSql.parseEpId(String(educatorId)); const cid = epSql.parseEpId(id);
    if (eid == null) return res.status(401).json({ success: false, message: "Unauthorized." });
    if (cid == null) return res.status(400).json({ success: false, message: "Invalid course id." });
    const r = await epSql.getCourseSubscribers(eid, cid, skip, limitNum);
    if (!r) return res.status(404).json({ success: false, message: "Course not found or not yours." });
    return res.status(200).json({ success: true, data: r.data, pagination: { total: r.total, page: pageNum, limit: limitNum, totalPages: Math.ceil(r.total / limitNum) } });
  } catch (error: any) {
    logger.error("getCourseSubscribers failed", { traceId, educatorId, courseId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
