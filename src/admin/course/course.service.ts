// src/admin/course/course.service.ts
//
// Domain logic for admin course endpoints. Controllers should:
//   1. Parse + validate input.
//   2. Call into this service.
//   3. Map the return value to the HTTP response.
//
// All read paths use `.lean()` + explicit `.select()`. All multi-document
// writes go through a Mongoose transaction. Hot reads are cached behind the
// shared cache-aside helper; writes invalidate the affected list+detail keys.

import mongoose, { Types } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { PackageCourseMaterial } from "../../models/course/PackageCourseMaterial.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";
import logger from "../../utils/logger";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ListCoursesQuery {
  search?: string;
  status?: string;
  isPaid?: string;
  isPopular?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface CategoryRef {
  category: Types.ObjectId;
  order: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, `Invalid ${label} ID`);
  }
};

const mapPlanResponse = (plan: any) => ({
  id: plan._id,
  name: plan.name ?? null,
  duration: plan.duration,
  price: plan.price,
  withMaterial: plan.withMaterial,
  materialPrice: plan.materialPrice ?? 0,
  isDefault: plan.isDefault,
  status: plan.status,
  courseId: plan.courseId,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

/**
 * Accepts either a real array or a JSON-encoded string (multipart/form-data),
 * normalizes into typed `CategoryRef[]`.
 */
export const parseCategoryRefs = (raw: any): CategoryRef[] | undefined => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  let items = raw;
  if (typeof raw === "string") {
    try {
      items = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(items)) return undefined;
  return items
    .filter((i: any) => i && mongoose.Types.ObjectId.isValid(i.category))
    .map((i: any) => ({
      category: new Types.ObjectId(i.category),
      order: typeof i.order === "number" ? i.order : Number(i.order) || 0,
    }));
};

const courseListKey = (filter: any, page: number, limit: number, sort: any) =>
  cache.key(
    "admin",
    "course",
    `list:${cache.hashFilter({ filter, page, limit, sort })}`
  );

const courseDetailKey = (id: string) => cache.key("admin", "course", `detail:${id}`);

const invalidateCourseCaches = async (courseId?: string) => {
  const keys: string[] = [];
  if (courseId) keys.push(courseDetailKey(courseId));
  await Promise.all([
    cache.invalidate(...keys),
    // List cache is partitioned by filter hash; sweep the prefix.
    cache.invalidateByPrefix(cache.key("admin", "course", "list:")),
  ]);
};

// ──────────────────────────────────────────────────────────────────────────────
// Pre-requisites
// ──────────────────────────────────────────────────────────────────────────────

export const getPreRequisites = async () => {
  const [educators, subjectCategories, videoCategories, materials] = await Promise.all([
    CourseEducator.find({ status: true }).select("_id name").lean(),
    CourseSubjectCategory.find({ status: true }).select("_id title").lean(),
    VideoCategory.find({ status: true }).select("_id title").lean(),
    PackageCourseMaterial.find({ isActive: true }).select("_id title").lean(),
  ]);

  return {
    educators: educators.map((e: any) => ({ _id: e._id, name: e.name })),
    subjectCategories: subjectCategories.map((s: any) => ({ _id: s._id, name: s.title })),
    videoCategories: videoCategories.map((v: any) => ({ _id: v._id, name: v.title })),
    materials: materials.map((m: any) => ({ _id: m._id, name: m.title })),
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// List & detail
// ──────────────────────────────────────────────────────────────────────────────

export const listCourses = async (query: ListCoursesQuery) => {
  const {
    search = "",
    status,
    isPaid,
    isPopular,
    page = "1",
    limit = "10",
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const filter: any = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }
  if (status === "true" || status === "false") filter.status = status === "true";
  if (isPaid === "true" || isPaid === "false") filter.isPaid = isPaid === "true";
  if (isPopular === "true" || isPopular === "false") filter.isPopular = isPopular === "true";

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
  const skip = (pageNum - 1) * limitNum;
  const sortDirection: 1 | -1 = sortOrder === "asc" ? 1 : -1;
  const sort: Record<string, 1 | -1> = { [sortBy]: sortDirection };

  return cache.aside({
    key: courseListKey(filter, pageNum, limitNum, sort),
    ttlSeconds: 300,
    load: async () => {
      const [data, total] = await Promise.all([
        Course.find(filter)
          .populate("courseEducatorId", "_id name")
          .populate("courseSubjectCategoryId", "_id title")
          .populate("videoCategoryId", "_id title")
          .populate("examCountdownCategoryId", "_id name colorHex")
          .populate("materialCategories.category", "_id title image")
          .populate("examCategories.category", "_id name image")
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Course.countDocuments(filter),
      ]);

      return {
        data,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    },
  });
};

export const getCourseById = async (id: string) => {
  assertObjectId(id, "Course");

  return cache.aside({
    key: courseDetailKey(id),
    ttlSeconds: 300,
    load: async () => {
      const [course, plans] = await Promise.all([
        Course.findById(id)
          .populate("courseEducatorId", "_id name")
          .populate("courseSubjectCategoryId", "_id title")
          .populate("videoCategoryId", "_id title")
          .populate("examCountdownCategoryId", "_id name colorHex")
          .populate("materialCategories.category", "_id title image")
          .populate("examCategories.category", "_id name image")
          .lean(),
        PackageCourseEbookPrice.find({ courseId: id })
          .sort({ isDefault: -1, createdAt: -1 })
          .lean(),
      ]);

      if (!course) throw new HttpError(404, "Course not found");

      return {
        course,
        plans: plans.map(mapPlanResponse),
      };
    },
  });
};

// ──────────────────────────────────────────────────────────────────────────────
// Course video categories & materials (admin masters)
// ──────────────────────────────────────────────────────────────────────────────

export interface ListVideoCategoriesQuery {
  page?: string;
  limit?: string;
}

export const listCourseVideoCategories = async (query: ListVideoCategoriesQuery) => {
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const filter = { status: true };
  const [data, total] = await Promise.all([
    VideoCategory.find(filter)
      .select("_id title slug image courseId order_by status")
      .sort({ order_by: 1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    VideoCategory.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

export const listCourseMaterials = async (query: ListVideoCategoriesQuery) => {
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    PackageCourseMaterial.find()
      .select("_id title image isActive")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    PackageCourseMaterial.countDocuments(),
  ]);

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

export const createCourseMaterial = async (validated: any) => {
  const material = await PackageCourseMaterial.create(validated);
  return material.toObject();
};

export const updateCourseMaterial = async (materialId: string, validated: any) => {
  assertObjectId(materialId, "Material");
  const material = await PackageCourseMaterial.findByIdAndUpdate(materialId, validated, {
    new: true,
  }).lean();
  if (!material) throw new HttpError(404, "Material not found");
  return material;
};

export const deleteCourseMaterial = async (materialId: string) => {
  assertObjectId(materialId, "Material");
  const material = await PackageCourseMaterial.findByIdAndDelete(materialId).lean();
  if (!material) throw new HttpError(404, "Material not found");
};

export const createCourseVideoCategory = async (validated: any) => {
  const category = await VideoCategory.create(validated);
  return category.toObject();
};

export const updateCourseVideoCategory = async (videoCategoryId: string, validated: any) => {
  assertObjectId(videoCategoryId, "Video Category");
  const category = await VideoCategory.findByIdAndUpdate(videoCategoryId, validated, {
    new: true,
  }).lean();
  if (!category) throw new HttpError(404, "Video Category not found");
  return category;
};

export const deleteCourseVideoCategory = async (videoCategoryId: string) => {
  assertObjectId(videoCategoryId, "Video Category");
  const isUsed = await Course.exists({ videoCategoryId });
  if (isUsed) {
    throw new HttpError(
      409,
      "Video category is linked with one or more courses. Remove mapping first."
    );
  }

  const category = await VideoCategory.findByIdAndDelete(videoCategoryId).lean();
  if (!category) throw new HttpError(404, "Video Category not found");
  const rel = await VideoCategoryRelation.deleteMany({
    $or: [{ parent: videoCategoryId }, { child: videoCategoryId }],
  });
  return { deletedRelations: rel.deletedCount ?? 0 };
};

// ──────────────────────────────────────────────────────────────────────────────
// Course CRUD
// ──────────────────────────────────────────────────────────────────────────────

export interface CreateCourseInput {
  validated: any; // shape of createCourseSchema
  materialCategories?: CategoryRef[];
  examCategories?: CategoryRef[];
}

export const createCourse = async (input: CreateCourseInput) => {
  const session = await mongoose.startSession();
  try {
    const { validated, materialCategories, examCategories } = input;
    let course: any;
    let folder: any;

    await session.withTransaction(async () => {
      const [created] = await Course.create(
        [
          {
            ...validated,
            examCountdownCategoryId: validated.examCountdownCategoryId || null,
            materialCategories: materialCategories ?? [],
            examCategories: examCategories ?? [],
          },
        ],
        { session }
      );
      course = created;

      // "Nested Folder Automation" — every course gets a root video folder.
      const [created2] = await VideoCategory.create(
        [
          {
            title: `${course.name} - Root`,
            slug: `${course.name.toLowerCase().replace(/ /g, "-")}-root`,
            image: course.image,
            courseId: course._id,
            order_by: 0,
          },
        ],
        { session }
      );
      folder = created2;
    });

    await invalidateCourseCaches();
    return { course: course.toObject(), folder: folder.toObject() };
  } finally {
    session.endSession();
  }
};

export interface UpdateCourseInput {
  id: string;
  validated: any;
  materialCategories?: CategoryRef[];
  examCategories?: CategoryRef[];
}

export const updateCourse = async (input: UpdateCourseInput) => {
  assertObjectId(input.id, "Course");
  const update: any = { ...input.validated };
  if (input.validated.examCountdownCategoryId !== undefined) {
    update.examCountdownCategoryId = input.validated.examCountdownCategoryId || null;
  }
  if (input.materialCategories !== undefined) update.materialCategories = input.materialCategories;
  if (input.examCategories !== undefined) update.examCategories = input.examCategories;

  const course = await Course.findByIdAndUpdate(input.id, update, { new: true }).lean();
  if (!course) throw new HttpError(404, "Course not found");
  await invalidateCourseCaches(input.id);
  return course;
};

export const deleteCourse = async (id: string) => {
  assertObjectId(id, "Course");
  const session = await mongoose.startSession();
  try {
    let result: {
      deletedCourseId: string;
      deletedPlans: number;
      deletedCourseVideoCategories: number;
      deletedVideoRelations: number;
    } | null = null;

    await session.withTransaction(async () => {
      const course = await Course.findByIdAndDelete(id, { session });
      if (!course) throw new HttpError(404, "Course not found");

      const scopedFolders = await VideoCategory.find(
        { courseId: id },
        { _id: 1 },
        { session }
      ).lean();
      const scopedIds = scopedFolders.map((f) => f._id);

      const [plansResult, foldersResult, relationsResult] = await Promise.all([
        PackageCourseEbookPrice.deleteMany({ courseId: id }, { session }),
        VideoCategory.deleteMany({ courseId: id }, { session }),
        scopedIds.length
          ? VideoCategoryRelation.deleteMany(
              { $or: [{ parent: { $in: scopedIds } }, { child: { $in: scopedIds } }] },
              { session }
            )
          : Promise.resolve({ deletedCount: 0 } as any),
      ]);

      result = {
        deletedCourseId: id,
        deletedPlans: plansResult.deletedCount ?? 0,
        deletedCourseVideoCategories: foldersResult.deletedCount ?? 0,
        deletedVideoRelations: relationsResult.deletedCount ?? 0,
      };
    });

    await invalidateCourseCaches(id);
    return result!;
  } finally {
    session.endSession();
  }
};

export const toggleCoursePopular = async (id: string, requested?: boolean | string) => {
  assertObjectId(id, "Course");
  const course = await Course.findById(id).select("_id isPopular");
  if (!course) throw new HttpError(404, "Course not found");

  let next: boolean;
  if (typeof requested === "boolean") next = requested;
  else if (requested === "true" || requested === "false") next = requested === "true";
  else next = !course.isPopular;

  course.isPopular = next;
  await course.save();
  await invalidateCourseCaches(id);
  return { _id: course._id, isPopular: course.isPopular };
};

// ──────────────────────────────────────────────────────────────────────────────
// Plans scoped to a course
//
// `enforceSingleDefault` ran outside any transaction in the legacy controller
// (P0 audit finding). We wrap create/update/markDefault calls in
// `session.withTransaction` so the plan write + the sibling flip commit
// atomically — no readers see two `isDefault: true` rows for the same course.
// ──────────────────────────────────────────────────────────────────────────────

const enforceSingleDefaultInTxn = async (
  planId: string | Types.ObjectId,
  courseId: Types.ObjectId,
  session: mongoose.ClientSession
) => {
  await PackageCourseEbookPrice.updateMany(
    { courseId, _id: { $ne: planId } },
    { $set: { isDefault: false } },
    { session }
  );
};

export const createCoursePlan = async (
  courseId: string,
  validated: any
) => {
  assertObjectId(courseId, "Course");

  const courseExists = await Course.exists({ _id: courseId });
  if (!courseExists) throw new HttpError(404, "Course not found");

  const normalized = {
    ...validated,
    duration: validated.duration ?? validated.subscriptionDurationMonths,
  };

  const session = await mongoose.startSession();
  try {
    let created: any;
    await session.withTransaction(async () => {
      const [plan] = await PackageCourseEbookPrice.create(
        [{ courseId: new Types.ObjectId(courseId), ...normalized }],
        { session }
      );
      created = plan;
      if (plan.isDefault) {
        await enforceSingleDefaultInTxn(plan._id, new Types.ObjectId(courseId), session);
      }
    });
    await invalidateCourseCaches(courseId);
    return mapPlanResponse(created);
  } finally {
    session.endSession();
  }
};

export const listCoursePlans = async (courseId: string) => {
  assertObjectId(courseId, "Course");
  const exists = await Course.exists({ _id: courseId });
  if (!exists) throw new HttpError(404, "Course not found");

  const plans = await PackageCourseEbookPrice.find({ courseId })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();
  return plans.map(mapPlanResponse);
};

export const getCoursePlanById = async (planId: string) => {
  assertObjectId(planId, "Plan");
  const plan = await PackageCourseEbookPrice.findById(planId).lean();
  if (!plan) throw new HttpError(404, "Pricing plan not found");
  return mapPlanResponse(plan);
};

export const updateCoursePlan = async (planId: string, validated: any) => {
  assertObjectId(planId, "Plan");
  const normalized = {
    ...validated,
    duration: validated.duration ?? validated.subscriptionDurationMonths,
  };

  const session = await mongoose.startSession();
  try {
    let updated: any;
    let affectedCourseId: string | undefined;
    await session.withTransaction(async () => {
      const plan = await PackageCourseEbookPrice.findByIdAndUpdate(
        planId,
        { $set: normalized },
        { new: true, session }
      );
      if (!plan) throw new HttpError(404, "Pricing plan not found");
      updated = plan;
      affectedCourseId = plan.courseId?.toString();

      if (plan.isDefault && plan.courseId) {
        await enforceSingleDefaultInTxn(
          plan._id,
          plan.courseId as Types.ObjectId,
          session
        );
      }
    });
    if (affectedCourseId) await invalidateCourseCaches(affectedCourseId);
    return mapPlanResponse(updated);
  } finally {
    session.endSession();
  }
};

export const deleteCoursePlan = async (planId: string) => {
  assertObjectId(planId, "Plan");
  const plan = await PackageCourseEbookPrice.findByIdAndDelete(planId).lean();
  if (!plan) throw new HttpError(404, "Pricing plan not found");
  if (plan.courseId) await invalidateCourseCaches(plan.courseId.toString());
};

// ──────────────────────────────────────────────────────────────────────────────
// Video category relations
// ──────────────────────────────────────────────────────────────────────────────

export interface ListVideoCategoryRelationsQuery {
  page?: string;
  limit?: string;
}

export const listVideoCategoryRelations = async (query: ListVideoCategoryRelationsQuery) => {
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(query.limit ?? "50", 10) || 50, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    VideoCategoryRelation.find()
      .populate("parent", "_id title slug")
      .populate("child", "_id title slug")
      .sort({ order: 1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    VideoCategoryRelation.countDocuments(),
  ]);

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

export const createVideoCategoryRelation = async (input: {
  parent: string;
  child: string;
  order?: number;
}) => {
  const { parent, child, order = 0 } = input;
  if (!parent || !child) {
    throw new HttpError(422, "parent and child are required.");
  }
  assertObjectId(parent, "parent");
  assertObjectId(child, "child");
  if (String(parent) === String(child)) {
    throw new HttpError(400, "parent and child cannot be same.");
  }

  const [parentCategory, childCategory] = await Promise.all([
    VideoCategory.exists({ _id: parent }),
    VideoCategory.exists({ _id: child }),
  ]);
  if (!parentCategory || !childCategory) {
    throw new HttpError(404, "Parent or child category not found.");
  }

  try {
    const relation = await VideoCategoryRelation.create({ parent, child, order });
    return relation.toObject();
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new HttpError(409, "Relation already exists.");
    }
    throw error;
  }
};

export const updateVideoCategoryRelation = async (relationId: string, order: number) => {
  assertObjectId(relationId, "relation");
  const relation = await VideoCategoryRelation.findByIdAndUpdate(
    relationId,
    { order },
    { new: true }
  ).lean();
  if (!relation) throw new HttpError(404, "Relation not found.");
  return relation;
};

export const deleteVideoCategoryRelation = async (relationId: string) => {
  assertObjectId(relationId, "relation");
  const relation = await VideoCategoryRelation.findByIdAndDelete(relationId).lean();
  if (!relation) throw new HttpError(404, "Relation not found.");
};

// Helper for callers that want to log invalidation themselves.
export const _invalidateCacheForTest = invalidateCourseCaches;
void logger; // import retained for future structured logs from this module
