import { Schema, model, Document, Types } from "mongoose";

export interface ICustomerAccessToken extends Document {
  customerId: Types.ObjectId;
  token: string;
  refreshToken: string;
  active: boolean;
  deleted: boolean;
  expiresAt: Date;
  createdAt: Date;
}

const CustomerAccessTokenSchema = new Schema<ICustomerAccessToken>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    token: { type: String, required: true },
    refreshToken: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    deleted: { type: Boolean, required: true, default: false },
    expiresAt: { type: Date, required: true },
  },
  { collection: "ws_customer_access_tokens", timestamps: { createdAt: true, updatedAt: false } }
);

CustomerAccessTokenSchema.index({ customerId: 1 });
CustomerAccessTokenSchema.index({ token: 1 });
CustomerAccessTokenSchema.index({ refreshToken: 1 });
CustomerAccessTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CustomerAccessToken = model<ICustomerAccessToken>(
  "CustomerAccessToken",
  CustomerAccessTokenSchema
);
