import { Schema, model, Document, Types } from "mongoose";
import { RefferalTransactionType, RefferalTransactionStatus } from "../enums";

export interface IReferralTransaction extends Document {
  orderId?: Types.ObjectId;
  customerId: Types.ObjectId;
  bankAccount?: Record<string, any>;
  description: string;
  coin: number;
  type: RefferalTransactionType;
  status: RefferalTransactionStatus;
  utr?: string;
  failureReason?: string;
  providerRef?: string;
  providerPayload?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

const ReferralTransactionSchema = new Schema<IReferralTransaction>(
  {
    orderId: { type: Schema.Types.ObjectId },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    bankAccount: { type: Schema.Types.Mixed },
    description: { type: String, required: true, maxlength: 150 },
    coin: { type: Number, required: true },
    type: {
      type: String,
      enum: Object.values(RefferalTransactionType),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(RefferalTransactionStatus),
      required: true,
      default: RefferalTransactionStatus.SUCCESSFUL,
    },
    utr: { type: String },
    failureReason: { type: String },
    providerRef: { type: String, index: true },
    providerPayload: { type: Schema.Types.Mixed },
  },
  { collection: "ws_referral_transactions", timestamps: true }
);

ReferralTransactionSchema.index({ customerId: 1, createdAt: -1 });
ReferralTransactionSchema.index({ type: 1, status: 1, createdAt: -1 });

export const ReferralTransaction = model<IReferralTransaction>(
  "ReferralTransaction",
  ReferralTransactionSchema
);
