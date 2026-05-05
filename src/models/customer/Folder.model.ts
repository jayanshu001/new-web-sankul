import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFolder extends Document {
  customerId: Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const folderSchema = new Schema<IFolder>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { collection: "ws_folders", timestamps: true }
);

folderSchema.index({ customerId: 1, name: 1 }, { unique: true });
folderSchema.index({ customerId: 1, createdAt: -1 });

export const Folder = mongoose.model<IFolder>("Folder", folderSchema);
