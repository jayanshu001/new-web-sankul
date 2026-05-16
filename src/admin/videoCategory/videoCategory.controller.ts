import { Request, Response } from "express";
import mongoose from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import {
  createVideoCategorySchema,
  updateVideoCategorySchema,
  listQuerySchema,
  sortFieldMap,
} from "./videoCategory.validation";

const formatZodErrors = (issues: any[]) =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

const toItem = (c: any) => ({
  id: c._id,
  name: c.title,
  slug: c.slug,
  order: c.order_by,
  image: c.image,
  child_category: c.childCategoryId
    ? typeof c.childCategoryId === "object"
      ? { id: c.childCategoryId._id, name: c.childCategoryId.title }
      : c.childCategoryId
    : null,
  educator: c.educatorId
    ? typeof c.educatorId === "object"
      ? { id: c.educatorId._id, name: c.educatorId.name }
      : c.educatorId
    : null,
  status: c.status,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
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
    const { search, status, educatorId, childCategoryId, page, per_page, sort_by, sort_dir } =
      parsed.data;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") filter.status = status === "true";
    if (educatorId) filter.educatorId = educatorId;
    if (childCategoryId) filter.childCategoryId = childCategoryId;

    const sort: any = { [sortFieldMap[sort_by]]: sort_dir === "asc" ? 1 : -1 };
    const skip = (page - 1) * per_page;

    const [items, total] = await Promise.all([
      VideoCategory.find(filter)
        .populate("childCategoryId", "_id title")
        .populate("educatorId", "_id name")
        .sort(sort)
        .skip(skip)
        .limit(per_page)
        .lean(),
      VideoCategory.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: { items: items.map(toItem), pagination: { page, per_page, total } },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /pre-requisites
export const getVideoCategoryPreRequisites = async (_req: Request, res: Response) => {
  try {
    const [categories, educators] = await Promise.all([
      VideoCategory.find().select("_id title").sort({ title: 1 }).lean(),
      CourseEducator.find({ status: true }).select("_id name").sort({ name: 1 }).lean(),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        categories: categories.map((c: any) => ({ id: c._id, name: c.title })),
        educators: educators.map((e: any) => ({ id: e._id, name: e.name })),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /:id
export const getVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }
    const cat = await VideoCategory.findById(id)
      .populate("childCategoryId", "_id title")
      .populate("educatorId", "_id name")
      .lean();
    if (!cat) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data: toItem(cat) });
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

    const slugDupe = await VideoCategory.exists({ slug: data.slug });
    if (slugDupe) {
      return res.status(409).json({ success: false, message: "Slug already exists" });
    }

    if (data.educatorId) {
      const ok = await CourseEducator.exists({ _id: data.educatorId });
      if (!ok) return res.status(422).json({ success: false, message: "Invalid educatorId" });
    }
    if (data.childCategoryId) {
      const ok = await VideoCategory.exists({ _id: data.childCategoryId });
      if (!ok) return res.status(422).json({ success: false, message: "Invalid childCategoryId" });
    }

    const created = await VideoCategory.create({
      title: data.name,
      slug: data.slug,
      image: data.image,
      order_by: data.order,
      status: data.status,
      childCategoryId: data.childCategoryId ?? null,
      educatorId: data.educatorId ?? null,
    });

    const populated = await VideoCategory.findById(created._id)
      .populate("childCategoryId", "_id title")
      .populate("educatorId", "_id name")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Video Category created successfully",
      data: toItem(populated),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /:id (multipart)
export const updateVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }

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

    const cat = await VideoCategory.findById(id);
    if (!cat) return res.status(404).json({ success: false, message: "Video Category not found" });

    if (data.slug && data.slug !== cat.slug) {
      const dupe = await VideoCategory.exists({ slug: data.slug, _id: { $ne: id } });
      if (dupe) return res.status(409).json({ success: false, message: "Slug already exists" });
    }
    if (data.childCategoryId) {
      if (String(data.childCategoryId) === String(id)) {
        return res
          .status(422)
          .json({ success: false, message: "childCategoryId cannot be itself" });
      }
      const ok = await VideoCategory.exists({ _id: data.childCategoryId });
      if (!ok) return res.status(422).json({ success: false, message: "Invalid childCategoryId" });
    }
    if (data.educatorId) {
      const ok = await CourseEducator.exists({ _id: data.educatorId });
      if (!ok) return res.status(422).json({ success: false, message: "Invalid educatorId" });
    }

    if (data.name !== undefined) cat.title = data.name;
    if (data.slug !== undefined) cat.slug = data.slug;
    if (data.order !== undefined) cat.order_by = data.order;
    if (data.status !== undefined) cat.status = data.status;
    if (data.childCategoryId !== undefined) cat.childCategoryId = (data.childCategoryId ?? null) as any;
    if (data.educatorId !== undefined) cat.educatorId = (data.educatorId ?? null) as any;
    if (data.image !== undefined && data.image) {
      if (cat.image && cat.image !== data.image) {
        deleteFromS3FileUrl(cat.image).catch(() => {});
      }
      cat.image = data.image;
    }

    await cat.save();

    const populated = await VideoCategory.findById(cat._id)
      .populate("childCategoryId", "_id title")
      .populate("educatorId", "_id name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Video Category updated successfully",
      data: toItem(populated),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /:id
export const deleteVideoCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }

    const [videoInUse, parentInUse] = await Promise.all([
      Video.exists({ videoCategoryId: id }),
      VideoCategory.exists({ childCategoryId: id }),
    ]);
    if (videoInUse || parentInUse) {
      return res.status(409).json({
        success: false,
        message:
          "Video Category is in use by videos or other categories and cannot be deleted",
      });
    }

    const cat = await VideoCategory.findByIdAndDelete(id);
    if (!cat) return res.status(404).json({ success: false, message: "Video Category not found" });

    if (cat.image) deleteFromS3FileUrl(cat.image).catch(() => {});

    return res
      .status(200)
      .json({ success: true, message: "Video Category deleted successfully", data: {} });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function nextAvailableUnassignedTitle(baseTitle: string): Promise<string> {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = `${baseTitle} (Copy`;
  const regex = new RegExp(`^${escape(base)}(?:\\s(\\d+))?\\)$`);
  const existing = await VideoCategory.find({
    courseId: null,
    liveCourseId: null,
    title: { $regex: `^${escape(base)}` },
  })
    .select("title")
    .lean();
  const taken = new Set<number>();
  for (const e of existing) {
    const m = (e.title || "").match(regex);
    if (!m) continue;
    taken.add(m[1] ? parseInt(m[1], 10) : 1);
  }
  if (!taken.has(1)) return `${baseTitle} (Copy)`;
  let n = 2;
  while (taken.has(n)) n++;
  return `${baseTitle} (Copy ${n})`;
}

async function uniqueSlug(base: string, session: mongoose.ClientSession): Promise<string> {
  let candidate = base || "category";
  let n = 1;
  while (await VideoCategory.exists({ slug: candidate }).session(session)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

// POST /:id/duplicate
export const duplicateVideoCategory = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }
    const source = await VideoCategory.findById(id).lean();
    if (!source) {
      return res.status(404).json({ success: false, message: "Video Category not found" });
    }

    let rootId: mongoose.Types.ObjectId | null = null;
    let rootTitle = "";
    const counts = { subCategories: 0, videos: 0 };

    await session.withTransaction(async () => {
      // Walk the childCategoryId chain to collect the subtree (linked list).
      const chain: any[] = [source];
      const seen = new Set<string>([String(source._id)]);
      let cursor: any = source;
      while (cursor.childCategoryId) {
        const childId = String(cursor.childCategoryId);
        if (seen.has(childId)) break; // guard against cycles
        const next = await VideoCategory.findById(childId).session(session).lean();
        if (!next) break;
        chain.push(next);
        seen.add(childId);
        cursor = next;
      }

      // Create clones bottom-up so each parent can reference its already-created child.
      rootTitle = await nextAvailableUnassignedTitle(source.title);
      const idMap = new Map<string, mongoose.Types.ObjectId>();

      for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const isRoot = i === 0;
        const title = isRoot ? rootTitle : node.title;
        const slugBase = slugify(title);
        const slug = await uniqueSlug(slugBase, session);
        const nextOldId = node.childCategoryId ? String(node.childCategoryId) : null;
        const newChildId = nextOldId ? idMap.get(nextOldId) ?? null : null;

        const [doc] = await VideoCategory.create(
          [
            {
              title,
              slug,
              image: node.image,
              courseId: null,
              liveCourseId: null,
              childCategoryId: newChildId,
              educatorId: null,
              order_by: node.order_by ?? 0,
              status: node.status ?? true,
            },
          ],
          { session }
        );
        idMap.set(String(node._id), doc._id as mongoose.Types.ObjectId);
        if (isRoot) rootId = doc._id as mongoose.Types.ObjectId;
        else counts.subCategories += 1;
      }

      // Clone videos across all mapped categories.
      const oldIds = chain.map((c) => c._id);
      const videos = await Video.find({ videoCategoryId: { $in: oldIds } })
        .session(session)
        .lean();
      if (videos.length) {
        const clones = videos.map((v: any) => ({
          videoCategoryId: idMap.get(String(v.videoCategoryId))!,
          liveSessionId: null,
          title: v.title,
          topic: v.topic,
          slug: v.slug,
          platform: v.platform,
          priceType: v.priceType,
          youtube_id: v.youtube_id,
          aws_id: v.aws_id,
          vimeo_id: v.vimeo_id,
          order: v.order ?? 0,
          status: v.status ?? true,
        }));
        await Video.insertMany(clones, { session });
        counts.videos = clones.length;
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        id: rootId,
        name: rootTitle,
        courseId: null,
        liveCourseId: null,
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

// PATCH /:id/status
export const toggleVideoCategoryStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }
    const cat = await VideoCategory.findById(id).select("status");
    if (!cat) return res.status(404).json({ success: false, message: "Video Category not found" });
    cat.status = !cat.status;
    await cat.save();
    return res.status(200).json({ success: true, data: { status: cat.status } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
