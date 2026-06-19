import logger from "../../utils/logger";
import { Types } from "mongoose";
import { Goal } from "../../models/Goal.model";
import { Customer } from "../../models/customer/Customer.model";
import { redisClient } from "../../config/redis";
import { prisma } from "../../config/prisma";
import { isGoalMysql } from "../../modules/goal/goal.service";

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

const ACTIVE_GOALS_CACHE_KEY = "cache:client:goals:active";
const MY_SELECTED_GOALS_CACHE_PREFIX = "cache:client:goals:selected:";
const PROFILE_CACHE_PREFIX = "cache:client:profile:";

export const getActiveGoals = async (traceId?: string) => {
  logger.info("getActiveGoals service invoked", { traceId });

  // ─── SQL branch — gated on `goal` ───
  if (isGoalMysql()) {
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
  }

  try {
    const cached = await redisClient.get(ACTIVE_GOALS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      logger.info("getActiveGoals cache hit", { traceId, count: parsed.length });
      return parsed;
    }
  } catch (err) {
    logger.warn("getActiveGoals cache read failed", { traceId, error: (err as Error).message });
  }

  const goals = await Goal.find({ isActive: true })
    .select("title image labels")
    .sort({ createdAt: 1 });

  try {
    await redisClient.set(ACTIVE_GOALS_CACHE_KEY, JSON.stringify(goals), "EX", 60 * 60); // 1h TTL
    logger.info("getActiveGoals cache written", { traceId });
  } catch (err) {
    logger.warn("getActiveGoals cache write failed", { traceId, error: (err as Error).message });
  }

  logger.info("getActiveGoals service completed", { traceId, count: goals.length });
  return goals;
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

    // ─── SQL branch — store selected LABEL ids on ws_customer.goal ───
    if (isGoalMysql()) {
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
    }
    const validGoals = goals.filter((id) => Types.ObjectId.isValid(id));

    const customer = await Customer.findByIdAndUpdate(
      customerId,
      { $set: { goals: validGoals } },
      { new: true }
    ).select("goals");

    if (!customer) {
      logger.warn("updateMyGoals service customer not found", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }

    try {
      await redisClient.del(
        `${MY_SELECTED_GOALS_CACHE_PREFIX}${customerId}`,
        `${PROFILE_CACHE_PREFIX}${customerId}`
      );
    } catch (err) {
      logger.warn("updateMyGoals cache invalidation failed", { traceId, customerId, error: (err as Error).message });
    }

    logger.info("updateMyGoals service completed", { traceId, customerId, count: validGoals.length });
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
    // ─── SQL branch ───
    if (isGoalMysql()) {
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
    }

    const customer = await Customer.findById(customerId).select("goals");
    if (!customer) {
      logger.warn("getGoalsWithSelection service customer not found", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }
    const selectedSet = new Set((customer.goals || []).map((id) => id.toString()));

    const goals = await Goal.find({ isActive: true })
      .select("title image labels")
      .sort({ createdAt: 1 });

    const shaped = goals.map((g) => {
      const doc = g.toObject();
      return {
        _id: doc._id,
        title: doc.title,
        image: doc.image,
        labels: doc.labels.map((label: any) => ({
          _id: label._id,
          name: label.name,
          isSelected: selectedSet.has(label._id?.toString()),
        })),
      };
    });

    logger.info("getGoalsWithSelection service completed", { traceId, customerId, count: shaped.length });
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
    // ─── SQL branch ───
    if (isGoalMysql()) {
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
    }

    const customer = await Customer.findById(customerId).select("goals");
    if (!customer) {
      logger.warn("getMySelectedGoals service missing customer", { traceId, customerId });
      return { ok: false, message: "Customer not found." };
    }

    const goalIds = (customer.goals || []).map(id => id.toString());

    if (goalIds.length === 0) {
      logger.info("getMySelectedGoals service no goals selected", { traceId, customerId });
      return { ok: true, data: [] };
    }

    const cacheKey = `${MY_SELECTED_GOALS_CACHE_PREFIX}${customerId}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        logger.info("getMySelectedGoals cache hit", { traceId, customerId, count: parsed.length });
        return { ok: true, data: parsed };
      }
    } catch (err) {
      logger.warn("getMySelectedGoals cache read failed", { traceId, customerId, error: (err as Error).message });
    }

    // Pass 1: Find goal groups that contain ANY selected label
    const rawGoals = await Goal.find({
      "labels._id": { $in: goalIds },
      isActive: true
    }).select("title image labels");

    // Pass 2: Filter out the unselected sub-labels dynamically
    const filteredGoals = rawGoals.map(goal => {
      const doc = goal.toObject();
      // Keep only labels the user explicitly checked
      doc.labels = doc.labels.filter(label => goalIds.includes(label._id?.toString()));
      return {
        _id: doc._id,
        title: doc.title,
        image: doc.image,
        labels: doc.labels
      };
    });

    try {
      await redisClient.set(cacheKey, JSON.stringify(filteredGoals), "EX", 60 * 5); // 5m TTL
      logger.info("getMySelectedGoals cache written", { traceId, customerId });
    } catch (err) {
      logger.warn("getMySelectedGoals cache write failed", { traceId, customerId, error: (err as Error).message });
    }

    logger.info("getMySelectedGoals service completed", { traceId, customerId, count: filteredGoals.length });
    return { ok: true, data: filteredGoals };
  } catch (error) {
    logger.error("getMySelectedGoals service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "Failed to fetch selected goals." };
  }
};
