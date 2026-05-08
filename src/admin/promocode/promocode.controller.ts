import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import {
  createPromocodeSchema,
  updatePromocodeSchema,
  togglePromocodeStatusSchema,
  bulkPromocodeIdsSchema,
  bulkPromocodeStatusSchema,
} from "./promocode.validation";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

export const getPromocodes = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      type,
      fromDate,
      toDate,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = {};
    if (search) filter.promocode = { $regex: search.toUpperCase(), $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";
    if (type === "public" || type === "private") filter.type = type;
    if (fromDate || toDate) {
      filter.promo_start_at = {};
      if (fromDate) filter.promo_start_at.$gte = new Date(fromDate);
      if (toDate) filter.promo_start_at.$lte = new Date(toDate);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      PromoCode.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      PromoCode.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPromocodeById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const promo = await PromoCode.findById(id);
    if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });

    const plans = await PromotedPackageCourseEbook.find({ promocodeId: id }).populate({
      path: "planId",
      model: "PackageCourseEbookPrice",
    });

    return res.status(200).json({ success: true, data: { promocode: promo, plans } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPromocode = async (req: Request, res: Response) => {
  try {
    const data = createPromocodeSchema.parse(req.body);
    const code = data.promocode.toUpperCase();

    const exists = await PromoCode.findOne({ promocode: code });
    if (exists)
      return res.status(409).json({ success: false, message: "Promocode already exists." });

    const promo = await PromoCode.create({
      promocode: code,
      title: data.title,
      description: data.description,
      promo_start_at: new Date(data.promo_start_at),
      promo_expire_at: new Date(data.promo_expire_at),
      type: data.type,
      status: data.status ?? true,
      discountType: data.discountType,
      discountValue: data.discountValue,
      promoterId: data.promoterId || null,
    });

    if (data.plans.length) {
      const docs = data.plans
        .filter((p) => isObjectId(p.planId))
        .map((p) => ({
          promocodeId: promo._id,
          planId: p.planId,
          customerPercentage: p.customerPercentage,
          promoterPercentage: p.promoterPercentage,
        }));
      if (docs.length) await PromotedPackageCourseEbook.insertMany(docs, { ordered: false });
    }

    return res.status(201).json({ success: true, data: promo });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePromocode = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const data = updatePromocodeSchema.parse(req.body);

    const update: any = { ...data };
    if (data.promocode) update.promocode = data.promocode.toUpperCase();
    if (data.promo_start_at) update.promo_start_at = new Date(data.promo_start_at);
    if (data.promo_expire_at) update.promo_expire_at = new Date(data.promo_expire_at);
    delete update.plans;

    const promo = await PromoCode.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });

    if (Array.isArray(data.plans)) {
      const keepPlanIds = data.plans.map((p) => p.planId).filter(isObjectId);
      await PromotedPackageCourseEbook.deleteMany({
        promocodeId: id,
        planId: { $nin: keepPlanIds },
      });
      for (const p of data.plans) {
        if (!isObjectId(p.planId)) continue;
        await PromotedPackageCourseEbook.updateOne(
          { promocodeId: id, planId: p.planId },
          {
            $set: {
              customerPercentage: p.customerPercentage,
              promoterPercentage: p.promoterPercentage,
            },
          },
          { upsert: true }
        );
      }
    }

    return res.status(200).json({ success: true, data: promo });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePromocode = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const deleted = await PromoCode.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Promocode not found." });

    await PromotedPackageCourseEbook.deleteMany({ promocodeId: id });
    return res.status(200).json({ success: true, message: "Promocode deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const togglePromocodeStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    const parsed = togglePromocodeStatusSchema.safeParse(req.body);
    let nextStatus: boolean;
    if (parsed.success) {
      nextStatus = parsed.data.status;
    } else {
      const promo = await PromoCode.findById(id).select("status");
      if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });
      nextStatus = !promo.status;
    }

    const promo = await PromoCode.findByIdAndUpdate(
      id,
      { $set: { status: nextStatus } },
      { new: true }
    );
    if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });
    return res.status(200).json({ success: true, data: { status: promo.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkStatus = async (req: Request, res: Response) => {
  try {
    const { ids, status } = bulkPromocodeStatusSchema.parse(req.body);
    const valid = ids.filter(isObjectId);
    if (!valid.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    const result = await PromoCode.updateMany(
      { _id: { $in: valid } },
      { $set: { status } }
    );
    return res
      .status(200)
      .json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDelete = async (req: Request, res: Response) => {
  try {
    const { ids } = bulkPromocodeIdsSchema.parse(req.body);
    const valid = ids.filter(isObjectId);
    if (!valid.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    await PromoCode.deleteMany({ _id: { $in: valid } });
    await PromotedPackageCourseEbook.deleteMany({ promocodeId: { $in: valid } });
    return res.status(200).json({ success: true, message: "Promocodes deleted." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Listing helpers for the create/edit form
export const getPromocodePlans = async (req: Request, res: Response) => {
  try {
    const { packageId, courseId, ebookId } = req.query as Record<string, string>;
    const filter: any = { status: true };
    if (packageId && isObjectId(packageId)) filter.packageId = packageId;
    if (courseId && isObjectId(courseId)) filter.courseId = courseId;
    if (ebookId && isObjectId(ebookId)) filter.ebookId = ebookId;

    const plans = await PackageCourseEbookPrice.find(filter)
      .populate("packageId", "name")
      .populate("courseId", "name")
      .populate("ebookId", "name")
      .sort({ duration: 1 });

    return res.status(200).json({ success: true, data: plans });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
