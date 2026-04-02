import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { getActiveGoals, getMySelectedGoals } from "./goal.client.service";

/**
 * GET /api/v1/client/goals
 * Fetches natively active goals for the Mobile UI Goal Selection Screen.
 */
export const fetchActiveGoalsHandler = async (req: Request, res: Response) => {
  try {
    const goals = await getActiveGoals();
    return success(res, goals , "Active goals fetched successfully.", 200);
  } catch (err) {
    console.error("[fetchActiveGoalsHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * GET /api/v1/client/goals/my-goals
 * Fetches only the goals & labels strictly checked/selected by the customer.
 */
export const fetchMySelectedGoalsHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return failure(res, "Unauthorized request.", 401);

    const result = await getMySelectedGoals(userId);
    if (!result.ok) {
      return failure(res, result.message, 404);
    }

    return success(res, result.data, "My Selected Goals fetched successfully.", 200);
  } catch (err) {
    console.error("[fetchMySelectedGoalsHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};
