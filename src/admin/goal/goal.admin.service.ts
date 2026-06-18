import logger from "../../utils/logger";
import { buildSearchFilter } from "../../utils/searchFilter";
import { Goal } from "../../models/Goal.model";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { redisClient } from "../../config/redis";
import {
  isGoalMysql, parseGoalId,
  createGoalSql, getGoalsSql, updateGoalSql, deleteGoalSql,
} from "../../modules/goal/goal.service";

const invalidateGoalCaches = async (traceId?: string) => {
  try { await redisClient.del(ADMIN_GOALS_CACHE_KEY, ACTIVE_GOALS_CACHE_KEY); }
  catch (err) { logger.warn("goal cache invalidation failed", { traceId, error: (err as Error).message }); }
};

const ADMIN_GOALS_CACHE_KEY = "cache:admin:goals:list";
const ACTIVE_GOALS_CACHE_KEY = "cache:client:goals:active";

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

  if (isGoalMysql()) {
    const saved = await createGoalSql({
      title: data.title,
      labels: parseLabels(data.labels).map((l) => ({ name: l.name })),
      image: data.image || null,
      isActive: !(data.isActive === "false" || data.isActive === false),
    });
    await invalidateGoalCaches(traceId);
    return saved;
  }

  const goal = new Goal({
    title: data.title,
    labels: parseLabels(data.labels),
    image: data.image || null,
    isActive: data.isActive === "false" || data.isActive === false ? false : true,
  });

  const saved = await goal.save();

  try {
    await redisClient.del(ADMIN_GOALS_CACHE_KEY, ACTIVE_GOALS_CACHE_KEY);
    logger.info("createGoal cache invalidated", { traceId });
  } catch (err) {
    logger.warn("createGoal cache invalidation failed", { traceId, error: (err as Error).message });
  }

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

  if (isGoalMysql()) {
    // Note: SQL search matches title only (labels are a JSON array — no
    // label-name text index); active filter + pagination + sort preserved.
    const result = await getGoalsSql({
      search: search as string | undefined,
      isActive: isActive === undefined || isActive === "" ? undefined : (isActive === "true" || isActive === true),
      page: Number(page), limit: Number(limit),
      sortBy: sortBy as string, sortOrder: (sortOrder as "asc" | "desc") ?? "desc",
    });
    logger.info("getGoals service (SQL) completed", { traceId, total: result.meta.total });
    return result;
  }

  // Search by Goal Title OR specific Label Name
  const filter: any = { ...buildSearchFilter(search, ["title", "labels.name"]) };

  // Filter by Active status
  if (isActive !== undefined && isActive !== "") {
    filter.isActive = isActive === "true" || isActive === true;
  }

  const skip = (page - 1) * limit;
  const sortDirection = sortOrder === 'asc' ? 1 : -1;

  try {
    const cached = await redisClient.get(ADMIN_GOALS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      logger.info("getGoals service cache hit", { traceId, total: parsed.total, count: parsed.data.length });
      return parsed;
    }
  } catch (err) {
    logger.warn("getGoals service cache read failed", { traceId, error: (err as Error).message });
  }

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

  try {
    await redisClient.set(ADMIN_GOALS_CACHE_KEY, JSON.stringify(result), "EX", 60 * 10); // 10m TTL
    logger.info("getGoals service cache written", { traceId });
  } catch (err) {
    logger.warn("getGoals service cache write failed", { traceId, error: (err as Error).message });
  }

  logger.info("getGoals service completed", { traceId, total, resultCount: goals.length });
  return result;
};

export const updateGoal = async (
  id: string,
  data: { title?: string; labels?: any; image?: string | null; isActive?: boolean | string },
  traceId?: string
) => {
  logger.info("updateGoal service invoked", { traceId, id, data });

  if (isGoalMysql()) {
    const nid = parseGoalId(id);
    if (nid == null) return { ok: false, message: "Goal not found!" };
    const r = await updateGoalSql(nid, {
      title: data.title,
      labels: data.labels !== undefined ? parseLabels(data.labels).map((l) => ({ name: l.name })) : undefined,
      image: data.image,
      isActive: data.isActive !== undefined ? (data.isActive === "true" || data.isActive === true) : undefined,
    });
    if (!r) return { ok: false, message: "Goal not found!" };
    if (r.previousImage) {
      deleteFromS3FileUrl(r.previousImage).catch((err) =>
        logger.error("updateGoal(SQL) failed deleting old image", { traceId, id, error: (err as Error).message }));
    }
    await invalidateGoalCaches(traceId);
    return { ok: true, goal: r.goal };
  }

  const goal = await Goal.findById(id);
  if (!goal) {
    logger.warn("updateGoal service missing goal", { traceId, id });
    return { ok: false, message: "Goal not found!" };
  }

  if (data.title !== undefined) goal.title = data.title;
  if (data.labels !== undefined) goal.labels = parseLabels(data.labels) as any;

  if (data.image !== undefined) {
    // "" is the clear sentinel from the controller (empty multipart field) →
    // store null. A non-empty value replaces the image. Either way, delete the
    // old icon from Spaces when it actually changed.
    const nextImage = data.image === "" ? null : data.image;
    if (goal.image && goal.image !== nextImage) {
      deleteFromS3FileUrl(goal.image).catch((err) =>
        logger.error("updateGoal service failed deleting old image", { traceId, id, error: (err as Error).message })
      );
    }
    goal.image = nextImage as any;
  }

  if (data.isActive !== undefined) {
    goal.isActive = data.isActive === "true" || data.isActive === true;
  }

  await goal.save();

  try {
    await redisClient.del(ADMIN_GOALS_CACHE_KEY, ACTIVE_GOALS_CACHE_KEY);
    logger.info("updateGoal cache invalidated", { traceId, id });
  } catch (err) {
    logger.warn("updateGoal cache invalidation failed", { traceId, id, error: (err as Error).message });
  }

  logger.info("updateGoal service completed", { traceId, id, goalId: goal._id });
  return { ok: true, goal };
};

export const deleteGoal = async (id: string, traceId?: string) => {
  logger.info("deleteGoal service invoked", { traceId, id });

  if (isGoalMysql()) {
    const nid = parseGoalId(id);
    if (nid == null) return { ok: false, message: "Goal not found!" };
    const r = await deleteGoalSql(nid);
    if (!r) return { ok: false, message: "Goal not found!" };
    if (r.image) {
      deleteFromS3FileUrl(r.image).catch((err) =>
        logger.error("deleteGoal(SQL) failed deleting image", { traceId, goalId: id, error: (err as Error).message }));
    }
    await invalidateGoalCaches(traceId);
    return { ok: true, message: "Goal permanently deleted." };
  }

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

  try {
    await redisClient.del(ADMIN_GOALS_CACHE_KEY, ACTIVE_GOALS_CACHE_KEY);
    logger.info("deleteGoal cache invalidated", { traceId, id });
  } catch (err) {
    logger.warn("deleteGoal cache invalidation failed", { traceId, id, error: (err as Error).message });
  }

  logger.info("deleteGoal service completed", { traceId, id });
  return { ok: true, message: "Goal permanently deleted." };
};
