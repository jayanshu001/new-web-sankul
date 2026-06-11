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
import { buildRegexCondition } from "../../utils/searchFilter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildAncestors(parentId?: string | null): Promise<mongoose.Types.ObjectId[]> {
  if (!parentId) return [];
  if (!mongoose.Types.ObjectId.isValid(parentId)) return [];
  const parent = await MaterialCategory.findById(parentId).select("_id ancestors").lean();
  if (!parent) return [];
  return [...(parent.ancestors || []), parent._id as mongoose.Types.ObjectId];
}

type AttachError = { status: number; message: string };

async function attachChildrenToParent(
  parentId: mongoose.Types.ObjectId,
  rawChildIds: string[] | undefined,
  session?: mongoose.ClientSession
): Promise<AttachError | null> {
  if (!rawChildIds || rawChildIds.length === 0) return null;

  const uniqueIds = Array.from(new Set(rawChildIds.map(String)));
  const parentIdStr = String(parentId);

  if (uniqueIds.some((id) => id === parentIdStr)) {
    return { status: 422, message: "A category cannot be its own child" };
  }

  const parent = await MaterialCategory.findById(parentId)
    .select("_id ancestors")
    .session(session ?? null)
    .lean();
  if (!parent) return { status: 404, message: "Parent category not found" };

  const parentAncestors = (parent.ancestors || []).map((a) => String(a));
  if (uniqueIds.some((id) => parentAncestors.includes(id))) {
    return {
      status: 422,
      message: "Cycle detected: one of the selected categories is an ancestor of this category",
    };
  }

  const children = await MaterialCategory.find({ _id: { $in: uniqueIds } })
    .select("_id ancestors parent")
    .session(session ?? null)
    .lean();
  if (children.length !== uniqueIds.length) {
    return { status: 422, message: "One or more childCategoryIds are invalid" };
  }

  const newAncestorsForChild = [...(parent.ancestors || []), parent._id as mongoose.Types.ObjectId];
  const newAncestorsStr = newAncestorsForChild.map((a) => String(a));

  for (const child of children) {
    const oldAncestors = (child.ancestors || []).map((a) => String(a));
    const oldPrefixForDescendants = [...oldAncestors, String(child._id)];

    // 0) Detach from the previous parent's childCategoryIds, if any.
    if (child.parent && String(child.parent) !== parentIdStr) {
      await MaterialCategory.updateOne(
        { _id: child.parent },
        { $pull: { childCategoryIds: child._id } },
        { session }
      );
    }

    // 1) Update the child itself.
    await MaterialCategory.updateOne(
      { _id: child._id },
      { $set: { parent: parent._id, ancestors: newAncestorsForChild } },
      { session }
    );

    // 1b) Mirror the relationship on the new parent's childCategoryIds.
    await MaterialCategory.updateOne(
      { _id: parent._id },
      { $addToSet: { childCategoryIds: child._id } },
      { session }
    );

    // 2) Rewrite ancestors on all descendants of this child.
    // Descendants are documents whose `ancestors` starts with oldPrefixForDescendants.
    const descendants = await MaterialCategory.find({ ancestors: child._id })
      .select("_id ancestors")
      .session(session ?? null)
      .lean();

    for (const d of descendants) {
      const oldAnc = (d.ancestors || []).map((a) => String(a));
      // Find the index of `child._id` and replace everything up to and including it
      // with newAncestorsForChild + child._id.
      const idx = oldAnc.indexOf(String(child._id));
      if (idx === -1) continue;
      const tail = oldAnc.slice(idx + 1);
      const rewritten = [
        ...newAncestorsStr,
        String(child._id),
        ...tail,
      ].map((s) => new mongoose.Types.ObjectId(s));
      await MaterialCategory.updateOne(
        { _id: d._id },
        { $set: { ancestors: rewritten } },
        { session }
      );
    }
  }

  return null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function nextAvailableCopyTitle(
  baseTitle: string,
  parent: mongoose.Types.ObjectId | null
): Promise<string> {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = `${baseTitle} (Copy`;
  const regex = new RegExp(`^${escape(base)}(?:\\s(\\d+))?\\)$`);
  const siblings = await MaterialCategory.find({
    parent: parent ?? null,
    title: { $regex: `^${escape(base)}` },
  })
    .select("title")
    .lean();
  const taken = new Set<number>();
  for (const s of siblings) {
    const m = (s.title || "").match(regex);
    if (!m) continue;
    taken.add(m[1] ? parseInt(m[1], 10) : 1);
  }
  if (!taken.has(1)) return `${baseTitle} (Copy)`;
  let n = 2;
  while (taken.has(n)) n++;
  return `${baseTitle} (Copy ${n})`;
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
    {
      const c = buildRegexCondition(search);
      if (c) filter.title = c;
    }
    if (status === "true" || status === "false") filter.status = status === "true";

    const { page = "1", limit = "20", sortBy, sortOrder } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const sort: any =
      sortBy === "order" || sortBy === "title" || sortBy === "createdAt"
        ? { [sortBy]: sortOrder === "desc" ? -1 : 1, title: 1 }
        : { order: 1, title: 1 };

    const [data, total] = await Promise.all([
      MaterialCategory.find(filter).sort(sort).skip(skip).limit(limitNum),
      MaterialCategory.countDocuments(filter),
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
  const session = await mongoose.startSession();
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = createMaterialCategorySchema.parse(req.body);
    const ancestors = await buildAncestors(data.parent ?? null);

    let createdId: mongoose.Types.ObjectId | null = null;
    let attachErr: AttachError | null = null;

    await session.withTransaction(async () => {
      const { childCategoryIds, ...catFields } = data;
      const [cat] = await MaterialCategory.create(
        [
          {
            ...catFields,
            parent: data.parent ?? null,
            slug: data.slug || slugify(data.title),
            ancestors,
          },
        ],
        { session }
      );
      createdId = cat._id as mongoose.Types.ObjectId;

      // Mirror the parent → child link.
      if (cat.parent) {
        await MaterialCategory.updateOne(
          { _id: cat.parent },
          { $addToSet: { childCategoryIds: cat._id } },
          { session }
        );
      }

      attachErr = await attachChildrenToParent(createdId, childCategoryIds, session);
      if (attachErr) throw new Error("__attach_abort__");
    });

    if (attachErr) {
      return res.status(attachErr.status).json({ success: false, message: attachErr.message });
    }

    const cat = await MaterialCategory.findById(createdId);
    return res.status(201).json({ success: true, data: cat });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.message === "__attach_abort__") {
      return res.status(500).json({ success: false, message: "Failed to attach child categories" });
    }
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    const data = updateMaterialCategorySchema.parse(req.body);
    const { childCategoryIds, ...catFields } = data;
    const update: any = { ...catFields };
    let oldParentId: mongoose.Types.ObjectId | null = null;
    let parentChanged = false;
    if (data.parent !== undefined) {
      if (data.parent === id)
        return res.status(400).json({ success: false, message: "Category cannot be its own parent." });
      const existing = await MaterialCategory.findById(id).select("parent");
      if (!existing) return res.status(404).json({ success: false, message: "Category not found." });
      oldParentId = (existing.parent as mongoose.Types.ObjectId | null) ?? null;
      update.parent = data.parent || null;
      update.ancestors = await buildAncestors(data.parent);
      parentChanged = String(oldParentId ?? "") !== String(update.parent ?? "");
    }
    if (data.title && !data.slug) update.slug = slugify(data.title);

    let notFound = false;
    let attachErr: AttachError | null = null;

    await session.withTransaction(async () => {
      const cat = await MaterialCategory.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true, session }
      );
      if (!cat) {
        notFound = true;
        throw new Error("__not_found__");
      }

      // Keep both sides of the relationship in sync when the parent changes.
      if (parentChanged) {
        if (oldParentId) {
          await MaterialCategory.updateOne(
            { _id: oldParentId },
            { $pull: { childCategoryIds: cat._id } },
            { session }
          );
        }
        if (cat.parent) {
          await MaterialCategory.updateOne(
            { _id: cat.parent },
            { $addToSet: { childCategoryIds: cat._id } },
            { session }
          );
        }
      }

      attachErr = await attachChildrenToParent(
        cat._id as mongoose.Types.ObjectId,
        childCategoryIds,
        session
      );
      if (attachErr) throw new Error("__attach_abort__");
    });

    if (notFound) return res.status(404).json({ success: false, message: "Category not found." });
    if (attachErr) {
      return res.status(attachErr.status).json({ success: false, message: attachErr.message });
    }

    const fresh = await MaterialCategory.findById(id);
    return res.status(200).json({ success: true, data: fresh });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.message === "__not_found__") {
      return res.status(404).json({ success: false, message: "Category not found." });
    }
    if (error.message === "__attach_abort__") {
      return res.status(500).json({ success: false, message: "Failed to attach child categories" });
    }
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
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
    if (cat.parent) {
      await MaterialCategory.updateOne(
        { _id: cat.parent },
        { $pull: { childCategoryIds: cat._id } }
      );
    }
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

