import { Request, Response } from "express";
import {
  adminLogin,
  createAdminUser,
  changeAdminPassword,
} from "./admin.auth.service";
import { success, failure, getErrorMessage } from "../../../utils/httpResponse";

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

    const result = await adminLogin(String(email), String(password));

    if (!result.ok) {
      return failure(res, result.message, 401);
    }

    return success(
      res,
      { admin: result.admin, accessToken: result.token },
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
