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

/**
 * POST /api/v1/admin/auth/login
 * Body: { email, password }
 */
export const adminLoginHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return failure(res, "Email and password are required.", 422);
    }

    const result = await adminLogin(String(email), String(password), req.headers["x-forwarded-for"] as string || req.ip);

    if (!result.ok) {
      return failure(res, result.message, 401);
    }

    return success(
      res,
      { admin: result.admin, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    console.error("[adminLoginHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/admin/auth/register
 * Body: { firstName, lastName?, email, password, role? }
 * NOTE: Protect this route — only callable by super_admin or via seeder
 */
export const adminRegisterHandler = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !email || !password) {
      return failure(res, "firstName, email and password are required.", 422);
    }

    const result = await createAdminUser({ firstName, lastName, email, password, role });

    if (!result.ok) {
      return failure(res, result.message, 409);
    }

    return success(res, {}, result.message, 201);
  } catch (err) {
    console.error("[adminRegisterHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/admin/auth/change-password
 * Body: { currentPassword, newPassword }
 * Protected: requires admin JWT
 */
export const adminChangePasswordHandler = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return failure(res, "currentPassword and newPassword are required.", 422);
    }

    if (newPassword.length < 6) {
      return failure(res, "New password must be at least 6 characters.", 422);
    }

    const result = await changeAdminPassword(adminId!, String(currentPassword), String(newPassword));

    if (!result.ok) {
      return failure(res, result.message, 400);
    }

    return success(res, {}, result.message, 200);
  } catch (err) {
    console.error("[adminChangePasswordHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * POST /api/v1/admin/auth/refresh
 * Body: { refreshToken: string }
 */
export const adminRefreshHandler = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return failure(res, "Refresh token is required.", 422);
    }

    const result = await refreshAdminToken(String(refreshToken));

    if (!result.ok) {
      return failure(res, result.message, 401);
    }

    return success(
      res,
      { admin: result.admin, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    console.error("[adminRefreshHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * DELETE /api/v1/admin/auth/logout
 * Protected: requires admin JWT
 */
export const adminLogoutHandler = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return failure(res, "Unauthorized request.", 401);

    const result = await logoutAdmin(adminId);

    if (!result.ok) {
      return failure(res, result.message, 400);
    }

    return success(res, {}, result.message, 200);
  } catch (err) {
    console.error("[adminLogoutHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * PUT /api/v1/admin/auth/profile
 * Body: multipart/form-data { firstName?, lastName?, image? (file) }
 * Protected: requires admin JWT
 */
export const adminUpdateProfileHandler = async (req: Request, res: Response) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return failure(res, "Unauthorized request.", 401);

    const { firstName, lastName } = req.body;

    // `multer-s3` attaches the S3 URL exactly to `req.file.location`
    const file = req.file as any;
    const image = file?.location;

    const result = await updateAdminProfile(adminId, { firstName, lastName, image });

    if (!result.ok) {
      return failure(res, result.message, 400);
    }

    return success(res, result.admin, result.message, 200);
  } catch (err) {
    console.error("[adminUpdateProfileHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};
