import { Goal } from "../../models/Goal.model";
import { Customer } from "../../models/customer/Customer.model";

export const getActiveGoals = async () => {
  // Fetches only active goals, cleanly projecting necessary UI fields
  return await Goal.find({ isActive: true })
    .select("title image labels")
    .sort({ createdAt: 1 });
};

/**
 * Fetches the user's specifically selected goals, filtering out unused labels
 */
export const getMySelectedGoals = async (customerId: string) => {
  try {
    const customer = await Customer.findById(customerId).select("goals");
    if (!customer) return { ok: false, message: "Customer not found." };

    const goalIds = (customer.goals || []).map(id => id.toString());

    if (goalIds.length === 0) {
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

    return { ok: true, data: filteredGoals };
  } catch (error) {
    console.error("[getMySelectedGoals service error]", error);
    return { ok: false, message: "Failed to fetch selected goals." };
  }
};
