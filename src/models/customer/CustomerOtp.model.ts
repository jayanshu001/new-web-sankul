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

// TTL index — auto-delete rows 10 minutes after createdAt. The OTP service
// itself uses a 5-minute validity window (OTP_TTL_MINUTES in
// client/auth/auth.service.ts); the extra 5 minutes is a safety buffer so
// the row outlives the OTP for audit purposes but never accumulates as
// dead rows. Mongo's TTL monitor runs once per minute, so actual deletion
// lags the timestamp by up to ~60s — fine for this use case.
CustomerOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

export const CustomerOtp = model<ICustomerOtp>("CustomerOtp", CustomerOtpSchema);
