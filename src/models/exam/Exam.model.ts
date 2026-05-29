import { Schema, model, Document, Types } from "mongoose";
import { ExamType, ExamStatus, ExamDifficulty, ExamLanguage } from "../enums";

export interface IExam extends Document {
  title: string;
  description?: string;
  type: ExamType;
  categoryId?: Types.ObjectId | null;
  isPaid: boolean;
  durationMinutes: number;
  questionCount: number;
  positiveMarks: number;
  negativeMarks: number;
  passingMarks?: number;
  solutionPdfUrl?: string;
  instructions?: string;
  policy?: string;
  startAt?: Date;
  endAt?: Date;
  status: ExamStatus;
  orderBy: number;
  language: ExamLanguage;
  difficulty?: ExamDifficulty;
  sendPush: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamSchema = new Schema<IExam>(
  {
    title: { type: String, required: true, maxlength: 255 },
    description: { type: String },
    type: {
      type: String,
      enum: Object.values(ExamType),
      required: true,
      default: ExamType.SUBJECT,
    },
    categoryId: { type: Schema.Types.ObjectId, ref: "ExamCategory", default: null },
    isPaid: { type: Boolean, default: false },
    durationMinutes: { type: Number, required: true, min: 1 },
    questionCount: { type: Number, default: 0, min: 0 },
    positiveMarks: { type: Number, required: true, default: 1 },
    negativeMarks: { type: Number, required: true, default: 0 },
    passingMarks: { type: Number, default: 0 },
    solutionPdfUrl: { type: String, maxlength: 500 },
    instructions: { type: String },
    policy: { type: String },
    startAt: { type: Date },
    endAt: { type: Date },
    status: {
      type: String,
      enum: Object.values(ExamStatus),
      required: true,
      default: ExamStatus.DRAFT,
    },
    orderBy: { type: Number, default: 0 },
    language: {
      type: String,
      enum: Object.values(ExamLanguage),
      default: ExamLanguage.GUJARATI,
    },
    difficulty: { type: String, enum: Object.values(ExamDifficulty) },
    sendPush: { type: Boolean, default: false },
  },
  { collection: "ws_exam", timestamps: true }
);

ExamSchema.index({ categoryId: 1, status: 1, orderBy: 1 });
ExamSchema.index({ type: 1, status: 1, startAt: 1 });

export const Exam = model<IExam>("Exam", ExamSchema);
