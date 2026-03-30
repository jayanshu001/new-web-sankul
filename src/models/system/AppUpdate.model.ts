import { Schema, model, Document } from "mongoose";
import { UpdateType } from "../enums";

export interface IAppUpdate extends Document {
  latestVersion: number;
  updateType: UpdateType;
  isUpdateAvailable: boolean;
}

const AppUpdateSchema = new Schema<IAppUpdate>(
  {
    latestVersion: { type: Number, required: true },
    updateType: {
      type: String,
      enum: Object.values(UpdateType),
      default: UpdateType.FLEXIBLE,
    },
    isUpdateAvailable: { type: Boolean, required: true },
  },
  { collection: "ws_app_updates", timestamps: false }
);

export const AppUpdate = model<IAppUpdate>("AppUpdate", AppUpdateSchema);
