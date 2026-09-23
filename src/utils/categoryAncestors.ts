/**
 * Resolve category ancestors ({id, name}, ordered root → immediate-parent) for a
 * page of category rows that form a single-parent tree via a `parent` self-FK.
 *
 * Used by the admin category pickers (exam / material / video) so each returned row
 * carries its ancestor chain — the FE renders the greyed parent rows for a search
 * match without holding the whole tree. See
 * docs/backend-requests/category-pickers-hierarchy.md.
 *
 * Cost: bounded by tree DEPTH (one batched `loadByIds` query per level), not by the
 * number of rows — typically 2–4 queries regardless of page size. Cycle-guarded.
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
 * Pre-load every ancestor of the given rows, then return a lookup that maps a row's
 * immediate `parent` id to its ancestors[] (root → immediate-parent).
 *
 * @param parentIds  each page row's own `parent` id (0/null = root; deduped internally)
 * @param loadByIds  batched loader: category ids → {id, name, parent} (one query/level)
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
    return chain.reverse(); // root → immediate-parent
  };
}

const uniqPositive = (ids: (number | null | undefined)[]): number[] => [
  ...new Set(ids.filter((id): id is number => typeof id === "number" && id > 0)),
];
