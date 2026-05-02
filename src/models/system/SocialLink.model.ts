import { Schema, model, Document, Types } from "mongoose";

export interface ISocialLink extends Document {
  typeId: Types.ObjectId;
  title: string;
  icon?: string;
  link: string;
  order: number;
  status: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const SocialLinkSchema = new Schema<ISocialLink>(
  {
    typeId: { type: Schema.Types.ObjectId, ref: "SocialLinkType", required: true },
    title: { type: String, required: true, maxlength: 255 },
    icon: { type: String, maxlength: 500 },
    link: { type: String, required: true, maxlength: 500 },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_social_links", timestamps: true }
);

SocialLinkSchema.index({ status: 1, order: 1 });
SocialLinkSchema.index({ typeId: 1 });

export const SocialLink = model<ISocialLink>("SocialLink", SocialLinkSchema);
