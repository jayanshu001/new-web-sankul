import { Request, Response } from "express";
import mongoose from "mongoose";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { Exam } from "../../models/exam/Exam.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { ExamQuestion } from "../../models/exam/ExamQuestion.model";
import { ExamQuestionOption } from "../../models/exam/ExamQuestionOption.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamResultDetail } from "../../models/exam/ExamResultDetail.model";
import { ExamResultDetailAnalytics } from "../../models/exam/ExamResultDetailAnalytics.model";
import { ExamStatus, ExamResultType, ExamType } from "../../models/enums";
import { formatScheduledAt } from "../../utils/displayTime";
import {
  createCategorySchema,
  updateCategorySchema,
  createExamSchema,
  updateExamSchema,
  reorderExamsSchema,
  createQuestionSchema,
  updateQuestionSchema,
  reorderQuestionsSchema,
  bulkCreateQuestionsSchema,
} from "./exam.validation";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// Parse + clamp the standard list pagination params, returning the spec's
// { page, per_page } naming (vs the module's older page/limit handlers).
const parseListPaging = (q: Record<string, string>) => {
  const page = Math.max(parseInt(q.page ?? "1", 10) || 1, 1);
  const per_page = Math.min(Math.max(parseInt(q.per_page ?? "20", 10) || 20, 1), 200);
  return { page, per_page, skip: (page - 1) * per_page };
};

const buildMeta = (page: number, per_page: number, total: number) => ({
  page,
  per_page,
  total,
  totalPages: Math.ceil(total / per_page),
});

// Recompute exam.questionCount = number of active questions for that exam.
// Call this whenever questions are created, deleted, or bulk-imported.
async function recomputeExamQuestionCount(
  examId: string | mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
) {
  const count = await ExamQuestion.countDocuments({ examId, status: true }).session(
    session ?? null
  );
  await Exam.updateOne({ _id: examId }, { $set: { questionCount: count } }, { session });
}

// ─── Exam Categories ──────────────────────────────────────────────────────────

