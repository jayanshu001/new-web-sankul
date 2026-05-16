import { Schema, model, Document, Types } from "mongoose";
import { ExamLanguage } from "../enums";

/**
 * Top-level Test Series product (e.g. "Online Mock test 2025").
 * Bundles many Exam papers grouped by series-scoped content categories
 * (TestSeriesContentCategory). Sold via TestSeriesPrice plans.
 */
export interface ITestSeries extends Document {
  title: string;
  description?: string;
  thumbnail?: string;
  examCategoryId?: Types.ObjectId | null;
  language: ExamLanguage;
  paperCount: number;
  isFree: boolean;
  instructions?: string;
  policy?: string;
  orderBy: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const TestSeriesSchema = new Schema<ITestSeries>(
  {
    title: { type: String, required: true, maxlength: 255 },
    description: { type: String },
    thumbnail: { type: String, maxlength: 500 },
    examCategoryId: { type: Schema.Types.ObjectId, ref: "ExamCategory", default: null },
    language: {
      type: String,
      enum: Object.values(ExamLanguage),
      default: ExamLanguage.GUJARATI,
    },
    paperCount: { type: Number, default: 0, min: 0 },
    isFree: { type: Boolean, default: false },
    instructions: { type: String },
    policy: { type: String },
    orderBy: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_test_series", timestamps: true }
);

TestSeriesSchema.index({ status: 1, orderBy: 1 });
TestSeriesSchema.index({ examCategoryId: 1, status: 1 });

export const TestSeries = model<ITestSeries>("TestSeries", TestSeriesSchema);
