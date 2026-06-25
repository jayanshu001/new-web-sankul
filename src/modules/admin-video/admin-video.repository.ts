import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

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

  /** Active categories for the pre-requisites dropdown (+ children via parent FK). */
  listActiveCategories: () =>
    prisma.videoCategory.findMany({ where: { status: true }, orderBy: [{ order_by: "asc" }, { title: "asc" }], select: { id: true, title: true, slug: true } }),
  childParentIds: async () => {
    const rows = await prisma.videoCategory.findMany({ where: { parent: { gt: 0 } }, select: { parent: true } });
    return new Set(rows.map((r) => r.parent!));
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
  if (opts.search) {
    const q = opts.search.trim();
    where.OR = [{ title: { contains: q } }, { slug: { contains: q } }, { topic: { contains: q } }];
  }
  if (opts.status !== undefined) where.status = opts.status;
  if (opts.type) where.priceType = opts.type;
  if (opts.platform) where.platform = opts.platform;
  if (opts.videoCategoryId !== undefined) where.videoCategoryId = opts.videoCategoryId;
  return where;
}
