import { Schema, model, Document, Types } from "mongoose";

export interface ICustomerOtp extends Document {
  customerId: Types.ObjectId;
  otp: string;
  createdAt: Date;
}

const CustomerOtpSchema = new Schema<ICustomerOtp>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    otp: { type: String, required: true, maxlength: 6 },
  },
  { collection: "ws_customer_otps", timestamps: { createdAt: true, updatedAt: false } }
);

CustomerOtpSchema.index({ customerId: 1 });

export const CustomerOtp = model<ICustomerOtp>("CustomerOtp", CustomerOtpSchema);
