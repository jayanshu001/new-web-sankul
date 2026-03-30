import { Schema, model, Document } from "mongoose";

export interface IFAQ extends Document {
  type: string;
  question: string;
  answer: string;
  isExpand: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const FAQSchema = new Schema<IFAQ>(
  {
    type: { type: String, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    isExpand: { type: Boolean, required: true, default: false },
  },
  { collection: "ws_faqs", timestamps: true }
);

export const FAQ = model<IFAQ>("FAQ", FAQSchema);
