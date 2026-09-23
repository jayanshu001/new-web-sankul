import type { Testimonial } from "@prisma/client";
import type {
  TestimonialCreateInput,
  TestimonialDto,
  TestimonialUpdateInput,
} from "./testimonial.types";

/** MySQL row → API DTO. Bridges the legacy `discription` typo → `description`. */
export const toTestimonialDto = (row: Testimonial): TestimonialDto => ({
  _id: String(row.id),
  name: row.name,
  title: row.title,
  description: row.discription,
  rating: row.rating,
});

export const toPrismaTestimonialCreate = (input: TestimonialCreateInput) => ({
  name: input.name,
  title: input.title,
  discription: input.description,
  rating: input.rating,
});

export const toPrismaTestimonialUpdate = (input: TestimonialUpdateInput) => ({
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.title !== undefined ? { title: input.title } : {}),
  ...(input.description !== undefined ? { discription: input.description } : {}),
  ...(input.rating !== undefined ? { rating: input.rating } : {}),
});
