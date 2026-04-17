import mongoose, { Schema, Document } from "mongoose";

export interface ICourseSubjectCategory extends Document {
  title: string;
  slug: string;
  image: string;
  parent: mongoose.Types.ObjectId | number; // Support both for flexibility transitioning from SQL
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const courseSubjectCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    image: { type: String, required: true },
    parent: { type: Schema.Types.Mixed, default: 0 }, // 0 for root as per staging
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const CourseSubjectCategory = mongoose.model<ICourseSubjectCategory>("CourseSubjectCategory", courseSubjectCategorySchema, "ws_course_subject_categories");
