import mongoose, { Schema, Document } from "mongoose";

export interface ILiveCourseCategory extends Document {
  title: string;
  slug: string;
  image: string;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const liveCourseCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    image: { type: String, required: true },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

liveCourseCategorySchema.index({ status: 1, order: 1 });

export const LiveCourseCategory = mongoose.model<ILiveCourseCategory>(
  "LiveCourseCategory",
  liveCourseCategorySchema,
  "ws_live_course_categories"
);
