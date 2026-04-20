import { Schema, model, Document } from "mongoose";

export interface IReferralProgram extends Document {
  name: string;
  title: string;
  image?: string;
  referralDiscount: number;
  referralReward: number;
  minimumPrice: number;
  initialRewardAmount?: number;
  video?: string;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ReferralProgramSchema = new Schema<IReferralProgram>(
  {
    name: { type: String, required: true, unique: true, maxlength: 50 },
    title: { type: String, required: true, maxlength: 255 },
    image: { type: String, maxlength: 255 },
    referralDiscount: { type: Number, required: true, default: 0 },
    referralReward: { type: Number, required: true, default: 0 },
    minimumPrice: { type: Number, required: true, default: 0 },
    initialRewardAmount: { type: Number, default: 0 },
    video: { type: String, maxlength: 255 },
    status: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_referral_programs", timestamps: true }
);

export const ReferralProgram = model<IReferralProgram>("ReferralProgram", ReferralProgramSchema);
