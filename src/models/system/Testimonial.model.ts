import { Schema, model, Document } from "mongoose";

export interface ITestimonial extends Document {
  name: string;
  title: string;
  description: string;
  rating: number;
}

const TestimonialSchema = new Schema<ITestimonial>(
  {
    name: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
  },
  { collection: "ws_testimonials", timestamps: false }
);

export const Testimonial = model<ITestimonial>("Testimonial", TestimonialSchema);
