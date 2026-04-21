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

export const loginHandler = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return failure(res, "Email and password are required.", 422);
    const result = await educatorLogin(String(email), String(password));
    if (!result.ok) return failure(res, result.message, 401);
    return success(
      res,
      { educator: result.educator, accessToken: result.token, refreshToken: result.refreshToken },
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
    const result = await educatorRefresh(String(refreshToken));
    if (!result.ok) return failure(res, result.message, 401);
    return success(
      res,
      { educator: result.educator, accessToken: result.token, refreshToken: result.refreshToken },
      result.message,
      200
    );
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const logoutHandler = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return failure(res, "Unauthorized.", 401);
    const result = await educatorLogout(educatorId);
    return success(res, {}, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const meHandler = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return failure(res, "Unauthorized.", 401);
    const result = await educatorGetProfile(educatorId);
    if (!result.ok) return failure(res, result.message, 404);
    return success(res, result.educator, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const updateProfileHandler = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return failure(res, "Unauthorized.", 401);
    const { name, about } = req.body as { name?: string; about?: string };
    const file = (req as any).file as any;
    const image = file?.location;
    const result = await educatorUpdateProfile(educatorId, { name, about, image });
    if (!result.ok) return failure(res, result.message, 400);
    return success(res, result.educator, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};

export const changePasswordHandler = async (req: Request, res: Response) => {
  try {
    const educatorId = req.user?.id;
    if (!educatorId) return failure(res, "Unauthorized.", 401);
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword)
      return failure(res, "currentPassword and newPassword are required.", 422);
    if (newPassword.length < 6)
      return failure(res, "New password must be at least 6 characters.", 422);
    const result = await educatorChangePassword(
      educatorId,
      String(currentPassword),
      String(newPassword)
    );
    if (!result.ok) return failure(res, result.message, 400);
    return success(res, {}, result.message, 200);
  } catch (err) {
    return failure(res, getErrorMessage(err), 500);
  }
};
