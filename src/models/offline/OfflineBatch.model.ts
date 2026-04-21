import { Schema, model, Document, Types } from "mongoose";

export interface IOfflineBatch extends Document {
  name: string;
  image: string;
  description: string;
  startAt: Date;
  duration: string;
  centerId: Types.ObjectId;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const OfflineBatchSchema = new Schema<IOfflineBatch>(
  {
    name: { type: String, required: true, maxlength: 255 },
    image: { type: String, required: true, maxlength: 500 },
    description: { type: String, required: true },
    startAt: { type: Date, required: true },
    duration: { type: String, required: true, maxlength: 100 },
    centerId: { type: Schema.Types.ObjectId, ref: "OfflineCenter", required: true },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_offline_batch", timestamps: true }
);

OfflineBatchSchema.index({ centerId: 1, status: 1 });
OfflineBatchSchema.index({ startAt: 1 });

export const OfflineBatch = model<IOfflineBatch>("OfflineBatch", OfflineBatchSchema);
