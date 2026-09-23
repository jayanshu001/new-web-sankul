/**
 * Customer goal-selection encoding shared by the profile + client-goals modules.
 *
 * A customer's selection lives on `ws_customer.goal` (JSON) as an array of
 * `{ goalId, labelIds }` — a target goal (`ws_customer_target_goal`) plus the
 * specific labels chosen within it (empty when the goal has no labels). The
 * legacy shape was a flat id array (`[1, 8, 9]`); readers stay tolerant of it by
 * coercing each bare id to `{ goalId, labelIds: [] }`.
 *
 * Target-goal labels live in `ws_customer_target_goal.labels` as `[{ id, name }]`
 * (ids assigned by the admin target-goal service, mirroring `ws_goal`).
 */

export interface GoalSelection {
  goalId: number;
  labelIds: number[];
}

/** One entry as accepted on the write boundary (object form or a bare id). */
export type GoalSelectionInput =
  | { goalId: string | number; labelIds?: (string | number)[] }
  | string
  | number;

const toPosInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Parse a `ws_goal`/`ws_customer_target_goal` labels JSON → `[{ id, name }]`. */
export const parseLabels = (raw: unknown): { id: number; name: string }[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l === "object" && (l as any).id != null)
    .map((l) => ({ id: Number((l as any).id), name: String((l as any).name ?? "") }))
    .filter((l) => Number.isInteger(l.id) && l.id > 0);
};

/** A goal as it currently exists in the catalog, for reconciliation. */
export interface CatalogGoal {
  /** Ids of the labels that currently exist on the goal. */
  labelIds: Set<number>;
  /** Whether the catalog goal is a labelled (accordion) goal. */
  hasLabels: boolean;
}

/**
 * Reconcile a parsed selection against the current catalog so every returned
 * entry matches one of the two valid FE shapes and can never disagree with
 * `GET /client/goals`:
 *
 *   - labelless goal → `labelIds: []`            (catalog goal has NO labels)
 *   - labelled goal  → `labelIds: [non-empty subset of the catalog's labels]`
 *
 * Drops any selection that would otherwise crash the Select-Goals bottom sheet:
 *   - goal id not in the (active) catalog                     → unknown/inactive
 *   - labelled catalog goal whose chosen labels all vanished  → stale (would
 *     otherwise be emitted as an empty-labels shape that FE reads as a
 *     *labelless* selection, conflicting with the catalog's accordion shape —
 *     the exact goal-moved-under-another-goal migration bug).
 *
 * `validGoals` must contain ONLY goals that still exist and are active; callers
 * build it from the same catalog read they render from.
 */
export const reconcileGoalSelection = (
  selections: GoalSelection[],
  validGoals: Map<number, CatalogGoal>
): GoalSelection[] => {
  const out: GoalSelection[] = [];
  for (const sel of selections) {
    const g = validGoals.get(sel.goalId);
    if (!g) continue; // unknown / inactive goal — drop
    if (g.hasLabels) {
      const kept = sel.labelIds.filter((id) => g.labelIds.has(id));
      if (kept.length === 0) continue; // labelled goal, no surviving chosen label — drop
      out.push({ goalId: sel.goalId, labelIds: kept });
    } else {
      out.push({ goalId: sel.goalId, labelIds: [] }); // genuinely labelless
    }
  }
  return out;
};

/**
 * Parse the stored/incoming selection into normalized `{ goalId, labelIds }[]`.
 * Tolerant of the legacy flat id array; drops invalid ids; dedupes by goalId
 * (first wins) while preserving order.
 */
export const parseGoalSelection = (raw: unknown): GoalSelection[] => {
  if (!Array.isArray(raw)) return [];
  const out: GoalSelection[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    let goalId: number | null;
    let labelIds: number[] = [];
    if (item != null && typeof item === "object") {
      goalId = toPosInt((item as any).goalId);
      const rawLabels = (item as any).labelIds;
      if (Array.isArray(rawLabels)) {
        labelIds = rawLabels.map(toPosInt).filter((n): n is number => n != null);
      }
    } else {
      goalId = toPosInt(item); // legacy flat id
    }
    if (goalId == null || seen.has(goalId)) continue;
    seen.add(goalId);
    // dedupe labelIds, preserve order
    out.push({ goalId, labelIds: [...new Set(labelIds)] });
  }
  return out;
};
