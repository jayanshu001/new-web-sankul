import mongoose, { Schema, Document, Types } from "mongoose";

export interface IExamCountdown extends Document {
  title: string;
  categoryId: Types.ObjectId;
  // Optional goal tagging (mirrors Package): goalId → Goal, goalLabelId → a
  // label id inside that goal's labels[]. Used to prioritise the dashboard
  // exam-countdown section by the user's selected goal-labels.
  goalId?: Types.ObjectId | null;
  goalLabelId?: number | null;
  examDate: Date;
  description?: string;
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
    goalId: { type: Schema.Types.ObjectId, ref: "Goal", default: null },
    goalLabelId: { type: Number, default: null },
    examDate: { type: Date, required: true },
    description: { type: String, default: "" },
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
