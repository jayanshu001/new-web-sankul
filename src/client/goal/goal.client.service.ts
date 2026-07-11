import logger from "../../utils/logger";
import { prisma } from "../../config/prisma";
import { redisClient } from "../../config/redis";
import { parseGoalSelection, parseLabels, reconcileGoalSelection, type GoalSelection, type CatalogGoal } from "../../utils/goalSelection";

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
      ? await prisma.customerTargetGoal.findMany({ where: { id: { in: parsed.map((s) => s.goalId) }, active: true }, select: { id: true, labels: true } })
      : [];
    // Reconcile the incoming selection against the catalog with the SAME rules as
    // the read path: unknown/inactive goals are dropped, and a labelled goal sent
    // with no valid label is dropped (not stored as a labelless shape) so a later
    // GET /client/goals/my-goals can never crash the FE bottom sheet.
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
    const labelsById = new Map(rows.map((r) => [r.id, parseLabels(r.labels)]));

    // Reconcile the stored selection against the CURRENT catalog before shaping,
    // so my-goals can never emit a shape that disagrees with GET /client/goals
    // (the goal-moved-under-another-goal bug). Stale/inactive goals and labelled
    // goals whose chosen labels all vanished are dropped rather than returned as
    // a labelless shape the FE bottom sheet would crash on.
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
