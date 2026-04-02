import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { updateCustomerProfile, getCustomerProfile } from "./customer.service";

export const updateProfileHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return failure(res, "Unauthorized request.", 401);
    }

    const { firstName, middleName, lastName, email, goals } = req.body;

    const result = await updateCustomerProfile(userId, {
      firstName,
      middleName,
      lastName,
      email,
      goals
    });

    if (!result.ok) {
      return failure(res, result.message, 400);
    }

    return success(res, result?.data, result.message, 200);
  } catch (err) {
    console.error("[updateProfileHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

export const getProfileHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return failure(res, "Unauthorized request.", 401);

    const result = await getCustomerProfile(userId);
    if (!result.ok) return failure(res, result.message, 404);

    return success(res, result.data, result.message, 200);
  } catch (err) {
    console.error("[getProfileHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};
