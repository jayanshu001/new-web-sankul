import { Schema, model, Document, Types } from "mongoose";

export interface IAdminAccessToken extends Document {
  adminUserId: Types.ObjectId;
  token: string;
  refreshToken: string;
  active: boolean;
  deleted: boolean;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const AdminAccessTokenSchema = new Schema<IAdminAccessToken>(
  {
    adminUserId: { type: Schema.Types.ObjectId, ref: "AdminUser", required: true },
    token: { type: String, required: true },
    refreshToken: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    deleted: { type: Boolean, required: true, default: false },
    expiresAt: { type: Date, required: true },
  },
  { collection: "ws_admin_access_tokens", timestamps: true }
);

AdminAccessTokenSchema.index({ adminUserId: 1 });
AdminAccessTokenSchema.index({ token: 1 });
AdminAccessTokenSchema.index({ refreshToken: 1 });
AdminAccessTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminAccessToken = model<IAdminAccessToken>(
  "AdminAccessToken",
  AdminAccessTokenSchema
);
