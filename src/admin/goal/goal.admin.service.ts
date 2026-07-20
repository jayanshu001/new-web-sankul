/**
 * Admin Goal CRUD — now backed by `ws_customer_target_goal` (the single goal
 * master after ws_goal was dropped). The `/admin/goals` contract is preserved
 * for the existing admin UI: DTO is the old ws_goal shape
 * (`_id, title, labels:[{id,name}], image, isActive, createdAt, updatedAt`), with
 * `title ← name` and `isActive ← active`. ws_customer_target_goal has no
 * timestamps, so createdAt/updatedAt are null and sorting falls back to id.
 */
import { prisma } from "../../config/prisma";
import logger from "../../utils/logger";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { redisClient } from "../../config/redis";
import { parseLabels as parseStoredLabels } from "../../utils/goalSelection";
import { buildPrismaSearch } from "../../utils/searchFilter";

const ADMIN_GOALS_CACHE_KEY = "cache:admin:goals:list";
const ACTIVE_GOALS_CACHE_KEY = "cache:client:goals:active";

const invalidateGoalCaches = async (traceId?: string) => {
  try { await redisClient.del(ADMIN_GOALS_CACHE_KEY, ACTIVE_GOALS_CACHE_KEY); }
  catch (err) { logger.warn("goal cache invalidation failed", { traceId, error: (err as Error).message }); }
};

export const parseGoalId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Old ws_goal DTO shape, mapped from a ws_customer_target_goal row. */
const dto = (g: any) => ({
  _id: String(g.id),
  title: g.name,
  labels: Array.isArray(g.labels) ? g.labels : [],
  image: g.image || null,
  isActive: g.active,
  createdAt: null,
  updatedAt: null,
});

/** Normalize multipart/JSON labels → [{ name }]; then assign stable per-goal ids. */
const parseLabels = (rawLabels: any): { name: string }[] => {
  const mapItem = (item: any): { name: string } | null => {
    if (typeof item === "string") return item.trim() ? { name: item.trim() } : null;
    if (item && typeof item === "object" && item.name) return { name: String(item.name) };
    return null;
  };
  if (typeof rawLabels === "string") {
    try {
      const parsed = JSON.parse(rawLabels);
      if (Array.isArray(parsed)) return parsed.map(mapItem).filter(Boolean) as { name: string }[];
    } catch {
      return rawLabels.split(",").map((n) => ({ name: n.trim() })).filter((l) => l.name);
    }
  }
  if (Array.isArray(rawLabels)) return rawLabels.map(mapItem).filter(Boolean) as { name: string }[];
  return [];
};

/**
 * Assign stable numeric ids to labels (existing labels keep their id, matched by
 * name; new labels get the next free id). Same scheme used across goal features.
 */
const withLabelIds = (labels: { name: string }[], existing?: unknown): { id: number; name: string }[] => {
  const prior = parseStoredLabels(existing);
  const idByName = new Map<string, number>();
  for (const l of prior) idByName.set(l.name, l.id);
  let next = Math.max(0, ...prior.map((l) => l.id)) + 1;
  return labels.map((l) => ({ id: idByName.get(l.name) ?? next++, name: l.name }));
};

export const createGoal = async (
  data: { title: string; labels: any; image?: string; isActive?: boolean | string },
  traceId?: string
) => {
  logger.info("createGoal service invoked", { traceId, title: data.title });
  const row = await prisma.customerTargetGoal.create({
    data: {
      name: data.title,
      image: data.image ?? "",
      active: !(data.isActive === "false" || data.isActive === false),
      labels: withLabelIds(parseLabels(data.labels)) as any,
    },
  });
  await invalidateGoalCaches(traceId);
  return dto(row);
};

export const getGoals = async (
  query: { search?: string; isActive?: string | boolean; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {},
  traceId?: string
) => {
  logger.info("getGoals service invoked", { traceId, query });
  const { search, isActive, page = 1, limit = 10, sortOrder = "desc" } = query;

  const where: any = {};
  const nameSearch = buildPrismaSearch(typeof search === "string" ? search : undefined, ["name"]);
  if (nameSearch) Object.assign(where, nameSearch);
  if (isActive !== undefined && isActive !== "") where.active = isActive === "true" || isActive === true;

  const p = Number(page), l = Number(limit);
  const skip = (p - 1) * l;
  const order: "asc" | "desc" = sortOrder === "asc" ? "asc" : "desc";
  const [rows, total] = await Promise.all([
    prisma.customerTargetGoal.findMany({ where, orderBy: { id: order }, skip, take: l }),
    prisma.customerTargetGoal.count({ where }),
  ]);
  return { data: rows.map(dto), meta: { total, page: p, limit: l, totalPages: Math.ceil(total / l) } };
};

/**
 * GET /admin/goals/:id — resolve one goal (with its `labels[]`) in the old
 * ws_goal DTO shape. Needed for server-searched Goal pickers to render the
 * selected goal's dependent "Goal Label" sub-dropdown in edit mode.
 */
export const getGoalById = async (id: string, traceId?: string) => {
  logger.info("getGoalById service invoked", { traceId, id });
  const nid = parseGoalId(id);
  if (nid == null) return null;
  const row = await prisma.customerTargetGoal.findUnique({ where: { id: nid } });
  return row ? dto(row) : null;
};

export const updateGoal = async (
  id: string,
  data: { title?: string; labels?: any; image?: string | null; isActive?: boolean | string },
  traceId?: string
): Promise<{ ok: false; message: string } | { ok: true; goal: any }> => {
  logger.info("updateGoal service invoked", { traceId, id });
  const nid = parseGoalId(id);
  if (nid == null) return { ok: false, message: "Goal not found!" };
  const existing = await prisma.customerTargetGoal.findUnique({ where: { id: nid } });
  if (!existing) return { ok: false, message: "Goal not found!" };

  const patch: any = {};
  if (data.title !== undefined) patch.name = data.title;
  if (data.labels !== undefined) patch.labels = withLabelIds(parseLabels(data.labels), existing.labels) as any;
  if (data.isActive !== undefined) patch.active = data.isActive === "true" || data.isActive === true;

  let previousImage: string | null = null;
  if (data.image !== undefined) {
    const next = data.image === "" ? "" : data.image;
    if (existing.image && existing.image !== next) previousImage = existing.image;
    patch.image = next ?? "";
  }

  const row = await prisma.customerTargetGoal.update({ where: { id: nid }, data: patch });
  if (previousImage) {
    deleteFromS3FileUrl(previousImage).catch((err) =>
      logger.error("updateGoal failed deleting old image", { traceId, id, error: (err as Error).message }));
  }
  await invalidateGoalCaches(traceId);
  return { ok: true, goal: dto(row) };
};

export const deleteGoal = async (id: string, traceId?: string): Promise<{ ok: false; message: string } | { ok: true; message: string }> => {
  logger.info("deleteGoal service invoked", { traceId, id });
  const nid = parseGoalId(id);
  if (nid == null) return { ok: false, message: "Goal not found!" };
  const existing = await prisma.customerTargetGoal.findUnique({ where: { id: nid }, select: { image: true } });
  if (!existing) return { ok: false, message: "Goal not found!" };
  await prisma.customerTargetGoal.delete({ where: { id: nid } });
  if (existing.image) {
    deleteFromS3FileUrl(existing.image).catch((err) =>
      logger.error("deleteGoal failed deleting image", { traceId, goalId: id, error: (err as Error).message }));
  }
  await invalidateGoalCaches(traceId);
  return { ok: true, message: "Goal permanently deleted." };
};
