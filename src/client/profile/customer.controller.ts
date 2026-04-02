import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { updateCustomerProfile, getCustomerProfile } from "./customer.service";
import logger from "../../utils/logger";

export const updateProfileHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("updateProfileHandler invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("updateProfileHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    const { firstName, middleName, lastName, email, goals } = req.body;

    const result = await updateCustomerProfile(userId, {
      firstName,
      middleName,
      lastName,
      email,
      goals,
    }, traceId);

    if (!result.ok) {
      logger.warn("updateProfileHandler validation failed", { traceId, userId, data: req.body });
      return failure(res, result.message, 400);
    }

    logger.info("updateProfileHandler success", { traceId, userId });
    return success(res, result?.data, result.message, 200);
  } catch (err) {
    logger.error("updateProfileHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const getProfileHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getProfileHandler invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("getProfileHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    const result = await getCustomerProfile(userId, traceId);
    if (!result.ok) {
      logger.warn("getProfileHandler not found", { traceId, userId });
      return failure(res, result.message, 404);
    }

    logger.info("getProfileHandler success", { traceId, userId });
    return success(res, result.data, result.message, 200);
  } catch (err) {
    logger.error("getProfileHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};
