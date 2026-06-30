import { testimonialRepository } from "./testimonial.repository";
import { toTestimonialDto } from "./testimonial.transformer";
import type {
  TestimonialCreateInput,
  TestimonialDto,
  TestimonialUpdateInput,
} from "./testimonial.types";

export const parseTestimonialId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const listTestimonials = async (): Promise<TestimonialDto[]> => {
  const rows = await testimonialRepository.findMany();
  return rows.map(toTestimonialDto);
};

/**
 * Admin server-side search + sort + opt-in pagination. `skip`/`take` apply only
 * when provided (absent → full filtered list). Always returns the total count.
 */
export const listTestimonialsPaged = async (q: {
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
}): Promise<{ items: TestimonialDto[]; total: number }> => {
  const opts = { search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take };
  const [rows, total] = await Promise.all([
    testimonialRepository.findPage(opts),
    testimonialRepository.count(opts),
  ]);
  return { items: rows.map(toTestimonialDto), total };
};

export const getTestimonialById = async (
  id: string
): Promise<TestimonialDto | null> => {
  const numId = parseTestimonialId(id);
  if (!numId) return null;
  const row = await testimonialRepository.findById(numId);
  return row ? toTestimonialDto(row) : null;
};

export const createTestimonial = async (
  input: TestimonialCreateInput
): Promise<TestimonialDto> => {
  const row = await testimonialRepository.create(input);
  return toTestimonialDto(row);
};

export const updateTestimonial = async (
  id: string,
  input: TestimonialUpdateInput
): Promise<TestimonialDto | null> => {
  const numId = parseTestimonialId(id);
  if (!numId) return null;
  try {
    const row = await testimonialRepository.update(numId, input);
    return toTestimonialDto(row);
  } catch {
    return null;
  }
};

export const deleteTestimonial = async (id: string): Promise<boolean> => {
  const numId = parseTestimonialId(id);
  if (!numId) return false;
  try {
    await testimonialRepository.delete(numId);
    return true;
  } catch {
    return false;
  }
};
