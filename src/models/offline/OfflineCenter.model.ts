import { Schema, model, Document, Types } from "mongoose";

export interface IOfflineCenter extends Document {
  name: string;
  images: string[];
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  cityId: Types.ObjectId;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const OfflineCenterSchema = new Schema<IOfflineCenter>(
  {
    name: { type: String, required: true, maxlength: 255 },
    images: { type: [String], default: [] },
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    phone: { type: String, required: true, maxlength: 20 },
    cityId: { type: Schema.Types.ObjectId, ref: "OfflineCity", required: true },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_offline_center", timestamps: true }
);

OfflineCenterSchema.index({ cityId: 1, status: 1 });

export const OfflineCenter = model<IOfflineCenter>("OfflineCenter", OfflineCenterSchema);
