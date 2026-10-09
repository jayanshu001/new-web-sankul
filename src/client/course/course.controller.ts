// Client courses: HTTP handlers for catalog, detail, shipping, orders and invoices.
import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import logger from "../../utils/logger";
import { CRM_LEAD_TYPE } from "../../shared/enums";
import { queueCRMLead } from "../../utils/crm";
import { buildCourseReceiptHtml, buildCourseReceiptHtmlBySub, buildLiveCourseReceiptHtml, buildTestSeriesReceiptHtml, buildTestSeriesReceiptHtmlBySub, renderPdfFromHtml } from "../../libs/core/generate";
import { shippingBodySchema } from "./course.validation";
import {
  upsertCourseOrderShipping,
  getOrderDetailsForUser,
} from "./course.service";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { omit, omitList } from "../../utils/pick";
import { buildCourseDetailsSql } from "../../modules/catalog-course/course-detail.sql";
import {
  listCourseCategoriesWithCounts,
  listCoursesWithPlans,
  parseCourseId,
} from "../../modules/catalog-course/catalog-course.service";
import type { ListCoursesOptions } from "../../modules/catalog-course/catalog-course.types";

// Accepts a 24-hex legacy id as well as a positive int so order-id validation keeps
// its original contract; real order ids are ints.
const isObjectId = (v: string) => /^([a-fA-F0-9]{24}|[1-9]\d*)$/.test(v);

/** `userId` is parsed defensively: a non-int id yields no purchase state rather than throwing. */
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
    const result = await listCoursesWithPlans(
      toMysqlCourseOptions(req.query as Record<string, string>, userId)
    );
    logger.info("listCoursesHandler success", { traceId, userId, total: result.pagination.total, source: "mysql" });
    const data = omitList(result.data as any[], ["withMaterial", "withoutMaterial", "order", "status", "videoCategoryId", "pcMaterialId"]);
    return res.status(200).json({ success: true, data, pagination: result.pagination });
  } catch (err) {
    logger.error("listCoursesHandler failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const listCourseCategoriesHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listCourseCategoriesHandler invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, page, limit, skip } = parseListQuery(req.query as Record<string, any>);
    const { data, total } = await listCourseCategoriesWithCounts({ search, skip, limit });
    const pagination = buildPagination(total, page, limit);
    logger.info("listCourseCategoriesHandler success", { traceId, count: data.length, total, source: "mysql" });
    return res.status(200).json({ success: true, data, pagination });
  } catch (err) {
    logger.error("listCourseCategoriesHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const listCoursesByCategoryHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const { categoryId } = req.params as { categoryId: string };
  logger.info("listCoursesByCategoryHandler invoked", { traceId, path: req.originalUrl, userId, categoryId });

  try {
    const catId = parseCourseId(categoryId);
    if (catId == null) {
      logger.warn("listCoursesByCategoryHandler invalid id", { traceId, categoryId });
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
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// Course detail without tab content; queues a VIEW_COURSE CRM lead for signed-in users.
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
    if (!userId && !req.isGuest) return failure(res, "Unauthorized request.", 401);

    const cidNum = parseCourseId(courseId);
    const userNum = userId ? parseCourseId(String(userId)) : null;
    if (cidNum == null) return failure(res, "Please select valid package", 400);
    const sqlResponse = await buildCourseDetailsSql(cidNum, userNum ?? undefined);
    if (!sqlResponse) return failure(res, "Please select valid package", 400);
    const requestBase = process.env.ORIGIN || `${req.protocol}://${req.get("host")}`;
    (sqlResponse as any).shareableLink = buildShareUrl("courses", courseId, requestBase);
    if (userId) {
      queueCRMLead({ params: { userId, courseId }, leadType: CRM_LEAD_TYPE.VIEW_COURSE }, { traceId, userId, courseId });
    }
    logger.info("getCourseByIdHandler success", { traceId, userId, courseId });
    // Tab content is loaded via GET /client/catalog/:type/:id/{videos|materials|tests}.
    const slimResponse = omit(sqlResponse as any, ["videos", "materials", "tests", "availablePromoCode"]);
    return success(res, slimResponse, "Course details fetched successfully.", 200);
  } catch (err) {
    logger.error("getCourseByIdHandler failed", {
      traceId,
      userId,
      courseId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
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
    return failure(res, "Something went wrong. Please try again later.", 500);
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
    // A non-int (legacy 24-hex) id passes validation but simply matches no row.
    if (!isObjectId(orderId) && !/^[1-9][0-9]*$/.test(orderId)) {
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
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// Render a purchase-history receipt as PDF, picking the builder by the id prefix.
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
    // Serves every row of GET /client/purchase-history/subscriptions, whose `_id`
    // prefix says which table the id belongs to (PK spaces overlap numerically).
    // Keep in sync with purchase-history/receipts.controller.ts:
    //   (plain) → package/course ORDER id, falling back to a subscription id
    //   "lc_"   → live-course subscription id
    //   "ts_"   → test-series ORDER id
    //   "pcs_"  → legacy package/course subscription (no order row)
    //   "tss_"  → legacy test-series subscription (no order row)
    // Longest prefix first: "tss_" must be tested before "ts_".
    const BUILDERS: Array<[string, (id: string, uid: string) => Promise<string>]> = [
      ["pcs_", buildCourseReceiptHtmlBySub],
      ["tss_", buildTestSeriesReceiptHtmlBySub],
      ["lc_", buildLiveCourseReceiptHtml],
      ["ts_", buildTestSeriesReceiptHtml],
    ];
    const matched = BUILDERS.find(([prefix]) => orderId.startsWith(prefix));
    const rawOrderId = matched ? orderId.slice(matched[0].length) : orderId;
    const build = matched ? matched[1] : buildCourseReceiptHtml;

    // Each builder does its own ownership (_id + customerId) and paid re-validation.
    if (!isObjectId(rawOrderId) && !/^[1-9][0-9]*$/.test(rawOrderId)) {
      return failure(res, "Please select valid package", 400);
    }

    const html = await build(rawOrderId, userId);
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
