import mongoose, { Schema, Document, Types } from "mongoose";

export type FolderItemKind = "material" | "video" | "ebook";

export interface IFolderItem extends Document {
  folderId: Types.ObjectId;
  customerId: Types.ObjectId;
  kind: FolderItemKind;
  refId: Types.ObjectId;
  addedAt: Date;
}

const folderItemSchema = new Schema<IFolderItem>(
  {
    folderId: { type: Schema.Types.ObjectId, ref: "Folder", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    kind: { type: String, enum: ["material", "video", "ebook"], required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { collection: "ws_folder_items", timestamps: false }
);

folderItemSchema.index({ folderId: 1, kind: 1, refId: 1 }, { unique: true });
folderItemSchema.index({ folderId: 1, addedAt: -1 });
folderItemSchema.index({ customerId: 1 });

export const FolderItem = mongoose.model<IFolderItem>("FolderItem", folderItemSchema);
