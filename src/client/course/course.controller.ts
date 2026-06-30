import { Request, Response } from "express";
import { Types } from "mongoose";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { CRM_LEAD_TYPE } from "../../models/enums";
import { GenerateCRMLead } from "../../utils/crm";
import { buildCourseReceiptHtml, renderPdfFromHtml } from "../../libs/core/generate";
import { shippingBodySchema } from "./course.validation";
import {
  upsertCourseOrderShipping,
  getOrderDetailsForUser,
} from "./course.service";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { buildCourseDetailsSql } from "../../modules/catalog-course/course-detail.sql";
import {
  listCourseCategoriesWithCounts,
  listCoursesWithPlans,
  parseCourseId,
} from "../../modules/catalog-course/catalog-course.service";
import type { ListCoursesOptions } from "../../modules/catalog-course/catalog-course.types";

/**
 * Map the listing query string → the MySQL `listCoursesWithPlans` options.
 * `userId` in the migrated id-space is the int customer id (customer-auth); we
 * parse it defensively so a stray ObjectId (while flag OFF) just yields no
 * purchase-state rather than throwing.
 */
function toMysqlCourseOptions(
  query: Record<string, string>,
  userId?: string,
  categoryId?: number
): ListCoursesOptions {
  const { search, isPopular, page, limit, sortBy, sortOrder } = query;
  const custId = userId != null ? parseCourseId(String(userId)) : null;
  return {
    search: search?.trim() || undefined,
    isPopular: isPopular === "true" ? true : isPopular === "false" ? false : undefined,
    page: page ? parseInt(page, 10) || 1 : 1,
    limit: limit ? parseInt(limit, 10) || 10 : 10,
    sortBy: sortBy === "name" || sortBy === "ordered" ? sortBy : "createdAt",
    sortOrder: sortOrder === "asc" ? "asc" : "desc",
    customerId: custId ?? undefined,
    categoryId,
  };
}

export const listCoursesHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listCoursesHandler invoked", { traceId, path: req.originalUrl, userId });

  try {
    // Composes catalog-course + commerce-price + commerce-subscription; returns
    // the { data, pagination } contract.
    const result = await listCoursesWithPlans(
      toMysqlCourseOptions(req.query as Record<string, string>, userId)
    );
    logger.info("listCoursesHandler success", { traceId, userId, total: result.pagination.total, source: "mysql" });
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
    const data = await listCourseCategoriesWithCounts();
    logger.info("listCourseCategoriesHandler success", { traceId, count: data.length, source: "mysql" });
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
    const catId = parseCourseId(categoryId);
    if (catId == null) {
      logger.warn("listCoursesByCategoryHandler invalid id (mysql)", { traceId, categoryId });
      return failure(res, "Invalid categoryId.", 400);
    }
    const result = await listCoursesWithPlans(
      toMysqlCourseOptions(req.query as Record<string, string>, userId, catId)
    );
    logger.info("listCoursesByCategoryHandler success", { traceId, userId, categoryId, total: result.pagination.total, source: "mysql" });
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

    // ─── SQL branch (int id-space) ───
    const cidNum = parseCourseId(courseId);
    const userNum = parseCourseId(String(userId));
    if (cidNum == null) return failure(res, "Please select valid package", 400);
    const sqlResponse = await buildCourseDetailsSql(cidNum, userNum ?? undefined);
    if (!sqlResponse) return failure(res, "Please select valid package", 400);
    const requestBase = process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;
    (sqlResponse as any).shareableLink = buildShareUrl("courses", courseId, requestBase);
    setImmediate(() => {
      void GenerateCRMLead({ params: { userId, courseId }, leadType: CRM_LEAD_TYPE.VIEW_COURSE }).catch((err) => {
        logger.warn("GenerateCRMLead (fire-and-forget) failed", { traceId, userId, courseId, error: getErrorMessage(err) });
      });
    });
    logger.info("getCourseByIdHandler success (sql)", { traceId, userId, courseId });
    return success(res, sqlResponse, "Course details fetched successfully.", 200);
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
    // Accept a SQL int order id (MySQL id-space) OR a Mongo ObjectId. The
    // receipt builder branches on isMysqlModule and re-validates ownership.
    if (!Types.ObjectId.isValid(orderId) && !/^[1-9][0-9]*$/.test(orderId)) {
      return failure(res, "Please select valid package", 400);
    }

    // Build the receipt HTML (shared EJS template — identical to the ebook/book
    // invoices) then rasterise it via the shared Puppeteer renderer.
    // buildCourseReceiptHtml does its own ownership (_id + customerId) and paid
    // checks.
    const html = await buildCourseReceiptHtml(orderId, userId);
    const buffer = await renderPdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", buffer.length);
    logger.info("getOrderInvoiceHandler success", { traceId, userId, orderId });
    return res.send(buffer);
  } catch (err: any) {
    const msg = err?.message || "Failed to generate invoice.";
    const code = /not found|invalid|not been paid/i.test(msg) ? 404 : 500;
    if (code === 500) {
      logger.error("getOrderInvoiceHandler failed", {
        traceId,
        userId,
        orderId,
        error: getErrorMessage(err),
        stack: (err as Error).stack,
      });
    } else {
      logger.warn("getOrderInvoiceHandler client error", { traceId, userId, orderId, msg });
    }
    return failure(res, msg, code);
  }
};
