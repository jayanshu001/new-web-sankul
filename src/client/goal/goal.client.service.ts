import logger from "../../utils/logger";
import { Types } from "mongoose";
import { Goal } from "../../models/Goal.model";
import { Customer } from "../../models/customer/Customer.model";
import { redisClient } from "../../config/redis";

const ACTIVE_GOALS_CACHE_KEY = "cache:client:goals:active";
const MY_SELECTED_GOALS_CACHE_PREFIX = "cache:client:goals:selected:";
const PROFILE_CACHE_PREFIX = "cache:client:profile:";

export const getActiveGoals = async (traceId?: string) => {
  logger.info("getActiveGoals service invoked", { traceId });

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
