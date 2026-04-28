import { Schema, model, Document } from "mongoose";

export interface IFaqType extends Document {
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const FaqTypeSchema = new Schema<IFaqType>(
  {
    title: { type: String, required: true, maxlength: 255 },
  },
  { collection: "ws_faq_types", timestamps: true }
);

export const FaqType = model<IFaqType>("FaqType", FaqTypeSchema);
