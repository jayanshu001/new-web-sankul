import mongoose, { Schema, Document } from "mongoose";

export interface IEbookPrice extends Document {
  ebookId: mongoose.Types.ObjectId;
  name?: string;
  duration: number;
  price: number;
  withMaterial: boolean;
  materialPrice: number;
  isDefault: boolean;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ebookPriceSchema: Schema = new Schema(
  {
    ebookId: { type: Schema.Types.ObjectId, ref: "Ebook", required: true },
    name: { type: String, default: null },
    duration: { type: Number, required: true },
    price: { type: Number, required: true },
    withMaterial: { type: Boolean, default: false },
    materialPrice: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ebookPriceSchema.index({ ebookId: 1, status: 1 });

export const EbookPrice = mongoose.model<IEbookPrice>("EbookPrice", ebookPriceSchema, "ws_ebook_prices");
