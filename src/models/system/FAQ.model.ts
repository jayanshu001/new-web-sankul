import { Schema, model, Document, Types } from "mongoose";

export interface IFAQ extends Document {
  typeId: Types.ObjectId;
  question: string;
  answer: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const FAQSchema = new Schema<IFAQ>(
  {
    typeId: { type: Schema.Types.ObjectId, ref: "FaqType", required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
  },
  { collection: "ws_faqs", timestamps: true }
);

FAQSchema.index({ typeId: 1 });

export const FAQ = model<IFAQ>("FAQ", FAQSchema);
