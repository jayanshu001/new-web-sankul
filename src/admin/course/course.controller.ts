// src/admin/course/course.controller.ts
//
// Thin controllers: parse + coerce request → validate → call service → respond.
// All error paths route through the global error middleware via `asyncHandler`;
// services throw `HttpError(code, message)` for predictable status codes.
//
// This file replaces the legacy inline-try/catch handlers (audit Module 2 P1)
// and consumes:
//   - middlewares/asyncHandler       — error forwarding
//   - admin/course/course.service.ts — domain logic, caching, transactions
//   - utils/httpResponse             — standard `{ success, code, data, ... }` envelope

import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import {
  createCourseSchema,
  createCoursePlanSchema,
  updateCoursePlanSchema,
} from "./course.validation";
import {
  createMaterialSchema,
  updateMaterialSchema,
  createVideoCategorySchema,
  updateVideoCategorySchema,
} from "../master/master.validation";
import * as courseService from "./course.service";

// ──────────────────────────────────────────────────────────────────────────────
// Multipart coercion helpers
// Forms posted by the admin UI send everything as strings; normalize before
// handing the payload to Zod.
// ──────────────────────────────────────────────────────────────────────────────

const coerceCourseBody = (req: Request) => {
  const file = req.file as any;
  if (file?.location) req.body.image = file.location;
  if (typeof req.body.ordered === "string") req.body.ordered = Number(req.body.ordered);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  if (typeof req.body.isPaid === "string") req.body.isPaid = req.body.isPaid === "true";
  if (typeof req.body.isPopular === "string") req.body.isPopular = req.body.isPopular === "true";
  delete req.body.examCountdownCategoryId;
  const materialCategories = courseService.parseCategoryRefs(req.body.materialCategories);
  const examCategories = courseService.parseCategoryRefs(req.body.examCategories);
  // Zod accepts ObjectId strings; pass the string form for schema validation
  // but keep the typed form for the service.
  if (materialCategories !== undefined) {
    req.body.materialCategories = materialCategories.map((r) => ({
      category: r.category.toString(),
      order: r.order,
    }));
  }
  if (examCategories !== undefined) {
    req.body.examCategories = examCategories.map((r) => ({
      category: r.category.toString(),
      order: r.order,
    }));
  }
  return { materialCategories, examCategories };
};

// ──────────────────────────────────────────────────────────────────────────────
// Pre-requisites / list / detail
// ──────────────────────────────────────────────────────────────────────────────

export const getPreRequisites = asyncHandler(async (_req: Request, res: Response) => {
  const data = await courseService.getPreRequisites();
  return success(res, data);
});

export const getCourses = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await courseService.listCourses(
    req.query as courseService.ListCoursesQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const getCourseById = asyncHandler(async (req: Request, res: Response) => {
  const result = await courseService.getCourseById(req.params.id as string);
  return success(res, result);
});

// ──────────────────────────────────────────────────────────────────────────────
// Video categories / materials masters
// ──────────────────────────────────────────────────────────────────────────────

export const getCourseVideoCategories = asyncHandler(
  async (req: Request, res: Response) => {
    const { data, pagination } = await courseService.listCourseVideoCategories(
      req.query as courseService.ListVideoCategoriesQuery
    );
    return res.status(200).json({ success: true, data, pagination });
  }
);

export const getCourseMaterials = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await courseService.listCourseMaterials(
    req.query as courseService.ListVideoCategoriesQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const createCourseMaterial = asyncHandler(async (req: Request, res: Response) => {
  const validated = createMaterialSchema.parse(req.body);
  const data = await courseService.createCourseMaterial(validated);
  return res.status(201).json({ success: true, data });
});

export const updateCourseMaterial = asyncHandler(async (req: Request, res: Response) => {
  const validated = updateMaterialSchema.parse(req.body);
  const data = await courseService.updateCourseMaterial(req.params.materialId as string, validated);
  return success(res, data as any);
});

export const deleteCourseMaterial = asyncHandler(async (req: Request, res: Response) => {
  await courseService.deleteCourseMaterial(req.params.materialId as string);
  return success(res, {}, "Material deleted successfully");
});

export const createCourseVideoCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const validated = createVideoCategorySchema.parse(req.body);
    const data = await courseService.createCourseVideoCategory(validated);
    return res.status(201).json({ success: true, data });
  }
);

