import { Schema, model, Document } from "mongoose";

export interface IBookSetting extends Document {
  key: string;
  freeShippingMinOrderAmount: number;
  supportPhone?: string;
  termsAndConditions?: string[];
  gstRate: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const BookSettingSchema = new Schema<IBookSetting>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    freeShippingMinOrderAmount: { type: Number, required: true, default: 0, min: 0 },
    supportPhone: { type: String, maxlength: 20 },
    termsAndConditions: { type: [String], default: [] },
    gstRate: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: "ws_book_settings", timestamps: true }
);

export const BookSetting = model<IBookSetting>("BookSetting", BookSettingSchema);
