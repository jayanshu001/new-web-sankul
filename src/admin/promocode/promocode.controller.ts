import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import {
  createPromocodeSchema,
  updatePromocodeSchema,
  togglePromocodeStatusSchema,
  bulkPromocodeIdsSchema,
  bulkPromocodeStatusSchema,
  AppliesToType,
} from "./promocode.validation";

const APPLIES_TO_MODEL = {
  package: Package,
  course: Course,
  liveCourse: LiveCourse,
} as const;

const APPLIES_TO_POPULATE_FIELDS = "_id name image";

async function assertAppliesToExists(appliesTo: { type: AppliesToType; ids: string[] }) {
  const Model = APPLIES_TO_MODEL[appliesTo.type] as any;
  const found = await Model.countDocuments({ _id: { $in: appliesTo.ids } });
  if (found !== appliesTo.ids.length) {
    throw Object.assign(new Error(`One or more ${appliesTo.type} ids do not exist`), {
      __badRequest: true,
    });
  }
}

async function populateAppliesTo(doc: any) {
  if (!doc?.appliesTo?.ids?.length) return doc;
  const Model = APPLIES_TO_MODEL[doc.appliesTo.type as AppliesToType] as any;
  if (!Model) return doc;
  const records = await Model.find({ _id: { $in: doc.appliesTo.ids } })
    .select(APPLIES_TO_POPULATE_FIELDS)
    .lean();
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  obj.appliesTo = { type: doc.appliesTo.type, ids: records };
  return obj;
}

// Phase-2 cutover: the legacy `plans` field is no longer accepted. Reject any
// payload that still includes it so clients are forced to migrate to `appliesTo`.
function rejectLegacyPlans(body: any) {
  if (body && Object.prototype.hasOwnProperty.call(body, "plans")) {
    throw Object.assign(
      new Error("plans is no longer supported — use appliesTo"),
      { __badRequest: true }
    );
  }
}

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

    const [rows, total] = await Promise.all([
      PromoCode.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      PromoCode.countDocuments(filter),
    ]);

    const data = rows.map((row: any) => ({
      ...row,
      appliesTo: row.appliesTo
        ? { type: row.appliesTo.type, count: row.appliesTo.ids?.length ?? 0 }
        : null,
    }));

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

    const populated = await populateAppliesTo(promo);

    return res.status(200).json({ success: true, data: { promocode: populated } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPromocode = async (req: Request, res: Response) => {
  try {
    rejectLegacyPlans(req.body);

    const data = createPromocodeSchema.parse(req.body);
    const code = data.promocode.toUpperCase();

    const exists = await PromoCode.findOne({ promocode: code });
    if (exists)
      return res.status(409).json({ success: false, message: "Promocode already exists." });

    await assertAppliesToExists(data.appliesTo);

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
      appliesTo: { type: data.appliesTo.type, ids: data.appliesTo.ids },
    });

    return res.status(201).json({ success: true, data: promo });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.__badRequest)
      return res.status(400).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePromocode = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid promocode id." });

    rejectLegacyPlans(req.body);

    const data = updatePromocodeSchema.parse(req.body);

    const update: any = { ...data };
    if (data.promocode) update.promocode = data.promocode.toUpperCase();
    if (data.promo_start_at) update.promo_start_at = new Date(data.promo_start_at);
    if (data.promo_expire_at) update.promo_expire_at = new Date(data.promo_expire_at);

    if (data.appliesTo) {
      await assertAppliesToExists(data.appliesTo);
      update.appliesTo = { type: data.appliesTo.type, ids: data.appliesTo.ids };
    } else {
      delete update.appliesTo;
    }

    const promo = await PromoCode.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!promo) return res.status(404).json({ success: false, message: "Promocode not found." });

    return res.status(200).json({ success: true, data: promo });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.__badRequest)
      return res.status(400).json({ success: false, message: error.message });
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
    return res.status(200).json({ success: true, message: "Promocodes deleted." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Phase-2 cutover: the plans-picker endpoint no longer makes sense — promocodes
// attach to entities, not plans. Return 410 so any stale client gets a clear
// signal to update.
export const getPromocodePlans = async (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: "Endpoint removed — promocodes now attach to entities, not plans.",
  });
};
