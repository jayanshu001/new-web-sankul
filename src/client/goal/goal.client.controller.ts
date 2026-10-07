// Client goals: HTTP handlers for active goals and the user's goal selection.
import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { getActiveGoals, getMySelectedGoals, updateMyGoals } from "./goal.client.service";
import logger from "../../utils/logger";
import { omit, omitList } from "../../utils/pick";

export const fetchActiveGoalsHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("fetchActiveGoalsHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId: req.user?.id,
  });

  try {
    const goals = await getActiveGoals(traceId);
    logger.info("fetchActiveGoalsHandler success", {
      traceId,
      goalCount: Array.isArray(goals) ? goals.length : undefined,
    });
    return success(res, goals , "Active goals fetched successfully.", 200);
  } catch (err) {
    logger.error("fetchActiveGoalsHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const fetchMySelectedGoalsHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("fetchMySelectedGoalsHandler invoked", {
    traceId,
    path: req.originalUrl,
    userId,
  });

  try {
    if (!userId) {
      logger.warn("fetchMySelectedGoalsHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }

    const result = await getMySelectedGoals(userId, traceId);
    if (!result.ok) {
      logger.warn("fetchMySelectedGoalsHandler no data found", {
        traceId,
        userId,
      });
      return failure(res, result.message, 404);
    }

    logger.info("fetchMySelectedGoalsHandler success", {
      traceId,
      userId,
      count: result.data?.length,
    });

    // The RN app only resolves selected goal/label ids here (see docs/api-optimization).
    const slimmed = (result.data ?? []).map((g: any) => ({
      ...omit(g, ["title", "image"]),
      labels: omitList(g.labels, ["name"]),
    }));

    return success(res, slimmed, "My Selected Goals fetched successfully.", 200);
  } catch (err) {
    logger.error("fetchMySelectedGoalsHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const updateMyGoalsHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("updateMyGoalsHandler invoked", { traceId, userId });
  try {
    if (!userId) {
      logger.warn("updateMyGoalsHandler unauthorized", { traceId });
      return failure(res, "Unauthorized request.", 401);
    }
    const { goals } = req.body;
    const result = await updateMyGoals(userId, goals, traceId);
    if (!result.ok) {
      logger.warn("updateMyGoalsHandler invalid", { traceId, userId, message: result.message });
      return failure(res, result.message, 400);
    }
    logger.info("updateMyGoalsHandler success", { traceId, userId });
    return success(res, result.data, result.message ?? "Goals updated.", 200);
  } catch (err) {
    logger.error("updateMyGoalsHandler failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
