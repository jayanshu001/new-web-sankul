import mongoose, { Schema, Document, Types } from "mongoose";

export type FolderType = "video" | "material";

export interface IFolder extends Document {
  customerId: Types.ObjectId;
  name: string;
  type: FolderType;
  isDefaultFolder: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const folderSchema = new Schema<IFolder>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ["video", "material"], required: true },
    isDefaultFolder: { type: Boolean, default: false },
  },
  { collection: "ws_folders", timestamps: true }
);

folderSchema.index({ customerId: 1, type: 1, name: 1 }, { unique: true });
folderSchema.index({ customerId: 1, type: 1, createdAt: -1 });

export const Folder = mongoose.model<IFolder>("Folder", folderSchema);
