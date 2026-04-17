import mongoose, { Schema, Document } from "mongoose";

export interface IPackageCourseMaterial extends Document {
  title: string;
  image?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const packageCourseMaterialSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    image: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const PackageCourseMaterial = mongoose.model<IPackageCourseMaterial>("PackageCourseMaterial", packageCourseMaterialSchema, "ws_package_course_materials");
