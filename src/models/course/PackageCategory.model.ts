import mongoose, { Schema, Document } from "mongoose";

export interface IPackageCategory extends Document {
  title: string;
  slug: string;
  image: string;
  order: number;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const packageCategorySchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    image: { type: String, required: true },
    order: { type: Number, default: 0 },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

packageCategorySchema.index({ status: 1, order: 1 });

export const PackageCategory = mongoose.model<IPackageCategory>(
  "PackageCategory",
  packageCategorySchema,
  "ws_package_categories"
);
