import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { createGoal, getGoals, updateGoal, deleteGoal } from "./goal.admin.service";
import logger from "../../utils/logger";

/**
 * POST /api/v1/admin/goals
 * Body: multipart/form-data { title, labels, image?, isActive? }
 */
export const createGoalHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createGoalHandler invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { title, labels, isActive } = req.body;

    if (!title || !labels) {
      logger.warn("createGoalHandler validation failed", { traceId, title, labels });
      return failure(res, "Title and at least one label are required.", 422);
    }

    const file = req.file as any;
    const image = file?.location;

    const goal = await createGoal({
      title: String(title),
      labels,
      image,
      isActive: isActive !== undefined ? String(isActive) : undefined,
    }, traceId);

    logger.info("createGoalHandler success", { traceId, goalId: goal?._id, title });
    return success(res, goal, "Goal created successfully.", 201);
  } catch (err) {
    logger.error("createGoalHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * GET /api/v1/admin/goals
 */
export const getGoalsHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getGoalsHandler invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { search, isActive, page, limit, sortBy, sortOrder } = req.query;

    const result = await getGoals({
      search: search as string,
      isActive: isActive as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc',
    }, traceId);

    logger.info("getGoalsHandler success", { traceId, count: (result?.data || []).length });
    return success(res, result, "Goals fetched successfully.", 200);
  } catch (err) {
    logger.error("getGoalsHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * PUT /api/v1/admin/goals/:id
 * Body: multipart/form-data { title?, labels?, image?, isActive? }
 */
export const updateGoalHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { id } = req.params;
  const userId = req.user?.id;

  logger.info("updateGoalHandler invoked", { traceId, path: req.originalUrl, userId, goalId: id });

  try {
    const { title, labels, isActive } = req.body;

    const file = req.file as any;
    // Image resolution for update, three cases:
    //   - file uploaded        → use its URL (replace)
    //   - empty `image` field  → "" sentinel → clear (service unsets it)
    //   - field absent         → undefined  → leave unchanged
    let image: string | undefined;
    if (file?.location) image = file.location;
    else if (req.body.image === "") image = "";

    const result = await updateGoal(String(id), {
      title: title !== undefined ? String(title) : undefined,
      labels,
      image,
      isActive: isActive !== undefined ? String(isActive) : undefined,
    }, traceId);

    if (!result.ok) {
      logger.warn("updateGoalHandler not found", { traceId, goalId: id });
      return failure(res, result.message, 404);
    }

    logger.info("updateGoalHandler success", { traceId, goalId: id });
    return success(res, result.goal , "Goal updated successfully.", 200);
  } catch (err) {
    logger.error("updateGoalHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * DELETE /api/v1/admin/goals/:id
 */
export const deleteGoalHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { id } = req.params;
  logger.info("deleteGoalHandler invoked", { traceId, path: req.originalUrl, goalId: id, userId: req.user?.id });

  try {
    const result = await deleteGoal(String(id), traceId);

    if (!result.ok) {
      logger.warn("deleteGoalHandler not found", { traceId, goalId: id });
      return failure(res, result.message, 404);
    }

    logger.info("deleteGoalHandler success", { traceId, goalId: id });
    return success(res, {}, result.message, 200);
  } catch (err) {
    logger.error("deleteGoalHandler failed", {
      traceId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, getErrorMessage(err), 500);
  }
};
