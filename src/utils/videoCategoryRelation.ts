// Video category hierarchy: parent/child reads from the relation DAG.
/**
 * Video-category hierarchy reads come from the `ws_video_category_relation` DAG,
 * not the `ws_video_category.parent` column (still written in sync by admin CRUD).
 * Where the API exposes a single parent (picker `parentId`, admin tree, ancestor
 * chains) the DAG is collapsed via {@link primaryParentMap}, which equals the
 * column value for well-formed single-edge data.
 */
import { prisma } from "../config/prisma";

export interface VcEdge {
  parent: number;
  child: number;
  order: number;
}

/**
 * `child → parent`, picking the lowest edge `order` then lowest parent id.
 * Edges with a non-positive parent/child are ignored.
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

export const loadAllEdges = (): Promise<VcEdge[]> =>
  prisma.videoCategoryRelation.findMany({ select: { parent: true, child: true, order: true } });

export const loadEdgesByChild = (ids: number[]): Promise<VcEdge[]> =>
  ids.length
    ? prisma.videoCategoryRelation.findMany({
        where: { child: { in: [...new Set(ids)] } },
        select: { parent: true, child: true, order: true },
      })
    : Promise.resolve([]);

/** Drives `has_children`. */
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

export const primaryParentsOf = async (ids: number[]): Promise<Map<number, number>> =>
  primaryParentMap(await loadEdgesByChild(ids));
