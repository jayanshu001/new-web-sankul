import { Schema, model, Document, Types } from "mongoose";

export interface IPromoterAccessToken extends Document {
  promoterId: Types.ObjectId;
  token: string;
  refreshToken: string;
  active: boolean;
  deleted: boolean;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const PromoterAccessTokenSchema = new Schema<IPromoterAccessToken>(
  {
    promoterId: { type: Schema.Types.ObjectId, ref: "Promoter", required: true },
    token: { type: String, required: true },
    refreshToken: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    deleted: { type: Boolean, required: true, default: false },
    expiresAt: { type: Date, required: true },
  },
  { collection: "ws_promoter_access_tokens", timestamps: true }
);

PromoterAccessTokenSchema.index({ promoterId: 1 });
PromoterAccessTokenSchema.index({ token: 1 });
PromoterAccessTokenSchema.index({ refreshToken: 1 });

export const PromoterAccessToken = model<IPromoterAccessToken>(
  "PromoterAccessToken",
  PromoterAccessTokenSchema
);
