import mongoose, { Schema, Document } from "mongoose";

export interface IPackageCourseSubscription extends Document {
  customerId: mongoose.Types.ObjectId;
  courseId: mongoose.Types.ObjectId;
  packageId: mongoose.Types.ObjectId;
  customerShippingId?: mongoose.Types.ObjectId | null;
  trackingId?: number | null;
  startAt?: Date | null;
  endAt?: Date | null;
  status: boolean;
  promocodeId?: mongoose.Types.ObjectId | null;
  promoterId?: mongoose.Types.ObjectId | null;
  paidAmount?: number | null;
  customerPercentage?: number | null;
  promoterPercentage?: number | null;
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
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    status: { type: Boolean, default: true },
    promocodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", default: null },
    promoterId: { type: Schema.Types.ObjectId, ref: "Promoter", default: null },
    paidAmount: { type: Number, default: null },
    customerPercentage: { type: Number, default: null },
    promoterPercentage: { type: Number, default: null },
  },
  { timestamps: true }
);

packageCourseSubscriptionSchema.index({ promoterId: 1, createdAt: -1 });
packageCourseSubscriptionSchema.index({ promocodeId: 1 });

packageCourseSubscriptionSchema.index({ customerId: 1 });
packageCourseSubscriptionSchema.index({ courseId: 1 });

export const PackageCourseSubscription = mongoose.model<IPackageCourseSubscription>(
  "PackageCourseSubscription",
  packageCourseSubscriptionSchema,
  "ws_package_course_subscriptions"
);
