// src/admin/course/course.service.ts
//
// Domain logic for admin course endpoints. Controllers should:
//   1. Parse + validate input.
//   2. Call into this service.
//   3. Map the return value to the HTTP response.

import mongoose, { Types } from "mongoose";
import { Course } from "../../models/course/Course.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { HttpError } from "../../middlewares/errorHandler";
import cache from "../../libs/cache";
import logger from "../../utils/logger";
import * as adminCourse from "../../modules/admin-course/admin-course.service";

// Re-exported so the thin controllers can branch validation (numeric vs ObjectId).
export const isAdminCourseMysql = adminCourse.isAdminCourseMysql;
export const parseCourseSqlId = adminCourse.parseCourseId;

// On the SQL branch ids are numeric; the Mongo assertObjectId would 400 them.
const assertCourseSqlId = (id: string, label: string): number => {
  const n = adminCourse.parseCourseId(id);
  if (!n) throw new HttpError(400, `Invalid ${label} ID`);
  return n;
};

// SQL create/update wrappers (validated numeric input from the controller).
export const createCourseSql = (v: any) => adminCourse.createCourse(v);

export const updateCourseSql = async (id: string, v: any) => {
  const res = await adminCourse.updateCourse(assertCourseSqlId(id, "Course"), v);
  if (res === "not_found") throw new HttpError(404, "Course not found");
  return res;
};

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

const courseDetailKey = (id: string) => cache.key("admin", "course", `detail:${id}`);

const invalidateCourseCaches = async (courseId?: string) => {
  const keys: string[] = [];
  if (courseId) keys.push(courseDetailKey(courseId));
  await Promise.all([
    cache.invalidate(...keys),
    // List cache is partitioned by filter hash; sweep the prefix.
    cache.invalidateByPrefix(cache.keyPrefix("admin", "course", "list:")),
  ]);
};

// ──────────────────────────────────────────────────────────────────────────────
// Pre-requisites
// ──────────────────────────────────────────────────────────────────────────────

export const getPreRequisites = async () => {
  return adminCourse.getPreRequisites();
};

// ──────────────────────────────────────────────────────────────────────────────
// List & detail
// ──────────────────────────────────────────────────────────────────────────────

export const listCourses = async (query: ListCoursesQuery) => {
  return adminCourse.listCourses(query);
};

export const getCourseById = async (id: string) => {
  const res = await adminCourse.getCourseById(assertCourseSqlId(id, "Course"));
  if (res === "not_found") throw new HttpError(404, "Course not found");
  return res;
};

// ──────────────────────────────────────────────────────────────────────────────
// Course video categories & materials (admin masters)
// ──────────────────────────────────────────────────────────────────────────────

export interface ListVideoCategoriesQuery {
  page?: string;
  limit?: string;
}

export const listCourseVideoCategories = async (query: ListVideoCategoriesQuery) => {
  return adminCourse.listCourseVideoCategories(query);
};

export const listCourseMaterials = async (query: ListVideoCategoriesQuery) => {
  return adminCourse.listCourseMaterials(query);
};

export const createCourseMaterial = async (validated: any) => {
  return adminCourse.createCourseMaterial(validated);
};

export const updateCourseMaterial = async (materialId: string, validated: any) => {
  const res = await adminCourse.updateCourseMaterial(assertCourseSqlId(materialId, "Material"), validated);
  if (res === "not_found") throw new HttpError(404, "Material not found");
  return res;
};

export const deleteCourseMaterial = async (materialId: string) => {
  if (!(await adminCourse.deleteCourseMaterial(assertCourseSqlId(materialId, "Material")))) throw new HttpError(404, "Material not found");
  return;
};

export const createCourseVideoCategory = async (validated: any) => {
  return adminCourse.createCourseVideoCategory(validated);
};

export const updateCourseVideoCategory = async (videoCategoryId: string, validated: any) => {
  const res = await adminCourse.updateCourseVideoCategory(assertCourseSqlId(videoCategoryId, "Video Category"), validated);
  if (res === "not_found") throw new HttpError(404, "Video Category not found");
  return res;
};

