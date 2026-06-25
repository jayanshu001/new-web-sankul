import { Request, Response } from "express";
import mongoose from "mongoose";
import { OfflineBannerSlider } from "../../models/offline/OfflineBannerSlider.model";
import { OfflineCity } from "../../models/offline/OfflineCity.model";
import { OfflineCenter } from "../../models/offline/OfflineCenter.model";
import { OfflineBatch } from "../../models/offline/OfflineBatch.model";
import { OfflineEnquiry } from "../../models/offline/OfflineEnquiry.model";
import { CustomerState } from "../../models/customer/CustomerState.model";
import {
  bannerCreateSchema,
  bannerUpdateSchema,
  cityCreateSchema,
  cityUpdateSchema,
  centerCreateSchema,
  centerUpdateSchema,
  batchCreateSchema,
  batchUpdateSchema,
  reorderSchema,
} from "./offline.validation";
import { buildSearchFilter } from "../../utils/searchFilter";
import { z } from "zod";
import {
  isOfflineBatchMysql, parseOfflineId,
  listCentersAdmin as sqlListCenters, getCenterDetail as sqlGetCenter,
  createCenter as sqlCreateCenter, updateCenter as sqlUpdateCenter, deleteCenter as sqlDeleteCenter,
  listBatchesAdmin as sqlListBatches, getBatchDetail as sqlGetBatch,
  createBatch as sqlCreateBatch, updateBatch as sqlUpdateBatch, deleteBatch as sqlDeleteBatch,
  listBanners as sqlListBanners, createBanner as sqlCreateBanner, updateBanner as sqlUpdateBanner,
  deleteBanner as sqlDeleteBanner, reorderBanners as sqlReorderBanners,
} from "../../modules/offline-batch/offline-batch.service";
import {
  isOfflineEnquiryMysql, parseOfflineEnquiryId,
  listEnquiriesAdmin as sqlListEnquiries, deleteEnquiryAdmin as sqlDeleteEnquiry,
} from "../../modules/offline-enquiry/offline-enquiry.service";
import {
  isOfflineCityMysql, parseCityId,
  listCitiesAdmin as sqlListCities, getCityAdmin as sqlGetCity,
  createCityAdmin as sqlCreateCity, updateCityAdmin as sqlUpdateCity, deleteCityAdmin as sqlDeleteCity,
} from "../../modules/offline-city/offline-city.service";

// City SQL body schema: stateId dropped (no SQL column), order/status numeric.
const cityCreateSqlSchema = z.object({
  name: z.string().min(1).max(100),
  image: z.string().min(1).max(500),
  order: z.coerce.number().int().default(0),
  status: z.boolean().optional(),
  // Parent state (ws_customer_state id). Nullable — a city may be unassigned.
  stateId: z.coerce.number().int().positive().nullable().optional(),
});
const cityUpdateSqlSchema = cityCreateSqlSchema.partial();

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// SQL-path body schemas: cityId/centerId are numeric ints (not 24-hex ObjectIds).
const centerCreateSqlSchema = z.object({
  name: z.string().min(1).max(255),
  images: z.array(z.string()).default([]),
  address: z.string().min(1),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  phone: z.string().min(1).max(20),
  cityId: z.coerce.number().int().positive(),
  status: z.boolean().optional(),
});
const centerUpdateSqlSchema = centerCreateSqlSchema.partial();
const batchCreateSqlSchema = z.object({
  name: z.string().min(1).max(255),
  image: z.string().min(1).max(500),
  description: z.string().min(1),
  startAt: z.string().min(1),
  duration: z.string().min(1).max(100),
  centerId: z.coerce.number().int().positive(),
  status: z.boolean().optional(),
});
const batchUpdateSqlSchema = batchCreateSqlSchema.partial();

// ─── Banners ──────────────────────────────────────────────────────────────

