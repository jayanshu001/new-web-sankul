import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type {
  TestimonialCreateInput,
  TestimonialUpdateInput,
} from "./testimonial.types";
import {
  toPrismaTestimonialCreate,
  toPrismaTestimonialUpdate,
} from "./testimonial.transformer";

export type TestimonialListOpts = {
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
};

const TESTIMONIAL_SORT_COLUMNS: Record<string, string> = {
  rating: "rating",
  name: "name",
  title: "title",
};

const buildTestimonialWhere = (opts: TestimonialListOpts): Record<string, unknown> =>
  buildPrismaSearch(opts.search, ["name", "title", "discription"]) ?? {};

export const testimonialRepository = {
  /** Client + admin list. Legacy API sorts by rating desc. */
  findMany: () =>
    prisma.testimonial.findMany({ orderBy: { rating: "desc" } }),

  /** Admin paginated + search list. */
  findPage: (opts: TestimonialListOpts) =>
    prisma.testimonial.findMany({
      where: buildTestimonialWhere(opts),
      orderBy: { [TESTIMONIAL_SORT_COLUMNS[opts.sortBy ?? ""] ?? "rating"]: opts.sortDir ?? "desc" },
      ...(opts.skip != null ? { skip: opts.skip } : {}),
      ...(opts.take != null ? { take: opts.take } : {}),
    }),

  count: (opts: TestimonialListOpts) =>
    prisma.testimonial.count({ where: buildTestimonialWhere(opts) }),

  findById: (id: number) => prisma.testimonial.findUnique({ where: { id } }),

  create: (input: TestimonialCreateInput) =>
    prisma.testimonial.create({ data: toPrismaTestimonialCreate(input) }),

  update: (id: number, input: TestimonialUpdateInput) =>
    prisma.testimonial.update({
      where: { id },
      data: toPrismaTestimonialUpdate(input),
    }),

  delete: (id: number) => prisma.testimonial.delete({ where: { id } }),
};
