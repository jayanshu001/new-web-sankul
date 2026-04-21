import { Schema, model, Document, Types } from "mongoose";

export interface INotification extends Document {
  customerId?: Types.ObjectId | null;
  title: string;
  body: string;
  image?: string | null;
  type: string;
  deepLink?: string | null;
  data?: Record<string, unknown>;
  isRead: boolean;
  readAt?: Date | null;
  broadcast: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null, index: true },
    title: { type: String, required: true, maxlength: 255 },
    body: { type: String, required: true },
    image: { type: String, default: null },
    type: { type: String, default: "general", maxlength: 50 },
    deepLink: { type: String, default: null },
    data: { type: Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    broadcast: { type: Boolean, default: false, index: true },
  },
  { collection: "ws_notifications", timestamps: true }
);

NotificationSchema.index({ customerId: 1, createdAt: -1 });
NotificationSchema.index({ broadcast: 1, createdAt: -1 });

export const Notification = model<INotification>("Notification", NotificationSchema);
