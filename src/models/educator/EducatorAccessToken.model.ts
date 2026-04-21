import { Schema, model, Document, Types } from "mongoose";

export interface IEducatorAccessToken extends Document {
  educatorId: Types.ObjectId;
  token: string;
  refreshToken: string;
  active: boolean;
  deleted: boolean;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const EducatorAccessTokenSchema = new Schema<IEducatorAccessToken>(
  {
    educatorId: { type: Schema.Types.ObjectId, ref: "CourseEducator", required: true },
    token: { type: String, required: true },
    refreshToken: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
    deleted: { type: Boolean, required: true, default: false },
    expiresAt: { type: Date, required: true },
  },
  { collection: "ws_educator_access_tokens", timestamps: true }
);

EducatorAccessTokenSchema.index({ educatorId: 1 });
EducatorAccessTokenSchema.index({ token: 1 });
EducatorAccessTokenSchema.index({ refreshToken: 1 });

export const EducatorAccessToken = model<IEducatorAccessToken>(
  "EducatorAccessToken",
  EducatorAccessTokenSchema
);