export const getCategories = async (req: Request, res: Response) => {
  try {
    const { parentId, search, status } = req.query as Record<string, string>;
    const filter: any = {};
    if (parentId === "root" || parentId === "null") filter.parentId = null;
    else if (parentId && isObjectId(parentId)) filter.parentId = parentId;
    if (search) filter.name = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const categories = await ExamCategory.find(filter).sort({ orderBy: 1, name: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryTree = async (_req: Request, res: Response) => {
  try {
    const all = await ExamCategory.find({ status: true }).sort({ orderBy: 1, name: 1 }).lean();
    const byParent = new Map<string, any[]>();
    all.forEach((c) => {
      const key = c.parentId ? c.parentId.toString() : "root";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    });
    const attachChildren = (node: any) => {
      const children = byParent.get(node._id.toString()) ?? [];
      node.children = children.map(attachChildren);
      return node;
    };
    const roots = (byParent.get("root") ?? []).map(attachChildren);
    return res.status(200).json({ success: true, data: roots });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const cat = await ExamCategory.findById(id);
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });

    // Resolve the parent (id + name) so the detail page needn't make a second request.
    let parent: { id: mongoose.Types.ObjectId; name: string } | null = null;
    if (cat.parentId) {
      const p = await ExamCategory.findById(cat.parentId).select("_id name").lean();
      if (p) parent = { id: p._id, name: p.name };
    }

    return res.status(200).json({ success: true, data: { ...cat.toObject(), parent } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /categories/:id/packages — paginated, searchable packages linked to this quiz category.
export const getCategoryPackages = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const exists = await ExamCategory.exists({ _id: id });
    if (!exists) return res.status(404).json({ success: false, message: "Category not found." });

    const { search, status } = req.query as Record<string, string>;
    const { page, per_page, skip } = parseListPaging(req.query as Record<string, string>);

    const filter: any = { "examCategories.category": id };
    if (search) filter.name = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.active = status === "true";

    const [docs, total] = await Promise.all([
      Package.find(filter)
        .select("_id name shareableLink active order")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(per_page)
        .lean(),
      Package.countDocuments(filter),
    ]);

    // Resolve a representative price per package: prefer the default plan row,
    // otherwise the lowest active price. Price lives in a separate collection.
    const packageIds = docs.map((p: any) => p._id);
    const priceRows = packageIds.length
      ? await PackageCourseEbookPrice.find({
          packageId: { $in: packageIds },
          status: true,
        })
          .select("packageId price isDefault")
          .lean()
      : [];
    const priceByPackage = new Map<string, number>();
    for (const row of priceRows as any[]) {
      const key = String(row.packageId);
      const existing = priceByPackage.get(key);
      // Default row wins outright; otherwise keep the lowest price seen.
      if (row.isDefault) priceByPackage.set(key, row.price);
      else if (existing === undefined || row.price < existing)
        priceByPackage.set(key, existing === undefined ? row.price : Math.min(existing, row.price));
    }

    const items = docs.map((p: any) => ({
      id: p._id,
      name: p.name,
      price: priceByPackage.get(String(p._id)) ?? null,
      shareableLink: p.shareableLink ?? null,
      status: p.active,
    }));

    return res.status(200).json({
      success: true,
      data: { items, meta: buildMeta(page, per_page, total) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /categories/:id/courses — paginated, searchable courses linked to this quiz category.
export const getCategoryCourses = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const exists = await ExamCategory.exists({ _id: id });
    if (!exists) return res.status(404).json({ success: false, message: "Category not found." });

    const { search, status } = req.query as Record<string, string>;
    const { page, per_page, skip } = parseListPaging(req.query as Record<string, string>);

    const filter: any = { "examCategories.category": id };
    if (search) filter.name = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const [docs, total] = await Promise.all([
      Course.find(filter)
        .select("_id name status ordered")
        .sort({ ordered: 1, createdAt: -1 })
        .skip(skip)
        .limit(per_page)
        .lean(),
      Course.countDocuments(filter),
    ]);

    const items = docs.map((c: any) => ({
      id: c._id,
      name: c.name,
      status: c.status,
      orderBy: c.ordered ?? 0,
    }));

    return res.status(200).json({
      success: true,
      data: { items, meta: buildMeta(page, per_page, total) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

async function buildAncestors(parentId?: string | null): Promise<mongoose.Types.ObjectId[]> {
  if (!parentId) return [];
  if (!isObjectId(parentId)) return [];
  const parent = await ExamCategory.findById(parentId).select("_id ancestors");
  if (!parent) return [];
  return [...(parent.ancestors || []), parent._id];
}

// Reparent a set of categories under `parentId`, keeping both `parentId`/`ancestors` on
// each child AND `childCategoryIds[]` on the parent in sync.
type AttachError = { status: number; message: string };
async function attachExamChildren(
  parentId: mongoose.Types.ObjectId,
  rawChildIds: string[] | undefined
): Promise<AttachError | null> {
  if (!rawChildIds || rawChildIds.length === 0) return null;
  const uniqueIds = Array.from(new Set(rawChildIds.map(String)));
  const parentIdStr = String(parentId);
  if (uniqueIds.some((id) => id === parentIdStr)) {
    return { status: 422, message: "A category cannot be its own child" };
  }
  if (uniqueIds.some((id) => !isObjectId(id))) {
    return { status: 422, message: "One or more childCategoryIds are invalid" };
  }
  const parent = await ExamCategory.findById(parentId).select("_id ancestors");
  if (!parent) return { status: 404, message: "Parent category not found" };
  const parentAncestors = (parent.ancestors || []).map((a) => String(a));
  if (uniqueIds.some((id) => parentAncestors.includes(id))) {
    return {
      status: 422,
      message: "Cycle detected: one of the selected categories is an ancestor of this category",
    };
  }

  const children = await ExamCategory.find({ _id: { $in: uniqueIds } }).select(
    "_id ancestors parentId"
  );
  if (children.length !== uniqueIds.length) {
    return { status: 422, message: "One or more childCategoryIds are invalid" };
  }

  const newAncestorsForChild = [...(parent.ancestors || []), parent._id];

  for (const child of children) {
    // 0) Detach from previous parent.
    if (child.parentId && String(child.parentId) !== parentIdStr) {
      await ExamCategory.updateOne(
        { _id: child.parentId },
        { $pull: { childCategoryIds: child._id } }
      );
    }

    const oldAncestors = (child.ancestors || []).map((a) => String(a));

    // 1) Update the child itself.
    await ExamCategory.updateOne(
      { _id: child._id },
      { $set: { parentId: parent._id, ancestors: newAncestorsForChild } }
    );

    // 1b) Mirror on the new parent's childCategoryIds.
    await ExamCategory.updateOne(
      { _id: parent._id },
      { $addToSet: { childCategoryIds: child._id } }
    );

    // 2) Cascade ancestors[] on this child's descendants.
    const descendants = await ExamCategory.find({ ancestors: child._id }).select("_id ancestors");
    for (const d of descendants) {
      const oldAnc = (d.ancestors || []).map((a) => String(a));
      const idx = oldAnc.indexOf(String(child._id));
      if (idx === -1) continue;
      const tail = oldAnc.slice(idx + 1);
      const rewritten = [
        ...newAncestorsForChild.map((a) => String(a)),
        String(child._id),
        ...tail,
      ].map((s) => new mongoose.Types.ObjectId(s));
      await ExamCategory.updateOne({ _id: d._id }, { $set: { ancestors: rewritten } });
    }
  }

  return null;
}

export const createCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = createCategorySchema.parse(req.body);
    const { childCategoryIds, ...catFields } = data;
    const ancestors = await buildAncestors(catFields.parentId ?? null);
    const cat = await ExamCategory.create({
      ...catFields,
      parentId: catFields.parentId ?? null,
      ancestors,
    });
    // Mirror the relationship on the parent's childCategoryIds.
    if (cat.parentId) {
      await ExamCategory.updateOne(
        { _id: cat.parentId },
        { $addToSet: { childCategoryIds: cat._id } }
      );
    }
    // Attach any pre-existing children passed in childCategoryIds[].
    const attachErr = await attachExamChildren(cat._id, childCategoryIds);
    if (attachErr) {
      return res.status(attachErr.status).json({ success: false, message: attachErr.message });
    }
    const fresh = await ExamCategory.findById(cat._id);
    return res.status(201).json({ success: true, data: fresh });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = updateCategorySchema.parse(req.body);
    const { childCategoryIds, ...catFields } = data;
    const update: any = { ...catFields };

    let cascadeNeeded = false;
    let oldAncestors: mongoose.Types.ObjectId[] = [];
    let newAncestors: mongoose.Types.ObjectId[] = [];

    if (catFields.parentId !== undefined) {
      const newParentId = catFields.parentId || null;
      if (newParentId === id) {
        return res.status(400).json({ success: false, message: "Category cannot be its own parent." });
      }

      // Reject cycles: the new parent must not be the category itself or any of its descendants.
      if (newParentId) {
        const newParent = await ExamCategory.findById(newParentId).select("_id ancestors");
        if (!newParent) {
          return res.status(400).json({ success: false, message: "Parent category not found." });
        }
        if (newParent.ancestors?.some((a) => a.toString() === id)) {
          return res.status(400).json({
            success: false,
            message: "Cannot move a category under one of its own descendants.",
          });
        }
      }

      const current = await ExamCategory.findById(id).select("_id ancestors parentId");
      if (!current) return res.status(404).json({ success: false, message: "Category not found." });

      oldAncestors = current.ancestors || [];
      newAncestors = await buildAncestors(newParentId);

      update.parentId = newParentId;
      update.ancestors = newAncestors;

      // Keep both sides of the parent ↔ child relationship in sync.
      const oldParentId = current.parentId ?? null;
      const movedId = current._id;
      if (String(oldParentId ?? "") !== String(newParentId ?? "")) {
        if (oldParentId) {
          await ExamCategory.updateOne(
            { _id: oldParentId },
            { $pull: { childCategoryIds: movedId } }
          );
        }
        if (newParentId) {
          await ExamCategory.updateOne(
            { _id: newParentId },
            { $addToSet: { childCategoryIds: movedId } }
          );
        }
      }

      // Cascade is only required when the ancestors chain actually changed.
      const ancestorsChanged =
        oldAncestors.length !== newAncestors.length ||
        oldAncestors.some((a, i) => a.toString() !== newAncestors[i]?.toString());
      cascadeNeeded = ancestorsChanged;
    }

    const cat = await ExamCategory.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });

    if (cascadeNeeded) {
      // Every descendant had `oldAncestors + [id]` as the prefix of its ancestors[].
      // Rewrite that prefix to `newAncestors + [id]`, preserving the intra-subtree tail.
      const movedObjectId = new mongoose.Types.ObjectId(id);
      const oldPrefixLen = oldAncestors.length + 1; // +1 for the moved category itself
      const descendants = await ExamCategory.find({ ancestors: movedObjectId }).select(
        "_id ancestors"
      );
      if (descendants.length) {
        const ops = descendants.map((d) => {
          const tail = (d.ancestors || []).slice(oldPrefixLen);
          const rebuilt = [...newAncestors, movedObjectId, ...tail];
          return {
            updateOne: {
              filter: { _id: d._id },
              update: { $set: { ancestors: rebuilt } },
            },
          };
        });
        await ExamCategory.bulkWrite(ops);
      }
    }

    const attachErr = await attachExamChildren(cat._id, childCategoryIds);
    if (attachErr) {
      return res.status(attachErr.status).json({ success: false, message: attachErr.message });
    }

    const fresh = childCategoryIds?.length ? await ExamCategory.findById(cat._id) : cat;
    return res.status(200).json({ success: true, data: fresh });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const childCount = await ExamCategory.countDocuments({ parentId: id });
    if (childCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Category has sub-categories. Delete or reassign them first.",
      });
    }
    const examCount = await Exam.countDocuments({ categoryId: id });
    if (examCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Category has exams. Reassign or delete them first.",
      });
    }
    const cat = await ExamCategory.findByIdAndDelete(id);
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    if (cat.parentId) {
      await ExamCategory.updateOne(
        { _id: cat.parentId },
        { $pull: { childCategoryIds: cat._id } }
      );
    }
    return res.status(200).json({ success: true, message: "Category deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Exams ────────────────────────────────────────────────────────────────────

export const getExams = async (req: Request, res: Response) => {
  try {
    const {
      search,
      categoryId,
      type,
      status,
      isPaid,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = {};
    if (search) filter.title = { $regex: search, $options: "i" };
    if (categoryId && isObjectId(categoryId)) filter.categoryId = categoryId;
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (isPaid === "true" || isPaid === "false") filter.isPaid = isPaid === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Exam.find(filter)
        .populate("categoryId", "_id name")
        .sort({ orderBy: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Exam.countDocuments(filter),
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

export const getExamById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    const exam = await Exam.findById(id).populate("categoryId", "_id name");
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });
    const questionCount = await ExamQuestion.countDocuments({ examId: id });
    return res.status(200).json({ success: true, data: { ...exam.toObject(), actualQuestionCount: questionCount } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

function applyExamUpload(req: Request) {
  const file = req.file as any;
  if (file?.location) req.body.solutionPdfUrl = file.location;
}

// Map the form's boolean Status toggle to the underlying enum.
// Schema accepts boolean (z.coerce.boolean), then we translate here.
function mapStatusFlagToEnum(statusFlag: unknown): string | undefined {
  if (statusFlag === undefined || statusFlag === null) return undefined;
  return statusFlag ? ExamStatus.PUBLISHED : ExamStatus.DRAFT;
}

// Single source of truth for the daily-test overlap rule, shared by create,
// update, and the status toggle so the rule can never drift between endpoints.
//
// DAILY tests may not have overlapping availability windows — the slot only
// frees up after the previous test's endAt. Two intervals overlap when each
// starts before the other ends: existing.startAt < candidate.endAt AND
// existing.endAt > candidate.startAt. Strict comparisons allow back-to-back
// windows (one ending exactly when the next begins). Only PUBLISHED tests
// reserve a slot, so this returns null unless the candidate is itself a
// PUBLISHED daily test with a complete window, and it only ever clashes with
// other PUBLISHED daily tests. `excludeId` drops the row being toggled/edited.
async function findDailyOverlap(candidate: {
  type?: string;
  status?: string;
  startAt?: Date;
  endAt?: Date;
  excludeId?: string;
}): Promise<any | null> {
  if (
    candidate.type !== ExamType.DAILY ||
    candidate.status !== ExamStatus.PUBLISHED ||
    !candidate.startAt ||
    !candidate.endAt
  )
    return null;

  const query: any = {
    type: ExamType.DAILY,
    status: ExamStatus.PUBLISHED,
    startAt: { $lt: candidate.endAt },
    endAt: { $gt: candidate.startAt },
  };
  if (candidate.excludeId) query._id = { $ne: candidate.excludeId };

  return Exam.findOne(query).select("_id title startAt endAt").lean();
}

// IST time-only formatter for the end of a window, e.g. "11:30 pm". Start uses
// the full formatScheduledAt (date + time); end only needs the time since both
// ends share a date in the common case, keeping the range compact.
const IST_TIME_ONLY = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Builds the human-readable 409 message naming the conflicting quiz and its
// availability window, so the admin sees exactly which test blocks the slot —
// e.g. "Overlaps with 'Gujarat Police Final Practice Tests'
//       (08 Jun 2026, 6:01 pm – 11:30 pm)". Falls back gracefully if the
// conflict has no title/window.
function dailyOverlapMessage(clash: any): string {
  const title = clash?.title ? `'${clash.title}'` : "another daily test";
  const start = formatScheduledAt(clash?.startAt);
  const end =
    clash?.endAt && !Number.isNaN(new Date(clash.endAt).getTime())
      ? IST_TIME_ONLY.format(new Date(clash.endAt))
      : null;
  const window = start && end ? ` (${start} – ${end})` : start ? ` (from ${start})` : "";
  return `This daily test's time window overlaps with ${title}${window}. Pick a slot that starts after it ends.`;
}

function sendDailyOverlap(res: Response, clash: any) {
  return res
    .status(409)
    .json({ success: false, message: dailyOverlapMessage(clash), conflict: clash });
}

export const createExam = async (req: Request, res: Response) => {
  try {
    applyExamUpload(req);
    const data = createExamSchema.parse(req.body);

    const newStatus = mapStatusFlagToEnum(data.status);

    const clash = await findDailyOverlap({
      type: data.type,
      status: newStatus,
      startAt: data.startAt,
      endAt: data.endAt,
    });
    if (clash) return sendDailyOverlap(res, clash);

    const payload: any = {
      ...data,
      categoryId: data.categoryId || null,
      status: newStatus,
    };
    const exam = await Exam.create(payload);
    return res.status(201).json({ success: true, data: exam });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateExam = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    applyExamUpload(req);
    const data = updateExamSchema.parse(req.body);

    // Same no-overlap rule as createExam. The payload is partial, so resolve the
    // effective type/window by merging the update over the current doc, then look
    // for any OTHER daily test whose window overlaps it.
    const current = await Exam.findById(id).select("type startAt endAt status").lean();
    if (!current) return res.status(404).json({ success: false, message: "Exam not found." });
    const effectiveType = data.type ?? current.type;
    const effectiveStartAt = data.startAt ?? current.startAt;
    const effectiveEndAt = data.endAt ?? current.endAt;
    // status flag is only in the payload when the toggle is touched; otherwise
    // the test keeps its current status.
    const effectiveStatus =
      data.status !== undefined ? mapStatusFlagToEnum(data.status) : current.status;
    // Daily tests must keep a complete window even after a partial edit.
    if (effectiveType === ExamType.DAILY && (!effectiveStartAt || !effectiveEndAt))
      return res.status(400).json({
        success: false,
        message: "startAt and endAt are required for daily tests.",
      });
    // Overlap only matters between PUBLISHED daily tests — a draft neither
    // reserves a slot nor is blocked by one.
    const clash = await findDailyOverlap({
      type: effectiveType,
      status: effectiveStatus,
      startAt: effectiveStartAt,
      endAt: effectiveEndAt,
      excludeId: id,
    });
    if (clash) return sendDailyOverlap(res, clash);

    const set: any = { ...data };
    if (data.categoryId !== undefined) set.categoryId = data.categoryId || null;
    if (data.status !== undefined) set.status = mapStatusFlagToEnum(data.status);
    const exam = await Exam.findByIdAndUpdate(
      id,
      { $set: set },
      { new: true }
    );
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });
    return res.status(200).json({ success: true, data: exam });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteExam = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    await session.withTransaction(async () => {
      const qIds = await ExamQuestion.find({ examId: id }, { _id: 1 }, { session });
      const questionIds = qIds.map((q) => q._id);
      if (questionIds.length) {
        await ExamQuestionOption.deleteMany({ questionId: { $in: questionIds } }, { session });
      }
      await ExamQuestion.deleteMany({ examId: id }, { session });
      await ExamResultDetail.deleteMany({ examId: id }, { session });
      await ExamResult.deleteMany({ examId: id }, { session });
      await Exam.findByIdAndDelete(id, { session });
    });

    return res.status(200).json({ success: true, message: "Exam and related data deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const updateExamStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid exam id." });
    const { status } = req.body as { status: ExamStatus };
    if (!Object.values(ExamStatus).includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value." });
    }

    // Publishing via the toggle must obey the same daily-overlap rule as
    // create/update — otherwise a draft could be saved into an occupied window
    // and then published here, producing two overlapping live tests. Loading
    // the existing window lets us run the shared check before persisting.
    // Unpublishing (draft/archived) can never create a conflict, so the helper
    // short-circuits to null for any non-PUBLISHED target and we skip straight
    // to the write.
    if (status === ExamStatus.PUBLISHED) {
      const current = await Exam.findById(id).select("type startAt endAt").lean();
      if (!current) return res.status(404).json({ success: false, message: "Exam not found." });
      const clash = await findDailyOverlap({
        type: current.type,
        status,
        startAt: current.startAt,
        endAt: current.endAt,
        excludeId: id,
      });
      if (clash) return sendDailyOverlap(res, clash);
    }

    const exam = await Exam.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });
    return res.status(200).json({ success: true, data: exam });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderExams = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderExamsSchema.parse(req.body);
    const ops = orders
      .filter((o) => isObjectId(o.id))
      .map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } } }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await Exam.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Exam order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Questions ────────────────────────────────────────────────────────────────
// Options live in a separate collection. Correctness uses ExamQuestion.answer text match.

function validateAnswerAmongOptions(answer: string, options: { name: string }[]) {
  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  const match = options.find((o) => norm(o.name) === norm(answer));
  if (!match)
    return "The `answer` value must match one of the option `name`s.";
  return null;
}

export const getQuestions = async (req: Request, res: Response) => {
  try {
    const { examId, search, status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const filter: any = {};
    if (examId && isObjectId(examId)) filter.examId = examId;
    if (search) filter.title = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const skip = (pageNum - 1) * limitNum;

    const [questions, total] = await Promise.all([
      ExamQuestion.find(filter).sort({ orderBy: 1, createdAt: 1 }).skip(skip).limit(limitNum).lean(),
      ExamQuestion.countDocuments(filter),
    ]);

    const qIds = questions.map((q: any) => q._id);
    const options = await ExamQuestionOption.find({ questionId: { $in: qIds } })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();
    const optsByQuestion: Record<string, any[]> = {};
    options.forEach((o: any) => {
      (optsByQuestion[String(o.questionId)] ||= []).push(o);
    });
    const decorated = questions.map((q: any) => ({
      ...q,
      options: optsByQuestion[String(q._id)] || [],
    }));

    return res.status(200).json({
      success: true,
      data: decorated,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getQuestionById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });
    const q = await ExamQuestion.findById(id).lean();
    if (!q) return res.status(404).json({ success: false, message: "Question not found." });
    const options = await ExamQuestionOption.find({ questionId: id })
      .sort({ orderBy: 1, createdAt: 1 })
      .lean();
    return res.status(200).json({ success: true, data: { ...q, options } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Resolves the multipart "image-or-URL-or-clear" convention for question
// endpoints. Mutates req.body to the shape the Zod schema + downstream handlers
// expect. Returns a list of validation errors (e.g. missing @file:<i>) so the
// caller can short-circuit with 400.
type QuestionImageError = { message: string };
const coerceQuestionImages = (req: Request): QuestionImageError | null => {
  const body = req.body as Record<string, any>;

  // Parse options=JSON-string (multipart) into array.
  if (typeof body.options === "string") {
    const s = body.options.trim();
    if (s.startsWith("[")) {
      try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) body.options = parsed; } catch {}
    }
  }

  // Index uploaded files by fieldname. With upload.any(), req.files is an array.
  const files = (req.files as Express.MulterS3.File[] | undefined) ?? [];
  const filesByField = new Map<string, Express.MulterS3.File>();
  for (const f of files) filesByField.set(f.fieldname, f);

  // image / solutionImage: file present -> use URL; "" -> "" (handler treats
  // as clear); URL stays.
  for (const field of ["image", "solutionImage"] as const) {
    const f = filesByField.get(field);
    if (f) body[field] = (f as any).location;
  }

  // Normalize option.image "" to undefined so create-paths default to null
  // cleanly. Real clears on update are handled in updateQuestion.
  if (Array.isArray(body.options)) {
    for (const opt of body.options) {
      if (opt && typeof opt === "object" && opt.image === "") delete opt.image;
    }
  }

  // options[i].image: "@file:<i>" -> resolve from optionImage_<i>.
  if (Array.isArray(body.options)) {
    for (let i = 0; i < body.options.length; i++) {
      const opt = body.options[i];
      if (!opt || typeof opt !== "object") continue;
      if (typeof opt.image === "string" && opt.image.startsWith("@file:")) {
        const idx = opt.image.slice("@file:".length);
        const file = filesByField.get(`optionImage_${idx}`);
        if (!file)
          return { message: `Missing uploaded file for option ${idx} (expected field optionImage_${idx}).` };
        opt.image = (file as any).location;
      }
    }
  }

  return null;
};

export const createQuestion = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const coerceErr = coerceQuestionImages(req);
    if (coerceErr) return res.status(400).json({ success: false, message: coerceErr.message });
    const data = createQuestionSchema.parse(req.body);
    if (!isObjectId(data.examId)) {
      return res.status(400).json({ success: false, message: "Invalid examId." });
    }
    const exam = await Exam.findById(data.examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    const err = validateAnswerAmongOptions(data.answer, data.options);
    if (err) return res.status(400).json({ success: false, message: err });

    let created: any;
    await session.withTransaction(async () => {
      let nextOrder = data.orderBy;
      if (nextOrder === undefined) {
        const last = await ExamQuestion.findOne({ examId: data.examId })
          .sort({ orderBy: -1 })
          .select("orderBy")
          .session(session)
          .lean();
        nextOrder = (last?.orderBy ?? -1) + 1;
      }
      const [q] = await ExamQuestion.create(
        [
          {
            examId: data.examId,
            title: data.title,
            answer: data.answer,
            image: data.image ?? null,
            solutionText: data.solutionText ?? null,
            solutionImage: data.solutionImage ?? null,
            orderBy: nextOrder,
            status: data.status ?? true,
          },
        ],
        { session }
      );
      const optionDocs = data.options.map((o, idx) => ({
        questionId: q._id,
        name: o.name,
        image: o.image ?? null,
        orderBy: o.orderBy ?? idx,
      }));
      const insertedOptions = await ExamQuestionOption.insertMany(optionDocs, { session });
      await recomputeExamQuestionCount(data.examId, session);
      created = { ...q.toObject(), options: insertedOptions };
    });

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const bulkCreateQuestions = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const { examId, questions } = bulkCreateQuestionsSchema.parse(req.body);
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Invalid examId." });

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: "Exam not found." });

    for (const q of questions) {
      const err = validateAnswerAmongOptions(q.answer, q.options);
      if (err)
        return res.status(400).json({ success: false, message: `Question "${q.title.slice(0, 40)}": ${err}` });
    }

    const created: any[] = [];
    await session.withTransaction(async () => {
      const last = await ExamQuestion.findOne({ examId })
        .sort({ orderBy: -1 })
        .select("orderBy")
        .session(session)
        .lean();
      let cursor = (last?.orderBy ?? -1) + 1;
      for (const q of questions) {
        const orderBy = q.orderBy ?? cursor++;
        const [doc] = await ExamQuestion.create(
          [
            {
              examId,
              title: q.title,
              answer: q.answer,
              image: q.image ?? null,
              solutionText: q.solutionText ?? null,
              solutionImage: q.solutionImage ?? null,
              orderBy,
              status: q.status ?? true,
            },
          ],
          { session }
        );
        const optionDocs = q.options.map((o, idx) => ({
          questionId: doc._id,
          name: o.name,
          image: o.image ?? null,
          orderBy: o.orderBy ?? idx,
        }));
        const insertedOptions = await ExamQuestionOption.insertMany(optionDocs, { session });
        created.push({ ...doc.toObject(), options: insertedOptions });
      }
      await recomputeExamQuestionCount(examId, session);
    });
    return res.status(201).json({ success: true, data: created, count: created.length });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const updateQuestion = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });
    const coerceErr = coerceQuestionImages(req);
    if (coerceErr) return res.status(400).json({ success: false, message: coerceErr.message });
    const data = updateQuestionSchema.parse(req.body);

    // If both options + answer updated, validate match. If only answer, validate against existing options.
    if (data.options || data.answer !== undefined) {
      const options =
        data.options ??
        (await ExamQuestionOption.find({ questionId: id })
          .select("name")
          .lean());
      const answer =
        data.answer ??
        (await ExamQuestion.findById(id).select("answer").lean())?.answer ??
        "";
      const err = validateAnswerAmongOptions(answer, options as any);
      if (err) return res.status(400).json({ success: false, message: err });
    }

    // Snapshot pre-update image URLs so we can best-effort delete S3 objects
    // that get replaced or cleared after the transaction commits.
    const before = await ExamQuestion.findById(id).select("image solutionImage").lean();
    const beforeOptionImages: string[] = data.options
      ? ((await ExamQuestionOption.find({ questionId: id }).select("image").lean()) as any[])
          .map((o) => o?.image)
          .filter((u) => typeof u === "string" && u)
      : [];
    const orphanUrls: string[] = [];

    let updated: any;
    await session.withTransaction(async () => {
      const update: any = { ...data };
      delete update.options;

      // Empty-string semantics: "" means clear the stored image.
      const unset: Record<string, ""> = {};
      for (const field of ["image", "solutionImage"] as const) {
        if (update[field] === "") {
          delete update[field];
          unset[field] = "";
          const prev = (before as any)?.[field];
          if (typeof prev === "string" && prev) orphanUrls.push(prev);
        } else if (typeof update[field] === "string" && update[field]) {
          const prev = (before as any)?.[field];
          if (typeof prev === "string" && prev && prev !== update[field]) orphanUrls.push(prev);
        }
      }

      const mutation: any = { $set: update };
      if (Object.keys(unset).length) mutation.$unset = unset;
      const q = await ExamQuestion.findByIdAndUpdate(id, mutation, { new: true, session });
      if (!q) throw new Error("Question not found.");

      if (data.options) {
        await ExamQuestionOption.deleteMany({ questionId: id }, { session });
        const docs = data.options.map((o: any, idx: number) => ({
          questionId: id,
          name: o.name,
          image: o.image && o.image !== "" ? o.image : null,
          orderBy: o.orderBy ?? idx,
        }));
        await ExamQuestionOption.insertMany(docs, { session });
        // All old option-image URLs are candidates for cleanup, minus any that
        // are still referenced by the new option set.
        const stillUsed = new Set(
          data.options.map((o: any) => o.image).filter((u: any) => typeof u === "string" && u)
        );
        for (const url of beforeOptionImages) if (!stillUsed.has(url)) orphanUrls.push(url);
      }

      const options = await ExamQuestionOption.find({ questionId: id })
        .sort({ orderBy: 1 })
        .lean({ session } as any);
      // status may have flipped, which affects the count.
      if (data.status !== undefined) {
        await recomputeExamQuestionCount(q.examId, session);
      }
      updated = { ...q.toObject(), options };
    });

    // Best-effort S3 cleanup after the transaction commits. Failures are
    // swallowed so an S3 hiccup never fails a successful DB write.
    if (orphanUrls.length) {
      Promise.all(orphanUrls.map((u) => deleteFromS3FileUrl(u).catch(() => {}))).catch(() => {});
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.message === "Question not found.")
      return res.status(404).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const deleteQuestion = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid question id." });

    let found: any = null;
    await session.withTransaction(async () => {
      found = await ExamQuestion.findByIdAndDelete(id, { session });
      if (!found) return;
      await ExamQuestionOption.deleteMany({ questionId: id }, { session });
      await ExamResultDetail.deleteMany({ questionId: id }, { session });
      await recomputeExamQuestionCount(found.examId, session);
    });
    if (!found) return res.status(404).json({ success: false, message: "Question not found." });
    return res.status(200).json({ success: true, message: "Question deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const reorderQuestions = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderQuestionsSchema.parse(req.body);
    const ops = orders
      .filter((o) => isObjectId(o.id))
      .map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } } }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await ExamQuestion.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Question order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Submissions / Analytics ──────────────────────────────────────────────────

// GET /api/v1/admin/exams/:examId/submissions
export const getExamSubmissions = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = { examId };
    const [data, total] = await Promise.all([
      ExamResult.find(filter)
        .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
        .sort({ score: -1, updatedAt: 1 })
        .skip(skip)
        .limit(limitNum),
      ExamResult.countDocuments(filter),
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

// GET /api/v1/admin/exams/:examId/analytics
export const getExamAnalytics = async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId as string;
    if (!isObjectId(examId))
      return res.status(400).json({ success: false, message: "Invalid exam id." });

    const oid = new mongoose.Types.ObjectId(examId);

    const overall = await ExamResult.aggregate([
      { $match: { examId: oid } },
      {
        $group: {
          _id: null,
          totalCandidates: { $sum: 1 },
          avgScore: { $avg: "$score" },
          maxScore: { $max: "$score" },
          minScore: { $min: "$score" },
          avgAccuracy: {
            $avg: {
              $cond: [
                { $gt: ["$total", 0] },
                { $multiply: [{ $divide: ["$success", "$total"] }, 100] },
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalCandidates: 1,
          avgScore: { $round: ["$avgScore", 2] },
          maxScore: 1,
          minScore: 1,
          avgAccuracy: { $round: ["$avgAccuracy", 2] },
        },
      },
    ]);

    const perQuestion = await ExamResultDetail.aggregate([
      { $match: { examId: oid } },
      {
        $group: {
          _id: "$questionId",
          total: { $sum: 1 },
          correct: { $sum: { $cond: [{ $eq: ["$result", ExamResultType.TRUE] }, 1, 0] } },
          wrong: { $sum: { $cond: [{ $eq: ["$result", ExamResultType.FALSE] }, 1, 0] } },
          skipped: { $sum: { $cond: [{ $eq: ["$result", ExamResultType.SKIP] }, 1, 0] } },
        },
      },
      {
        $lookup: {
          from: "ws_exam_question",
          localField: "_id",
          foreignField: "_id",
          as: "question",
        },
      },
      { $unwind: { path: "$question", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          questionTitle: "$question.title",
          total: 1,
          correct: 1,
          wrong: 1,
          skipped: 1,
          accuracy: {
            $cond: [
              { $eq: ["$total", 0] },
              0,
              { $round: [{ $multiply: [{ $divide: ["$correct", "$total"] }, 100] }, 2] },
            ],
          },
        },
      },
      { $sort: { accuracy: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      data: { overall: overall[0] ?? null, perQuestion },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exams/results/:id — fetch one ExamResult with details
export const getResultById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid result id." });
    const result = await ExamResult.findById(id)
      .populate("customerId", "_id firstName lastName phoneNumber emailAddress")
      .populate("examId", "_id title type durationMinutes");
    if (!result) return res.status(404).json({ success: false, message: "Result not found." });
    const details = await ExamResultDetail.find({ examResultId: id }).lean();
    return res.status(200).json({ success: true, data: { result, details } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/v1/admin/exams/results/:id/invalidate — zero out a result (retains row)
export const invalidateResult = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid result id." });
    const result = await ExamResult.findByIdAndUpdate(
      id,
      { $set: { status: false, score: 0 } },
      { new: true }
    );
    if (!result) return res.status(404).json({ success: false, message: "Result not found." });
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/admin/exams/analytics/customer/:customerId — lifetime aggregates
export const getCustomerAnalytics = async (req: Request, res: Response) => {
  try {
    const customerId = req.params.customerId as string;
    if (!isObjectId(customerId))
      return res.status(400).json({ success: false, message: "Invalid customer id." });
    const analytics = await ExamResultDetailAnalytics.findOne({ customerId });
    return res.status(200).json({ success: true, data: analytics });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
