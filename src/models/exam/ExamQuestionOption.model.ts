import { Schema, model, Document, Types } from "mongoose";

/**
 * Separate options collection — matches old ws_exam_question_option table.
 * Correctness is determined by matching option.name to ExamQuestion.answer (text).
 * A special option with name "skip" is treated as a skipped answer.
 */
export interface IExamQuestionOption extends Document {
  name: string;
  questionId: Types.ObjectId;
  image?: string | null;
  orderBy: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamQuestionOptionSchema = new Schema<IExamQuestionOption>(
  {
    name: { type: String, required: true, maxlength: 1000 },
    questionId: { type: Schema.Types.ObjectId, ref: "ExamQuestion", required: true },
    image: { type: String, default: null, maxlength: 500 },
    orderBy: { type: Number, default: 0 },
  },
  { collection: "ws_exam_question_option", timestamps: true }
);

ExamQuestionOptionSchema.index({ questionId: 1, orderBy: 1 });

export const ExamQuestionOption = model<IExamQuestionOption>(
  "ExamQuestionOption",
  ExamQuestionOptionSchema
);
