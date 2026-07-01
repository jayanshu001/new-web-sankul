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
