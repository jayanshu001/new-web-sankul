import { Schema, model, Document } from "mongoose";

export interface IImageNotification extends Document {
  image: string;
  redirectUrl?: string;
  active: boolean;
}

const ImageNotificationSchema = new Schema<IImageNotification>(
  {
    image: { type: String, required: true },
    redirectUrl: { type: String },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: "ws_image_notifications", timestamps: false }
);

export const ImageNotification = model<IImageNotification>(
  "ImageNotification",
  ImageNotificationSchema
);
