import { Schema, model, Document, Types } from "mongoose";
import { ExamAttemptStatus, ExamResultType } from "../enums";

export interface IExamAttemptAnswer {
  questionId: Types.ObjectId;
  selectedOptionIds: Types.ObjectId[];
  result: ExamResultType;
  points: number;
  answeredAt?: Date;
}

export interface IExamAttempt extends Document {
  customerId: Types.ObjectId;
  examId: Types.ObjectId;
  attemptNumber: number;
  status: ExamAttemptStatus;
  startedAt: Date;
  submittedAt?: Date;
  deadlineAt: Date;
  answers: IExamAttemptAnswer[];
  totalQuestions: number;
  attempted: number;
  skipped: number;
  correct: number;
  wrong: number;
  score: number;
  accuracy: number;
  elapsedSeconds?: number;
  rank?: number;
  totalCandidates?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const ExamAttemptAnswerSchema = new Schema<IExamAttemptAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: "ExamQuestion", required: true },
    selectedOptionIds: [{ type: Schema.Types.ObjectId }],
    result: {
      type: String,
      enum: Object.values(ExamResultType),
      default: ExamResultType.SKIP,
    },
    points: { type: Number, default: 0 },
    answeredAt: { type: Date },
  },
  { _id: false }
);

const ExamAttemptSchema = new Schema<IExamAttempt>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    attemptNumber: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      enum: Object.values(ExamAttemptStatus),
      default: ExamAttemptStatus.IN_PROGRESS,
      required: true,
    },
    startedAt: { type: Date, required: true, default: Date.now },
    submittedAt: { type: Date },
    deadlineAt: { type: Date, required: true },
    answers: { type: [ExamAttemptAnswerSchema], default: [] },
    totalQuestions: { type: Number, required: true, default: 0 },
    attempted: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    elapsedSeconds: { type: Number, default: 0 },
    rank: { type: Number },
    totalCandidates: { type: Number },
  },
  { collection: "ws_exam_attempts", timestamps: true }
);

ExamAttemptSchema.index({ customerId: 1, examId: 1, attemptNumber: -1 });
ExamAttemptSchema.index({ examId: 1, score: -1 });
ExamAttemptSchema.index({ customerId: 1, status: 1 });
ExamAttemptSchema.index({ customerId: 1, submittedAt: -1 });

export const ExamAttempt = model<IExamAttempt>("ExamAttempt", ExamAttemptSchema);
