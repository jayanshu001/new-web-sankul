// Goal selection: parse and reconcile a customer's stored goal + label choices.
/**
 * Customer goal selection, stored on `ws_customer.goal` (JSON) as
 * `[{ goalId, labelIds }]` (labelIds empty for labelless goals). Readers also
 * accept the legacy flat id array, coercing each id to `{ goalId, labelIds: [] }`.
 * Labels live in `ws_customer_target_goal.labels` as `[{ id, name }]`.
 */

export interface GoalSelection {
  goalId: number;
  labelIds: number[];
}

export type GoalSelectionInput =
  | { goalId: string | number; labelIds?: (string | number)[] }
  | string
  | number;

const toPosInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const parseLabels = (raw: unknown): { id: number; name: string }[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l === "object" && (l as any).id != null)
    .map((l) => ({ id: Number((l as any).id), name: String((l as any).name ?? "") }))
    .filter((l) => Number.isInteger(l.id) && l.id > 0);
};

export interface CatalogGoal {
  labelIds: Set<number>;
  /** Labelled (accordion) goal. */
  hasLabels: boolean;
}

/**
 * Reconcile a selection against the current catalog so it never disagrees with
 * `GET /client/goals`: labelless goals get `labelIds: []`, labelled goals a
 * non-empty subset of their current labels. Drops unknown/inactive goals and
 * labelled goals whose chosen labels all vanished (an empty-labels entry would
 * read as labelless and crash the Select-Goals sheet).
 *
 * `validGoals` must contain only existing, active goals, built from the same
 * catalog read the caller renders from.
 */
export const reconcileGoalSelection = (
  selections: GoalSelection[],
  validGoals: Map<number, CatalogGoal>
): GoalSelection[] => {
  const out: GoalSelection[] = [];
  for (const sel of selections) {
    const g = validGoals.get(sel.goalId);
    if (!g) continue;
    if (g.hasLabels) {
      const kept = sel.labelIds.filter((id) => g.labelIds.has(id));
      if (kept.length === 0) continue;
      out.push({ goalId: sel.goalId, labelIds: kept });
    } else {
      out.push({ goalId: sel.goalId, labelIds: [] });
    }
  }
  return out;
};

/**
 * Normalize a stored/incoming selection. Accepts the legacy flat id array, drops
 * invalid ids, dedupes by goalId (first wins) preserving order.
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
      goalId = toPosInt(item);
    }
    if (goalId == null || seen.has(goalId)) continue;
    seen.add(goalId);
    out.push({ goalId, labelIds: [...new Set(labelIds)] });
  }
  return out;
};
