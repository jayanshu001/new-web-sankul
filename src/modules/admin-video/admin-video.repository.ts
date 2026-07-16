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
      // Stable secondary sort on id (asc) so rows that tie on the primary key
      // (e.g. many share order=0) always come back in ascending-id order — the
      // DB's natural order — matching the legacy/Mongo response exactly.
      orderBy: [{ [sortCol(opts.sortBy)]: opts.sortDir }, { id: "asc" }],
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

  create: (data: Prisma.VideoUncheckedCreateInput) => prisma.video.create({ data, include: { VideoCategory: { select: { id: true, title: true, slug: true } } } }),
  update: (id: number, data: Prisma.VideoUncheckedUpdateInput) => prisma.video.update({ where: { id }, data, include: { VideoCategory: { select: { id: true, title: true, slug: true } } } }),
  delete: (id: number) => prisma.video.delete({ where: { id } }),
  setStatus: (id: number, status: boolean) => prisma.video.update({ where: { id }, data: { status, updated_at: new Date() } }),
  setOrder: (id: number, order: number) => prisma.video.update({ where: { id }, data: { order, updated_at: new Date() } }),
};

function sortCol(sortBy: string): string {
  if (sortBy === "name" || sortBy === "title") return "title";
  if (sortBy === "order") return "order";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updated_at";
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
