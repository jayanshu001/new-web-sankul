import { Schema, model, Document, Types } from "mongoose";

/**
 * One row per (customerId, examId) — matches old ws_exam_result.
 * Retake overwrites the existing row (no attempt history).
 */
export interface IExamResult extends Document {
  customerId: Types.ObjectId;
  examId: Types.ObjectId;
  total: number;
  attempt: number;
  skip: number;
  success: number;
  failed: number;
  score: number;
  timing: string;
  ratting?: string | null;
  solution?: string | null;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamResultSchema = new Schema<IExamResult>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    total: { type: Number, required: true, default: 0 },
    attempt: { type: Number, required: true, default: 0 },
    skip: { type: Number, required: true, default: 0 },
    success: { type: Number, required: true, default: 0 },
    failed: { type: Number, required: true, default: 0 },
    score: { type: Number, required: true, default: 0 },
    timing: { type: String, required: true, default: "00:00" },
    ratting: { type: String, default: null },
    solution: { type: String, default: null },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_exam_result", timestamps: true }
);

ExamResultSchema.index({ customerId: 1, examId: 1 }, { unique: true });
ExamResultSchema.index({ examId: 1 });
ExamResultSchema.index({ examId: 1, score: -1 });

export const ExamResult = model<IExamResult>("ExamResult", ExamResultSchema);
