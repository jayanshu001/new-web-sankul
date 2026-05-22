import { Schema, model, Document, Types } from "mongoose";

export interface ILiveChatMessage extends Document {
  liveClassId: string;
  customerId?: Types.ObjectId;
  adminId?: Types.ObjectId;
  isAdmin: boolean;
  userName: string;
  message: string;
  // Soft-delete: when an admin deletes a single message, we keep the row so the
  // moderation history survives but hide it from chat history + live views.
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt: Date;
}

const LiveChatMessageSchema = new Schema<ILiveChatMessage>(
  {
    liveClassId: { type: String, required: true, index: true },
    customerId:  { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    adminId:     { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    isAdmin:     { type: Boolean, default: false, index: true },
    userName:    { type: String, required: true, maxlength: 200 },
    message:     { type: String, required: true, maxlength: 2000 },
    deletedAt:   { type: Date,                    default: null },
    deletedBy:   { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { collection: "ws_live_chat_messages", timestamps: true }
);

LiveChatMessageSchema.index({ liveClassId: 1, createdAt: 1 });

export const LiveChatMessage = model<ILiveChatMessage>("LiveChatMessage", LiveChatMessageSchema);
