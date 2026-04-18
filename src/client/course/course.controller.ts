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

    const response = await buildCourseDetails(courseId);
    if (!response) {
      return failure(res, "Please select valid package", 400);
    }

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

    const shipping = await upsertCourseOrderShipping(userId, parsed.data);
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

    const subscription = await getOrderDetailsForUser(orderId, userId);
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

    const sub = await getOrderForInvoice(orderId, userId);
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
