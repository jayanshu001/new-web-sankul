import { prisma } from "../../config/prisma";
import type {
  TestimonialCreateInput,
  TestimonialUpdateInput,
} from "./testimonial.types";
import {
  toPrismaTestimonialCreate,
  toPrismaTestimonialUpdate,
} from "./testimonial.transformer";

export const testimonialRepository = {
  /** Client + admin list. Legacy API sorts by rating desc. */
  findMany: () =>
    prisma.testimonial.findMany({ orderBy: { rating: "desc" } }),

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
