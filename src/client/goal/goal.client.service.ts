import logger from "../../utils/logger";
import { Goal } from "../../models/Goal.model";
import { Customer } from "../../models/customer/Customer.model";

export const getActiveGoals = async (traceId?: string) => {
  logger.info("getActiveGoals service invoked", { traceId });

  const goals = await Goal.find({ isActive: true })
    .select("title image labels")
    .sort({ createdAt: 1 });

  logger.info("getActiveGoals service completed", { traceId, count: goals.length });
  return goals;
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

    logger.info("getMySelectedGoals service completed", { traceId, customerId, count: filteredGoals.length });
    return { ok: true, data: filteredGoals };
  } catch (error) {
    logger.error("getMySelectedGoals service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "Failed to fetch selected goals." };
  }
};
