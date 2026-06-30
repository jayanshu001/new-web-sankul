import logger from "../../utils/logger";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { redisClient } from "../../config/redis";
import {
  parseGoalId,
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

  const saved = await createGoalSql({
    title: data.title,
    labels: parseLabels(data.labels).map((l) => ({ name: l.name })),
    image: data.image || null,
    isActive: !(data.isActive === "false" || data.isActive === false),
  });
  await invalidateGoalCaches(traceId);
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
};

export const updateGoal = async (
  id: string,
  data: { title?: string; labels?: any; image?: string | null; isActive?: boolean | string },
  traceId?: string
) => {
  logger.info("updateGoal service invoked", { traceId, id, data });

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
};

export const deleteGoal = async (id: string, traceId?: string) => {
  logger.info("deleteGoal service invoked", { traceId, id });

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
};
