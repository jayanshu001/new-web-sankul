import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { getActiveGoals } from "./goal.client.service";

/**
 * GET /api/v1/client/goals
 * Fetches natively active goals for the Mobile UI Goal Selection Screen.
 */
export const fetchActiveGoalsHandler = async (req: Request, res: Response) => {
  try {
    const goals = await getActiveGoals();
    return success(res, goals, "Active goals fetched successfully.", 200);
  } catch (err) {
    console.error("[fetchActiveGoalsHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};
