import { Schema, model, Document, Types } from "mongoose";

/**
 * Exam question — matches old ws_exam_question.
 * Options live in a separate collection (ExamQuestionOption).
 * `answer` is the text of the correct option; evaluation is a case-insensitive trim match
 * against the submitted option's name. The special option name "skip" marks a skipped answer.
 */
export interface IExamQuestion extends Document {
  examId: Types.ObjectId;
  title: string;
  answer: string;
  image?: string | null;
  solutionText?: string | null;
  solutionImage?: string | null;
  orderBy: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamQuestionSchema = new Schema<IExamQuestion>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    title: { type: String, required: true },
    answer: { type: String, required: true, maxlength: 1000 },
    image: { type: String, default: null, maxlength: 500 },
    solutionText: { type: String, default: null },
    solutionImage: { type: String, default: null, maxlength: 500 },
    orderBy: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_exam_question", timestamps: true }
);

ExamQuestionSchema.index({ examId: 1, status: 1, orderBy: 1 });

export const ExamQuestion = model<IExamQuestion>("ExamQuestion", ExamQuestionSchema);
