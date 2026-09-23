import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import {
  educatorLogin,
  educatorRefresh,
  educatorLogout,
  educatorChangePassword,
  educatorUpdateProfile,
  educatorGetProfile,
} from "./educator.auth.service";
import logger from "../../utils/logger";

export const loginHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("loginHandler invoked", { traceId, path: req.originalUrl, email: req.body?.email });

  try {
    const { email, password } = req.body;
    if (!email || !password) { logger.warn("loginHandler missing credentials", { traceId }); return failure(res, "Email and password are required.", 422); }
    const result = await educatorLogin(String(email), String(password), traceId);
    if (!result.ok) { logger.warn("loginHandler failed", { traceId, email, message: result.message }); return failure(res, result.message, 401); }
    logger.info("loginHandler success", { traceId, educatorId: (result.educator as any)?.id });
    return success(
      res,
      { educator: result.educator, accessToken: result.token, refreshToken: result.refreshToken },
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
    const result = await educatorRefresh(String(refreshToken), traceId);
    if (!result.ok) { logger.warn("refreshHandler failed", { traceId, message: result.message }); return failure(res, result.message, 401); }
    logger.info("refreshHandler success", { traceId, educatorId: (result.educator as any)?.id });
    return success(
      res,
      { educator: result.educator, accessToken: result.token, refreshToken: result.refreshToken },
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
  const educatorId = req.user?.id;
  logger.info("logoutHandler invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("logoutHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const result = await educatorLogout(educatorId, traceId);
    logger.info("logoutHandler success", { traceId, educatorId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("logoutHandler failed", { traceId, educatorId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const meHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  logger.info("meHandler invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("meHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const result = await educatorGetProfile(educatorId, traceId);
    if (!result.ok) { logger.warn("meHandler not found", { traceId, educatorId, message: result.message }); return failure(res, result.message, 404); }
    logger.info("meHandler success", { traceId, educatorId });
    return success(res, result.educator, result.message, 200);
  } catch (err) {
    logger.error("meHandler failed", { traceId, educatorId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const updateProfileHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  logger.info("updateProfileHandler invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("updateProfileHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const { name, about } = req.body as { name?: string; about?: string };
    const file = (req as any).file as any;
    const image = file?.location;
    const result = await educatorUpdateProfile(educatorId, { name, about, image }, traceId);
    if (!result.ok) { logger.warn("updateProfileHandler failed", { traceId, educatorId, message: result.message }); return failure(res, result.message, 400); }
    logger.info("updateProfileHandler success", { traceId, educatorId });
    return success(res, result.educator, result.message, 200);
  } catch (err) {
    logger.error("updateProfileHandler failed", { traceId, educatorId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

export const changePasswordHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const educatorId = req.user?.id;
  logger.info("changePasswordHandler invoked", { traceId, path: req.originalUrl, educatorId });

  try {
    if (!educatorId) { logger.warn("changePasswordHandler unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) { logger.warn("changePasswordHandler missing fields", { traceId, educatorId }); return failure(res, "currentPassword and newPassword are required.", 422); }
    if (newPassword.length < 6) { logger.warn("changePasswordHandler weak password", { traceId, educatorId }); return failure(res, "New password must be at least 6 characters.", 422); }
    const result = await educatorChangePassword(
      educatorId,
      String(currentPassword),
      String(newPassword),
      traceId
    );
    if (!result.ok) { logger.warn("changePasswordHandler service failed", { traceId, educatorId, message: result.message }); return failure(res, result.message, 400); }
    logger.info("changePasswordHandler success", { traceId, educatorId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("changePasswordHandler failed", { traceId, educatorId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};
