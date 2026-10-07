// Admin courses: HTTP handlers for courses, plans, linked content and video categories.
import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import { HttpError } from "../../middlewares/errorHandler";
import { parseListQuery } from "../../utils/listQuery";
import { listPromocodesForScope } from "../../modules/promo-code/promo-code.service";
import {
  createCourseSqlSchema,
  createCoursePlanSchema,
  updateCoursePlanSchema,
  linkCourseBooksSchema,
  reorderCourseBooksSchema,
  reorderCourseCategoriesSchema,
} from "./course.validation";
import {
  createMaterialSchema,
  updateMaterialSchema,
  createVideoCategorySchema,
  updateVideoCategorySchema,
} from "../master/master.validation";
import * as courseService from "./course.service";

// Multipart sends every field as a string; normalize before Zod.
const coerceCourseBodySql = (req: Request) => {
  const file = req.file as any;
  if (file?.location) req.body.image = file.location;
  if (typeof req.body.ordered === "string") req.body.ordered = Number(req.body.ordered);
  if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
  if (typeof req.body.isPaid === "string") req.body.isPaid = req.body.isPaid === "true";
  if (typeof req.body.isPopular === "string") req.body.isPopular = req.body.isPopular === "true";
  // The detail GET returns these refs populated ({_id,name}) and the edit form
  // round-trips the object (or ""). Flatten to an id string and drop empties so
  // coerce.number never sees an object (NaN).
  const flattenIdRef = (v: any): any => {
    if (v == null) return undefined;
    if (typeof v === "object" && !Array.isArray(v)) {
      const id = v._id ?? v.id;
      return id != null ? String(id) : undefined;
    }
    // Multipart sends a ref object as a JSON string, or as "[object Object]".
    if (typeof v === "string") {
      const s = v.trim();
      if (s === "" || s === "null" || s === "undefined" || s === "[object Object]") return undefined;
      if (s.startsWith("{")) {
        try {
          const o = JSON.parse(s);
          const id = o?._id ?? o?.id;
          return id != null ? String(id) : undefined;
        } catch {
          /* not JSON — fall through */
        }
      }
      return s;
    }
    return v;
  };
  for (const k of ["courseEducatorId", "courseSubjectCategoryId", "videoCategoryId"] as const) {
    if (k in req.body) {
      const norm = flattenIdRef(req.body[k]);
      if (norm === undefined) delete req.body[k];
      else req.body[k] = norm;
    }
  }
  delete req.body.examCountdownCategoryId;
  const parseRefs = (raw: any): Array<{ category: number; order: number }> | undefined => {
    if (raw === undefined || raw === null || raw === "") return undefined;
    let items = raw;
    if (typeof raw === "string") { try { items = JSON.parse(raw); } catch { return undefined; } }
    if (!Array.isArray(items)) return undefined;
    return items
      .map((i: any) => ({ category: Number(i?.category), order: Number(i?.order) || 0 }))
      .filter((r) => Number.isInteger(r.category) && r.category > 0);
  };
  const materialCategories = parseRefs(req.body.materialCategories);
  const examCategories = parseRefs(req.body.examCategories);
  if (materialCategories !== undefined) req.body.materialCategories = materialCategories;
  if (examCategories !== undefined) req.body.examCategories = examCategories;
  const parseIdList = (raw: any): number[] | undefined => {
    if (raw === undefined || raw === null || raw === "") return undefined;
    let items = raw;
    if (typeof raw === "string") { try { items = JSON.parse(raw); } catch { return undefined; } }
    if (!Array.isArray(items)) return undefined;
    return items.map((i: any) => Number(i)).filter((n) => Number.isInteger(n) && n > 0);
  };
  const examCountdownIds = parseIdList(req.body.examCountdownIds);
  const examCountdownCategoryIds = parseIdList(req.body.examCountdownCategoryIds);
  if (examCountdownIds !== undefined) req.body.examCountdownIds = examCountdownIds;
  if (examCountdownCategoryIds !== undefined) req.body.examCountdownCategoryIds = examCountdownCategoryIds;
  return { materialCategories, examCategories };
};

// Form dropdown options: active educators, subject/video categories and materials.
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