export const duplicateCategory = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid category id." });

    const source = await MaterialCategory.findById(id).lean();
    if (!source) return res.status(404).json({ success: false, message: "Category not found." });

    let rootId: mongoose.Types.ObjectId | null = null;
    let rootTitle = "";
    const counts = { subCategories: 0, materials: 0 };

    await session.withTransaction(async () => {
      const newTopTitle = await nextAvailableCopyTitle(source.title, source.parent ?? null);
      rootTitle = newTopTitle;

      const idMap = new Map<string, mongoose.Types.ObjectId>();

      // Clone root
      const [rootDoc] = await MaterialCategory.create(
        [
          {
            title: newTopTitle,
            slug: slugify(newTopTitle),
            image: source.image ?? null,
            parent: source.parent ?? null,
            ancestors: source.ancestors ?? [],
            order: source.order ?? 0,
            status: source.status ?? true,
          },
        ],
        { session }
      );
      rootId = rootDoc._id as mongoose.Types.ObjectId;
      idMap.set(String(source._id), rootId);

      // BFS over descendants
      const queue: mongoose.Types.ObjectId[] = [source._id as mongoose.Types.ObjectId];
      while (queue.length) {
        const parentOldId = queue.shift()!;
        const children = await MaterialCategory.find({ parent: parentOldId })
          .session(session)
          .lean();
        for (const child of children) {
          const newParentId = idMap.get(String(parentOldId))!;
          const newAncestorsAtParent = await MaterialCategory.findById(newParentId)
            .session(session)
            .select("ancestors")
            .lean();
          const [childDoc] = await MaterialCategory.create(
            [
              {
                title: child.title,
                slug: child.slug ?? slugify(child.title),
                image: child.image ?? null,
                parent: newParentId,
                ancestors: [...(newAncestorsAtParent?.ancestors ?? []), newParentId],
                order: child.order ?? 0,
                status: child.status ?? true,
              },
            ],
            { session }
          );
          idMap.set(String(child._id), childDoc._id as mongoose.Types.ObjectId);
          counts.subCategories += 1;
          queue.push(child._id as mongoose.Types.ObjectId);
        }
      }

      // Clone materials across all mapped categories
      const oldCategoryIds = Array.from(idMap.keys()).map((s) => new mongoose.Types.ObjectId(s));
      const materials = await Material.find({ materialCategoryId: { $in: oldCategoryIds } })
        .session(session)
        .lean();
      if (materials.length) {
        const clones = materials.map((m) => ({
          materialCategoryId: idMap.get(String(m.materialCategoryId))!,
          title: m.title,
          description: m.description,
          file: m.file,
          directLink: m.directLink,
          thumbnail: m.thumbnail,
          fileSize: m.fileSize,
          fileMime: m.fileMime,
          language: m.language,
          isPreview: m.isPreview,
          isPaid: m.isPaid,
          order: m.order,
          status: m.status,
        }));
        await Material.insertMany(clones, { session });
        counts.materials = clones.length;
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        id: rootId,
        name: rootTitle,
        parent: source.parent ?? null,
        createdAt: new Date(),
        itemsCloned: counts,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
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
    {
      const c = buildRegexCondition(search);
      if (c) filter.title = c;
    }
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

function applyUploadedFile(req: Request) {
  const file = req.file as any;
  if (file?.location) {
    req.body.file = file.location;
    if (file.size != null && req.body.fileSize == null) req.body.fileSize = file.size;
    if (file.mimetype && !req.body.fileMime) req.body.fileMime = file.mimetype;
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
    applyUploadedFile(req);
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
