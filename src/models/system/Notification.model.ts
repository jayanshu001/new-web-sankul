import { Schema, model, Document, Types } from "mongoose";

export type NotificationStatus = "sent" | "scheduled" | "failed" | "cancelled";

export interface INotificationAudience {
  all: boolean;
  platforms?: ("ios" | "android")[];
  courseIds?: Types.ObjectId[];
  userIds?: Types.ObjectId[];
}

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

  status: NotificationStatus;
  scheduledAt?: Date | null;
  sentAt?: Date | null;
  failureReason?: string | null;
  recipientCount?: number;
  audience?: INotificationAudience;

  createdAt?: Date;
  updatedAt?: Date;
}

const AudienceSchema = new Schema<INotificationAudience>(
  {
    all: { type: Boolean, default: false },
    platforms: [{ type: String, enum: ["ios", "android"] }],
    courseIds: [{ type: Schema.Types.ObjectId, ref: "Course" }],
    userIds: [{ type: Schema.Types.ObjectId, ref: "Customer" }],
  },
  { _id: false }
);

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

    status: {
      type: String,
      enum: ["sent", "scheduled", "failed", "cancelled"],
      default: "sent",
      index: true,
    },
    scheduledAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    recipientCount: { type: Number, default: 0 },
    audience: { type: AudienceSchema, default: () => ({ all: false }) },
  },
  { collection: "ws_notifications", timestamps: true }
);

NotificationSchema.index({ customerId: 1, createdAt: -1 });
NotificationSchema.index({ broadcast: 1, createdAt: -1 });
NotificationSchema.index({ status: 1, scheduledAt: 1 });

export const Notification = model<INotification>("Notification", NotificationSchema);
