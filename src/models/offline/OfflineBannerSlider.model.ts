import { Schema, model, Document } from "mongoose";

export interface IOfflineBannerSlider extends Document {
  image: string;
  key?: string;
  keyId?: number;
  orderBy: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const OfflineBannerSliderSchema = new Schema<IOfflineBannerSlider>(
  {
    image: { type: String, required: true, maxlength: 500 },
    key: { type: String, maxlength: 100 },
    keyId: { type: Number },
    orderBy: { type: Number, default: 0 },
  },
  { collection: "ws_offline_banner_slider", timestamps: true }
);

export const OfflineBannerSlider = model<IOfflineBannerSlider>(
  "OfflineBannerSlider",
  OfflineBannerSliderSchema
);
