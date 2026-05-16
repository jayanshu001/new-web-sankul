import { Schema, model, Document, Types } from "mongoose";

/**
 * Many-to-many link between a TestSeries (+ content category) and an Exam.
 * One row per paper inside a series. Per-link orderBy controls display order
 * inside the content category. Same Exam can appear in multiple series.
 */
export interface ITestSeriesExam extends Document {
  testSeriesId: Types.ObjectId;
  contentCategoryId: Types.ObjectId;
  examId: Types.ObjectId;
  orderBy: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const TestSeriesExamSchema = new Schema<ITestSeriesExam>(
  {
    testSeriesId: { type: Schema.Types.ObjectId, ref: "TestSeries", required: true },
    contentCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "TestSeriesContentCategory",
      required: true,
    },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    orderBy: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_test_series_exam", timestamps: true }
);

TestSeriesExamSchema.index(
  { testSeriesId: 1, examId: 1 },
  { unique: true }
);
TestSeriesExamSchema.index({ testSeriesId: 1, contentCategoryId: 1, orderBy: 1 });
TestSeriesExamSchema.index({ examId: 1 });

export const TestSeriesExam = model<ITestSeriesExam>(
  "TestSeriesExam",
  TestSeriesExamSchema
);
