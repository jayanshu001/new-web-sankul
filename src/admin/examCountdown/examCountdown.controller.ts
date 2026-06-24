import { Request, Response } from "express";
import mongoose from "mongoose";
import { ExamCountdown } from "../../models/examCountdown/ExamCountdown.model";
import { ExamCountdownCategory } from "../../models/examCountdown/ExamCountdownCategory.model";
import { buildRegexCondition } from "../../utils/searchFilter";
import * as ecSql from "../../modules/exam-countdown/exam-countdown.service";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const TEN_YEARS_MS = 10 * 365 * 86_400_000;
const FIVE_YEARS_MS = 5 * 365 * 86_400_000;

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseExamDate(raw: any): { date: Date | null; error?: string } {
  if (!raw) return { date: null, error: "examDate is required." };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { date: null, error: "examDate is not a valid date." };
  const now = Date.now();
  if (d.getTime() > now + TEN_YEARS_MS)
    return { date: null, error: "examDate cannot be more than 10 years in the future." };
  if (d.getTime() < now - FIVE_YEARS_MS)
    return { date: null, error: "examDate cannot be more than 5 years in the past." };
  return { date: utcMidnight(d) };
}

// ─── Categories ─────────────────────────────────────────────────────────────

// GET /admin/exam-countdowns/categories
export const adminListCategories = async (req: Request, res: Response) => {
  try {
    const search = (req.query.search ?? "").toString().trim();
    // Pagination is opt-in: if page/limit are sent we paginate + return a
    // `pagination` block (same shape as GET /admin/exam-countdowns); if neither
    // is sent we return the full list (legacy contract) for non-paging callers.
    const paginate = req.query.page !== undefined || req.query.limit !== undefined;
    const pageNum = Math.max(parseInt(String(req.query.page ?? "1"), 10) || 1, 1);
    const limitNum = Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    if (ecSql.isExamCountdownMysql()) {
      const { data, total } = await ecSql.listCategoriesAdmin({
        search: search || null,
        skip: paginate ? skip : undefined,
        take: paginate ? limitNum : undefined,
      });
      return res.status(200).json(
        paginate
          ? { success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } }
          : { success: true, data }
      );
    }

    const filter: any = {};
    const c = buildRegexCondition(search);
    if (c) filter.name = c;
    if (paginate) {
      const [data, total] = await Promise.all([
        ExamCountdownCategory.find(filter).sort({ order: 1, name: 1 }).skip(skip).limit(limitNum).lean(),
        ExamCountdownCategory.countDocuments(filter),
      ]);
      return res.status(200).json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
    }
    const data = await ExamCountdownCategory.find(filter).sort({ order: 1, name: 1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /admin/exam-countdowns/categories
export const adminCreateCategory = async (req: Request, res: Response) => {
  try {
    const name = (req.body?.name ?? "").toString().trim();
    const colorHex = (req.body?.colorHex ?? "").toString().trim();
    const order = Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : 0;
    const status = req.body?.status === undefined ? true : Boolean(req.body.status);

    if (!name) return res.status(400).json({ success: false, message: "name is required." });
    if (name.length > 60)
      return res.status(400).json({ success: false, message: "name too long (max 60)." });
    if (!HEX.test(colorHex))
      return res
        .status(400)
        .json({ success: false, message: "colorHex must be a 7-char hex like #7C3AED." });

    if (ecSql.isExamCountdownMysql()) {
      const r = await ecSql.createCategory({ name, colorHex, order, status });
      if (r.conflict) return res.status(409).json({ success: false, message: "A category with this name already exists." });
      return res.status(201).json({ success: true, data: r.data });
    }
    try {
      const cat = await ExamCountdownCategory.create({ name, colorHex, order, status });
      return res.status(201).json({ success: true, data: cat });
    } catch (err: any) {
      if (err?.code === 11000)
        return res
          .status(409)
          .json({ success: false, message: "A category with this name already exists." });
      throw err;
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /admin/exam-countdowns/categories/:id
export const adminUpdateCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const useSql = ecSql.isExamCountdownMysql();
    if (!useSql && !mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const update: any = {};
    if (req.body?.name !== undefined) {
      const name = req.body.name.toString().trim();
      if (!name)
        return res.status(400).json({ success: false, message: "name cannot be empty." });
      if (name.length > 60)
        return res.status(400).json({ success: false, message: "name too long (max 60)." });
      update.name = name;
    }
    if (req.body?.colorHex !== undefined) {
      const c = req.body.colorHex.toString().trim();
      if (!HEX.test(c))
        return res
          .status(400)
          .json({ success: false, message: "colorHex must be a 7-char hex like #7C3AED." });
      update.colorHex = c;
    }
    if (req.body?.order !== undefined) update.order = Number(req.body.order) || 0;
    if (req.body?.status !== undefined) update.status = Boolean(req.body.status);

    if (useSql) {
      const nid = ecSql.parseEcId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid category id." });
      const r = await ecSql.updateCategory(nid, update);
      if ((r as any).notFound) return res.status(404).json({ success: false, message: "Category not found." });
      if ((r as any).conflict) return res.status(409).json({ success: false, message: "A category with this name already exists." });
      return res.status(200).json({ success: true, data: (r as any).data });
    }
    try {
      const cat = await ExamCountdownCategory.findByIdAndUpdate(id, { $set: update }, { new: true });
      if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
      return res.status(200).json({ success: true, data: cat });
    } catch (err: any) {
      if (err?.code === 11000)
        return res
          .status(409)
          .json({ success: false, message: "A category with this name already exists." });
      throw err;
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /admin/exam-countdowns/categories/:id
export const adminDeleteCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (ecSql.isExamCountdownMysql()) {
      const nid = ecSql.parseEcId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid category id." });
      const r = await ecSql.deleteCategory(nid);
      if ((r as any).notFound) return res.status(404).json({ success: false, message: "Category not found." });
      if ((r as any).inUse)
        return res.status(400).json({ success: false, message: "Category is referenced by one or more countdowns. Reassign or soft-disable instead." });
      return res.status(200).json({ success: true, message: "Category deleted." });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const inUse = await ExamCountdown.exists({ categoryId: id });
    if (inUse)
      return res.status(400).json({
        success: false,
        message:
          "Category is referenced by one or more countdowns. Reassign or soft-disable instead.",
      });

    const removed = await ExamCountdownCategory.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, message: "Category deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Countdowns ─────────────────────────────────────────────────────────────

// GET /admin/exam-countdowns
export const adminListCountdowns = async (req: Request, res: Response) => {
  try {
    const {
      categoryId,
      search = "",
      page = "1",
      limit = "20",
      includePast = "true",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    if (ecSql.isExamCountdownMysql()) {
      let catId: number | null = null;
      if (categoryId) {
        catId = ecSql.parseEcId(categoryId);
        if (catId == null) return res.status(400).json({ success: false, message: "Invalid categoryId." });
      }
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const r = await ecSql.listCountdownsAdmin({
        categoryId: catId, search: search || null, includePast: includePast !== "false",
        skip, limitNum, pageNum, todayUTC,
      });
      return res.status(200).json({ success: true, ...r });
    }

    const filter: any = {};
    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(categoryId))
        return res.status(400).json({ success: false, message: "Invalid categoryId." });
      filter.categoryId = categoryId;
    }
    {
      const c = buildRegexCondition(search);
      if (c) filter.title = c;
    }
    if (includePast === "false") {
      const now = new Date();
      filter.examDate = {
        $gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      };
    }

    const [data, total] = await Promise.all([
      ExamCountdown.find(filter)
        .populate("categoryId", "_id name colorHex")
        .sort({ examDate: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ExamCountdown.countDocuments(filter),
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

// POST /admin/exam-countdowns
export const adminCreateCountdown = async (req: Request, res: Response) => {
  try {
    const title = (req.body?.title ?? "").toString().trim();
    const categoryId = (req.body?.categoryId ?? "").toString().trim();
    const description = (req.body?.description ?? "").toString();
    const status = req.body?.status === undefined ? true : Boolean(req.body.status);

    if (!title) return res.status(400).json({ success: false, message: "title is required." });
    if (title.length > 200)
      return res.status(400).json({ success: false, message: "title too long (max 200)." });

    const useSql = ecSql.isExamCountdownMysql();
    if (!useSql && !mongoose.Types.ObjectId.isValid(categoryId))
      return res.status(400).json({ success: false, message: "Invalid categoryId." });

    const { date, error } = parseExamDate(req.body?.examDate);
    if (error || !date) return res.status(400).json({ success: false, message: error });

    if (useSql) {
      const nid = ecSql.parseEcId(categoryId);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid categoryId." });
      const r = await ecSql.createCountdown({ title, categoryId: nid, examDate: date, description, status });
      if ((r as any).catNotFound) return res.status(404).json({ success: false, message: "Category not found." });
      if ((r as any).catDisabled) return res.status(400).json({ success: false, message: "Category is disabled; enable it before assigning." });
      return res.status(201).json({ success: true, data: (r as any).data });
    }

    const cat = await ExamCountdownCategory.findById(categoryId).select("_id status");
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    if (!cat.status)
      return res
        .status(400)
        .json({ success: false, message: "Category is disabled; enable it before assigning." });

    const doc = await ExamCountdown.create({
      title,
      categoryId,
      examDate: date,
      description,
      status,
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /admin/exam-countdowns/:id
export const adminUpdateCountdown = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const useSql = ecSql.isExamCountdownMysql();
    if (!useSql && !mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid countdown id." });

    const update: any = {};
    if (req.body?.title !== undefined) {
      const t = req.body.title.toString().trim();
      if (!t) return res.status(400).json({ success: false, message: "title cannot be empty." });
      if (t.length > 200)
        return res.status(400).json({ success: false, message: "title too long (max 200)." });
      update.title = t;
    }
    if (req.body?.categoryId !== undefined) {
      const cid = req.body.categoryId.toString().trim();
      if (useSql) {
        const nid = ecSql.parseEcId(cid);
        if (nid == null) return res.status(400).json({ success: false, message: "Invalid categoryId." });
        update.categoryId = nid;
      } else {
        if (!mongoose.Types.ObjectId.isValid(cid))
          return res.status(400).json({ success: false, message: "Invalid categoryId." });
        const cat = await ExamCountdownCategory.findById(cid).select("_id status");
        if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
        if (!cat.status)
          return res
            .status(400)
            .json({ success: false, message: "Category is disabled; enable it before assigning." });
        update.categoryId = cid;
      }
    }
    if (req.body?.examDate !== undefined) {
      const { date, error } = parseExamDate(req.body.examDate);
      if (error || !date) return res.status(400).json({ success: false, message: error });
      update.examDate = date;
    }
    if (req.body?.description !== undefined) update.description = req.body.description.toString();
    if (req.body?.status !== undefined) update.status = Boolean(req.body.status);

    if (useSql) {
      const nid = ecSql.parseEcId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid countdown id." });
      const r = await ecSql.updateCountdown(nid, update);
      if ((r as any).notFound) return res.status(404).json({ success: false, message: "Countdown not found." });
      if ((r as any).catNotFound) return res.status(404).json({ success: false, message: "Category not found." });
      if ((r as any).catDisabled) return res.status(400).json({ success: false, message: "Category is disabled; enable it before assigning." });
      return res.status(200).json({ success: true, data: (r as any).data });
    }

    const doc = await ExamCountdown.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Countdown not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /admin/exam-countdowns/:id
export const adminDeleteCountdown = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (ecSql.isExamCountdownMysql()) {
      const nid = ecSql.parseEcId(id);
      if (nid == null) return res.status(400).json({ success: false, message: "Invalid countdown id." });
      const r = await ecSql.deleteCountdown(nid);
      if ((r as any).notFound) return res.status(404).json({ success: false, message: "Countdown not found." });
      return res.status(200).json({ success: true, message: "Countdown deleted." });
    }
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid countdown id." });
    const removed = await ExamCountdown.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ success: false, message: "Countdown not found." });
    return res.status(200).json({ success: true, message: "Countdown deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
