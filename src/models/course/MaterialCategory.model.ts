import mongoose, { Schema, Document } from "mongoose";

export interface IMaterialCategory extends Document {
  title: string;
  slug?: string;
  image?: string;
  parent: mongoose.Types.ObjectId | null;
  ancestors: mongoose.Types.ObjectId[];
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const materialCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, default: "" },
    image: { type: String, default: null },
    parent: { type: Schema.Types.ObjectId, ref: "MaterialCategory", default: null },
    ancestors: [{ type: Schema.Types.ObjectId, ref: "MaterialCategory" }],
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

materialCategorySchema.index({ parent: 1, status: 1, order: 1 });
materialCategorySchema.index({ ancestors: 1 });
materialCategorySchema.index({ slug: 1 }, { sparse: true });

export const MaterialCategory = mongoose.model<IMaterialCategory>(
  "MaterialCategory",
  materialCategorySchema,
  "ws_material_categories"
);
