import { Schema, model, Document } from "mongoose";

export interface IPromoter extends Document {
  fullName: string;
  email: string;
  phone: string;
  image?: string | null;
  password?: string;
  status: boolean;
  isDelete: boolean;
  lastLoginDate?: Date | null;
  lastLoginIp?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const PromoterSchema = new Schema<IPromoter>(
  {
    fullName: { type: String, required: true, maxlength: 255 },
    email: { type: String, required: true, unique: true, maxlength: 255 },
    phone: { type: String, required: true, maxlength: 20 },
    image: { type: String, default: null, maxlength: 500 },
    password: { type: String, maxlength: 255, select: false },
    status: { type: Boolean, default: true },
    isDelete: { type: Boolean, default: false },
    lastLoginDate: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, maxlength: 100 },
  },
  { collection: "ws_promoter", timestamps: true }
);

PromoterSchema.index({ status: 1, isDelete: 1 });

export const Promoter = model<IPromoter>("Promoter", PromoterSchema);
