import mongoose, { Schema, Document } from "mongoose";

export interface IExamCategory extends Document {
  title: string;
  image?: string;
  parent: mongoose.Types.ObjectId | null;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const examCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    image: { type: String, default: null },
    parent: { type: Schema.Types.ObjectId, ref: "ExamCategory", default: null },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

examCategorySchema.index({ parent: 1, status: 1, order: 1 });

export const ExamCategory = mongoose.model<IExamCategory>(
  "ExamCategory",
  examCategorySchema,
  "ws_exam_categories"
);