export const updateCourseVideoCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const validated = updateVideoCategorySchema.parse(req.body);
    const data = await courseService.updateCourseVideoCategory(
      req.params.videoCategoryId as string,
      validated
    );
    return success(res, data as any);
  }
);

export const deleteCourseVideoCategory = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await courseService.deleteCourseVideoCategory(req.params.videoCategoryId as string);
    return success(res, data, "Video Category deleted successfully");
  }
);

// ──────────────────────────────────────────────────────────────────────────────
// Course CRUD + popular toggle
// ──────────────────────────────────────────────────────────────────────────────

export const createCourse = asyncHandler(async (req: Request, res: Response) => {
  const { materialCategories, examCategories } = coerceCourseBody(req);
  const validated = createCourseSchema.parse(req.body);
  const data = await courseService.createCourse({
    validated,
    materialCategories,
    examCategories,
  });
  return res
    .status(201)
    .json({ success: true, message: "Course created successfully with default folder", data });
});

export const updateCourse = asyncHandler(async (req: Request, res: Response) => {
  const { materialCategories, examCategories } = coerceCourseBody(req);
  const validated = createCourseSchema.partial().parse(req.body);
  const data = await courseService.updateCourse({
    id: req.params.id as string,
    validated,
    materialCategories,
    examCategories,
  });
  return success(res, data as any);
});

export const deleteCourse = asyncHandler(async (req: Request, res: Response) => {
  const data = await courseService.deleteCourse(req.params.id as string);
  return success(res, data, "Course deleted successfully.");
});

export const toggleCoursePopular = asyncHandler(async (req: Request, res: Response) => {
  const data = await courseService.toggleCoursePopular(req.params.id as string, req.body?.isPopular);
  return success(
    res,
    data,
    `Course marked as ${data.isPopular ? "popular" : "not popular"}`
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Plans (course-scoped)
// ──────────────────────────────────────────────────────────────────────────────

export const createCoursePlan = asyncHandler(async (req: Request, res: Response) => {
  const validated = createCoursePlanSchema.parse(req.body);
  const data = await courseService.createCoursePlan(req.params.id as string, validated);
  return res
    .status(201)
    .json({ success: true, message: "Pricing plan created successfully", data });
});

export const getCoursePlans = asyncHandler(async (req: Request, res: Response) => {
  const data = await courseService.listCoursePlans(req.params.id as string);
  return res.status(200).json({ success: true, data });
});

export const getCoursePlanById = asyncHandler(async (req: Request, res: Response) => {
  const data = await courseService.getCoursePlanById(req.params.planId as string);
  return success(res, data);
});

export const updateCoursePlan = asyncHandler(async (req: Request, res: Response) => {
  const validated = updateCoursePlanSchema.parse(req.body);
  const data = await courseService.updateCoursePlan(req.params.planId as string, validated);
  return success(res, data);
});

export const deleteCoursePlan = asyncHandler(async (req: Request, res: Response) => {
  await courseService.deleteCoursePlan(req.params.planId as string);
  return success(res, {}, "Pricing plan deleted successfully");
});

// ──────────────────────────────────────────────────────────────────────────────
// Video category relations
// ──────────────────────────────────────────────────────────────────────────────

export const getVideoCategoryRelations = asyncHandler(
  async (req: Request, res: Response) => {
    const { data, pagination } = await courseService.listVideoCategoryRelations(
      req.query as courseService.ListVideoCategoryRelationsQuery
    );
    return res.status(200).json({ success: true, data, pagination });
  }
);

export const createVideoCategoryRelation = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await courseService.createVideoCategoryRelation(req.body || {});
    return res.status(201).json({ success: true, data });
  }
);

export const updateVideoCategoryRelation = asyncHandler(
  async (req: Request, res: Response) => {
    const order = Number(req.body?.order ?? 0);
    const data = await courseService.updateVideoCategoryRelation(
      req.params.relationId as string,
      order
    );
    return success(res, data as any);
  }
);

export const deleteVideoCategoryRelation = asyncHandler(
  async (req: Request, res: Response) => {
    await courseService.deleteVideoCategoryRelation(req.params.relationId as string);
    return success(res, {}, "Relation deleted successfully.");
  }
);
