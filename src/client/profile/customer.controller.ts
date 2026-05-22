import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import {
  updateCustomerProfile,
  getCustomerProfile,
  upsertCustomerProfilePicture,
  deleteCustomerProfilePicture,
  deleteCustomerAccount,
  updateCustomerFirebaseToken,
  registerDeviceToken,
  unregisterDeviceToken,
} from "./customer.service";
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

    const { firstName, middleName, lastName, email, goals, phone2, dob, gender, stateId, districtId, city, educationId, language } = req.body;

    const result = await updateCustomerProfile(userId, {
      firstName,
      middleName,
      lastName,
      email,
      goals,
      phone2,
      dob,
      gender,
      stateId,
      districtId,
      city,
      educationId,
      language,
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

/**
 * PUT /api/v1/client/profile/profile-picture
 * Body: multipart/form-data { image: file }
 */
export const upsertProfilePictureHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("upsertProfilePictureHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId,
  });

  try {
    if (!userId) {
      logger.warn("upsertProfilePictureHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    // `multer-s3` attaches the S3 URL exactly to `req.file.location`
    const file = req.file as any;
    const image = file?.location as string | undefined;

    if (!image) {
      logger.warn("upsertProfilePictureHandler missing image", { traceId, userId });
      return failure(res, "Profile picture image is required.", 422);
    }

    const result = await upsertCustomerProfilePicture(userId, { image }, traceId);

    if (!result.ok) {
      logger.warn("upsertProfilePictureHandler failed", {
        traceId,
        userId,
        message: result.message,
      });
      return failure(res, result.message, 400);
    }

    logger.info("upsertProfilePictureHandler success", { traceId, userId });
    return success(res, result.data, result.message, 200);
  } catch (err) {
    logger.error("upsertProfilePictureHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * DELETE /api/v1/client/profile
 * Soft-deletes the authenticated customer's account and invalidates all tokens.
 */
export const deleteAccountHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("deleteAccountHandler invoked", { traceId, userId });
  try {
    if (!userId) {
      logger.warn("deleteAccountHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }
    const result = await deleteCustomerAccount(userId, traceId);
    if (!result.ok) return failure(res, result.message, 404);
    logger.info("deleteAccountHandler success", { traceId, userId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("deleteAccountHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * PATCH /api/v1/client/profile/firebase-token
 * Body: { phoneNumber: string; firebaseToken: string }
 * No auth required — called immediately after login on device.
 */
export const updateFirebaseTokenHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("updateFirebaseTokenHandler invoked", { traceId });
  try {
    const { phoneNumber, firebaseToken, platform } = req.body;
    if (!phoneNumber || !firebaseToken) {
      return failure(res, "phoneNumber and firebaseToken are required.", 422);
    }
    const normalizedPlatform =
      platform === "ios" || platform === "android" ? platform : undefined;
    const result = await updateCustomerFirebaseToken(
      String(phoneNumber),
      String(firebaseToken),
      normalizedPlatform,
      traceId
    );
    if (!result.ok) return failure(res, result.message, 404);
    logger.info("updateFirebaseTokenHandler success", { traceId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("updateFirebaseTokenHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * PUT /api/v1/client/profile/device-token
 * Body: { firebaseToken: string; platform?: "ios" | "android" }
 * Authenticated. Preferred over the legacy phone-based endpoint.
 */
export const registerDeviceTokenHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("registerDeviceTokenHandler invoked", { traceId, userId });

  try {
    if (!userId) { logger.warn("registerDeviceTokenHandler unauthorized", { traceId }); return failure(res, "Unauthorized request.", 401); }
    const { firebaseToken, platform } = req.body;
    if (!firebaseToken || typeof firebaseToken !== "string") {
      logger.warn("registerDeviceTokenHandler missing firebaseToken", { traceId, userId });
      return failure(res, "firebaseToken is required.", 422);
    }
    const normalizedPlatform =
      platform === "ios" || platform === "android" ? platform : undefined;
    const result = await registerDeviceToken(userId, firebaseToken, normalizedPlatform, traceId);
    if (!result.ok) { logger.warn("registerDeviceTokenHandler service failure", { traceId, userId, message: result.message }); return failure(res, result.message, 404); }
    logger.info("registerDeviceTokenHandler success", { traceId, userId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("registerDeviceTokenHandler failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * DELETE /api/v1/client/profile/device-token
 * Body: { firebaseToken: string }
 * Authenticated. Removes only this device's token, leaving other logged-in
 * devices receiving pushes.
 */
export const unregisterDeviceTokenHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("unregisterDeviceTokenHandler invoked", { traceId, userId });

  try {
    if (!userId) { logger.warn("unregisterDeviceTokenHandler unauthorized", { traceId }); return failure(res, "Unauthorized request.", 401); }
    const { firebaseToken } = req.body;
    if (!firebaseToken || typeof firebaseToken !== "string") {
      logger.warn("unregisterDeviceTokenHandler missing firebaseToken", { traceId, userId });
      return failure(res, "firebaseToken is required.", 422);
    }
    const result = await unregisterDeviceToken(userId, firebaseToken, traceId);
    if (!result.ok) { logger.warn("unregisterDeviceTokenHandler service failure", { traceId, userId, message: result.message }); return failure(res, result.message, 404); }
    logger.info("unregisterDeviceTokenHandler success", { traceId, userId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("unregisterDeviceTokenHandler failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * DELETE /api/v1/client/profile/profile-picture
 */
export const deleteProfilePictureHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("deleteProfilePictureHandler invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("deleteProfilePictureHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    const result = await deleteCustomerProfilePicture(userId, traceId);

    if (!result.ok) {
      logger.warn("deleteProfilePictureHandler failed", {
        traceId,
        userId,
        message: result.message,
      });
      return failure(res, result.message, 400);
    }

    logger.info("deleteProfilePictureHandler success", { traceId, userId });
    return success(res, result.data, result.message, 200);
  } catch (err) {
    logger.error("deleteProfilePictureHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};
