import mongoose, { Schema, Document, Types } from "mongoose";

export type PackageChatMediaType = "image" | "video" | "pdf" | "audio" | "other";
export type PackageChatSenderType = "admin" | "system";

export interface IPackageChat extends Document {
  packageId: Types.ObjectId;
  text?: string;
  mediaUrl?: string;
  mediaType?: PackageChatMediaType;
  senderType: PackageChatSenderType;
  senderId?: Types.ObjectId | null;
  pushSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPackageChat>(
  {
    packageId: { type: Schema.Types.ObjectId, ref: "Package", required: true },
    text: { type: String, default: "" },
    mediaUrl: { type: String, maxlength: 1000 },
    mediaType: {
      type: String,
      enum: ["image", "video", "pdf", "audio", "other"],
      default: "other",
    },
    senderType: {
      type: String,
      enum: ["admin", "system"],
      default: "admin",
      required: true,
    },
    senderId: { type: Schema.Types.ObjectId, default: null },
    pushSent: { type: Boolean, default: false },
  },
  { collection: "ws_package_chats", timestamps: true }
);

schema.index({ packageId: 1, createdAt: -1 });

export const PackageChat = mongoose.model<IPackageChat>("PackageChat", schema);
