import mongoose, { Schema, Document } from "mongoose";

export interface IMaterial extends Document {
  title: string;
  description?: string;
  materialCategoryId: mongoose.Types.ObjectId;
  file: string;
  directLink?: string;
  thumbnail?: string;
  fileSize?: number;
  fileMime?: string;
  language?: string;
  isPreview: boolean;
  downloadCount: number;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const materialSchema = new Schema<IMaterial>(
  {
    title: { type: String, required: true, trim: true, maxlength: 255 },
    description: { type: String },
    materialCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "MaterialCategory",
      required: true,
    },
    file: { type: String, required: true, maxlength: 1000 },
    directLink: { type: String, default: "", maxlength: 1000 },
    thumbnail: { type: String, maxlength: 500 },
    fileSize: { type: Number, default: 0 },
    fileMime: { type: String, maxlength: 100 },
    language: { type: String, default: "gu", maxlength: 20 },
    isPreview: { type: Boolean, default: false },
    downloadCount: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { collection: "ws_materials", timestamps: true }
);

materialSchema.index({ materialCategoryId: 1, status: 1, order: 1 });
materialSchema.index({ createdAt: -1 });

export const Material = mongoose.model<IMaterial>("Material", materialSchema);
