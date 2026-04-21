import { Schema, model, Document } from "mongoose";
import { InquiryCourse, InquiryMode } from "../enums";

export interface IInquiry extends Document {
  name: string;
  mobile: string;
  email: string;
  city: string;
  course: InquiryCourse;
  mode: InquiryMode;
  message?: string;
  source?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const InquirySchema = new Schema<IInquiry>(
  {
    name: { type: String, required: true, maxlength: 255 },
    mobile: { type: String, required: true, maxlength: 20 },
    email: { type: String, required: true, maxlength: 255 },
    city: { type: String, required: true, maxlength: 100 },
    course: { type: String, enum: Object.values(InquiryCourse), required: true },
    mode: { type: String, enum: Object.values(InquiryMode), required: true },
    message: { type: String, default: null },
    source: { type: String, maxlength: 50, default: "website" },
  },
  { collection: "ws_website_inquiry", timestamps: true }
);

InquirySchema.index({ createdAt: -1 });
InquirySchema.index({ mobile: 1 });

export const Inquiry = model<IInquiry>("Inquiry", InquirySchema);
