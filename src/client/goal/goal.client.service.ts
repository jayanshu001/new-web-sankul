import logger from "../../utils/logger";
import { prisma } from "../../config/prisma";
import { redisClient } from "../../config/redis";
import { parseGoalSelection, parseLabels, type GoalSelection } from "../../utils/goalSelection";

// Goals are the customer target-goal master (`ws_customer_target_goal`), each
// optionally carrying labels ([{ id, name }] JSON). The client selection lives on
// `ws_customer.goal` as [{ goalId, labelIds }] (legacy flat id arrays still read).
// It can be written here (PUT /client/goals) or via /client/profile/update — both
// persist the same validated composite shape.
const MY_SELECTED_GOALS_CACHE_PREFIX = "cache:client:goals:selected:";
const PROFILE_CACHE_PREFIX = "cache:client:profile:";

const parseGoalCustomerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Persist the customer's goal selection. Accepts the composite
 * `[{ goalId, labelIds }]` (or a legacy flat id array); validates against
 * ws_customer_target_goal — unknown goals dropped, label ids filtered to those
 * that exist on the goal — then stores the normalized composite on ws_customer.goal.
 */
export const updateMyGoals = async (customerId: string, goals: unknown, traceId?: string) => {
  logger.info("updateMyGoals service invoked", { traceId, customerId });
  try {
    if (!Array.isArray(goals)) return { ok: false as const, message: "Goals must be an array." };
    const cid = parseGoalCustomerId(customerId);
    if (cid == null) return { ok: false as const, message: "Customer not found." };
    const exists = await prisma.customer.findFirst({ where: { id: cid }, select: { id: true } });
    if (!exists) return { ok: false as const, message: "Customer not found." };

    const parsed = parseGoalSelection(goals);
    const rows = parsed.length
      ? await prisma.customerTargetGoal.findMany({ where: { id: { in: parsed.map((s) => s.goalId) } }, select: { id: true, labels: true } })
      : [];
    const labelSetByGoal = new Map(rows.map((r) => [r.id, new Set(parseLabels(r.labels).map((l) => l.id))]));
    const selection: GoalSelection[] = [];
    for (const sel of parsed) {
      const valid = labelSetByGoal.get(sel.goalId);
      if (!valid) continue; // unknown goal
      selection.push({ goalId: sel.goalId, labelIds: sel.labelIds.filter((id) => valid.has(id)) });
    }

    await prisma.customer.update({ where: { id: cid }, data: { goal: selection as any, updatedAt: new Date() } });
    try { await redisClient.del(`${MY_SELECTED_GOALS_CACHE_PREFIX}${customerId}`, `${PROFILE_CACHE_PREFIX}${customerId}`); } catch { /* best-effort */ }
    return { ok: true as const, data: { goals: selection }, message: "Goals updated successfully." };
  } catch (error) {
    logger.error("updateMyGoals service error", { traceId, customerId, error: (error as Error).message });
    return { ok: false as const, message: "Failed to update goals." };
  }
};

export const getActiveGoals = async (traceId?: string) => {
  logger.info("getActiveGoals service invoked", { traceId });

  const rows = await prisma.customerTargetGoal.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, image: true, labels: true },
  });
  return rows.map((g) => ({
    _id: String(g.id),
    title: g.name,
    image: g.image ?? null,
    labels: parseLabels(g.labels).map((l) => ({ _id: String(l.id), name: l.name })),
  }));
};

/**
 * Fetches the customer's selected goals — each returned with ONLY the labels
 * the customer chose within it. A selected goal with no labels still appears
 * (empty `labels`). Order follows the stored selection.
 */
export const getMySelectedGoals = async (customerId: string, traceId?: string) => {
  logger.info("getMySelectedGoals service invoked", { traceId, customerId });

  try {
    const cid = parseGoalCustomerId(customerId);
    if (cid == null) return { ok: false, message: "Customer not found." };
    const customer = await prisma.customer.findFirst({ where: { id: cid }, select: { goal: true } });
    if (!customer) return { ok: false, message: "Customer not found." };

    const selections = parseGoalSelection(customer.goal);
    if (!selections.length) return { ok: true, data: [] };

    const rows = await prisma.customerTargetGoal.findMany({
      where: { id: { in: selections.map((s) => s.goalId) }, active: true },
      select: { id: true, name: true, image: true, labels: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const shaped = selections
      .map((sel) => {
        const row = byId.get(sel.goalId);
        if (!row) return null;
        const chosen = new Set(sel.labelIds);
        return {
          _id: String(row.id),
          title: row.name,
          image: row.image ?? null,
          labels: parseLabels(row.labels)
            .filter((l) => chosen.has(l.id))
            .map((l) => ({ _id: String(l.id), name: l.name })),
        };
      })
      .filter(Boolean);
    return { ok: true, data: shaped };
  } catch (error) {
    logger.error("getMySelectedGoals service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "Failed to fetch selected goals." };
  }
};
