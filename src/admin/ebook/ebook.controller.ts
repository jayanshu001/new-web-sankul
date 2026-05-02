import { Request, Response } from "express";
import mongoose from "mongoose";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import {
  createEbookSchema,
  updateEbookSchema,
  createEbookPlanSchema,
  updateEbookPlanSchema,
  reorderEbooksSchema,
} from "./ebook.validation";

// ─── Ebook CRUD ───────────────────────────────────────────────────────────────

export const getEbooks = async (req: Request, res: Response) => {
  try {
    const {
      search,
      author,
      publisher,
      language,
      status,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filters: any = {};
    if (search) filters.$or = [
      { name: { $regex: search, $options: "i" } },
      { author: { $regex: search, $options: "i" } },
    ];
    if (author) filters.author = { $regex: author, $options: "i" };
    if (publisher) filters.publisher = { $regex: publisher, $options: "i" };
    if (language) filters.language = language;
    if (status === "true" || status === "false") filters.status = status === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Ebook.find(filters).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limitNum),
      Ebook.countDocuments(filters),
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

export const getEbookById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    }

    const ebook = await Ebook.findById(id);
    if (!ebook) return res.status(404).json({ success: false, message: "Ebook not found" });

    const plans = await EbookPrice.find({ ebookId: id, status: true }).sort({ price: 1 });

    return res.status(200).json({ success: true, data: { ...ebook.toObject(), plans } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

function applyEbookUploads(req: Request) {
  const files = req.files as Record<string, Express.MulterS3.File[]> | undefined;
  if (!files) return;
  for (const key of ["image", "thumbnail", "demoUrl", "bookUrl"] as const) {
    const url = files[key]?.[0]?.location;
    if (url) req.body[key] = url;
  }
  if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
}

export const createEbook = async (req: Request, res: Response) => {
  try {
    applyEbookUploads(req);
    const validatedData = createEbookSchema.parse(req.body);
    const ebook = new Ebook(validatedData);
    await ebook.save();
    return res.status(201).json({ success: true, data: ebook });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEbook = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    }

    applyEbookUploads(req);
    const validatedData = updateEbookSchema.parse(req.body);
    const ebook = await Ebook.findByIdAndUpdate(id, validatedData, { new: true });
    if (!ebook) return res.status(404).json({ success: false, message: "Ebook not found" });

    return res.status(200).json({ success: true, data: ebook });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEbook = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const ebook = await Ebook.findByIdAndDelete(id, { session });
      if (!ebook) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: "Ebook not found" });
      }
      await EbookPrice.deleteMany({ ebookId: id }, { session });
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    return res.status(200).json({ success: true, message: "Ebook deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleEbookTrending = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    const ebook = await Ebook.findById(id).select("isTrending");
    if (!ebook) return res.status(404).json({ success: false, message: "Ebook not found" });
    ebook.isTrending = !ebook.isTrending;
    await ebook.save();
    return res.status(200).json({ success: true, data: { isTrending: ebook.isTrending } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderEbooks = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderEbooksSchema.parse(req.body);

    await Promise.all(orders.map(({ id, order }) => Ebook.findByIdAndUpdate(id, { order })));

    return res.status(200).json({ success: true, message: "Ebooks reordered successfully" });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Ebook Plans ──────────────────────────────────────────────────────────────

export const getEbookPlans = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    }

    const ebookExists = await Ebook.exists({ _id: id });
    if (!ebookExists) return res.status(404).json({ success: false, message: "Ebook not found" });

    const plans = await EbookPrice.find({ ebookId: id }).sort({ price: 1 });
    return res.status(200).json({ success: true, data: plans });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createEbookPlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Ebook ID" });
    }

    const ebookExists = await Ebook.exists({ _id: id });
    if (!ebookExists) return res.status(404).json({ success: false, message: "Ebook not found" });

    const validatedData = createEbookPlanSchema.parse(req.body);
    const plan = new EbookPrice({ ...validatedData, ebookId: id });
    await plan.save();
    return res.status(201).json({ success: true, data: plan });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getEbookPlanById = async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, message: "Invalid Plan ID" });
    }

    const plan = await EbookPrice.findById(planId).populate("ebookId", "_id name");
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    return res.status(200).json({ success: true, data: plan });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEbookPlan = async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, message: "Invalid Plan ID" });
    }

    const validatedData = updateEbookPlanSchema.parse(req.body);
    const plan = await EbookPrice.findByIdAndUpdate(planId, validatedData, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    return res.status(200).json({ success: true, data: plan });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEbookPlan = async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ success: false, message: "Invalid Plan ID" });
    }

    const plan = await EbookPrice.findByIdAndDelete(planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    return res.status(200).json({ success: true, message: "Plan deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
