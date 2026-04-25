import { Request, Response } from "express";
import mongoose from "mongoose";
import { Material } from "../../models/course/Material.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Course } from "../../models/course/Course.model";
import {
  createMaterialCategorySchema,
  updateMaterialCategorySchema,
  reorderCategoriesSchema,
  createMaterialSchema,
  updateMaterialSchema,
  reorderMaterialsSchema,
  bulkStatusSchema,
  bulkDeleteSchema,
} from "./material.validation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildAncestors(parentId?: string | null): Promise<mongoose.Types.ObjectId[]> {
  if (!parentId) return [];
  if (!mongoose.Types.ObjectId.isValid(parentId)) return [];
  const parent = await MaterialCategory.findById(parentId).select("_id ancestors").lean();
  if (!parent) return [];
  return [...(parent.ancestors || []), parent._id as mongoose.Types.ObjectId];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Categories ───────────────────────────────────────────────────────────────

export const listCategories = async (req: Request, res: Response) => {
  try {
    const { parent, search, status, tree } = req.query as Record<string, string>;

    if (tree === "true") {
      const all = await MaterialCategory.find(
        status === "true" || status === "false" ? { status: status === "true" } : {}
      )
        .sort({ order: 1, title: 1 })
        .lean();
      const byParent = new Map<string, any[]>();
      all.forEach((c) => {
        const k = c.parent ? c.parent.toString() : "root";
        if (!byParent.has(k)) byParent.set(k, []);
        byParent.get(k)!.push(c);
      });
      const attach = (node: any) => {
        const children = byParent.get(node._id.toString()) ?? [];
        node.children = children.map(attach);
        return node;
      };
      const roots = (byParent.get("root") ?? []).map(attach);
      return res.status(200).json({ success: true, data: roots });
    }

    const filter: any = {};
    if (parent === "root" || parent === "null") filter.parent = null;
    else if (parent && mongoose.Types.ObjectId.isValid(parent)) filter.parent = parent;
    if (search) filter.title = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const categories = await MaterialCategory.find(filter).sort({ order: 1, title: 1 });
    return res.status(200).json({ success: true, data: categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const cat = await MaterialCategory.findById(id);
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data: cat });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = createMaterialCategorySchema.parse(req.body);
    const ancestors = await buildAncestors(data.parent ?? null);
    const cat = await MaterialCategory.create({
      ...data,
      parent: data.parent ?? null,
      slug: data.slug || slugify(data.title),
      ancestors,
    });
    return res.status(201).json({ success: true, data: cat });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = updateMaterialCategorySchema.parse(req.body);
    const update: any = { ...data };
    if (data.parent !== undefined) {
      if (data.parent === id)
        return res.status(400).json({ success: false, message: "Category cannot be its own parent." });
      update.parent = data.parent || null;
      update.ancestors = await buildAncestors(data.parent);
    }
    if (data.title && !data.slug) update.slug = slugify(data.title);
    const cat = await MaterialCategory.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data: cat });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const childCount = await MaterialCategory.countDocuments({ parent: id });
    if (childCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Category has sub-categories. Delete or reassign them first.",
      });
    }
    const materialCount = await Material.countDocuments({ materialCategoryId: id });
    if (materialCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Category has materials. Delete or reassign them first.",
      });
    }
    const cat = await MaterialCategory.findByIdAndDelete(id);
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, message: "Category deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleCategoryStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const cat = await MaterialCategory.findById(id).select("status");
    if (!cat) return res.status(404).json({ success: false, message: "Category not found." });
    cat.status = !cat.status;
    await cat.save();
    return res.status(200).json({ success: true, data: { status: cat.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderCategories = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderCategoriesSchema.parse(req.body);
    const values = new Set(orders.map((o) => o.order));
    if (values.size !== orders.length)
      return res.status(400).json({ success: false, message: "Duplicate order values." });
    const ops = orders
      .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
      .map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { order: o.order } } } }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await MaterialCategory.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Category order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Category detail sub-resources
