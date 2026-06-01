import { Request, Response } from "express";
import mongoose from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { Course } from "../../models/course/Course.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import {
  createVideoCategorySchema,
  updateVideoCategorySchema,
  listQuerySchema,
  categoryCoursesQuerySchema,
  categoryVideosQuerySchema,
  sortFieldMap,
} from "./videoCategory.validation";

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

const toItem = (c: any) => ({
  id: c._id,
  name: c.title,
  slug: c.slug,
  order: c.order_by,
  image: c.image,
  child_categories: Array.isArray(c.childCategoryIds)
    ? c.childCategoryIds.map((cc: any) =>
        cc && typeof cc === "object" && cc._id
          ? {
              id: cc._id,
              name: cc.title,
              slug: cc.slug ?? null,
              status: cc.status,
              order: cc.order_by ?? 0,
            }
          : { id: cc, name: null, slug: null, status: null, order: null }
      )
    : [],
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
    if (childCategoryId) filter.childCategoryIds = childCategoryId;

    const sort: any = { [sortFieldMap[sort_by]]: sort_dir === "asc" ? 1 : -1 };
    const skip = (page - 1) * per_page;

    const [items, total] = await Promise.all([
      VideoCategory.find(filter)
        .populate("childCategoryIds", "_id title slug status order_by")
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
      .populate("childCategoryIds", "_id title slug status order_by")
      .populate("educatorId", "_id name")
      .lean();
    if (!cat) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data: toItem(cat) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /:id/courses — paginated, searchable courses linked to this video category.
export const listVideoCategoryCourses = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }
    const exists = await VideoCategory.exists({ _id: id });
    if (!exists) {
      return res.status(404).json({ success: false, message: "Video Category not found" });
    }

    const parsed = categoryCoursesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { search, status, page, per_page } = parsed.data;

    const filter: any = { videoCategoryId: id };
    if (search) filter.name = { $regex: search, $options: "i" };
    if (status === "true" || status === "false") filter.status = status === "true";

    const skip = (page - 1) * per_page;
    const [docs, total] = await Promise.all([
      Course.find(filter)
        .select("_id name status ordered")
        .sort({ ordered: 1 })
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

// GET /:id/videos — paginated, searchable videos belonging to this video category.
export const listVideoCategoryVideos = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }
    const exists = await VideoCategory.exists({ _id: id });
    if (!exists) {
      return res.status(404).json({ success: false, message: "Video Category not found" });
    }

    const parsed = categoryVideosQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(422).json({
        success: false,
        message: "Validation failed",
        errors: formatZodErrors(parsed.error.issues),
      });
    }
    const { search, status, platform, page, per_page } = parsed.data;

    const filter: any = { videoCategoryId: id };
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
        { topic: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") filter.status = status === "true";
    if (platform) filter.platform = platform;

    const skip = (page - 1) * per_page;
    const [docs, total] = await Promise.all([
      Video.find(filter)
        .select("_id title slug status order platform")
        .sort({ order: 1 })
        .skip(skip)
        .limit(per_page)
        .lean(),
      Video.countDocuments(filter),
    ]);

    const items = docs.map((v: any) => ({
      id: v._id,
      name: v.title ?? null,
      slug: v.slug ?? null,
      status: v.status,
      orderBy: v.order ?? 0,
      platform: v.platform ?? null,
    }));

    return res.status(200).json({
      success: true,
      data: { items, meta: buildMeta(page, per_page, total) },
    });
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
    const uniqueChildIds = Array.from(new Set((data.childCategoryIds ?? []).map(String)));
    if (uniqueChildIds.length) {
      const count = await VideoCategory.countDocuments({ _id: { $in: uniqueChildIds } });
      if (count !== uniqueChildIds.length) {
        return res
          .status(422)
          .json({ success: false, message: "One or more childCategoryIds are invalid" });
      }
    }

    const created = await VideoCategory.create({
      title: data.name,
      slug: data.slug,
      image: data.image,
      order_by: data.order,
      status: data.status,
      childCategoryIds: uniqueChildIds,
      educatorId: data.educatorId ?? null,
    });

    const populated = await VideoCategory.findById(created._id)
      .populate("childCategoryIds", "_id title slug status order_by")
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
    let nextChildIds: string[] | undefined;
    if (data.childCategoryIds !== undefined) {
      nextChildIds = Array.from(new Set(data.childCategoryIds.map(String)));
      if (nextChildIds.includes(String(id))) {
        return res
          .status(422)
          .json({ success: false, message: "childCategoryIds cannot include the category itself" });
      }
      if (nextChildIds.length) {
        const count = await VideoCategory.countDocuments({ _id: { $in: nextChildIds } });
        if (count !== nextChildIds.length) {
          return res
            .status(422)
            .json({ success: false, message: "One or more childCategoryIds are invalid" });
        }
      }
    }
    if (data.educatorId) {
      const ok = await CourseEducator.exists({ _id: data.educatorId });
      if (!ok) return res.status(422).json({ success: false, message: "Invalid educatorId" });
    }

    if (data.name !== undefined) cat.title = data.name;
    if (data.slug !== undefined) cat.slug = data.slug;
    if (data.order !== undefined) cat.order_by = data.order;
    if (data.status !== undefined) cat.status = data.status;
    if (nextChildIds !== undefined) cat.childCategoryIds = nextChildIds as any;
    if (data.educatorId !== undefined) cat.educatorId = (data.educatorId ?? null) as any;
    if (data.image !== undefined && data.image) {
      if (cat.image && cat.image !== data.image) {
        deleteFromS3FileUrl(cat.image).catch(() => {});
      }
      cat.image = data.image;
    }

    await cat.save();

    const populated = await VideoCategory.findById(cat._id)
      .populate("childCategoryIds", "_id title slug status order_by")
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
      VideoCategory.exists({ childCategoryIds: id }),
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
      // BFS the DAG of childCategoryIds, collecting every node once.
      const nodesById = new Map<string, any>();
      nodesById.set(String(source._id), source);
      const queue: any[] = [source];
      while (queue.length) {
        const cur = queue.shift();
        const childIds: string[] = (cur.childCategoryIds || []).map((x: any) => String(x));
        for (const cid of childIds) {
          if (nodesById.has(cid)) continue;
          const next = await VideoCategory.findById(cid).session(session).lean();
          if (!next) continue;
          nodesById.set(cid, next);
          queue.push(next);
        }
      }

      rootTitle = await nextAvailableUnassignedTitle(source.title);
      const idMap = new Map<string, mongoose.Types.ObjectId>();

      // Pass 1: create clones without children (so all ids exist for rewiring).
      for (const [oldId, node] of nodesById) {
        const isRoot = oldId === String(source._id);
        const title = isRoot ? rootTitle : node.title;
        const slugBase = slugify(title);
        const slug = await uniqueSlug(slugBase, session);
        const [doc] = await VideoCategory.create(
          [
            {
              title,
              slug,
              image: node.image,
              courseId: null,
              liveCourseId: null,
              childCategoryIds: [],
              educatorId: null,
              order_by: node.order_by ?? 0,
              status: node.status ?? true,
            },
          ],
          { session }
        );
        idMap.set(oldId, doc._id as mongoose.Types.ObjectId);
        if (isRoot) rootId = doc._id as mongoose.Types.ObjectId;
        else counts.subCategories += 1;
      }

      // Pass 2: rewire each clone's childCategoryIds to the new ids.
      for (const [oldId, node] of nodesById) {
        const newId = idMap.get(oldId)!;
        const newChildIds = (node.childCategoryIds || [])
          .map((c: any) => idMap.get(String(c)))
          .filter(Boolean);
        if (newChildIds.length) {
          await VideoCategory.updateOne(
            { _id: newId },
            { $set: { childCategoryIds: newChildIds } },
            { session }
          );
        }
      }

      // Clone videos across all mapped categories.
      const oldIds = Array.from(nodesById.values()).map((c) => c._id);
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
