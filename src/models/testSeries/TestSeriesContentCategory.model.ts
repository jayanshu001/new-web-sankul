import { Schema, model, Document, Types } from "mongoose";

/**
 * Series-scoped content category — the rows shown under the "Test Content" tab
 * (e.g. "GPSC Mains Lecture PDF"). Flat list per series. Distinct from the
 * global ExamCategory tree.
 */
export interface ITestSeriesContentCategory extends Document {
  testSeriesId: Types.ObjectId;
  name: string;
  icon?: string;
  orderBy: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const TestSeriesContentCategorySchema = new Schema<ITestSeriesContentCategory>(
  {
    testSeriesId: { type: Schema.Types.ObjectId, ref: "TestSeries", required: true },
    name: { type: String, required: true, maxlength: 255 },
    icon: { type: String, maxlength: 500 },
    orderBy: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_test_series_content_category", timestamps: true }
);

TestSeriesContentCategorySchema.index({ testSeriesId: 1, status: 1, orderBy: 1 });

export const TestSeriesContentCategory = model<ITestSeriesContentCategory>(
  "TestSeriesContentCategory",
  TestSeriesContentCategorySchema
);