export const deleteCourseVideoCategory = async (videoCategoryId: string) => {
  const res = await adminCourse.deleteCourseVideoCategory(assertCourseSqlId(videoCategoryId, "Video Category"));
  if (res === "in_use") throw new HttpError(409, "Video category is linked with one or more courses. Remove mapping first.");
  if (res === "not_found") throw new HttpError(404, "Video Category not found");
  return res;
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
  if (input.materialCategories !== undefined) update.materialCategories = input.materialCategories;
  if (input.examCategories !== undefined) update.examCategories = input.examCategories;

  const course = await Course.findByIdAndUpdate(input.id, update, { new: true }).lean();
  if (!course) throw new HttpError(404, "Course not found");
  await invalidateCourseCaches(input.id);
  return course;
};

export const deleteCourse = async (id: string) => {
  const res = await adminCourse.deleteCourse(assertCourseSqlId(id, "Course"));
  if (res === "not_found") throw new HttpError(404, "Course not found");
  return res;
};

export const toggleCoursePopular = async (id: string, requested?: boolean | string) => {
  const res = await adminCourse.toggleCoursePopular(assertCourseSqlId(id, "Course"), requested);
  if (res === "not_found") throw new HttpError(404, "Course not found");
  return res;
};

// ──────────────────────────────────────────────────────────────────────────────
// Plans scoped to a course
// ──────────────────────────────────────────────────────────────────────────────

export const createCoursePlan = async (
  courseId: string,
  validated: any
) => {
  const res = await adminCourse.createCoursePlan(assertCourseSqlId(courseId, "Course"), validated);
  if (res === "not_found") throw new HttpError(404, "Course not found");
  return res;
};

export const listCoursePlans = async (courseId: string) => {
  const res = await adminCourse.listCoursePlans(assertCourseSqlId(courseId, "Course"));
  if (res === "not_found") throw new HttpError(404, "Course not found");
  return res;
};

export const getCoursePlanById = async (planId: string) => {
  const res = await adminCourse.getCoursePlanById(assertCourseSqlId(planId, "Plan"));
  if (res === "not_found") throw new HttpError(404, "Pricing plan not found");
  return res;
};

export const updateCoursePlan = async (planId: string, validated: any) => {
  const res = await adminCourse.updateCoursePlan(assertCourseSqlId(planId, "Plan"), validated);
  if (res === "not_found") throw new HttpError(404, "Pricing plan not found");
  return res;
};

export const deleteCoursePlan = async (planId: string) => {
  if (!(await adminCourse.deleteCoursePlan(assertCourseSqlId(planId, "Plan")))) throw new HttpError(404, "Pricing plan not found");
  return;
};

// ──────────────────────────────────────────────────────────────────────────────
// Video category relations
// ──────────────────────────────────────────────────────────────────────────────

export interface ListVideoCategoryRelationsQuery {
  page?: string;
  limit?: string;
}

export const listVideoCategoryRelations = async (query: ListVideoCategoryRelationsQuery) => {
  return adminCourse.listVideoCategoryRelations(query);
};

export const createVideoCategoryRelation = async (input: {
  parent: string;
  child: string;
  order?: number;
}) => {
  const { parent, child, order = 0 } = input;
  const res = await adminCourse.createVideoCategoryRelation({ parent, child, order });
  if (res === "missing") throw new HttpError(422, "parent and child are required.");
  if (res === "same") throw new HttpError(400, "parent and child cannot be same.");
  if (res === "not_found") throw new HttpError(404, "Parent or child category not found.");
  if (res === "exists") throw new HttpError(409, "Relation already exists.");
  return res;
};

export const updateVideoCategoryRelation = async (relationId: string, order: number) => {
  const res = await adminCourse.updateVideoCategoryRelation(assertCourseSqlId(relationId, "relation"), order);
  if (res === "not_found") throw new HttpError(404, "Relation not found.");
  return res;
};

export const deleteVideoCategoryRelation = async (relationId: string) => {
  if (!(await adminCourse.deleteVideoCategoryRelation(assertCourseSqlId(relationId, "relation")))) throw new HttpError(404, "Relation not found.");
  return;
};

// Helper for callers that want to log invalidation themselves.
export const _invalidateCacheForTest = invalidateCourseCaches;
void logger; // import retained for future structured logs from this module
