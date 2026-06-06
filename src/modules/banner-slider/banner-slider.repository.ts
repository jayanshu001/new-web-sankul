import { prisma } from "../../config/prisma";
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

export const bannerSliderRepository = {
  /** Legacy API sorts by orderBy asc; optional `key` filter (client). */
  findMany: (opts?: { key?: BannerKey }) =>
    prisma.bannerSlider.findMany({
      where: opts?.key ? { key: BANNER_KEY_TO_MYSQL[opts.key] } : undefined,
      orderBy: { orderBy: "asc" },
    }),

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
