// src/admin/course/course.service.ts
//
// Domain logic for admin course endpoints. Controllers should:
//   1. Parse + validate input.
//   2. Call into this service.
//   3. Map the return value to the HTTP response.

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

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

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
