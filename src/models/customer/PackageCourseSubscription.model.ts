import mongoose, { Schema, Document } from "mongoose";

export interface IPackageCourseSubscription extends Document {
  customerId: mongoose.Types.ObjectId;
  courseId: mongoose.Types.ObjectId;
  packageId: mongoose.Types.ObjectId;
  customerShippingId?: mongoose.Types.ObjectId | null;
  trackingId?: number | null;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const packageCourseSubscriptionSchema: Schema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    packageId: { type: Schema.Types.ObjectId, ref: "PackageCourseEbookPrice", required: true },
    customerShippingId: { type: Schema.Types.ObjectId, ref: "CustomerShipping", default: null },
    trackingId: { type: Number, default: null },
    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

packageCourseSubscriptionSchema.index({ customerId: 1 });
packageCourseSubscriptionSchema.index({ courseId: 1 });

export const PackageCourseSubscription = mongoose.model<IPackageCourseSubscription>(
  "PackageCourseSubscription",
  packageCourseSubscriptionSchema,
  "ws_package_course_subscriptions"
);
