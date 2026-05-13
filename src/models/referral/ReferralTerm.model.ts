import { Schema, model, Document } from "mongoose";

export interface IReferralTerm extends Document {
  text: string;
  order: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ReferralTermSchema = new Schema<IReferralTerm>(
  {
    text: { type: String, required: true, maxlength: 1000 },
    order: { type: Number, required: true, default: 0 },
    status: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_referral_terms", timestamps: true }
);

ReferralTermSchema.index({ status: 1, order: 1 });

export const ReferralTerm = model<IReferralTerm>("ReferralTerm", ReferralTermSchema);
