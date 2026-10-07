// Category ancestors: parent chains for the admin category pickers.
/**
 * Ancestor chains for the admin category pickers (exam / material / video), so the
 * FE can render parent rows for a search match without the whole tree. One batched
 * query per tree level, not per row. Cycle-guarded.
 */

export interface CategoryAncestor {
  id: string;
  name: string;
}

interface RawNode {
  id: number;
  name: string | null;
  parent: number | null;
}

/**
 * Pre-loads every ancestor, then returns a lookup from a row's `parent` id to its
 * ancestors (root → immediate parent).
 *
 * @param parentIds  each row's own `parent` id (0/null = root)
 * @param loadByIds  batched loader: ids → {id, name, parent}
 */
export async function resolveAncestors(
  parentIds: (number | null | undefined)[],
  loadByIds: (ids: number[]) => Promise<RawNode[]>,
): Promise<(parentId: number | null | undefined) => CategoryAncestor[]> {
  const index = new Map<number, RawNode>();

  let frontier = uniqPositive(parentIds);
  while (frontier.length) {
    const rows = await loadByIds(frontier);
    const next: number[] = [];
    for (const r of rows) {
      if (!index.has(r.id)) {
        index.set(r.id, r);
        if (r.parent && r.parent > 0 && !index.has(r.parent)) next.push(r.parent);
      }
    }
    frontier = uniqPositive(next);
  }

  return (parentId: number | null | undefined): CategoryAncestor[] => {
    const chain: CategoryAncestor[] = [];
    const seen = new Set<number>();
    let cur = parentId ?? 0;
    while (cur > 0 && index.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const node = index.get(cur)!;
      chain.push({ id: String(node.id), name: node.name ?? "" });
      cur = node.parent ?? 0;
    }
    return chain.reverse();
  };
}

const uniqPositive = (ids: (number | null | undefined)[]): number[] => [
  ...new Set(ids.filter((id): id is number => typeof id === "number" && id > 0)),
];
