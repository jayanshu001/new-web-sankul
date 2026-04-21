import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Promoter } from "../../models/promoter/Promoter.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { createPromoterSchema, updatePromoterSchema } from "./promoter.validation";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);
const SALT_ROUNDS = 10;

// GET /api/v1/admin/promoters
export const listPromoters = async (req: Request, res: Response) => {
  try {
    const { search, status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const filter: any = { isDelete: false };
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") filter.status = status === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Promoter.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Promoter.countDocuments(filter),
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

// GET /api/v1/admin/promoters/:id
export const getPromoter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });

    const promoter = await Promoter.findOne({ _id: id, isDelete: false }).lean();
    if (!promoter) return res.status(404).json({ success: false, message: "Promoter not found." });

    const [promocodeCount, subscriptionCount] = await Promise.all([
      PromoCode.countDocuments({ promoterId: id }),
      PackageCourseSubscription.countDocuments({ promoterId: id }),
    ]);

    return res
      .status(200)
      .json({ success: true, data: { ...promoter, stats: { promocodeCount, subscriptionCount } } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/v1/admin/promoters
export const createPromoter = async (req: Request, res: Response) => {
  try {
    const data = createPromoterSchema.parse(req.body);
    const existing = await Promoter.findOne({ email: data.email.toLowerCase() });
    if (existing)
      return res.status(409).json({ success: false, message: "Email already in use." });

    const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
    const promoter = await Promoter.create({
      ...data,
      email: data.email.toLowerCase(),
      password: hashed,
    });

    const { password, ...safe } = promoter.toObject();
    return res.status(201).json({ success: true, data: safe });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// PUT /api/v1/admin/promoters/:id
export const updatePromoter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });

    const data = updatePromoterSchema.parse(req.body);
    const update: any = { ...data };
    if (data.email) update.email = data.email.toLowerCase();
    if (data.password) update.password = await bcrypt.hash(data.password, SALT_ROUNDS);

    const promoter = await Promoter.findOneAndUpdate(
      { _id: id, isDelete: false },
      { $set: update },
      { new: true }
    );
    if (!promoter) return res.status(404).json({ success: false, message: "Promoter not found." });

    const obj = promoter.toObject();
    delete (obj as any).password;
    return res.status(200).json({ success: true, data: obj });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// DELETE /api/v1/admin/promoters/:id — soft delete
export const deletePromoter = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const promoter = await Promoter.findByIdAndUpdate(
      id,
      { $set: { isDelete: true, status: false } },
      { new: true }
    );
    if (!promoter) return res.status(404).json({ success: false, message: "Promoter not found." });
    return res.status(200).json({ success: true, message: "Promoter deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// PATCH /api/v1/admin/promoters/:id/status
export const togglePromoterStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const promoter = await Promoter.findOne({ _id: id, isDelete: false }).select("status");
    if (!promoter) return res.status(404).json({ success: false, message: "Promoter not found." });
    promoter.status = !promoter.status;
    await promoter.save();
    return res.status(200).json({ success: true, data: { status: promoter.status } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/promoters/:id/promocodes
export const getPromoterPromocodes = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = await PromoCode.find({ promoterId: id }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/admin/promoters/:id/subscriptions
export const getPromoterSubscriptions = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const data = await PackageCourseSubscription.find({ promoterId: id })
      .populate({ path: "customerId", select: "firstName lastName phoneNumber" })
      .populate({ path: "courseId", select: "name" })
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
