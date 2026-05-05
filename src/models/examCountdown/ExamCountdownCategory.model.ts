import mongoose, { Schema, Document } from "mongoose";

export interface IExamCountdownCategory extends Document {
  name: string;
  colorHex: string;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const examCountdownCategorySchema = new Schema<IExamCountdownCategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    colorHex: {
      type: String,
      required: true,
      match: [/^#[0-9A-Fa-f]{6}$/, "colorHex must be a 7-char hex like #7C3AED"],
    },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_exam_countdown_categories", timestamps: true }
);

examCountdownCategorySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);
examCountdownCategorySchema.index({ status: 1, order: 1 });

export const ExamCountdownCategory = mongoose.model<IExamCountdownCategory>(
  "ExamCountdownCategory",
  examCountdownCategorySchema
);
