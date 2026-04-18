import mongoose, { Schema, Document } from "mongoose";

export interface IMaterialCategory extends Document {
  title: string;
  image?: string;
  parent: mongoose.Types.ObjectId | null;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const materialCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    image: { type: String, default: null },
    parent: { type: Schema.Types.ObjectId, ref: "MaterialCategory", default: null },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

materialCategorySchema.index({ parent: 1, status: 1, order: 1 });

export const MaterialCategory = mongoose.model<IMaterialCategory>(
  "MaterialCategory",
  materialCategorySchema,
  "ws_material_categories"
);
