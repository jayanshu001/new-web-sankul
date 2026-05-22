import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import {
  promoterLogin,
  promoterRefresh,
  promoterLogout,
  promoterChangePassword,
  promoterUpdateProfile,
  promoterGetProfile,
} from "./promoter.auth.service";
import logger from "../../utils/logger";

export const loginHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("loginHandler invoked", { traceId, path: req.originalUrl, email: req.body?.email });

  try {
    const { email, password } = req.body;
    if (!email || !password) { logger.warn("loginHandler missing credentials", { traceId }); return failure(res, "Email and password are required.", 422); }
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip;
    const result = await promoterLogin(String(email), String(password), ip, traceId);
    if (!result.ok) { logger.warn("loginHandler failed", { traceId, email, message: result.message }); return failure(res, result.message, 401); }
    logger.info("loginHandler success", { traceId, promoterId: (result.promoter as any)?.id });
    return success(
      res,
      { promoter: result.promoter, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    logger.error("loginHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const refreshHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("refreshHandler invoked", { traceId, path: req.originalUrl });

  try {
    const { refreshToken } = req.body;
    if (!refreshToken) { logger.warn("refreshHandler missing token", { traceId }); return failure(res, "Refresh token is required.", 422); }
    const result = await promoterRefresh(String(refreshToken), traceId);
    if (!result.ok) { logger.warn("refreshHandler failed", { traceId, message: result.message }); return failure(res, result.message, 401); }
    logger.info("refreshHandler success", { traceId, promoterId: (result.promoter as any)?.id });
    return success(
      res,
      { promoter: result.promoter, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    logger.error("refreshHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const logoutHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("logoutHandler invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("logoutHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const result = await promoterLogout(promoterId, traceId);
    logger.info("logoutHandler success", { traceId, promoterId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("logoutHandler failed", { traceId, promoterId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const meHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("meHandler invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("meHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const result = await promoterGetProfile(promoterId, traceId);
    if (!result.ok) { logger.warn("meHandler not found", { traceId, promoterId, message: result.message }); return failure(res, result.message, 404); }
    logger.info("meHandler success", { traceId, promoterId });
    return success(res, result.promoter, result.message, 200);
  } catch (err) {
    logger.error("meHandler failed", { traceId, promoterId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const updateProfileHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("updateProfileHandler invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("updateProfileHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const { fullName, phone } = req.body as { fullName?: string; phone?: string };
    const file = (req as any).file as any;
    const image = file?.location;
    const result = await promoterUpdateProfile(promoterId, { fullName, phone, image }, traceId);
    if (!result.ok) { logger.warn("updateProfileHandler failed", { traceId, promoterId, message: result.message }); return failure(res, result.message, 400); }
    logger.info("updateProfileHandler success", { traceId, promoterId });
    return success(res, result.promoter, result.message, 200);
  } catch (err) {
    logger.error("updateProfileHandler failed", { traceId, promoterId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const changePasswordHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("changePasswordHandler invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("changePasswordHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) { logger.warn("changePasswordHandler missing fields", { traceId, promoterId }); return failure(res, "currentPassword and newPassword are required.", 422); }
    if (newPassword.length < 6) { logger.warn("changePasswordHandler weak password", { traceId, promoterId }); return failure(res, "New password must be at least 6 characters.", 422); }
    const result = await promoterChangePassword(
      promoterId,
      String(currentPassword),
      String(newPassword),
      traceId
    );
    if (!result.ok) { logger.warn("changePasswordHandler service failed", { traceId, promoterId, message: result.message }); return failure(res, result.message, 400); }
    logger.info("changePasswordHandler success", { traceId, promoterId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("changePasswordHandler failed", { traceId, promoterId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};
