import { Schema, model, Document, Types } from "mongoose";
import { ExamResultType } from "../enums";

/**
 * One row per (customerId, examId, questionId) — matches old ws_exam_result_detail.
 * Upserted on submit.
 */
export interface IExamResultDetail extends Document {
  examResultId: Types.ObjectId;
  customerId: Types.ObjectId;
  examId: Types.ObjectId;
  questionId: Types.ObjectId;
  answerId?: Types.ObjectId | null;
  result: ExamResultType;
  point: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamResultDetailSchema = new Schema<IExamResultDetail>(
  {
    examResultId: { type: Schema.Types.ObjectId, ref: "ExamResult", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    questionId: { type: Schema.Types.ObjectId, ref: "ExamQuestion", required: true },
    answerId: { type: Schema.Types.ObjectId, ref: "ExamQuestionOption", default: null },
    result: {
      type: String,
      enum: Object.values(ExamResultType),
      required: true,
      default: ExamResultType.SKIP,
    },
    point: { type: Number, required: true, default: 0 },
  },
  { collection: "ws_exam_result_detail", timestamps: true }
);

ExamResultDetailSchema.index(
  { examResultId: 1, questionId: 1 },
  { unique: true }
);
ExamResultDetailSchema.index({ customerId: 1, examId: 1 });
ExamResultDetailSchema.index({ examId: 1 });

export const ExamResultDetail = model<IExamResultDetail>(
  "ExamResultDetail",
  ExamResultDetailSchema
);
