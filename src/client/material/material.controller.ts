import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { Material } from "../../models/course/Material.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";

const NEWLY_ADDED_DAYS = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function computeLeafCount(categoryId: Types.ObjectId | string): Promise<number> {
  const children = await MaterialCategory.find({ parent: categoryId, status: true })
    .select("_id")
    .lean();
  if (children.length === 0) {
    return Material.countDocuments({ materialCategoryId: categoryId, status: true });
  }
  const counts = await Promise.all(children.map((c) => computeLeafCount(c._id as any)));
  return counts.reduce((a, b) => a + b, 0);
}

async function hasNewlyAddedMaterial(categoryId: Types.ObjectId | string): Promise<boolean> {
  const cutoff = new Date(Date.now() - NEWLY_ADDED_DAYS * 24 * 60 * 60 * 1000);
  const children = await MaterialCategory.find({ parent: categoryId, status: true })
    .select("_id")
    .lean();
  if (children.length === 0) {
    const recent = await Material.exists({
      materialCategoryId: categoryId,
      status: true,
      createdAt: { $gt: cutoff },
    });
    return !!recent;
  }
  const results = await Promise.all(children.map((c) => hasNewlyAddedMaterial(c._id as any)));
  return results.some(Boolean);
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/client/materials/categories/:id/contents
 *
 * Drill-down for the material tree. Returns:
 *   - `subjects[]` — child categories (with count + isNewlyAdded decorations)
 *   - `materials[]` — leaf PDFs at this node
 *   - `breadcrumbs[]` — ancestor chain (root → current)
 */
export const getCategoryContents = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const current = await MaterialCategory.findOne({ _id: id, status: true }).lean();
    if (!current) return res.status(404).json({ success: false, message: "Category not found." });

    const children = await MaterialCategory.find({ parent: id, status: true })
      .select("_id title image order")
      .sort({ order: 1, title: 1 })
      .lean();

    const subjects = await Promise.all(
      children.map(async (c) => {
        const [grandChildren, count, isNewlyAdded] = await Promise.all([
          MaterialCategory.countDocuments({ parent: c._id, status: true }),
          computeLeafCount(c._id as any),
          hasNewlyAddedMaterial(c._id as any),
        ]);
        return {
          ...c,
          havingChildDirectory: grandChildren > 0,
          count,
          isNewlyAdded,
        };
      })
    );

    const materials = await Material.find({ materialCategoryId: id, status: true })
      .select("_id title description thumbnail file directLink fileSize language isPreview order createdAt")
      .sort({ order: 1, createdAt: -1 });

    let breadcrumbs: any[] = [];
    if (current.ancestors && current.ancestors.length) {
      const ancestors = await MaterialCategory.find({ _id: { $in: current.ancestors } })
        .select("_id title")
        .lean();
      const ancMap = new Map(ancestors.map((a) => [a._id.toString(), a]));
      breadcrumbs = current.ancestors
        .map((aid: any) => ancMap.get(aid.toString()))
        .filter(Boolean);
    }
    breadcrumbs.push({ _id: current._id, title: current.title });

    return res.status(200).json({
      success: true,
      data: { current: { _id: current._id, title: current.title, image: current.image }, breadcrumbs, subjects, materials },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/client/materials/:id
 * Single material detail (useful for deep links).
 */
export const getMaterialDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid material id." });

    const material = await Material.findOne({ _id: id, status: true }).populate(
      "materialCategoryId",
      "_id title"
    );
    if (!material) return res.status(404).json({ success: false, message: "Material not found." });

    return res.status(200).json({ success: true, data: material });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/client/materials/:id/track-download
 * Increments the download counter. Fire-and-forget from the client.
 */
export const trackDownload = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid material id." });

    const material = await Material.findByIdAndUpdate(
      id,
      { $inc: { downloadCount: 1 } },
      { new: true }
    ).select("_id downloadCount");
    if (!material) return res.status(404).json({ success: false, message: "Material not found." });

    return res.status(200).json({ success: true, data: material });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/client/materials/recent
 * Newly added materials (last N days, default 10) across all active categories.
 */
export const getRecentMaterials = async (req: Request, res: Response) => {
  try {
    const days = Math.max(parseInt((req.query.days as string) || "10", 10), 1);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10), 1), 100);

    const materials = await Material.find({ status: true, createdAt: { $gt: cutoff } })
      .populate("materialCategoryId", "_id title")
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({ success: true, data: materials });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
