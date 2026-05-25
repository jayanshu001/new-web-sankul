import { Request, Response } from "express";
import { Types } from "mongoose";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { CRM_LEAD_TYPE } from "../../models/enums";
import { GenerateCRMLead } from "../../utils/crm";
import { pdfCourseReceipt } from "../../utils/pdfCourseReceipt";
import { shippingBodySchema } from "./course.validation";
import {
  buildCourseDetails,
  upsertCourseOrderShipping,
  getOrderDetailsForUser,
  getOrderForInvoice,
} from "./course.service";
import { Course } from "../../models/course/Course.model";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { buildShareUrl } from "../../deeplinking/shareRedirect";

async function paginateCoursesWithPlans(
  baseFilters: any,
  query: Record<string, string>,
  userId?: string
) {
  const {
    search = "",
    isPopular,
    page = "1",
    limit = "10",
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const filters: any = { ...baseFilters };
  if (isPopular === "true" || isPopular === "false") {
    filters.isPopular = isPopular === "true";
  }
  if (search) {
    filters.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
  const skip = (pageNum - 1) * limitNum;
  const sortDirection = sortOrder === "asc" ? 1 : -1;

  const [courses, total] = await Promise.all([
    Course.find(filters)
      .populate("courseEducatorId", "_id name")
      .populate("courseSubjectCategoryId", "_id title")
      .populate("videoCategoryId", "_id title")
      .sort({ [sortBy]: sortDirection })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Course.countDocuments(filters),
  ]);

  const courseIds = courses.map((c: any) => c._id);
  const allPlans = courseIds.length
    ? await PackageCourseEbookPrice.find({
        courseId: { $in: courseIds },
        status: true,
      })
        .sort({ duration: 1 })
        .lean()
    : [];

  const plansByCourse = new Map<string, { withMaterial: any[]; withoutMaterial: any[] }>();
  for (const p of allPlans as any[]) {
    const key = String(p.courseId);
    let bucket = plansByCourse.get(key);
    if (!bucket) {
      bucket = { withMaterial: [], withoutMaterial: [] };
      plansByCourse.set(key, bucket);
    }
    (p.withMaterial ? bucket.withMaterial : bucket.withoutMaterial).push(p);
  }

  let purchasedSet = new Set<string>();
  if (userId && courseIds.length) {
    const now = new Date();
    const planIds = (allPlans as any[]).map((p) => p._id);
    const subs = await PackageCourseSubscription.find({
      customerId: userId,
      paymentStatus: "verified",
      status: true,
      $and: [
        { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
        { $or: [{ courseId: { $in: courseIds } }, { packageId: { $in: planIds } }] },
      ],
    })
      .select("courseId packageId")
      .lean();
    const planToCourse = new Map<string, string>(
      (allPlans as any[]).map((p) => [String(p._id), String(p.courseId)])
    );
    subs.forEach((s: any) => {
      if (s.courseId) purchasedSet.add(String(s.courseId));
      const viaPlan = planToCourse.get(String(s.packageId));
      if (viaPlan) purchasedSet.add(viaPlan);
    });
  }

  const data = courses.map((c: any) => ({
    ...c,
    isPaid: c.isPaid ?? true,
    isPurchased: purchasedSet.has(String(c._id)),
    plans: plansByCourse.get(String(c._id)) ?? { withMaterial: [], withoutMaterial: [] },
  }));

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
}

export const listCoursesHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listCoursesHandler invoked", { traceId, path: req.originalUrl, userId });

  try {
    const result = await paginateCoursesWithPlans({ status: true }, req.query as Record<string, string>, userId);
    logger.info("listCoursesHandler success", { traceId, userId, total: result.pagination.total });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error("listCoursesHandler failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

// GET /api/v1/client/courses/categories
// Lists active course subject categories with the count of active courses in each.
export const listCourseCategoriesHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCourseCategoriesHandler invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const categories = await CourseSubjectCategory.find({ status: true })
      .sort({ order: 1, title: 1 })
      .lean();

    const ids = categories.map((c: any) => c._id);
    const counts = ids.length
      ? await Course.aggregate([
          { $match: { status: true, courseSubjectCategoryId: { $in: ids } } },
          { $group: { _id: "$courseSubjectCategoryId", count: { $sum: 1 } } },
        ])
      : [];
    const countByCategory = new Map<string, number>();
    for (const row of counts) countByCategory.set(String(row._id), row.count);

    const data = categories.map((c: any) => ({
      ...c,
      courseCount: countByCategory.get(String(c._id)) ?? 0,
    }));

    logger.info("listCourseCategoriesHandler success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error("listCourseCategoriesHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

// GET /api/v1/client/courses/categories/:categoryId/courses
// Lists active courses inside a given category, with plans (same shape as the main list).
export const listCoursesByCategoryHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const { categoryId } = req.params as { categoryId: string };
  logger.info("listCoursesByCategoryHandler invoked", { traceId, path: req.originalUrl, userId, categoryId });

  try {
    if (!Types.ObjectId.isValid(categoryId)) {
      logger.warn("listCoursesByCategoryHandler invalid id", { traceId, categoryId });
      return failure(res, "Invalid categoryId.", 400);
    }
    const result = await paginateCoursesWithPlans(
      { status: true, courseSubjectCategoryId: new Types.ObjectId(categoryId) },
      req.query as Record<string, string>,
      userId
    );
    logger.info("listCoursesByCategoryHandler success", { traceId, userId, categoryId, total: result.pagination.total });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error("listCoursesByCategoryHandler failed", {
      traceId,
      userId,
      categoryId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const getCourseByIdHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const courseId = req.params.id as string;
  logger.info("getCourseByIdHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId,
    courseId,
  });

  try {
    if (!userId) return failure(res, "Unauthorized request.", 401);
    if (!Types.ObjectId.isValid(courseId)) {
      return failure(res, "Please select valid package", 400);
    }

    const response = await buildCourseDetails(courseId, userId, traceId);
    if (!response) {
      return failure(res, "Please select valid package", 400);
    }

    const requestBase = process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;
    (response as any).shareableLink = buildShareUrl("courses", courseId, requestBase);

    setImmediate(() => {
      void GenerateCRMLead({
        params: { userId, courseId },
        leadType: CRM_LEAD_TYPE.VIEW_COURSE,
      }).catch((err) => {
        logger.warn("GenerateCRMLead (fire-and-forget) failed", {
          traceId,
          userId,
          courseId,
          error: getErrorMessage(err),
        });
      });
    });

    logger.info("getCourseByIdHandler success", { traceId, userId, courseId });
    return success(res, response, "Course details fetched successfully.", 200);
  } catch (err) {
    logger.error("getCourseByIdHandler failed", {
      traceId,
      userId,
      courseId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const addCourseOrderShippingHandler = async (
  req: Request,
  res: Response
) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("addCourseOrderShippingHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId,
  });

  try {
    if (!userId) return failure(res, "Unauthorized request.", 401);

    const parsed = shippingBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("addCourseOrderShippingHandler validation failed", {
        traceId,
        userId,
        issues: parsed.error.issues,
      });
      return failure(
        res,
        parsed.error.issues[0]?.message ?? "Invalid shipping data",
        400
      );
    }

    const shipping = await upsertCourseOrderShipping(userId, parsed.data, traceId);
    if (!shipping) {
      return failure(res, "Unable to save shipping", 400);
    }

    logger.info("addCourseOrderShippingHandler success", { traceId, userId });
    return success(res, shipping, "Shipping saved successfully.", 200);
  } catch (err) {
    logger.error("addCourseOrderShippingHandler failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const getOrderDetailsHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const orderId = req.params.id as string;
  logger.info("getOrderDetailsHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId,
    orderId,
  });

  try {
    if (!userId) return failure(res, "Unauthorized request.", 401);
    if (!Types.ObjectId.isValid(orderId)) {
      return failure(res, "Please select valid package", 400);
    }

    const subscription = await getOrderDetailsForUser(orderId, userId, traceId);
    if (!subscription) {
      return failure(res, "Invalid Subscription Order!", 400);
    }

    logger.info("getOrderDetailsHandler success", { traceId, userId, orderId });
    return success(res, subscription, "Order details fetched successfully.", 200);
  } catch (err) {
    logger.error("getOrderDetailsHandler failed", {
      traceId,
      userId,
      orderId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const getOrderInvoiceHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const orderId = req.params.id as string;
  logger.info("getOrderInvoiceHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId,
    orderId,
  });

  try {
    if (!userId) return failure(res, "Unauthorized request.", 401);
    if (!Types.ObjectId.isValid(orderId)) {
      return failure(res, "Please select valid package", 400);
    }

    const sub = await getOrderForInvoice(orderId, userId, traceId);
    if (!sub) {
      return failure(res, "Invalid Package / Course Order!", 400);
    }

    const buffer = await pdfCourseReceipt(orderId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", buffer.length);
    logger.info("getOrderInvoiceHandler success", { traceId, userId, orderId });
    return res.send(buffer);
  } catch (err) {
    logger.error("getOrderInvoiceHandler failed", {
      traceId,
      userId,
      orderId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};
