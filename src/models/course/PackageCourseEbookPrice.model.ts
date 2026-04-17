import mongoose, { Schema, Document } from "mongoose";

export interface IPackageCourseEbookPrice extends Document {
  courseId: mongoose.Types.ObjectId;
  name?: string;
  duration: number;
  price: number;
  withMaterial: boolean; // Renamed from includesMaterialFees to match staging
  materialPrice: number;
  isDefault: boolean;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const packageCourseEbookPriceSchema: Schema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    name: { type: String, default: null },
    duration: { type: Number, required: true },
    price: { type: Number, required: true },
    withMaterial: { type: Boolean, default: false },
    materialPrice: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const PackageCourseEbookPrice = mongoose.model<IPackageCourseEbookPrice>("PackageCourseEbookPrice", packageCourseEbookPriceSchema, "ws_package_course_ebook_prices");
