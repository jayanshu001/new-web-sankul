import mongoose, { Schema, Document, Types } from "mongoose";

export interface IExamCountdown extends Document {
  title: string;
  categoryId: Types.ObjectId;
  examDate: Date;
  description?: string;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const examCountdownSchema = new Schema<IExamCountdown>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExamCountdownCategory",
      required: true,
    },
    examDate: { type: Date, required: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_exam_countdowns", timestamps: true }
);

examCountdownSchema.index({ examDate: 1, status: 1 });
examCountdownSchema.index({ categoryId: 1, examDate: 1 });
examCountdownSchema.index({ title: "text" });

export const ExamCountdown = mongoose.model<IExamCountdown>(
  "ExamCountdown",
  examCountdownSchema
);
