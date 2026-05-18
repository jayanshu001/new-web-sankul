import { Schema, model, Document, Types } from "mongoose";

export interface ILiveBannerSlider extends Document {
  image: string;
  liveCourseId: Types.ObjectId;
  orderBy: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const LiveBannerSliderSchema = new Schema<ILiveBannerSlider>(
  {
    image: { type: String, required: true, maxlength: 500 },
    liveCourseId: { type: Schema.Types.ObjectId, ref: "LiveCourse", required: true },
    orderBy: { type: Number, required: true, default: 0 },
  },
  { collection: "ws_live_banner_sliders", timestamps: true }
);

LiveBannerSliderSchema.index({ orderBy: 1 });
LiveBannerSliderSchema.index({ liveCourseId: 1 });

export const LiveBannerSlider = model<ILiveBannerSlider>(
  "LiveBannerSlider",
  LiveBannerSliderSchema
);
