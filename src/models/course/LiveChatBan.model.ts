import { Schema, model, Document, Types } from "mongoose";

// A customer who is barred from sending any live-chat messages. Global —
// not scoped to a single live class. Existence of a row = banned.
export interface ILiveChatBan extends Document {
  customerId: Types.ObjectId;
  bannedBy: Types.ObjectId;
  reason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const LiveChatBanSchema = new Schema<ILiveChatBan>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, unique: true },
    bannedBy:   { type: Schema.Types.ObjectId, ref: "AdminUser", required: true },
    reason:     { type: String, default: null, maxlength: 500 },
  },
  { collection: "ws_live_chat_bans", timestamps: true }
);

export const LiveChatBan = model<ILiveChatBan>("LiveChatBan", LiveChatBanSchema);
