import { Request, Response } from "express";
import {
  adminLogin,
  createAdminUser,
  changeAdminPassword,
  refreshAdminToken,
  logoutAdmin,
  updateAdminProfile,
} from "./admin.auth.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

/**
 * POST /api/v1/admin/auth/login
 * Body: { email, password }
 */
export const adminLoginHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("adminLoginHandler invoked", { traceId, path: req.originalUrl, ip: req.ip });

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      logger.warn("adminLoginHandler missing credentials", { traceId, hasEmail: !!email, hasPassword: !!password });
      return failure(res, "Email and password are required.", 422);
    }

    const result = await adminLogin(String(email), String(password), (req.headers["x-forwarded-for"] as string) || req.ip);

    if (!result.ok) {
      logger.warn("adminLoginHandler auth failed", { traceId, email });
      return failure(res, result.message, 401);
    }

    logger.info("adminLoginHandler success", { traceId, adminId: result.admin?._id });
    return success(
      res,
      { admin: result.admin, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    logger.error("adminLoginHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/admin/auth/register
 * Body: { firstName, lastName?, email, password, role? }
 * NOTE: Protect this route — only callable by super_admin or via seeder
 */
export const adminRegisterHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("adminRegisterHandler invoked", { traceId, path: req.originalUrl, ip: req.ip });

  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !email || !password) {
      logger.warn("adminRegisterHandler missing fields", { traceId, firstName: !!firstName, email: !!email, password: !!password });
      return failure(res, "firstName, email and password are required.", 422);
    }

    const result = await createAdminUser({ firstName, lastName, email, password, role }, traceId);

    if (!result.ok) {
      logger.warn("adminRegisterHandler conflict", { traceId, email });
      return failure(res, result.message, 409);
    }

    logger.info("adminRegisterHandler success", { traceId, adminEmail: email });
    return success(res, {}, result.message, 201);
  } catch (err) {
    logger.error("adminRegisterHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/admin/auth/change-password
 * Body: { currentPassword, newPassword }
 * Protected: requires admin JWT
 */
export const adminChangePasswordHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const adminId = req.user?.id;
  logger.info("adminChangePasswordHandler invoked", { traceId, path: req.originalUrl, adminId });

  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      logger.warn("adminChangePasswordHandler missing fields", { traceId, adminId });
      return failure(res, "currentPassword and newPassword are required.", 422);
    }

    if (newPassword.length < 6) {
      logger.warn("adminChangePasswordHandler weak password", { traceId, adminId, newPasswordLength: newPassword.length });
      return failure(res, "New password must be at least 6 characters.", 422);
    }

    const result = await changeAdminPassword(adminId!, String(currentPassword), String(newPassword), traceId);

    if (!result.ok) {
      logger.warn("adminChangePasswordHandler failed", { traceId, adminId, message: result.message });
      return failure(res, result.message, 400);
    }

    logger.info("adminChangePasswordHandler success", { traceId, adminId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("adminChangePasswordHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/admin/auth/refresh
 * Body: { refreshToken: string }
 */
export const adminRefreshHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("adminRefreshHandler invoked", { traceId, path: req.originalUrl });

  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      logger.warn("adminRefreshHandler missing token", { traceId });
      return failure(res, "Refresh token is required.", 422);
    }

    const result = await refreshAdminToken(String(refreshToken), traceId);

    if (!result.ok) {
      logger.warn("adminRefreshHandler invalid token", { traceId });
      return failure(res, result.message, 401);
    }

    const refreshedAdminId = result.admin?.id || (result.admin as any)?._id;
    logger.info("adminRefreshHandler success", { traceId, adminId: refreshedAdminId });
    return success(
      res,
      { admin: result.admin, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    logger.error("adminRefreshHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * DELETE /api/v1/admin/auth/logout
 * Protected: requires admin JWT
 */
export const adminLogoutHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const adminId = req.user?.id;
  logger.info("adminLogoutHandler invoked", { traceId, path: req.originalUrl, adminId });

  try {
    if (!adminId) {
      logger.warn("adminLogoutHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    const result = await logoutAdmin(adminId, traceId);

    if (!result.ok) {
      logger.warn("adminLogoutHandler failed", { traceId, adminId, message: result.message });
      return failure(res, result.message, 400);
    }

    logger.info("adminLogoutHandler success", { traceId, adminId });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("adminLogoutHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * PUT /api/v1/admin/auth/profile
 * Body: multipart/form-data { firstName?, lastName?, image? (file) }
 * Protected: requires admin JWT
 */
export const adminUpdateProfileHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const adminId = req.user?.id;
  logger.info("adminUpdateProfileHandler invoked", { traceId, path: req.originalUrl, adminId });

  try {
    if (!adminId) {
      logger.warn("adminUpdateProfileHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    const { firstName, lastName } = req.body;

    // `multer-s3` attaches the S3 URL exactly to `req.file.location`
    const file = req.file as any;
    const image = file?.location;

    const result = await updateAdminProfile(adminId, { firstName, lastName, image }, traceId);

    if (!result.ok) {
      logger.warn("adminUpdateProfileHandler failed", { traceId, adminId, message: result.message });
      return failure(res, result.message, 400);
    }

    logger.info("adminUpdateProfileHandler success", { traceId, adminId });
    return success(res, result.admin, result.message, 200);
  } catch (err) {
    logger.error("adminUpdateProfileHandler failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};
