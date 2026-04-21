import { Schema, model, Document, Types } from "mongoose";

export interface IOfflineEnquiry extends Document {
  customerId?: Types.ObjectId | null;
  name: string;
  email: string;
  mobile: string;
  qualification: string;
  batchId: Types.ObjectId;
  remarks?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const OfflineEnquirySchema = new Schema<IOfflineEnquiry>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    name: { type: String, required: true, maxlength: 255 },
    email: { type: String, required: true, maxlength: 255 },
    mobile: { type: String, required: true, maxlength: 20 },
    qualification: { type: String, required: true, maxlength: 255 },
    batchId: { type: Schema.Types.ObjectId, ref: "OfflineBatch", required: true },
    remarks: { type: String, default: null },
  },
  { collection: "ws_offline_enquiry", timestamps: true }
);

OfflineEnquirySchema.index({ batchId: 1, createdAt: -1 });
OfflineEnquirySchema.index({ customerId: 1 });

export const OfflineEnquiry = model<IOfflineEnquiry>("OfflineEnquiry", OfflineEnquirySchema);