export const getCategoryCourses = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const courses = await Course.find({ "materialCategories.category": id })
      .select("_id name image level status");
    return res.status(200).json({ success: true, data: courses });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryMaterials = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const { page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 50, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Material.find({ materialCategoryId: id })
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Material.countDocuments({ materialCategoryId: id }),
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

// ─── Materials (leaf files) ───────────────────────────────────────────────────

export const listMaterials = async (req: Request, res: Response) => {
  try {
    const {
      search,
      materialCategoryId,
      status,
      language,
      isPreview,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const filter: any = {};
    if (search) filter.title = { $regex: search, $options: "i" };
    if (materialCategoryId && mongoose.Types.ObjectId.isValid(materialCategoryId))
      filter.materialCategoryId = materialCategoryId;
    if (status === "true" || status === "false") filter.status = status === "true";
    if (language) filter.language = language;
    if (isPreview === "true" || isPreview === "false") filter.isPreview = isPreview === "true";

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      Material.find(filter)
        .populate("materialCategoryId", "_id title")
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Material.countDocuments(filter),
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

export const getMaterialById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid material id." });
    const m = await Material.findById(id).populate("materialCategoryId", "_id title");
    if (!m) return res.status(404).json({ success: false, message: "Material not found." });
    return res.status(200).json({ success: true, data: m });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createMaterial = async (req: Request, res: Response) => {
  try {
    const data = createMaterialSchema.parse(req.body);
    if (!mongoose.Types.ObjectId.isValid(data.materialCategoryId))
      return res.status(400).json({ success: false, message: "Invalid materialCategoryId." });

    const category = await MaterialCategory.findById(data.materialCategoryId);
    if (!category) return res.status(404).json({ success: false, message: "Category not found." });

    const material = await Material.create(data);
    return res.status(201).json({ success: true, data: material });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid material id." });
    const data = updateMaterialSchema.parse(req.body);
    if (
      data.materialCategoryId &&
      !mongoose.Types.ObjectId.isValid(data.materialCategoryId)
    )
      return res.status(400).json({ success: false, message: "Invalid materialCategoryId." });

    const material = await Material.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!material) return res.status(404).json({ success: false, message: "Material not found." });
    return res.status(200).json({ success: true, data: material });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid material id." });
    const m = await Material.findByIdAndDelete(id);
    if (!m) return res.status(404).json({ success: false, message: "Material not found." });
    return res.status(200).json({ success: true, message: "Material deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleMaterialStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid material id." });
    const m = await Material.findById(id).select("status");
    if (!m) return res.status(404).json({ success: false, message: "Material not found." });
    m.status = !m.status;
    await m.save();
    return res.status(200).json({ success: true, data: { status: m.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderMaterials = async (req: Request, res: Response) => {
  try {
    const { materialCategoryId, orders } = reorderMaterialsSchema.parse(req.body);
    if (!mongoose.Types.ObjectId.isValid(materialCategoryId))
      return res.status(400).json({ success: false, message: "Invalid materialCategoryId." });

    const values = new Set(orders.map((o) => o.order));
    if (values.size !== orders.length)
      return res.status(400).json({ success: false, message: "Duplicate order values." });

    const ops = orders
      .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
      .map((o) => ({
        updateOne: {
          filter: { _id: o.id, materialCategoryId },
          update: { $set: { order: o.order } },
        },
      }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await Material.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Material order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkStatus = async (req: Request, res: Response) => {
  try {
    const { ids, status } = bulkStatusSchema.parse(req.body);
    const validIds = ids.filter((i) => mongoose.Types.ObjectId.isValid(i));
    if (!validIds.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    const r = await Material.updateMany({ _id: { $in: validIds } }, { $set: { status } });
    return res.status(200).json({ success: true, modified: r.modifiedCount });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDelete = async (req: Request, res: Response) => {
  try {
    const { ids } = bulkDeleteSchema.parse(req.body);
    const validIds = ids.filter((i) => mongoose.Types.ObjectId.isValid(i));
    if (!validIds.length)
      return res.status(400).json({ success: false, message: "No valid ids." });
    const r = await Material.deleteMany({ _id: { $in: validIds } });
    return res.status(200).json({ success: true, deleted: r.deletedCount });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};
