import mongoose, { Schema, Document } from "mongoose";

export interface IPackageType extends Document {
  name: string;
  order: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const packageTypeSchema = new Schema<IPackageType>(
  {
    name: { type: String, required: true, maxlength: 255 },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { collection: "ws_package_types", timestamps: true }
);

packageTypeSchema.index({ active: 1, order: 1 });

export const PackageType = mongoose.model<IPackageType>("PackageType", packageTypeSchema);
