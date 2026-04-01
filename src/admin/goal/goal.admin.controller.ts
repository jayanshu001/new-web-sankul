import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { createGoal, getGoals, updateGoal, deleteGoal } from "./goal.admin.service";

/**
 * POST /api/v1/admin/goals
 * Body: multipart/form-data { title, labels, image?, isActive? }
 */
export const createGoalHandler = async (req: Request, res: Response) => {
  try {
    const { title, labels, isActive } = req.body;

    if (!title || !labels) {
      return failure(res, "Title and at least one label are required.", 422);
    }

    // Attach DigitalOcean S3 URL if an image was uploaded via Multer
    const file = req.file as any;
    const image = file?.location; 

    const goal = await createGoal({ 
      title: String(title), 
      labels, 
      image, 
      isActive: isActive !== undefined ? String(isActive) : undefined 
    });
    return success(res, goal , "Goal created successfully.", 201);
  } catch (err) {
    console.error("[createGoalHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * GET /api/v1/admin/goals
 */
export const getGoalsHandler = async (req: Request, res: Response) => {
  try {
    const { search, isActive, page, limit, sortBy, sortOrder } = req.query;

    const result = await getGoals({
      search: search as string,
      isActive: isActive as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc'
    });

    return success(res, result, "Goals fetched successfully.", 200);
  } catch (err) {
    console.error("[getGoalsHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * PUT /api/v1/admin/goals/:id
 * Body: multipart/form-data { title?, labels?, image?, isActive? }
 */
export const updateGoalHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, labels, isActive } = req.body;

    const file = req.file as any;
    const image = file?.location; 

    const result = await updateGoal(String(id), { 
      title: title !== undefined ? String(title) : undefined, 
      labels, 
      image, 
      isActive: isActive !== undefined ? String(isActive) : undefined 
    });

    if (!result.ok) {
        return failure(res, result.message, 404);
    }

    return success(res, result.goal , "Goal updated successfully.", 200);
  } catch (err) {
    console.error("[updateGoalHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};

/**
 * DELETE /api/v1/admin/goals/:id
 */
export const deleteGoalHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await deleteGoal(String(id));

    if (!result.ok) {
        return failure(res, result.message, 404);
    }

    return success(res, {}, result.message, 200);
  } catch (err) {
    console.error("[deleteGoalHandler]", err);
    return failure(res, getErrorMessage(err), 500);
  }
};
