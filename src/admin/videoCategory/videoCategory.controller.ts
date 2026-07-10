import { Request, Response } from "express";
import {
  createVideoCategorySchema,
  updateVideoCategorySchema,
  listQuerySchema,
  categoryCoursesQuerySchema,
  categoryVideosQuerySchema,
} from "./videoCategory.validation";
import * as vcat from "../../modules/admin-master/admin-master.service";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

const buildMeta = (page: number, per_page: number, total: number) => ({
  page,
  per_page,
  total,
  totalPages: Math.ceil(total / per_page),
});

// GET /
export const listVideoCategories = async (req: Request, res: Response) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { search, status, educatorId, page, per_page, limit, sort_by, sort_dir } = parsed.data;
    const pageSize = limit ?? per_page; // `limit` (picker page-size) takes precedence

    const { items, total } = await vcat.fullVcList({ search, status, educatorId, page, per_page: pageSize, sort_by, sort_dir });
    return res.status(200).json({ success: true, data: { items, pagination: { page, per_page: pageSize, total } } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /pre-requisites
export const getVideoCategoryPreRequisites = async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, data: await vcat.fullVcPreRequisites() });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /:id
export const getVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = vcat.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const data = await vcat.fullVcGet(numId);
    if (!data) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /:id/courses — paginated, searchable courses linked to this video category.
export const listVideoCategoryCourses = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = vcat.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    if (!(await vcat.fullVcCategoryExists(numId))) return res.status(404).json({ success: false, message: "Video Category not found" });
    const parsed = categoryCoursesQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(422).json({ success: false, message: "Validation failed", errors: formatZodErrors(parsed.error.issues) });
    const { search, status, page, per_page } = parsed.data;
    const { items, total } = await vcat.listCategoryCourses(numId, { search, status, page, per_page });
    return res.status(200).json({ success: true, data: { items, meta: buildMeta(page, per_page, total) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /:id/videos — paginated, searchable videos belonging to this video category.
export const listVideoCategoryVideos = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = vcat.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    if (!(await vcat.fullVcCategoryExists(numId))) return res.status(404).json({ success: false, message: "Video Category not found" });
    const parsed = categoryVideosQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(422).json({ success: false, message: "Validation failed", errors: formatZodErrors(parsed.error.issues) });
    const { search, status, platform, page, per_page } = parsed.data;
    const { items, total } = await vcat.listCategoryVideos(numId, { search, status, platform, page, per_page });
    return res.status(200).json({ success: true, data: { items, meta: buildMeta(page, per_page, total) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST / (multipart)
export const createVideoCategory = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    const parsed = createVideoCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const data = parsed.data;

    if (!data.image) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: { image: "Image is required" },
      });
    }

    const r = await vcat.fullVcCreate(data);
    if (!r.ok) {
      if (r.reason === "slug") return res.status(409).json({ success: false, message: "Slug already exists" });
      if (r.reason === "child") return res.status(422).json({ success: false, message: "One or more childCategoryIds are invalid" });
      return res.status(422).json({ success: false, message: "Invalid educatorId" });
    }
    return res.status(201).json({ success: true, message: "Video Category created successfully", data: r.data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /:id (multipart)
export const updateVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const file = req.file as any;
    if (file?.location) req.body.image = file.location;

    const parsed = updateVideoCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const data = parsed.data;

    const numId = vcat.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const r = await vcat.fullVcUpdate(numId, data);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Video Category not found" });
    if (r === "slug") return res.status(409).json({ success: false, message: "Slug already exists" });
    if (r === "educator") return res.status(422).json({ success: false, message: "Invalid educatorId" });
    if (r === "child") return res.status(422).json({ success: false, message: "One or more childCategoryIds are invalid" });
    return res.status(200).json({ success: true, message: "Video Category updated successfully", data: r });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /:id
export const deleteVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = vcat.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const r = await vcat.fullVcDelete(numId);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Video Category not found" });
    if (r === "in_use") return res.status(409).json({ success: false, message: "Video Category is in use by videos or other categories and cannot be deleted" });
    return res.status(200).json({ success: true, message: "Video Category deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /:id/duplicate
export const duplicateVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = vcat.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const r = await vcat.fullVcDuplicate(numId);
    if (r === "not_found") return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data: r });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /:id/status
export const toggleVideoCategoryStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const numId = vcat.parseMasterId(id);
    if (!numId) return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    const s = await vcat.fullVcToggle(numId);
    if (s === null) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data: { status: s } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
