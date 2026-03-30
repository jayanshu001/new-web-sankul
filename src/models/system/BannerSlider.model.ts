import { Schema, model, Document } from "mongoose";

export interface IBannerSlider extends Document {
  image: string;
  key?: string;
  keyId?: number;
  orderBy: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const BannerSliderSchema = new Schema<IBannerSlider>(
  {
    image: { type: String, required: true, maxlength: 255 },
    key: { type: String, maxlength: 255 },
    keyId: { type: Number },
    orderBy: { type: Number, required: true },
  },
  { collection: "ws_banner_sliders", timestamps: true }
);

export const BannerSlider = model<IBannerSlider>("BannerSlider", BannerSliderSchema);
