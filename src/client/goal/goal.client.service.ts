import logger from "../../utils/logger";
import { redisClient } from "../../config/redis";
import { prisma } from "../../config/prisma";

// SQL goal labels live in the `ws_goal.labels` JSON as [{ id, name }] (ids
// assigned by modules/goal). The client selection stores selected LABEL ids on
// `ws_customer.goal` (Json). Cache is bypassed on the SQL branch so a flag flip
// can't serve Mongo-shaped cached payloads.
const sqlLabelArr = (j: any): { id: number; name: string }[] => (Array.isArray(j) ? j : []);
const parseGoalCustomerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const selectedGoalIds = (j: any): string[] => (Array.isArray(j) ? j.map((x) => String(x)) : []);

const MY_SELECTED_GOALS_CACHE_PREFIX = "cache:client:goals:selected:";
const PROFILE_CACHE_PREFIX = "cache:client:profile:";

export const getActiveGoals = async (traceId?: string) => {
  logger.info("getActiveGoals service invoked", { traceId });

  const rows = await prisma.goal.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, image: true, labels: true },
  });
  return rows.map((g) => ({
    _id: String(g.id),
    title: g.title,
    image: g.image ?? null,
    labels: sqlLabelArr(g.labels).map((l) => ({ _id: String(l.id), name: l.name })),
  }));
};

/**
 * Updates the customer's selected goal labels.
 * Accepts an array of goal-label ObjectIds; invalid IDs are filtered out.
 */
export const updateMyGoals = async (customerId: string, goals: string[], traceId?: string) => {
  logger.info("updateMyGoals service invoked", { traceId, customerId, goalCount: goals?.length });
  try {
    if (!Array.isArray(goals)) {
      logger.warn("updateMyGoals service invalid input", { traceId, customerId });
      return { ok: false, message: "Goals must be an array of IDs." };
    }

    // ─── store selected LABEL ids on ws_customer.goal ───
    const cid = parseGoalCustomerId(customerId);
    if (cid == null) return { ok: false, message: "Customer not found." };
    const validGoals = goals.filter((id) => id != null && String(id).trim() !== "").map(String);
    const exists = await prisma.customer.findFirst({ where: { id: cid }, select: { id: true } });
    if (!exists) return { ok: false, message: "Customer not found." };
    await prisma.customer.update({ where: { id: cid }, data: { goal: validGoals as any, updatedAt: new Date() } });
    try {
      await redisClient.del(`${MY_SELECTED_GOALS_CACHE_PREFIX}${customerId}`, `${PROFILE_CACHE_PREFIX}${customerId}`);
    } catch { /* cache best-effort */ }
    logger.info("updateMyGoals service completed (sql)", { traceId, customerId, count: validGoals.length });
    return { ok: true, data: { goals: validGoals }, message: "Goals updated successfully." };
  } catch (error) {
    logger.error("updateMyGoals service error", { traceId, customerId, error: (error as Error).message });
    return { ok: false, message: "Failed to update goals." };
  }
};

/**
 * Returns all active goals with an isSelected flag per label for the given customer.
 */
export const getGoalsWithSelection = async (customerId: string, traceId?: string) => {
  logger.info("getGoalsWithSelection service invoked", { traceId, customerId });
  try {
    const cid = parseGoalCustomerId(customerId);
    if (cid == null) return { ok: false, message: "Customer not found." };
    const customer = await prisma.customer.findFirst({ where: { id: cid }, select: { goal: true } });
    if (!customer) return { ok: false, message: "Customer not found." };
    const selected = new Set(selectedGoalIds(customer.goal));
    const goals = await prisma.goal.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, image: true, labels: true },
    });
    const shaped = goals.map((g) => ({
      _id: String(g.id),
      title: g.title,
      image: g.image ?? null,
      labels: sqlLabelArr(g.labels).map((l) => ({ _id: String(l.id), name: l.name, isSelected: selected.has(String(l.id)) })),
    }));
    return { ok: true, data: shaped };
  } catch (error) {
    logger.error("getGoalsWithSelection service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "Failed to fetch goals." };
  }
};

/**
 * Fetches the user's specifically selected goals, filtering out unused labels
 */
export const getMySelectedGoals = async (customerId: string, traceId?: string) => {
  logger.info("getMySelectedGoals service invoked", { traceId, customerId });

  try {
    const cid = parseGoalCustomerId(customerId);
    if (cid == null) return { ok: false, message: "Customer not found." };
    const customer = await prisma.customer.findFirst({ where: { id: cid }, select: { goal: true } });
    if (!customer) return { ok: false, message: "Customer not found." };
    const selectedIds = selectedGoalIds(customer.goal);
    if (!selectedIds.length) return { ok: true, data: [] };
    const selSet = new Set(selectedIds);
    const goals = await prisma.goal.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, image: true, labels: true },
    });
    const filtered = goals
      .map((g) => {
        const labels = sqlLabelArr(g.labels).filter((l) => selSet.has(String(l.id))).map((l) => ({ _id: String(l.id), name: l.name }));
        return labels.length ? { _id: String(g.id), title: g.title, image: g.image ?? null, labels } : null;
      })
      .filter(Boolean);
    return { ok: true, data: filtered };
  } catch (error) {
    logger.error("getMySelectedGoals service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "Failed to fetch selected goals." };
  }
};
