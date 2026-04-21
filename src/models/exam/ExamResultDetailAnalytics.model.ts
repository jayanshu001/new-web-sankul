import { Schema, model, Document, Types } from "mongoose";

/**
 * One row per customer — lifetime aggregates across all exams.
 * Matches old ws_exam_result_detail_analytics.
 * Recomputed on each submit.
 */
export interface IExamResultDetailAnalytics extends Document {
  customerId: Types.ObjectId;
  exams: number;
  questions: number;
  attempt: number;
  skip: number;
  success: number;
  failed: number;
  score: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamResultDetailAnalyticsSchema = new Schema<IExamResultDetailAnalytics>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, unique: true },
    exams: { type: Number, default: 0 },
    questions: { type: Number, default: 0 },
    attempt: { type: Number, default: 0 },
    skip: { type: Number, default: 0 },
    success: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
  },
  { collection: "ws_exam_result_detail_analytics", timestamps: true }
);

export const ExamResultDetailAnalytics = model<IExamResultDetailAnalytics>(
  "ExamResultDetailAnalytics",
  ExamResultDetailAnalyticsSchema
);
