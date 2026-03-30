import { Schema, model, Document } from "mongoose";

export interface IPopupNotification extends Document {
  title: string;
  description: string;
  image: string;
  discount: string;
  promocode: string;
  promoExpireAt: Date;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const PopupNotificationSchema = new Schema<IPopupNotification>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    image: { type: String, required: true },
    discount: { type: String, required: true },
    promocode: { type: String, required: true },
    promoExpireAt: { type: Date, required: true },
    status: { type: Boolean, required: true },
  },
  { collection: "ws_popup_notifications", timestamps: true }
);

export const PopupNotification = model<IPopupNotification>(
  "PopupNotification",
  PopupNotificationSchema
);
