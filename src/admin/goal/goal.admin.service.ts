import logger from "../../utils/logger";
import { Goal } from "../../models/Goal.model";
import { deleteFromS3FileUrl } from "../../middlewares/upload";

/**
 * Normalizes 'labels' input into structured objects { _id?, name }
 */
const parseLabels = (rawLabels: any): { _id?: string, name: string }[] => {
  const mapItem = (item: any) => {
    if (typeof item === "string") return { name: item };
    if (item && typeof item === "object" && item.name) return { _id: item._id, name: item.name };
    return null;
  };

  if (typeof rawLabels === "string") {
    try {
      const parsed = JSON.parse(rawLabels);
      if (Array.isArray(parsed)) return parsed.map(mapItem).filter(Boolean) as any;
    } catch {
      return rawLabels.split(",").map((name) => ({ name: name.trim() })).filter(l => l.name);
    }
  }
  
  if (Array.isArray(rawLabels)) {
    return rawLabels.map(mapItem).filter(Boolean) as any;
  }
  return [];
};

export const createGoal = async (data: { title: string; labels: any; image?: string; isActive?: boolean | string }, traceId?: string) => {
  logger.info("createGoal service invoked", { traceId, data });

  const goal = new Goal({
    title: data.title,
    labels: parseLabels(data.labels),
    image: data.image || null,
    isActive: data.isActive === "false" || data.isActive === false ? false : true,
  });

  const saved = await goal.save();
  logger.info("createGoal service completed", { traceId, goalId: saved._id });
  return saved;
};

export const getGoals = async (query: {
  search?: string;
  isActive?: string | boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
} = {}, traceId?: string) => {
  logger.info("getGoals service invoked", { traceId, query });
  const { search, isActive, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = query;
  
  const filter: any = {};

  // Search by Goal Title OR specific Label Name
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { "labels.name": { $regex: search, $options: "i" } }
    ];
  }

  // Filter by Active status
  if (isActive !== undefined && isActive !== "") {
    filter.isActive = isActive === "true" || isActive === true;
  }

  const skip = (page - 1) * limit;
  const sortDirection = sortOrder === 'asc' ? 1 : -1;

  const goals = await Goal.find(filter)
    .sort({ [sortBy]: sortDirection })
    .skip(skip)
    .limit(limit);

  const total = await Goal.countDocuments(filter);

  const result = {
    data: goals,
    meta: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit)
    }
  };

  logger.info("getGoals service completed", { traceId, total, resultCount: goals.length });
  return result;
};

export const updateGoal = async (
  id: string,
  data: { title?: string; labels?: any; image?: string; isActive?: boolean | string },
  traceId?: string
) => {
  logger.info("updateGoal service invoked", { traceId, id, data });

  const goal = await Goal.findById(id);
  if (!goal) {
    logger.warn("updateGoal service missing goal", { traceId, id });
    return { ok: false, message: "Goal not found!" };
  }

  if (data.title !== undefined) goal.title = data.title;
  if (data.labels !== undefined) goal.labels = parseLabels(data.labels) as any;

  if (data.image !== undefined) {
    if (goal.image && goal.image !== data.image) {
      // Trigger background cleanup of the old icon from DO Spaces
      deleteFromS3FileUrl(goal.image).catch((err) =>
        console.error("[updateGoal] Failed to delete old goal icon:", err)
      );
    }
    goal.image = data.image;
  }

  if (data.isActive !== undefined) {
    goal.isActive = data.isActive === "true" || data.isActive === true;
  }

  await goal.save();
  logger.info("updateGoal service completed", { traceId, id, goalId: goal._id });
  return { ok: true, goal };
};

export const deleteGoal = async (id: string, traceId?: string) => {
  logger.info("deleteGoal service invoked", { traceId, id });

  const goal = await Goal.findById(id);
  if (!goal) {
    logger.warn("deleteGoal service goal not found", { traceId, id });
    return { ok: false, message: "Goal not found!" };
  }

  if (goal.image) {
    deleteFromS3FileUrl(goal.image).catch((err) =>
      logger.error("deleteGoal service failed deleting image", { traceId, goalId: id, error: (err as Error).message })
    );
  }

  await goal.deleteOne();
  logger.info("deleteGoal service completed", { traceId, id });
  return { ok: true, message: "Goal permanently deleted." };
};
