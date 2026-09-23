/**
 * Video-category hierarchy resolver — sourced from the `ws_video_category_relation`
 * edge table (the parent→child DAG), NOT the legacy `ws_video_category.parent`
 * self-FK column.
 *
 * Background: video categories historically carried TWO hierarchy stores kept in
 * sync by the admin CRUD — the single-parent `parent` column and the many-to-many
 * `ws_video_category_relation` edge table. The relation table is the source of
 * truth (it is what the client catalog DAG walker `catalog-category-tree` and
 * package composition already trust). These helpers move every parent/child READ
 * onto that table.
 *
 * The relation table is a DAG (a category may sit under >1 parent). Where the API
 * exposes a SINGLE parent (picker `parentId`, admin tree, ancestor chains), we
 * collapse to a deterministic "primary" parent via {@link primaryParentMap} so the
 * response shape is byte-identical to the old single-parent column output. For
 * well-formed data (exactly one edge per child — how `vcSetParent` maintains it)
 * the primary parent equals the old column value.
 */
import { prisma } from "../config/prisma";

export interface VcEdge {
  parent: number;
  child: number;
  order: number;
}

/**
 * Collapse a set of DAG edges to ONE deterministic parent per child:
 * lowest edge `order`, then lowest `parent` id. Stable and — for a child with a
 * single edge — identical to the old `ws_video_category.parent` value.
 * Edges with a non-positive parent/child are ignored. Returns `child → parent`.
 */
export function primaryParentMap(edges: VcEdge[]): Map<number, number> {
  const byChild = new Map<number, VcEdge[]>();
  for (const e of edges) {
    if (!e.parent || e.parent <= 0 || !e.child || e.child <= 0) continue;
    const arr = byChild.get(e.child);
    if (arr) arr.push(e);
    else byChild.set(e.child, [e]);
  }
  const out = new Map<number, number>();
  for (const [child, list] of byChild) {
    list.sort((a, b) => a.order - b.order || a.parent - b.parent);
    out.set(child, list[0].parent);
  }
  return out;
}

/** Every parent→child edge (the whole DAG). Used for in-memory tree builds. */
export const loadAllEdges = (): Promise<VcEdge[]> =>
  prisma.videoCategoryRelation.findMany({ select: { parent: true, child: true, order: true } });

/** Edges whose `child` ∈ ids (for resolving those children's parents). */
export const loadEdgesByChild = (ids: number[]): Promise<VcEdge[]> =>
  ids.length
    ? prisma.videoCategoryRelation.findMany({
        where: { child: { in: [...new Set(ids)] } },
        select: { parent: true, child: true, order: true },
      })
    : Promise.resolve([]);

/** Distinct category ids that are the parent of ≥1 edge (drives `has_children`). */
export const parentIdsWithChildren = async (): Promise<Set<number>> => {
  const rows = await prisma.videoCategoryRelation.findMany({
    where: { parent: { gt: 0 } },
    select: { parent: true },
    distinct: ["parent"],
  });
  return new Set(rows.map((r) => r.parent));
};

/** Distinct child ids directly under `parentId`, ordered by edge `order` then id. */
export const childIdsOf = async (parentId: number): Promise<number[]> => {
  if (!parentId || parentId <= 0) return [];
  const rows = await prisma.videoCategoryRelation.findMany({
    where: { parent: parentId },
    select: { child: true, order: true },
    orderBy: [{ order: "asc" }, { child: "asc" }],
  });
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of rows) {
    if (r.child && r.child > 0 && !seen.has(r.child)) {
      seen.add(r.child);
      out.push(r.child);
    }
  }
  return out;
};

/** Batched `child → primary parent` map for the given child ids. */
export const primaryParentsOf = async (ids: number[]): Promise<Map<number, number>> =>
  primaryParentMap(await loadEdgesByChild(ids));