export const createCourse = asyncHandler(async (req: Request, res: Response) => {
  coerceCourseBodySql(req);
  const v = createCourseSqlSchema.parse(req.body);
  const data = await courseService.createCourseSql(v);
  return res.status(201).json({ success: true, message: "Course created successfully", data });
});

export const updateCourse = asyncHandler(async (req: Request, res: Response) => {
  coerceCourseBodySql(req);
  // Educator stays required on update so it can't be cleared.
  const v = createCourseSqlSchema
    .partial()
    .required({ courseEducatorId: true })
    .parse(req.body);
  const data = await courseService.updateCourseSql(req.params.id as string, v);
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

export const toggleCourseStatus = asyncHandler(async (req: Request, res: Response) => {
  const data = await courseService.toggleCourseStatus(req.params.id as string, req.body?.status);
  return success(
    res,
    data,
    `Course ${data.status ? "activated" : "deactivated"}`
  );
});

export const createCoursePlan = asyncHandler(async (req: Request, res: Response) => {
  const validated = createCoursePlanSchema.parse(req.body);
  const data = await courseService.createCoursePlan(req.params.id as string, validated);
  return res
    .status(201)
    .json({ success: true, message: "Pricing plan created successfully", data });
});

export const getCoursePlans = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
  const { data, pagination } = await courseService.listCoursePlans(req.params.id as string, {
    skip,
    take: limit,
    page,
    limit,
  });
  return res.status(200).json({ success: true, data, pagination });
});

export const getCoursePromocodes = asyncHandler(async (req: Request, res: Response) => {
  const courseId = courseService.parseCourseSqlId(req.params.id as string);
  if (!courseId) throw new HttpError(400, "Invalid Course ID");
  const q = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
  const { data, pagination } = await listPromocodesForScope("course", courseId, q);
  return res.status(200).json({ success: true, data, pagination });
});

export const getCourseExamCategories = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
  const { data, pagination } = await courseService.listCourseExamCategories(req.params.id as string, {
    search,
    skip,
    take: limit,
    page,
    limit,
  });
  return res.status(200).json({ success: true, data, pagination });
});

export const getCourseMaterialCategories = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
  const { data, pagination } = await courseService.listCourseMaterialCategories(req.params.id as string, {
    search,
    skip,
    take: limit,
    page,
    limit,
  });
  return res.status(200).json({ success: true, data, pagination });
});

export const getCourseBooks = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
  const { data, pagination } = await courseService.listCourseBooks(req.params.id as string, {
    search,
    skip,
    take: limit,
    page,
    limit,
  });
  return res.status(200).json({ success: true, data, pagination });
});

// Idempotent.
export const linkCourseBooks = asyncHandler(async (req: Request, res: Response) => {
  const { bookIds } = linkCourseBooksSchema.parse(req.body);
  const data = await courseService.linkCourseBooks(req.params.id as string, bookIds);
  return res.status(201).json({ success: true, message: "Books linked to course.", data });
});

export const reorderCourseBooks = asyncHandler(async (req: Request, res: Response) => {
  const { order } = reorderCourseBooksSchema.parse(req.body);
  const data = await courseService.reorderCourseBooks(req.params.id as string, order);
  return res.status(200).json({ success: true, message: "Book order updated.", data });
});

export const reorderCourseExamCategories = asyncHandler(async (req: Request, res: Response) => {
  const { order } = reorderCourseCategoriesSchema.parse(req.body);
  const data = await courseService.reorderCourseExamCategories(req.params.id as string, order);
  return res.status(200).json({ success: true, message: "Exam category order updated.", data });
});

export const reorderCourseMaterialCategories = asyncHandler(async (req: Request, res: Response) => {
  const { order } = reorderCourseCategoriesSchema.parse(req.body);
  const data = await courseService.reorderCourseMaterialCategories(req.params.id as string, order);
  return res.status(200).json({ success: true, message: "Material category order updated.", data });
});

export const unlinkCourseBook = asyncHandler(async (req: Request, res: Response) => {
  const data = await courseService.unlinkCourseBook(req.params.id as string, req.params.bookId as string);
  return res.status(200).json({ success: true, message: "Book unlinked from course.", data });
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
