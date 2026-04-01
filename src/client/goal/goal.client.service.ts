import { Goal } from "../../models/Goal.model";

export const getActiveGoals = async () => {
  // Fetches only active goals, cleanly projecting necessary UI fields
  return await Goal.find({ isActive: true })
    .select("title image labels")
    .sort({ createdAt: 1 });
};
