import { Schema, model, Document, Types } from "mongoose";
import { InquiryCourse, InquiryMode } from "../enums";

export interface IInquiry extends Document {
  customerId?: Types.ObjectId;
  description: string;
  // Legacy fields (kept optional for older rows / website form)
  name?: string;
  mobile?: string;
  email?: string;
  city?: string;
  course?: InquiryCourse;
  mode?: InquiryMode;
  message?: string;
  source?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const InquirySchema = new Schema<IInquiry>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    description: { type: String, required: true, maxlength: 2000 },
    name: { type: String, maxlength: 255 },
    mobile: { type: String, maxlength: 20 },
    email: { type: String, maxlength: 255 },
    city: { type: String, maxlength: 100 },
    course: { type: String, enum: Object.values(InquiryCourse) },
    mode: { type: String, enum: Object.values(InquiryMode) },
    message: { type: String, default: null },
    source: { type: String, maxlength: 50, default: "app" },
  },
  { collection: "ws_website_inquiry", timestamps: true }
);

InquirySchema.index({ createdAt: -1 });
InquirySchema.index({ customerId: 1 });
InquirySchema.index({ mobile: 1 });

export const Inquiry = model<IInquiry>("Inquiry", InquirySchema);
