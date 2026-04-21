import { Schema, model, Document } from "mongoose";

export interface IOfflineCity extends Document {
  name: string;
  image: string;
  order: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const OfflineCitySchema = new Schema<IOfflineCity>(
  {
    name: { type: String, required: true, maxlength: 100 },
    image: { type: String, required: true, maxlength: 500 },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_offline_city", timestamps: true }
);

OfflineCitySchema.index({ status: 1, order: 1 });

export const OfflineCity = model<IOfflineCity>("OfflineCity", OfflineCitySchema);
