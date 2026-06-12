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

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// ─── Banners ──────────────────────────────────────────────────────────────

export const listBanners = async (_req: Request, res: Response) => {
  try {
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
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.keyId === "string") req.body.keyId = Number(req.body.keyId);
    if (typeof req.body.orderBy === "string") req.body.orderBy = Number(req.body.orderBy);
    const data = bannerUpdateSchema.parse(req.body);
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
    const { status, stateId } = req.query as Record<string, string>;
    const filter: any = {};
    if (status === "true" || status === "false") filter.status = status === "true";
    if (stateId && isObjectId(stateId)) filter.stateId = stateId;
    const data = await OfflineCity.find(filter)
      .populate({ path: "stateId", model: CustomerState, select: "_id name stateCode" })
      .sort({ order: 1 })
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getCity = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
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
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
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
    const { cityId, status } = req.query as Record<string, string>;
    const filter: any = {};
    if (cityId && isObjectId(cityId)) filter.cityId = cityId;
    if (status === "true" || status === "false") filter.status = status === "true";
    const data = await OfflineCenter.find(filter)
      .populate({ path: "cityId", model: OfflineCity, select: "name" })
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getCenter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
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
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const payload = buildCenterPayload(req);
    if (payload.images && payload.images.length === 0) delete payload.images;
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
    const { centerId, status, upcoming } = req.query as Record<string, string>;
    const filter: any = {};
    if (centerId && isObjectId(centerId)) filter.centerId = centerId;
    if (status === "true" || status === "false") filter.status = status === "true";
    if (upcoming === "true") filter.startAt = { $gt: new Date() };

    const data = await OfflineBatch.find(filter)
      .populate({
        path: "centerId",
        model: OfflineCenter,
        populate: { path: "cityId", model: OfflineCity, select: "name" },
      })
      .sort({ startAt: 1 })
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getBatch = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
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
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
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
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await OfflineEnquiry.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Enquiry not found." });
    return res.status(200).json({ success: true, message: "Enquiry deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
