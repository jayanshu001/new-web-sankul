import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface IExamCategory extends Document {
  name: string;
  image?: string;
  parentId?: Types.ObjectId | null;
  ancestors: Types.ObjectId[];
  childCategoryIds: Types.ObjectId[];
  orderBy: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamCategorySchema = new Schema<IExamCategory>(
  {
    name: { type: String, required: true, maxlength: 255 },
    image: { type: String, maxlength: 500 },
    parentId: { type: Schema.Types.ObjectId, ref: "ExamCategory", default: null },
    ancestors: [{ type: Schema.Types.ObjectId, ref: "ExamCategory" }],
    childCategoryIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "ExamCategory" }],
      default: [],
      index: true,
    },
    orderBy: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_exam_categories", timestamps: true }
);

ExamCategorySchema.index({ parentId: 1, status: 1, orderBy: 1 });
ExamCategorySchema.index({ ancestors: 1 });

export const ExamCategory =
  (mongoose.models.ExamCategory as mongoose.Model<IExamCategory>) ||
  model<IExamCategory>("ExamCategory", ExamCategorySchema);
