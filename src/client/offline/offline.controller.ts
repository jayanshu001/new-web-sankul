import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { OfflineBannerSlider } from "../../models/offline/OfflineBannerSlider.model";
import { OfflineCity } from "../../models/offline/OfflineCity.model";
import { OfflineCenter } from "../../models/offline/OfflineCenter.model";
import { OfflineBatch } from "../../models/offline/OfflineBatch.model";
import { OfflineEnquiry } from "../../models/offline/OfflineEnquiry.model";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GET /api/v1/client/offline — dashboard: banners + cities/centers/batches + upcoming batches
export const getOfflineDashboard = async (_req: Request, res: Response) => {
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

    return res.status(200).json({ success: true, data: { dashboard } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/cities
export const listCities = async (_req: Request, res: Response) => {
  try {
    const data = await OfflineCity.find({ status: true }).sort({ order: 1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/cities/:cityId/centers
export const listCentersByCity = async (req: Request, res: Response) => {
  try {
    const cityId = req.params.cityId as string;
    if (!isObjectId(cityId))
      return res.status(400).json({ success: false, message: "Invalid city id." });

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

    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/centers/:id
export const getCenterDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid center id." });

    const center = await OfflineCenter.findOne({ _id: id, status: true })
      .populate({ path: "cityId", model: OfflineCity })
      .lean();
    if (!center) return res.status(404).json({ success: false, message: "Center not found." });

    const batches = await OfflineBatch.find({ centerId: id, status: true })
      .sort({ startAt: 1 })
      .lean();

    return res.status(200).json({ success: true, data: { ...center, batches } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/offline/batches/:id
export const getBatchDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid batch id." });

    const batch = await OfflineBatch.findOne({ _id: id, status: true })
      .populate({
        path: "centerId",
        model: OfflineCenter,
        populate: { path: "cityId", model: OfflineCity },
      })
      .lean();
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found." });

    return res.status(200).json({ success: true, data: batch });
  } catch (e: any) {
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
  try {
    const userId = req.user?.id || null;
    const data = enquirySchema.parse(req.body);

    const batch = await OfflineBatch.exists({ _id: data.batchId });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found." });

    const enquiry = await OfflineEnquiry.create({
      customerId: userId,
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      qualification: data.qualification,
      batchId: data.batchId,
      remarks: data.remarks,
    });

    return res.status(201).json({ success: true, data: enquiry });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};
