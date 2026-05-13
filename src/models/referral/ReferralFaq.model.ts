import { Schema, model, Document } from "mongoose";

export interface IReferralFaq extends Document {
  question: string;
  answer: string;
  order: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ReferralFaqSchema = new Schema<IReferralFaq>(
  {
    question: { type: String, required: true, maxlength: 500 },
    answer: { type: String, required: true, maxlength: 5000 },
    order: { type: Number, required: true, default: 0 },
    status: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_referral_faqs", timestamps: true }
);

ReferralFaqSchema.index({ status: 1, order: 1 });

export const ReferralFaq = model<IReferralFaq>("ReferralFaq", ReferralFaqSchema);
