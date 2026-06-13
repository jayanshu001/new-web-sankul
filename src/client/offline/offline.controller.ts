import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { OfflineBannerSlider } from "../../models/offline/OfflineBannerSlider.model";
import { OfflineCity } from "../../models/offline/OfflineCity.model";
import { OfflineCenter } from "../../models/offline/OfflineCenter.model";
import { OfflineBatch } from "../../models/offline/OfflineBatch.model";
import { OfflineEnquiry } from "../../models/offline/OfflineEnquiry.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  isOfflineBatchMysql,
  parseOfflineId,
  listCenters as listCentersMysql,
  listBatches as listBatchesMysql,
  getCenterDetail as getCenterDetailMysql,
  getBatchDetail as getBatchDetailMysql,
} from "../../modules/offline-batch/offline-batch.service";
import {
  isOfflineEnquiryMysql,
  enquiryBatchExists,
  submitEnquiryMysql,
} from "../../modules/offline-enquiry/offline-enquiry.service";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// MySQL enquiry: batchId is an INT (the migrated id-space), not an ObjectId.
const enquiryMysqlSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  mobile: z.string().min(6).max(20),
  qualification: z.string().min(1).max(255),
  batchId: z.coerce.number().int().positive(),
  remarks: z.string().max(2000).optional(), // accepted but dropped (no SQL col)
});

