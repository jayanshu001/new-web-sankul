import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import {
  BANNER_KEY_TO_MYSQL,
  type BannerCreateInput,
  type BannerKey,
  type BannerUpdateInput,
} from "./banner-slider.types";
import {
  toPrismaBannerCreate,
  toPrismaBannerUpdate,
} from "./banner-slider.transformer";

export type BannerListOpts = {
  key?: BannerKey;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
};

const BANNER_SORT_COLUMNS: Record<string, string> = {
  orderBy: "orderBy",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

const buildBannerWhere = (opts: BannerListOpts) => {
  const where: Record<string, unknown> = {};
  if (opts.key) where.key = BANNER_KEY_TO_MYSQL[opts.key];
  const and: unknown[] = [];
  const search = buildPrismaSearch(opts.search, ["image", "key"]);
  if (search) and.push(search);
  if (and.length) where.AND = and;
  return where;
};

export const bannerSliderRepository = {
  /** Legacy API sorts by orderBy asc; optional `key` filter (client). */
  findMany: (opts?: { key?: BannerKey }) =>
    prisma.bannerSlider.findMany({
      where: opts?.key ? { key: BANNER_KEY_TO_MYSQL[opts.key] } : undefined,
      orderBy: { orderBy: "asc" },
    }),

  /** Admin paginated + search list. */
  findPage: (opts: BannerListOpts) =>
    prisma.bannerSlider.findMany({
      where: buildBannerWhere(opts),
      orderBy: { [BANNER_SORT_COLUMNS[opts.sortBy ?? ""] ?? "orderBy"]: opts.sortDir ?? "asc" },
      ...(opts.skip != null ? { skip: opts.skip } : {}),
      ...(opts.take != null ? { take: opts.take } : {}),
    }),

  count: (opts: BannerListOpts) =>
    prisma.bannerSlider.count({ where: buildBannerWhere(opts) }),

  findById: (id: number) => prisma.bannerSlider.findUnique({ where: { id } }),

  create: (input: BannerCreateInput) =>
    prisma.bannerSlider.create({ data: toPrismaBannerCreate(input) }),

  update: (id: number, input: BannerUpdateInput) =>
    prisma.bannerSlider.update({
      where: { id },
      data: toPrismaBannerUpdate(input),
    }),

  delete: (id: number) => prisma.bannerSlider.delete({ where: { id } }),

  /** Bulk reorder: set orderBy per id. Mirrors Mongo bulkWrite. */
  reorder: (ops: { id: number; orderBy: number }[]) =>
    prisma.$transaction(
      ops.map((o) =>
        prisma.bannerSlider.update({
          where: { id: o.id },
          data: { orderBy: o.orderBy, updated_at: new Date() },
        })
      )
    ),
};
