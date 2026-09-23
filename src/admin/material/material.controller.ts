import { Request, Response } from "express";
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
import * as adminMaterial from "../../modules/admin-material/admin-material.service";
import { parseListQuery } from "../../utils/listQuery";

// ─── Categories ───────────────────────────────────────────────────────────────

export const listCategories = async (req: Request, res: Response) => {
  try {
    const { parent, search, status, tree } = req.query as Record<string, string>;
    const statusBool = status === "true" ? true : status === "false" ? false : undefined;

    if (tree === "true") {
      const data = await adminMaterial.listCategoriesTree(statusBool);
      return res.status(200).json({ success: true, data });
    }
    const { page = "1", limit = "20", sortBy, sortOrder } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const { data, total } = await adminMaterial.listCategories({ parent, search, status: statusBool, sortBy, sortOrder, page: pageNum, limit: limitNum });
    return res.status(200).json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const data = await adminMaterial.getCategoryById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = createMaterialCategorySchema.parse(req.body);
    // ⚠ childCategoryIds[] + ancestors[] are Mongo-only (single-parent SQL) — dropped.
    const created = await adminMaterial.createCategory(data);
    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = updateMaterialCategorySchema.parse(req.body);
    // ⚠ childCategoryIds[] reparenting + ancestors[] are Mongo-only — dropped.
    const res2 = await adminMaterial.updateCategory(numId, data);
    if (res2 === "not_found") return res.status(404).json({ success: false, message: "Category not found." });
    if (res2 === "self_parent") return res.status(400).json({ success: false, message: "Category cannot be its own parent." });
    return res.status(200).json({ success: true, data: res2 });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const res2 = await adminMaterial.deleteCategory(numId);
    if (res2 === "not_found") return res.status(404).json({ success: false, message: "Category not found." });
    if (res2 === "has_children") return res.status(400).json({ success: false, message: "Category has sub-categories. Delete or reassign them first." });
    if (res2 === "has_materials") return res.status(400).json({ success: false, message: "Category has materials. Delete or reassign them first." });
    return res.status(200).json({ success: true, message: "Category deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleCategoryStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const res2 = await adminMaterial.toggleCategoryStatus(numId);
    if (res2 === "not_found") return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data: res2 });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderCategories = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderCategoriesSchema.parse(req.body);
    const res2 = await adminMaterial.reorderCategories(orders);
    if (res2 === "dup") return res.status(400).json({ success: false, message: "Duplicate order values." });
    if (res2 === "no_valid") return res.status(400).json({ success: false, message: "No valid ids." });
    return res.status(200).json({ success: true, message: "Category order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Deep-clone a category subtree + its materials. Single-parent SQL tree walk over
// `parent` (the Mongo ancestors[] DAG is not used); logic lives in the
// admin-material SQL module.
export const duplicateCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const data = await adminMaterial.duplicateCategory(numId);
    if (data === "not_found") return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Category detail sub-resources
export const getCategoryCourses = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
    const { data, pagination } = await adminMaterial.getCategoryCourses(numId, { search, page, limit, skip, take: limit });
    return res.status(200).json({ success: true, data, pagination });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryLinkedProducts = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
    const { data, pagination } = await adminMaterial.getCategoryLinkedProducts(numId, { search, page, limit, skip, take: limit });
    return res.status(200).json({ success: true, data, pagination });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCategoryMaterials = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { page = "1", limit = "50", search } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 50, 1);

    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid category id." });
    const { data, total } = await adminMaterial.getCategoryMaterials(numId, pageNum, limitNum, search);
    return res.status(200).json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
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
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);

    // language/isPreview filters are Mongo-only (no SQL columns) → ignored.
    const { data, total } = await adminMaterial.listMaterials({
      search,
      materialCategoryId: materialCategoryId ? adminMaterial.parseMaterialId(materialCategoryId) ?? undefined : undefined,
      status: status === "true" ? true : status === "false" ? false : undefined,
      page: pageNum, limit: limitNum,
    });
    return res.status(200).json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMaterialById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid material id." });
    const data = await adminMaterial.getMaterialById(numId);
    if (!data) return res.status(404).json({ success: false, message: "Material not found." });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

function applyUploadedFile(req: Request) {
  const file = req.file as any;
  if (file?.location) {
    req.body.file = file.location;
    // Keep the user's original filename (e.g. "Test 151 - Class 3.pdf") separate
    // from the generated storage key in `file`. Caller-supplied fileName wins.
    if (file.originalname && req.body.fileName == null) req.body.fileName = file.originalname;
    if (file.size != null && req.body.fileSize == null) req.body.fileSize = file.size;
    if (file.mimetype && !req.body.fileMime) req.body.fileMime = file.mimetype;
    // Persist the admin's original filename so the FE can display it instead of
    // the server-generated key in the stored URL.
    if (file.originalname && !req.body.originalName) req.body.originalName = file.originalname;
  }
  if (typeof req.body.fileSize === "string") req.body.fileSize = Number(req.body.fileSize);
  if (typeof req.body.order === "string") req.body.order = Number(req.body.order);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  if (typeof req.body.isPreview === "string") req.body.isPreview = req.body.isPreview === "true";
  // Arrives as "true"/"false" in multipart (PDF upload) requests — coerce it
  // the same way as isPreview/status so the Zod boolean validator passes.
  if (typeof req.body.isPaid === "string") req.body.isPaid = req.body.isPaid === "true";
}

export const createMaterial = async (req: Request, res: Response) => {
  try {
    applyUploadedFile(req);
    const data = createMaterialSchema.parse(req.body);
    // Mongo-only fields (description/thumbnail/fileSize/fileMime/language/
    // isPreview/isPaid/downloadCount) are dropped — no SQL columns.
    const res2 = await adminMaterial.createMaterial(data as any);
    if (res2 === "category") return res.status(404).json({ success: false, message: "Category not found." });
    return res.status(201).json({ success: true, data: res2 });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    applyUploadedFile(req);
    const data = updateMaterialSchema.parse(req.body);
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid material id." });
    const res2 = await adminMaterial.updateMaterial(numId, data as any);
    if (res2 === "not_found") return res.status(404).json({ success: false, message: "Material not found." });
    if (res2 === "category") return res.status(400).json({ success: false, message: "Invalid materialCategoryId." });
    return res.status(200).json({ success: true, data: res2 });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteMaterial = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid material id." });
    if (!(await adminMaterial.deleteMaterial(numId))) return res.status(404).json({ success: false, message: "Material not found." });
    return res.status(200).json({ success: true, message: "Material deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleMaterialStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const numId = adminMaterial.parseMaterialId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid material id." });
    const res2 = await adminMaterial.toggleMaterialStatus(numId);
    if (res2 === "not_found") return res.status(404).json({ success: false, message: "Material not found." });
    return res.status(200).json({ success: true, data: res2 });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const reorderMaterials = async (req: Request, res: Response) => {
  try {
    const { materialCategoryId, orders } = reorderMaterialsSchema.parse(req.body);
    const catId = adminMaterial.parseMaterialId(materialCategoryId);
    if (!catId) return res.status(400).json({ success: false, message: "Invalid materialCategoryId." });
    const res2 = await adminMaterial.reorderMaterials(catId, orders);
    if (res2 === "dup") return res.status(400).json({ success: false, message: "Duplicate order values." });
    if (res2 === "no_valid") return res.status(400).json({ success: false, message: "No valid ids." });
    return res.status(200).json({ success: true, message: "Material order updated." });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkStatus = async (req: Request, res: Response) => {
  try {
    const { ids, status } = bulkStatusSchema.parse(req.body);
    const res2 = await adminMaterial.bulkStatus(ids, status);
    if (res2 === "no_valid") return res.status(400).json({ success: false, message: "No valid ids." });
    return res.status(200).json({ success: true, modified: res2.modified });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkDelete = async (req: Request, res: Response) => {
  try {
    const { ids } = bulkDeleteSchema.parse(req.body);
    const res2 = await adminMaterial.bulkDelete(ids);
    if (res2 === "no_valid") return res.status(400).json({ success: false, message: "No valid ids." });
    return res.status(200).json({ success: true, deleted: res2.deleted });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};