export const listBanners = async (_req: Request, res: Response) => {
  try {
    if (isOfflineBatchMysql()) return res.status(200).json({ success: true, data: await sqlListBanners() });
    const data = await OfflineBannerSlider.find().sort({ orderBy: 1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createBanner = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.keyId === "string") req.body.keyId = Number(req.body.keyId);
    if (typeof req.body.orderBy === "string") req.body.orderBy = Number(req.body.orderBy);
    const data = bannerCreateSchema.parse(req.body);
    if (isOfflineBatchMysql()) return res.status(201).json({ success: true, data: await sqlCreateBanner(data) });
    const doc = await OfflineBannerSlider.create(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateBanner = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.keyId === "string") req.body.keyId = Number(req.body.keyId);
    if (typeof req.body.orderBy === "string") req.body.orderBy = Number(req.body.orderBy);
    const data = bannerUpdateSchema.parse(req.body);
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await sqlUpdateBanner(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineBannerSlider.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteBanner = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const ok = await sqlDeleteBanner(nid);
      if (!ok) return res.status(404).json({ success: false, message: "Not found." });
      return res.status(200).json({ success: true, message: "Deleted." });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineBannerSlider.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const reorderBanners = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderSchema.parse(req.body);
    if (isOfflineBatchMysql()) {
      const count = await sqlReorderBanners(orders);
      if (!count) return res.status(400).json({ success: false, message: "No valid ids." });
      return res.status(200).json({ success: true, message: "Order updated." });
    }
    const ops = orders
      .filter((o) => isObjectId(o.id))
      .map((o) => ({
        updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } },
      }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await OfflineBannerSlider.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Order updated." });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Cities ──────────────────────────────────────────────────────────────

export const listCities = async (req: Request, res: Response) => {
  try {
    // Pagination opt-in (page/limit); `search` matches city name; newest first.
    const { status, stateId, search, page, limit } = req.query as Record<string, string>;
    const paginate = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
    const meta = (total: number) => ({
      total,
      page: paginate ? pageNum : 1,
      limit: paginate ? limitNum : total,
      totalPages: paginate ? Math.ceil(total / limitNum) : 1,
    });

    if (isOfflineCityMysql()) {
      const st = status === "true" ? true : status === "false" ? false : undefined;
      const stateNum = stateId && Number.isInteger(Number(stateId)) && Number(stateId) > 0 ? Number(stateId) : undefined;
      const { data, total } = await sqlListCities({
        status: st,
        stateId: stateNum,
        search: search?.trim() || undefined,
        skip: paginate ? (pageNum - 1) * limitNum : undefined,
        take: paginate ? limitNum : undefined,
      });
      return res.status(200).json({ success: true, data, pagination: meta(total) });
    }

    const filter: any = {};
    if (status === "true" || status === "false") filter.status = status === "true";
    if (stateId && isObjectId(stateId)) filter.stateId = stateId;
    Object.assign(filter, buildSearchFilter(search, ["name"]));
    const query = OfflineCity.find(filter)
      .populate({ path: "stateId", model: CustomerState, select: "_id name stateCode" })
      .sort({ createdAt: -1, _id: -1 });
    if (paginate) query.skip((pageNum - 1) * limitNum).limit(limitNum);
    const [data, total] = await Promise.all([query.lean(), OfflineCity.countDocuments(filter)]);
    return res.status(200).json({ success: true, data, pagination: meta(total) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getCity = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineCityMysql()) {
      const nid = parseCityId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const data = await sqlGetCity(nid);
      if (!data) return res.status(404).json({ success: false, message: "City not found." });
      return res.status(200).json({ success: true, data });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineCity.findById(id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "City not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createCity = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    if (isOfflineCityMysql()) {
      const data = cityCreateSqlSchema.parse(req.body);
      return res.status(201).json({ success: true, data: await sqlCreateCity(data) });
    }
    const data = cityCreateSchema.parse(req.body);
    const doc = await OfflineCity.create(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateCity = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    if (isOfflineCityMysql()) {
      const nid = parseCityId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const data = cityUpdateSqlSchema.parse(req.body);
      const r = await sqlUpdateCity(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = cityUpdateSchema.parse(req.body);
    const doc = await OfflineCity.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "City not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteCity = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineCityMysql()) {
      const nid = parseCityId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await sqlDeleteCity(nid);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, message: "City deleted." });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const centerCount = await OfflineCenter.countDocuments({ cityId: id });
    if (centerCount > 0)
      return res.status(409).json({
        success: false,
        message: `Cannot delete — city has ${centerCount} centers.`,
      });
    const doc = await OfflineCity.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "City not found." });
    return res.status(200).json({ success: true, message: "City deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Centers ──────────────────────────────────────────────────────────────

export const listCenters = async (req: Request, res: Response) => {
  try {
    // Pagination opt-in (page/limit); `search` matches center name; newest first.
    const { cityId, status, search, page, limit } = req.query as Record<string, string>;
    const paginate = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
    const meta = (total: number) => ({
      total,
      page: paginate ? pageNum : 1,
      limit: paginate ? limitNum : total,
      totalPages: paginate ? Math.ceil(total / limitNum) : 1,
    });

    if (isOfflineBatchMysql()) {
      const cid = cityId ? parseOfflineId(cityId) ?? undefined : undefined;
      // status filter is a no-op on SQL (no status column — all rows active)
      const { data, total } = await sqlListCenters({
        cityId: cid,
        search: search?.trim() || undefined,
        skip: paginate ? (pageNum - 1) * limitNum : undefined,
        take: paginate ? limitNum : undefined,
      });
      return res.status(200).json({ success: true, data, pagination: meta(total) });
    }

    const filter: any = {};
    if (cityId && isObjectId(cityId)) filter.cityId = cityId;
    if (status === "true" || status === "false") filter.status = status === "true";
    Object.assign(filter, buildSearchFilter(search, ["name"]));
    const query = OfflineCenter.find(filter)
      .populate({ path: "cityId", model: OfflineCity, select: "name" })
      .sort({ createdAt: -1, _id: -1 });
    if (paginate) query.skip((pageNum - 1) * limitNum).limit(limitNum);
    const [data, total] = await Promise.all([query.lean(), OfflineCenter.countDocuments(filter)]);
    return res.status(200).json({ success: true, data, pagination: meta(total) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getCenter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const data = await sqlGetCenter(nid);
      if (!data) return res.status(404).json({ success: false, message: "Center not found." });
      return res.status(200).json({ success: true, data });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineCenter.findById(id)
      .populate({ path: "cityId", model: OfflineCity })
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: "Center not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

const buildCenterPayload = (req: Request) => {
  const body: Record<string, any> = { ...req.body };
  if (body.latitude !== undefined) body.latitude = Number(body.latitude);
  if (body.longitude !== undefined) body.longitude = Number(body.longitude);
  if (body.status !== undefined && typeof body.status === "string") {
    body.status = body.status === "true";
  }

  const uploaded = (req.files as Array<{ location?: string }> | undefined) ?? [];
  const uploadedUrls = uploaded.map((f) => f.location).filter((u): u is string => !!u);

  let existing: string[] = [];
  if (Array.isArray(body.images)) existing = body.images.filter((x: any) => typeof x === "string");
  else if (typeof body.images === "string" && body.images.length) existing = [body.images];

  body.images = [...existing, ...uploadedUrls];
  return body;
};

export const createCenter = async (req: Request, res: Response) => {
  try {
    const payload = buildCenterPayload(req);
    if (isOfflineBatchMysql()) {
      const data = centerCreateSqlSchema.parse(payload);
      const r = await sqlCreateCenter(data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(201).json({ success: true, data: r.data });
    }
    const data = centerCreateSchema.parse(payload);
    const cityExists = await OfflineCity.exists({ _id: data.cityId });
    if (!cityExists) return res.status(404).json({ success: false, message: "City not found." });
    const doc = await OfflineCenter.create(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateCenter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const payload = buildCenterPayload(req);
    if (payload.images && payload.images.length === 0) delete payload.images;
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const data = centerUpdateSqlSchema.parse(payload);
      const r = await sqlUpdateCenter(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = centerUpdateSchema.parse(payload);
    const doc = await OfflineCenter.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Center not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteCenter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await sqlDeleteCenter(nid);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, message: "Center deleted." });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const batchCount = await OfflineBatch.countDocuments({ centerId: id });
    if (batchCount > 0)
      return res.status(409).json({
        success: false,
        message: `Cannot delete — center has ${batchCount} batches.`,
      });
    const doc = await OfflineCenter.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Center not found." });
    return res.status(200).json({ success: true, message: "Center deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Batches ──────────────────────────────────────────────────────────────

export const listBatches = async (req: Request, res: Response) => {
  try {
    // Pagination opt-in (page/limit); `search` matches batch name; newest first.
    const { centerId, status, upcoming, search, page, limit } = req.query as Record<string, string>;
    const paginate = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
    const meta = (total: number) => ({
      total,
      page: paginate ? pageNum : 1,
      limit: paginate ? limitNum : total,
      totalPages: paginate ? Math.ceil(total / limitNum) : 1,
    });

    if (isOfflineBatchMysql()) {
      const cid = centerId ? parseOfflineId(centerId) ?? undefined : undefined;
      const { data, total } = await sqlListBatches({
        centerId: cid,
        upcoming: upcoming === "true",
        search: search?.trim() || undefined,
        skip: paginate ? (pageNum - 1) * limitNum : undefined,
        take: paginate ? limitNum : undefined,
      });
      return res.status(200).json({ success: true, data, pagination: meta(total) });
    }

    const filter: any = {};
    if (centerId && isObjectId(centerId)) filter.centerId = centerId;
    if (status === "true" || status === "false") filter.status = status === "true";
    if (upcoming === "true") filter.startAt = { $gt: new Date() };
    Object.assign(filter, buildSearchFilter(search, ["name"]));

    const query = OfflineBatch.find(filter)
      .populate({
        path: "centerId",
        model: OfflineCenter,
        populate: { path: "cityId", model: OfflineCity, select: "name" },
      })
      .sort({ createdAt: -1, _id: -1 });
    if (paginate) query.skip((pageNum - 1) * limitNum).limit(limitNum);
    const [data, total] = await Promise.all([query.lean(), OfflineBatch.countDocuments(filter)]);
    return res.status(200).json({ success: true, data, pagination: meta(total) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getBatch = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const data = await sqlGetBatch(nid);
      if (!data) return res.status(404).json({ success: false, message: "Batch not found." });
      return res.status(200).json({ success: true, data });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineBatch.findById(id)
      .populate({
        path: "centerId",
        model: OfflineCenter,
        populate: { path: "cityId", model: OfflineCity },
      })
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: "Batch not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createBatch = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    if (isOfflineBatchMysql()) {
      const data = batchCreateSqlSchema.parse(req.body);
      const r = await sqlCreateBatch(data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(201).json({ success: true, data: r.data });
    }
    const data = batchCreateSchema.parse(req.body);
    const centerExists = await OfflineCenter.exists({ _id: data.centerId });
    if (!centerExists) return res.status(404).json({ success: false, message: "Center not found." });
    const doc = await OfflineBatch.create({ ...data, startAt: new Date(data.startAt) });
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateBatch = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const data = batchUpdateSqlSchema.parse(req.body);
      const r = await sqlUpdateBatch(nid, data);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, data: r.data });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = batchUpdateSchema.parse(req.body);
    const update: any = { ...data };
    if (data.startAt) update.startAt = new Date(data.startAt);
    const doc = await OfflineBatch.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Batch not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteBatch = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineBatchMysql()) {
      const nid = parseOfflineId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const r = await sqlDeleteBatch(nid);
      if (!r.ok) return res.status(r.status).json({ success: false, message: r.message });
      return res.status(200).json({ success: true, message: "Batch deleted." });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineBatch.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Batch not found." });
    await OfflineEnquiry.deleteMany({ batchId: id });
    return res.status(200).json({ success: true, message: "Batch deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Enquiries ──────────────────────────────────────────────────────────────

export const listEnquiries = async (req: Request, res: Response) => {
  try {
    const { batchId, search, fromDate, toDate, page = "1", limit = "20" } =
      req.query as Record<string, string>;

    if (isOfflineEnquiryMysql()) {
      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
      const { data, total } = await sqlListEnquiries({
        batchId: batchId ? parseOfflineEnquiryId(batchId) ?? undefined : undefined,
        search: search?.trim() || undefined,
        from: fromDate ? new Date(fromDate) : undefined,
        to: toDate ? new Date(toDate) : undefined,
        page: pageNum,
        limit: limitNum,
      });
      return res.status(200).json({
        success: true,
        data,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    }

    const filter: any = {};
    if (batchId && isObjectId(batchId)) filter.batchId = batchId;
    Object.assign(filter, buildSearchFilter(search, ["name", "mobile", "email"]));
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      OfflineEnquiry.find(filter)
        .populate({ path: "batchId", model: OfflineBatch, select: "name startAt" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      OfflineEnquiry.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteEnquiry = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (isOfflineEnquiryMysql()) {
      const nid = parseOfflineEnquiryId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid id." });
      const ok = await sqlDeleteEnquiry(nid);
      if (!ok) return res.status(404).json({ success: false, message: "Enquiry not found." });
      return res.status(200).json({ success: true, message: "Enquiry deleted." });
    }
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineEnquiry.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Enquiry not found." });
    return res.status(200).json({ success: true, message: "Enquiry deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
