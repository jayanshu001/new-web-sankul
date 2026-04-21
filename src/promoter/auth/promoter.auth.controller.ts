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

export const loginHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return failure(res, "Email and password are required.", 422);
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip;
    const result = await promoterLogin(String(email), String(password), ip);
    if (!result.ok) return failure(res, result.message, 401);
    return success(
      res,
      { promoter: result.promoter, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const refreshHandler = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return failure(res, "Refresh token is required.", 422);
    const result = await promoterRefresh(String(refreshToken));
    if (!result.ok) return failure(res, result.message, 401);
    return success(
      res,
      { promoter: result.promoter, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const logoutHandler = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return failure(res, "Unauthorized.", 401);
    const result = await promoterLogout(promoterId);
    return success(res, {}, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const meHandler = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return failure(res, "Unauthorized.", 401);
    const result = await promoterGetProfile(promoterId);
    if (!result.ok) return failure(res, result.message, 404);
    return success(res, result.promoter, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const updateProfileHandler = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return failure(res, "Unauthorized.", 401);
    const { fullName, phone } = req.body as { fullName?: string; phone?: string };
    const file = (req as any).file as any;
    const image = file?.location;
    const result = await promoterUpdateProfile(promoterId, { fullName, phone, image });
    if (!result.ok) return failure(res, result.message, 400);
    return success(res, result.promoter, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const changePasswordHandler = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return failure(res, "Unauthorized.", 401);
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword)
      return failure(res, "currentPassword and newPassword are required.", 422);
    if (newPassword.length < 6)
      return failure(res, "New password must be at least 6 characters.", 422);
    const result = await promoterChangePassword(
      promoterId,
      String(currentPassword),
      String(newPassword)
    );
    if (!result.ok) return failure(res, result.message, 400);
    return success(res, {}, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};
