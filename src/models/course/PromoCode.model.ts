import mongoose, { Schema, Document } from "mongoose";
import { PromocodeType } from "../enums";

export interface IPromoCode extends Document {
  type: PromocodeType;
  promocode: string;
  title: string;
  description: string;
  promo_start_at: Date;
  promo_expire_at: Date;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const promoCodeSchema: Schema = new Schema(
  {
    type: { type: String, enum: ["public", "private"], required: true },
    promocode: { type: String, required: true },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    promo_start_at: { type: Date, required: true },
    promo_expire_at: { type: Date, required: true },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

promoCodeSchema.index({ type: 1, status: 1 });
promoCodeSchema.index({ promocode: 1 });

export const PromoCode = mongoose.model<IPromoCode>(
  "PromoCode",
  promoCodeSchema,
  "ws_promo_codes"
);
