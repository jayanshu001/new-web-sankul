import { Schema, model, Document, Types } from "mongoose";
import { ExamQuestionType } from "../enums";

export interface IExamQuestionOption {
  _id?: Types.ObjectId;
  text: string;
  image?: string;
  isCorrect: boolean;
}

export interface IExamQuestion extends Document {
  examId: Types.ObjectId;
  title: string;
  image?: string;
  solutionText?: string;
  solutionImage?: string;
  type: ExamQuestionType;
  options: IExamQuestionOption[];
  positiveMarksOverride?: number | null;
  negativeMarksOverride?: number | null;
  orderBy: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamQuestionOptionSchema = new Schema<IExamQuestionOption>(
  {
    text: { type: String, required: true, maxlength: 1000 },
    image: { type: String, maxlength: 500 },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true }
);

const ExamQuestionSchema = new Schema<IExamQuestion>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    title: { type: String, required: true },
    image: { type: String, maxlength: 500 },
    solutionText: { type: String },
    solutionImage: { type: String, maxlength: 500 },
    type: {
      type: String,
      enum: Object.values(ExamQuestionType),
      default: ExamQuestionType.SINGLE,
    },
    options: {
      type: [ExamQuestionOptionSchema],
      validate: {
        validator: (v: IExamQuestionOption[]) => Array.isArray(v) && v.length >= 2,
        message: "A question must have at least 2 options.",
      },
    },
    positiveMarksOverride: { type: Number, default: null },
    negativeMarksOverride: { type: Number, default: null },
    orderBy: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_exam_questions", timestamps: true }
);

ExamQuestionSchema.index({ examId: 1, status: 1, orderBy: 1 });

export const ExamQuestion = model<IExamQuestion>("ExamQuestion", ExamQuestionSchema);