// GET /api/v1/client/offline — dashboard: banners + cities/centers/batches + upcoming batches
export const getOfflineDashboard = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getOfflineDashboard invoked", { traceId, path: _req.originalUrl });

  try {
    const now = new Date();
    const [banners, cities, upcomingBatches] = await Promise.all([
      OfflineBannerSlider.find().sort({ orderBy: 1 }).lean(),
      OfflineCity.find({ status: true }).sort({ order: 1 }).lean(),
      OfflineBatch.find({ status: true, startAt: { $gt: now } })
        .populate({
          path: "centerId",
          model: OfflineCenter,
          populate: { path: "cityId", model: OfflineCity, select: "name" },
        })
        .sort({ startAt: 1 })
        .limit(10)
        .lean(),
    ]);

    // Attach centers + active batches per city
    const cityIds = cities.map((c) => c._id);
    const centers = await OfflineCenter.find({
      cityId: { $in: cityIds },
      status: true,
    }).lean();
    const centerIds = centers.map((c) => c._id);
    const batches = await OfflineBatch.find({
      centerId: { $in: centerIds },
      status: true,
    })
      .sort({ startAt: 1 })
      .lean();

    const batchesByCenter: Record<string, any[]> = {};
    batches.forEach((b) => {
      (batchesByCenter[String(b.centerId)] ||= []).push(b);
    });

    const centersByCity: Record<string, any[]> = {};
    centers.forEach((c: any) => {
      (centersByCity[String(c.cityId)] ||= []).push({
        ...c,
        batches: batchesByCenter[String(c._id)] || [],
      });
    });

    const citiesWithNested = cities.map((c: any) => ({
      ...c,
      centers: centersByCity[String(c._id)] || [],
    }));

    const dashboard: Array<{ title: string; type: string; data: unknown }> = [];
    if (banners.length) dashboard.push({ title: "Banner", type: "banner", data: banners });
    if (citiesWithNested.length)
      dashboard.push({ title: "City", type: "city", data: citiesWithNested });
    if (upcomingBatches.length)
      dashboard.push({ title: "Upcoming Batches", type: "upcoming_batch", data: upcomingBatches });

    logger.info("getOfflineDashboard success", { traceId, sections: dashboard.length });
    return res.status(200).json({ success: true, data: { dashboard } });
  } catch (e: any) {
    logger.error("getOfflineDashboard failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/cities
export const listCities = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listCities invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await OfflineCity.find({ status: true }).sort({ order: 1 }).lean();
    logger.info("listCities success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listCities failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/cities/:cityId/centers
export const listCentersByCity = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const cityId = req.params.cityId as string;
  logger.info("listCentersByCity invoked", { traceId, path: req.originalUrl, cityId });

  try {
    if (!isObjectId(cityId)) { logger.warn("listCentersByCity invalid id", { traceId, cityId }); return res.status(400).json({ success: false, message: "Invalid city id." }); }

    const centers = await OfflineCenter.find({ cityId, status: true }).lean();
    const centerIds = centers.map((c) => c._id);
    const batches = await OfflineBatch.find({ centerId: { $in: centerIds }, status: true })
      .sort({ startAt: 1 })
      .lean();

    const batchesByCenter: Record<string, any[]> = {};
    batches.forEach((b) => {
      (batchesByCenter[String(b.centerId)] ||= []).push(b);
    });

    const data = centers.map((c: any) => ({
      ...c,
      batches: batchesByCenter[String(c._id)] || [],
    }));

    logger.info("listCentersByCity success", { traceId, cityId, centerCount: centers.length, batchCount: batches.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listCentersByCity failed", { traceId, cityId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/centers
export const listCenters = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCenters invoked", { traceId, path: req.originalUrl });

  try {
    const { cityId, search } = req.query as Record<string, string>;

    if (isOfflineBatchMysql()) {
      const cid = cityId ? parseOfflineId(cityId) : null;
      const data = await listCentersMysql({
        cityId: cid ?? undefined,
        search: search?.trim() || undefined,
      });
      logger.info("listCenters success", { traceId, count: data.length, source: "mysql" });
      return res.status(200).json({ success: true, data });
    }

    const filter: any = { status: true };
    if (cityId && isObjectId(cityId)) filter.cityId = cityId;
    if (search && search.trim()) filter.name = { $regex: search.trim(), $options: "i" };
    const data = await OfflineCenter.find(filter)
      .populate({ path: "cityId", model: OfflineCity, select: "_id name" })
      .sort({ createdAt: -1 })
      .lean();
    logger.info("listCenters success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listCenters failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/batches
export const listBatches = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listBatches invoked", { traceId, path: req.originalUrl });

  try {
    const { centerId, cityId, upcoming, search } = req.query as Record<string, string>;

    if (isOfflineBatchMysql()) {
      const data = await listBatchesMysql({
        centerId: centerId ? parseOfflineId(centerId) ?? undefined : undefined,
        cityId: cityId ? parseOfflineId(cityId) ?? undefined : undefined,
        upcoming: upcoming === "true",
        search: search?.trim() || undefined,
      });
      logger.info("listBatches success", { traceId, count: data.length, source: "mysql" });
      return res.status(200).json({ success: true, data });
    }

    const filter: any = { status: true };
    if (centerId && isObjectId(centerId)) filter.centerId = centerId;
    if (search && search.trim()) filter.name = { $regex: search.trim(), $options: "i" };
    if (upcoming === "true") filter.startAt = { $gt: new Date() };

    if (!centerId && cityId && isObjectId(cityId)) {
      const centerIds = await OfflineCenter.find({ cityId, status: true }).distinct("_id");
      filter.centerId = { $in: centerIds };
    }

    const data = await OfflineBatch.find(filter)
      .populate({
        path: "centerId",
        model: OfflineCenter,
        populate: { path: "cityId", model: OfflineCity, select: "_id name" },
      })
      .sort({ startAt: 1 })
      .lean();
    logger.info("listBatches success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listBatches failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/centers/:id
export const getCenterDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getCenterDetail invoked", { traceId, path: req.originalUrl, centerId: id });

  try {
    if (isOfflineBatchMysql()) {
      const cid = parseOfflineId(id);
      if (cid == null) { logger.warn("getCenterDetail invalid id (mysql)", { traceId, centerId: id }); return res.status(400).json({ success: false, message: "Invalid center id." }); }
      const data = await getCenterDetailMysql(cid);
      if (!data) { logger.warn("getCenterDetail not found (mysql)", { traceId, centerId: id }); return res.status(404).json({ success: false, message: "Center not found." }); }
      logger.info("getCenterDetail success", { traceId, centerId: id, batchCount: data.batches.length, source: "mysql" });
      return res.status(200).json({ success: true, data });
    }

    if (!isObjectId(id)) { logger.warn("getCenterDetail invalid id", { traceId, centerId: id }); return res.status(400).json({ success: false, message: "Invalid center id." }); }

    const center = await OfflineCenter.findOne({ _id: id, status: true })
      .populate({ path: "cityId", model: OfflineCity })
      .lean();
    if (!center) { logger.warn("getCenterDetail not found", { traceId, centerId: id }); return res.status(404).json({ success: false, message: "Center not found." }); }

    const batches = await OfflineBatch.find({ centerId: id, status: true })
      .sort({ startAt: 1 })
      .lean();

    logger.info("getCenterDetail success", { traceId, centerId: id, batchCount: batches.length });
    return res.status(200).json({ success: true, data: { ...center, batches } });
  } catch (e: any) {
    logger.error("getCenterDetail failed", { traceId, centerId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/batches/:id
export const getBatchDetail = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getBatchDetail invoked", { traceId, path: req.originalUrl, batchId: id });

  try {
    if (isOfflineBatchMysql()) {
      const bid = parseOfflineId(id);
      if (bid == null) { logger.warn("getBatchDetail invalid id (mysql)", { traceId, batchId: id }); return res.status(400).json({ success: false, message: "Invalid batch id." }); }
      const data = await getBatchDetailMysql(bid);
      if (!data) { logger.warn("getBatchDetail not found (mysql)", { traceId, batchId: id }); return res.status(404).json({ success: false, message: "Batch not found." }); }
      logger.info("getBatchDetail success", { traceId, batchId: id, source: "mysql" });
      return res.status(200).json({ success: true, data });
    }

    if (!isObjectId(id)) { logger.warn("getBatchDetail invalid id", { traceId, batchId: id }); return res.status(400).json({ success: false, message: "Invalid batch id." }); }

    const batch = await OfflineBatch.findOne({ _id: id, status: true })
      .populate({
        path: "centerId",
        model: OfflineCenter,
        populate: { path: "cityId", model: OfflineCity },
      })
      .lean();
    if (!batch) { logger.warn("getBatchDetail not found", { traceId, batchId: id }); return res.status(404).json({ success: false, message: "Batch not found." }); }

    logger.info("getBatchDetail success", { traceId, batchId: id });
    return res.status(200).json({ success: true, data: batch });
  } catch (e: any) {
    logger.error("getBatchDetail failed", { traceId, batchId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/offline/enquiry
const enquirySchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  mobile: z.string().min(6).max(20),
  qualification: z.string().min(1).max(255),
  batchId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid batch id."),
  remarks: z.string().max(2000).optional(),
});

export const submitEnquiry = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id || null;
  logger.info("submitEnquiry invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    // ── MySQL enquiry write path (offline-enquiry, flag-gated) ───────────────
    // Branch before the ObjectId schema parse — a MySQL batch id is an int.
    // Anonymous-allowed (userId may be null → stored as the 0 sentinel).
    if (isOfflineEnquiryMysql()) {
      const data = enquiryMysqlSchema.parse(req.body);
      if (!(await enquiryBatchExists(data.batchId))) {
        logger.warn("submitEnquiry batch not found (mysql)", { traceId, batchId: data.batchId });
        return res.status(404).json({ success: false, message: "Batch not found." });
      }
      const customerIdInt = userId != null ? Number(userId) : null; // C3 seam
      const enquiry = await submitEnquiryMysql({
        customerId: Number.isInteger(customerIdInt as number) ? (customerIdInt as number) : null,
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        qualification: data.qualification,
        batchId: data.batchId,
      });
      logger.info("submitEnquiry success (mysql)", { traceId, customerId: userId, batchId: data.batchId, enquiryId: enquiry._id });
      return res.status(201).json({ success: true, data: enquiry });
    }

    const data = enquirySchema.parse(req.body);

    const batch = await OfflineBatch.exists({ _id: data.batchId });
    if (!batch) { logger.warn("submitEnquiry batch not found", { traceId, batchId: data.batchId }); return res.status(404).json({ success: false, message: "Batch not found." }); }

    const enquiry = await OfflineEnquiry.create({
      customerId: userId,
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      qualification: data.qualification,
      batchId: data.batchId,
      remarks: data.remarks,
    });

    logger.info("submitEnquiry success", { traceId, customerId: userId, batchId: data.batchId, enquiryId: enquiry._id });
    return res.status(201).json({ success: true, data: enquiry });
  } catch (e: any) {
    if (e.issues) { logger.warn("submitEnquiry validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("submitEnquiry failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
