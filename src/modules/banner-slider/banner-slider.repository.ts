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
  /**
   * Admin-only: sort `created_at DESC, id DESC` and ignore sortBy/sortDir.
   * RECENCY IS THE CONTRACT on admin lists (utils/listOrdering). The client page
   * shares this query and must keep its curated `orderBy ASC`, so the flag is set
   * by listBannersPaged and never by listBannersClientPaged.
   */
  recency?: boolean;
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
  /** Client list: `order_by ASC, created_at ASC`; optional `key` filter. */
  findMany: (opts?: { key?: BannerKey }) =>
    prisma.bannerSlider.findMany({
      where: opts?.key ? { key: BANNER_KEY_TO_MYSQL[opts.key] } : undefined,
      orderBy: [{ orderBy: "asc" }, { created_at: "asc" }],
    }),

  /**
   * Paginated + search list — backs BOTH the admin list (sortBy/sortDir) and the
   * client `/client/cms/banners` page. `created_at ASC` is appended as the
   * tiebreaker so the client's default `order_by ASC` page is deterministic.
   */
  findPage: (opts: BannerListOpts) =>
    prisma.bannerSlider.findMany({
      where: buildBannerWhere(opts),
      orderBy: opts.recency
        ? [{ created_at: "desc" as const }, { id: "desc" as const }]
        : [
            { [BANNER_SORT_COLUMNS[opts.sortBy ?? ""] ?? "orderBy"]: opts.sortDir ?? "asc" },
            { created_at: "asc" },
          ],
      ...(opts.skip != null ? { skip: opts.skip } : {}),
      ...(opts.take != null ? { take: opts.take } : {}),
    }),

  count: (opts: BannerListOpts) =>
    prisma.bannerSlider.count({ where: buildBannerWhere(opts) }),

  findById: (id: number) => prisma.bannerSlider.findUnique({ where: { id } }),

  /**
   * `orderBy` of the PREVIOUS row — the most recently created banner in this list
   * — which is the input to the +1 calculation on create (see utils/listOrdering).
   * Scoped by `key` because each key (Packages/Courses/Book/EBook/Explore) is its
   * own independently ordered list in the admin UI, so "the previous banner" means
   * the previous one on the same screen.
   */
  prevOrderBy: async (key?: BannerKey): Promise<number | null> =>
    (
      await prisma.bannerSlider.findFirst({
        where: key ? { key: BANNER_KEY_TO_MYSQL[key] } : { key: null },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { orderBy: true },
      })
    )?.orderBy ?? null,

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
