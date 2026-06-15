import { Schema, model, Document, Types } from "mongoose";

// Qualification values surfaced in the "Register" form dropdown. When the user
// picks "other", the free-text they type lands in `otherQualification`.
export const OFFLINE_BATCH_QUALIFICATIONS = [
  "post_graduate",
  "graduate",
  "10_plus_2",
  "other",
] as const;
export type OfflineBatchQualification = (typeof OFFLINE_BATCH_QUALIFICATIONS)[number];

export interface IOfflineBatchEnquiry extends Document {
  customerId?: Types.ObjectId | null;
  name: string;
  email: string;
  mobile: string;
  qualification: OfflineBatchQualification;
  otherQualification?: string | null;
  batchId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const OfflineBatchEnquirySchema = new Schema<IOfflineBatchEnquiry>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    name: { type: String, required: true, maxlength: 255 },
    email: { type: String, required: true, maxlength: 255 },
    mobile: { type: String, required: true, maxlength: 20 },
    qualification: { type: String, enum: OFFLINE_BATCH_QUALIFICATIONS, required: true },
    otherQualification: { type: String, maxlength: 255, default: null },
    batchId: { type: Schema.Types.ObjectId, ref: "OfflineBatch", required: true },
  },
  { collection: "ws_offline_batch_enquiry", timestamps: true }
);

OfflineBatchEnquirySchema.index({ batchId: 1, createdAt: -1 });
OfflineBatchEnquirySchema.index({ customerId: 1 });

export const OfflineBatchEnquiry = model<IOfflineBatchEnquiry>(
  "OfflineBatchEnquiry",
  OfflineBatchEnquirySchema
);
