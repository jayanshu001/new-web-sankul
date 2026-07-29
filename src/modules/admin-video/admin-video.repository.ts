import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { parentIdsWithChildren, primaryParentsOf } from "../../utils/videoCategoryRelation";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * Prisma persistence for the admin-video MySQL branch (ws_video).
 * Video belongs to one VideoCategory (vcategory_id). platform = youtube|vimeo|aws
 * with the matching *_id column carrying the provider id. priceType enum (free|paid).
 */
export const adminVideoRepository = {
  list: (opts: { search?: string; status?: boolean; type?: "free" | "paid"; platform?: string; videoCategoryId?: number; sortBy: string; sortDir: "asc" | "desc"; skip: number; take: number }) =>
    prisma.video.findMany({
      where: buildWhere(opts),
      include: { VideoCategory: { select: { id: true, title: true, slug: true } } },
      orderBy: buildOrderBy(opts.sortBy, opts.sortDir),
      skip: opts.skip,
      take: opts.take,
    }),
  count: (opts: { search?: string; status?: boolean; type?: "free" | "paid"; platform?: string; videoCategoryId?: number }) =>
    prisma.video.count({ where: buildWhere(opts) }),

  findById: (id: number) =>
    prisma.video.findUnique({ where: { id }, include: { VideoCategory: { select: { id: true, title: true, slug: true } } } }),
  findBare: (id: number) => prisma.video.findUnique({ where: { id } }),

  categoryExists: (id: number) => prisma.videoCategory.findUnique({ where: { id }, select: { id: true } }),

  /** Active categories for the pre-requisites dropdown. The parent/child hierarchy
   *  is resolved separately from ws_video_category_relation (see the service), so
   *  the `parent` column is intentionally NOT selected here.
   *  `search` = title contains-match; `limit` caps the page (omit → all, back-compat). */
  listActiveCategories: (opts: { search?: string; limit?: number } = {}) =>
    prisma.videoCategory.findMany({
      where: { status: true, ...(buildPrismaSearch(opts.search, ["title"]) ?? {}) },
      orderBy: [{ order_by: "asc" }, { title: "asc" }],
      select: { id: true, title: true, slug: true },
      ...(opts.limit && opts.limit > 0 ? { take: opts.limit } : {}),
    }),
  // Categories that are a parent of ≥1 ws_video_category_relation edge (has_children).
  childParentIds: () => parentIdsWithChildren(),
  // Batched `child → primary parent` map from the relation DAG (deterministic single
  // parent), for the picker's parentId + ancestor-chain resolution.
  primaryParents: (ids: number[]) => primaryParentsOf(ids),
  // Batched {id, name, parent} loader for ancestor-chain resolution — parent resolved
  // from ws_video_category_relation. Status-agnostic so a disabled parent still resolves
  // (it renders as a greyed row). One query/level.
  categoriesByIds: async (ids: number[]) => {
    if (!ids.length) return [];
    const [cats, parents] = await Promise.all([
      prisma.videoCategory.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
      primaryParentsOf(ids),
    ]);
    return cats.map((r) => ({ id: r.id, name: r.title, parent: parents.get(r.id) ?? null }));
  },

  slugTaken: (slug: string, exceptId?: number) =>
    prisma.video.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }),

  /**
   * `order` of the PREVIOUS video (most recently created) — input to the +1 calc
   * on create (see utils/listOrdering). Deliberately NOT scoped to a category:
   * the admin screen is one list with an optional category filter, and a global
   * maximum keeps the value unique across BOTH the filtered and unfiltered views.
   */
  prevOrder: async (): Promise<number | null> =>
    (await prisma.video.findFirst({ orderBy: [{ created_at: "desc" }, { id: "desc" }], select: { order: true } }))?.order ?? null,

  create: (data: Prisma.VideoUncheckedCreateInput) => prisma.video.create({ data, include: { VideoCategory: { select: { id: true, title: true, slug: true } } } }),
  update: (id: number, data: Prisma.VideoUncheckedUpdateInput) => prisma.video.update({ where: { id }, data, include: { VideoCategory: { select: { id: true, title: true, slug: true } } } }),
  delete: (id: number) => prisma.video.delete({ where: { id } }),
  setStatus: (id: number, status: boolean) => prisma.video.update({ where: { id }, data: { status, updated_at: new Date() } }),
  setOrder: (id: number, order: number) => prisma.video.update({ where: { id }, data: { order, updated_at: new Date() } }),
};

/**
 * Admin list ordering. RECENCY IS THE CONTRACT here: the newest video is always
 * row #1, whatever `ws_video.order` says.
 *
 * `sort_by=order` (the default, and what the admin UI sends) therefore maps to
 * `created_at DESC` — NOT to the `order` column. `sort_dir` is deliberately
 * ignored in that case: the requirement is "newest on top", so honouring
 * `sort_dir=asc` (which the UI does send) would invert exactly what was asked
 * for. Every other `sort_by` still sorts by its own column in the requested
 * direction.
 *
 * Consequence, on purpose: manual reordering is INVISIBLE on this screen. The
 * `order` column is still written — append-on-create (`MAX(order) + 1`) and
 * `setOrder` both keep maintaining it, and the client catalog still sorts by it
 * (`order ASC, created_at ASC`) — but nothing here reads it. To restore curated
 * ordering, return `[{ order: sortDir }, { id: "desc" }]` for the "order" case.
 *
 * The trailing `id DESC` is the stable tiebreaker: `created_at` is a datetime and
 * bulk-created rows can share a value, which would otherwise page unpredictably.
 */
function buildOrderBy(
  sortBy: string,
  sortDir: "asc" | "desc"
): Prisma.VideoOrderByWithRelationInput[] {
  if (sortBy === "order") return [{ created_at: "desc" }, { id: "desc" }];
  return [{ [sortCol(sortBy)]: sortDir }, { id: "desc" }];
}

function sortCol(sortBy: string): string {
  if (sortBy === "name" || sortBy === "title") return "title";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updated_at";
  if (sortBy === "createdAt" || sortBy === "created_at") return "created_at";
  // "order" never reaches here — buildOrderBy intercepts it (see above).
  return "created_at";
}

function buildWhere(opts: { search?: string; status?: boolean; type?: "free" | "paid"; platform?: string; videoCategoryId?: number }): Prisma.VideoWhereInput {
  const where: Prisma.VideoWhereInput = {};
  const search = buildPrismaSearch(opts.search, ["title", "slug", "topic"]);
  if (search) Object.assign(where, search);
  if (opts.status !== undefined) where.status = opts.status;
  if (opts.type) where.priceType = opts.type;
  if (opts.platform) where.platform = opts.platform;
  if (opts.videoCategoryId !== undefined) where.videoCategoryId = opts.videoCategoryId;
  return where;
}
