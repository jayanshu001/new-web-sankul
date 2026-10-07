// Client goals: goal catalog reads and the customer's goal selection logic.
import logger from "../../utils/logger";
import { prisma } from "../../config/prisma";
import { redisClient } from "../../config/redis";
import { parseGoalSelection, parseLabels, reconcileGoalSelection, type GoalSelection, type CatalogGoal } from "../../utils/goalSelection";

// Goals are the `ws_customer_target_goal` master, each optionally carrying labels
// ([{ id, name }] JSON). The customer's selection lives on `ws_customer.goal` as
// [{ goalId, labelIds }]; legacy flat id arrays are still read.
const MY_SELECTED_GOALS_CACHE_PREFIX = "cache:client:goals:selected:";
const PROFILE_CACHE_PREFIX = "cache:client:profile:";

const parseGoalCustomerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Accepts `[{ goalId, labelIds }]` or a legacy flat id array; unknown goals are dropped
 * and label ids filtered to those on the goal before storing on ws_customer.goal.
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
      ? await prisma.customerTargetGoal.findMany({ where: { id: { in: parsed.map((s) => s.goalId) }, active: true }, select: { id: true, labels: true } })
      : [];
    // Same reconcile rules as the read path: a labelled goal sent with no valid label is
    // dropped (not stored labelless) so GET /client/goals/my-goals can't crash the FE sheet.
    const validGoals = new Map<number, CatalogGoal>(
      rows.map((r) => {
        const labels = parseLabels(r.labels);
        return [r.id, { labelIds: new Set(labels.map((l) => l.id)), hasLabels: labels.length > 0 }];
      })
    );
    const selection: GoalSelection[] = reconcileGoalSelection(parsed, validGoals);

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

/** Selected goals, each with only the labels the customer chose; order follows the stored selection. */
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
    const labelsById = new Map(rows.map((r) => [r.id, parseLabels(r.labels)]));

    // Reconcile against the current catalog so my-goals never disagrees with GET /client/goals.
    // Stale goals, and labelled goals whose chosen labels all vanished, are dropped rather than
    // returned labelless (the FE bottom sheet crashes on that shape).
    const validGoals = new Map<number, CatalogGoal>(
      rows.map((r) => {
        const labels = labelsById.get(r.id)!;
        return [r.id, { labelIds: new Set(labels.map((l) => l.id)), hasLabels: labels.length > 0 }];
      })
    );
    const reconciled = reconcileGoalSelection(selections, validGoals);

    const shaped = reconciled.map((sel) => {
      const row = byId.get(sel.goalId)!; // guaranteed present by reconcile
      const chosen = new Set(sel.labelIds);
      return {
        _id: String(row.id),
        title: row.name,
        image: row.image ?? null,
        labels: labelsById.get(row.id)!
          .filter((l) => chosen.has(l.id))
          .map((l) => ({ _id: String(l.id), name: l.name })),
      };
    });
    return { ok: true, data: shaped };
  } catch (error) {
    logger.error("getMySelectedGoals service error", { traceId, customerId, error: (error as Error).message, stack: (error as Error).stack });
    return { ok: false, message: "Failed to fetch selected goals." };
  }
};
