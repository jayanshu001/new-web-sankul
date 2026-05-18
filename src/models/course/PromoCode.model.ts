import mongoose, { Schema, Document } from "mongoose";
import { PromocodeType } from "../enums";

export type PromoDiscountType = "flat" | "percentage";
export type PromoAppliesToType = "package" | "course" | "liveCourse";

export interface IPromoCode extends Document {
  type: PromocodeType;
  promocode: string;
  title: string;
  description: string;
  promo_start_at: Date;
  promo_expire_at: Date;
  status: boolean;
  discountType: PromoDiscountType;
  discountValue: number;
  promoterId?: mongoose.Types.ObjectId | null;
  appliesTo?: {
    type: PromoAppliesToType;
    ids: mongoose.Types.ObjectId[];
  } | null;
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
    discountType: { type: String, enum: ["flat", "percentage"], required: true, default: "percentage" },
    discountValue: { type: Number, required: true, default: 0, min: 0 },
    promoterId: { type: Schema.Types.ObjectId, ref: "Promoter", default: null },
    // Plain nested object. We deliberately avoid the `{ type: {...} }` wrapper
    // here because Mongoose would interpret the inner `type` field as a
    // SchemaType descriptor and choke on `default: null`. Optional by design —
    // older rows pre-migration may not have it yet.
    appliesTo: {
      type: { type: String, enum: ["package", "course", "liveCourse"] },
      ids: { type: [Schema.Types.ObjectId], default: [] },
    },
  },
  { timestamps: true }
);

promoCodeSchema.index({ promoterId: 1 });

promoCodeSchema.index({ type: 1, status: 1 });
promoCodeSchema.index({ promocode: 1 });
promoCodeSchema.index({ "appliesTo.type": 1, "appliesTo.ids": 1, status: 1 });

export const PromoCode = mongoose.model<IPromoCode>(
  "PromoCode",
  promoCodeSchema,
  "ws_promo_codes"
);
