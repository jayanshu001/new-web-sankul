import { Schema, model, Document } from "mongoose";

export interface IVersion extends Document {
  latestVersionCode: number;
  lastSupportedVersionCode: number;
}

const VersionSchema = new Schema<IVersion>(
  {
    latestVersionCode: { type: Number, required: true },
    lastSupportedVersionCode: { type: Number, required: true },
  },
  { collection: "ws_versions", timestamps: false }
);

export const Version = model<IVersion>("Version", VersionSchema);
