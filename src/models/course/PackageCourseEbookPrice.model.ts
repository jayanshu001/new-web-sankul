import mongoose, { Schema, Document } from "mongoose";

export interface IPackageCourseEbookPrice extends Document {
  courseId?: mongoose.Types.ObjectId | null;
  packageId?: mongoose.Types.ObjectId | null;
  ebookId?: mongoose.Types.ObjectId | null;
  name?: string;
  duration: number;
  price: number;
  withMaterial: boolean;
  materialPrice: number;
  isDefault: boolean;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const packageCourseEbookPriceSchema: Schema = new Schema(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", default: null },
    packageId: { type: Schema.Types.ObjectId, ref: "Package", default: null },
    ebookId: { type: Schema.Types.ObjectId, ref: "Ebook", default: null },
    name: { type: String, default: null },
    duration: { type: Number, required: true },
    price: { type: Number, required: true },
    withMaterial: { type: Boolean, default: false },
    materialPrice: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

packageCourseEbookPriceSchema.index({ courseId: 1, status: 1 });
packageCourseEbookPriceSchema.index({ packageId: 1, status: 1 });
packageCourseEbookPriceSchema.index({ ebookId: 1, status: 1 });

packageCourseEbookPriceSchema.pre("validate", function (next) {
  const doc = this as any;
  const set = [doc.courseId, doc.packageId, doc.ebookId].filter(Boolean);
  if (set.length !== 1) {
    return next(new Error("Exactly one of courseId, packageId, ebookId must be set."));
  }
  next();
});

export const PackageCourseEbookPrice = mongoose.model<IPackageCourseEbookPrice>(
  "PackageCourseEbookPrice",
  packageCourseEbookPriceSchema,
  "ws_package_course_ebook_prices"
);
