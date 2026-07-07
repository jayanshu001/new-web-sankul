import { Request, Response } from "express";
import { z } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import {
  parseOfflineId,
  listCenters as listCentersMysql,
  listBatches as listBatchesMysql,
  getCenterDetail as getCenterDetailMysql,
  getBatchDetail as getBatchDetailMysql,
  listBanners as listBannersMysql,
  getCentersWithBatchesByCities as getCentersWithBatchesByCitiesMysql,
  listUpcomingBatches as listUpcomingBatchesMysql,
} from "../../modules/offline-batch/offline-batch.service";
import {
  listActiveCities as listActiveCitiesMysql,
} from "../../modules/offline-city/offline-city.service";
import {
  enquiryBatchExists,
  submitEnquiryMysql,
  submitBatchEnquiryMysql,
  OFFLINE_BATCH_QUALIFICATIONS,
} from "../../modules/offline-enquiry/offline-enquiry.service";

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

    // ── MySQL dashboard composition (offline-batch + offline-city) ──
    // banners + cities with nested centers/batches + upcoming batches.
    // Sections are only pushed when non-empty.
    const [banners, cities, upcomingBatches] = await Promise.all([
      listBannersMysql(),
      listActiveCitiesMysql(),
      listUpcomingBatchesMysql(now, 10),
    ]);

    const cityIds = cities
      .map((c) => parseOfflineId(c._id))
      .filter((n): n is number => n != null);
    const centersByCity = await getCentersWithBatchesByCitiesMysql(cityIds);

    const citiesWithNested = cities.map((c) => ({
      ...c,
      centers: centersByCity.get(c._id) ?? [],
    }));

    const dashboard: Array<{ title: string; type: string; data: unknown }> = [];
    if (banners.length) dashboard.push({ title: "Banner", type: "banner", data: banners });
    if (citiesWithNested.length)
      dashboard.push({ title: "City", type: "city", data: citiesWithNested });
    if (upcomingBatches.length)
      dashboard.push({ title: "Upcoming Batches", type: "upcoming_batch", data: upcomingBatches });

    logger.info("getOfflineDashboard success", { traceId, sections: dashboard.length, source: "mysql" });
    return res.status(200).json({ success: true, data: { dashboard } });
  } catch (e: any) {
    logger.error("getOfflineDashboard failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/cities
export const listCities = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCities invoked", { traceId, path: req.originalUrl });

  try {
    // ── MySQL active-cities read (offline-city). Active only, ordered by manual
    // `order` then name (mirrors Mongo {status:true} sort {order:1}); name search.
    // Pagination applied over the (small) active set to keep buildPagination shape.
    const { search, page, limit, skip } = parseListQuery(req.query);
    const all = await listActiveCitiesMysql(search);
    const total = all.length;
    const data = all.slice(skip, skip + limit);
    logger.info("listCities success", { traceId, count: data.length, source: "mysql" });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
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
    // ── MySQL: centers (each with nested active batches) under this city
    // (offline-batch). SQL ids are ints, not 24-hex ObjectIds.
    const cid = parseOfflineId(cityId);
    if (cid == null) { logger.warn("listCentersByCity invalid id (mysql)", { traceId, cityId }); return res.status(400).json({ success: false, message: "Invalid city id." }); }

    const byCity = await getCentersWithBatchesByCitiesMysql([cid]);
    const data = byCity.get(String(cid)) ?? [];

    logger.info("listCentersByCity success", { traceId, cityId, centerCount: data.length, source: "mysql" });
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
    const { cityId } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);

    const cid = cityId ? parseOfflineId(cityId) : null;
    const { data, total } = await listCentersMysql({
      cityId: cid ?? undefined,
      search: search || undefined,
      skip,
      take: limit,
    });
    logger.info("listCenters success", { traceId, count: data.length, source: "mysql" });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
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
    const { centerId, cityId, upcoming } = req.query as Record<string, string>;
    const { search, page, limit, skip } = parseListQuery(req.query);

    const { data, total } = await listBatchesMysql({
      centerId: centerId ? parseOfflineId(centerId) ?? undefined : undefined,
      cityId: cityId ? parseOfflineId(cityId) ?? undefined : undefined,
      upcoming: upcoming === "true",
      search: search || undefined,
      skip,
      take: limit,
    });
    logger.info("listBatches success", { traceId, count: data.length, source: "mysql" });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
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
    const cid = parseOfflineId(id);
    if (cid == null) { logger.warn("getCenterDetail invalid id (mysql)", { traceId, centerId: id }); return res.status(400).json({ success: false, message: "Invalid center id." }); }
    const data = await getCenterDetailMysql(cid);
    if (!data) { logger.warn("getCenterDetail not found (mysql)", { traceId, centerId: id }); return res.status(404).json({ success: false, message: "Center not found." }); }
    logger.info("getCenterDetail success", { traceId, centerId: id, batchCount: data.batches.length, source: "mysql" });
    return res.status(200).json({ success: true, data });
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
    const bid = parseOfflineId(id);
    if (bid == null) { logger.warn("getBatchDetail invalid id (mysql)", { traceId, batchId: id }); return res.status(400).json({ success: false, message: "Invalid batch id." }); }
    const data = await getBatchDetailMysql(bid);
    if (!data) { logger.warn("getBatchDetail not found (mysql)", { traceId, batchId: id }); return res.status(404).json({ success: false, message: "Batch not found." }); }
    logger.info("getBatchDetail success", { traceId, batchId: id, source: "mysql" });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getBatchDetail failed", { traceId, batchId: id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/offline/enquiry
export const submitEnquiry = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id || null;
  logger.info("submitEnquiry invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    // ── MySQL enquiry write path (offline-enquiry) ───────────────────────────
    // A MySQL batch id is an int. Anonymous-allowed (userId may be null → stored
    // as the 0 sentinel).
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
  } catch (e: any) {
    if (e.issues) { logger.warn("submitEnquiry validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("submitEnquiry failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/client/offline/batch-enquiry
// The offline-batch "Register" form (name/email/number/qualification +
// optional free-text when "other" is chosen). Auth is REQUIRED — customerId is
// always recorded against the logged-in customer.
// MySQL enquiry: batchId is an INT (the migrated id-space), not an ObjectId.
const batchEnquirySchema = z
  .object({
    name: z.string().min(1).max(255),
    email: z.string().email().max(255),
    mobile: z.string().min(6).max(20),
    qualification: z.enum(OFFLINE_BATCH_QUALIFICATIONS),
    otherQualification: z.string().min(1).max(255).optional(),
    batchId: z.coerce.number().int().positive(),
  })
  .refine((d) => d.qualification !== "other" || !!d.otherQualification, {
    message: "otherQualification is required when qualification is 'other'.",
    path: ["otherQualification"],
  });

export const submitBatchEnquiry = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id || null;
  logger.info("submitBatchEnquiry invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    // ── MySQL batch-enquiry write path (offline-enquiry, same ws_offline_enquiry
    // table as submitEnquiry). Batch id is an int; existence checked via the
    // offline-enquiry repo. otherQualification retained only for "other".
    const data = batchEnquirySchema.parse(req.body);

    if (!(await enquiryBatchExists(data.batchId))) {
      logger.warn("submitBatchEnquiry batch not found (mysql)", { traceId, batchId: data.batchId });
      return res.status(404).json({ success: false, message: "Batch not found." });
    }

    const customerIdInt = userId != null ? Number(userId) : null;
    const enquiry = await submitBatchEnquiryMysql({
      customerId: Number.isInteger(customerIdInt as number) ? (customerIdInt as number) : null,
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      qualification: data.qualification,
      // Only retain the free-text when "other" is selected.
      otherQualification: data.qualification === "other" ? data.otherQualification ?? null : null,
      batchId: data.batchId,
    });

    logger.info("submitBatchEnquiry success (mysql)", { traceId, customerId: userId, batchId: data.batchId, enquiryId: enquiry._id });
    return res.status(201).json({ success: true, data: enquiry });
  } catch (e: any) {
    if (e.issues) { logger.warn("submitBatchEnquiry validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("submitBatchEnquiry failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
