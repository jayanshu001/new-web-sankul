import { Schema, model, Document } from "mongoose";

export interface ISocialLinkType extends Document {
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const SocialLinkTypeSchema = new Schema<ISocialLinkType>(
  {
    title: { type: String, required: true, maxlength: 255, unique: true },
  },
  { collection: "ws_social_link_types", timestamps: true }
);

export const SocialLinkType = model<ISocialLinkType>("SocialLinkType", SocialLinkTypeSchema);
