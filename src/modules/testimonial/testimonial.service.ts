import mongoose from "mongoose";
import { Testimonial } from "../../models/system/Testimonial.model";
import { isMysqlModule } from "../../config/migration";
import { testimonialRepository } from "./testimonial.repository";
import { toTestimonialDto } from "./testimonial.transformer";
import type {
  TestimonialCreateInput,
  TestimonialDto,
  TestimonialUpdateInput,
} from "./testimonial.types";

const MODULE = "testimonial";

export const parseTestimonialId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const fromMongoDoc = (d: {
  _id: unknown;
  name: string;
  title: string;
  description: string;
  rating: number;
}): TestimonialDto => ({
  _id: String(d._id),
  name: d.name,
  title: d.title,
  description: d.description,
  rating: d.rating,
});

export const listTestimonials = async (): Promise<TestimonialDto[]> => {
  if (isMysqlModule(MODULE)) {
    const rows = await testimonialRepository.findMany();
    return rows.map(toTestimonialDto);
  }

  const docs = await Testimonial.find().sort({ rating: -1 }).lean();
  return docs.map((d) => fromMongoDoc(d as never));
};

export const getTestimonialById = async (
  id: string
): Promise<TestimonialDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseTestimonialId(id);
    if (!numId) return null;
    const row = await testimonialRepository.findById(numId);
    return row ? toTestimonialDto(row) : null;
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Testimonial.findById(id).lean();
  return doc ? fromMongoDoc(doc as never) : null;
};

export const createTestimonial = async (
  input: TestimonialCreateInput
): Promise<TestimonialDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await testimonialRepository.create(input);
    return toTestimonialDto(row);
  }

  const doc = await Testimonial.create(input);
  return fromMongoDoc(doc as never);
};

export const updateTestimonial = async (
  id: string,
  input: TestimonialUpdateInput
): Promise<TestimonialDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseTestimonialId(id);
    if (!numId) return null;
    try {
      const row = await testimonialRepository.update(numId, input);
      return toTestimonialDto(row);
    } catch {
      return null;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await Testimonial.findByIdAndUpdate(
    id,
    { $set: input },
    { new: true }
  ).lean();
  return doc ? fromMongoDoc(doc as never) : null;
};

export const deleteTestimonial = async (id: string): Promise<boolean> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseTestimonialId(id);
    if (!numId) return false;
    try {
      await testimonialRepository.delete(numId);
      return true;
    } catch {
      return false;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await Testimonial.findByIdAndDelete(id);
  return !!doc;
};
