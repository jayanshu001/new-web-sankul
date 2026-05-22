import mongoose, { Schema, Document } from "mongoose";

export interface IPackageCourseSubscription extends Document {
  customerId: mongoose.Types.ObjectId;
  // Exactly one of courseId / targetPackageId is set: courseId for course
  // subscriptions, targetPackageId for package subscriptions. `packageId`
  // below is the plan row (PackageCourseEbookPrice) — historical name.
  courseId?: mongoose.Types.ObjectId | null;
  targetPackageId?: mongoose.Types.ObjectId | null;
  packageId: mongoose.Types.ObjectId;
  customerShippingId?: mongoose.Types.ObjectId | null;
  trackingId?: number | null;
  startAt?: Date | null;
  endAt?: Date | null;
  status: boolean;
  promocodeId?: mongoose.Types.ObjectId | null;
  promoterId?: mongoose.Types.ObjectId | null;
  referrerId?: mongoose.Types.ObjectId | null;
  paidAmount?: number | null;
  customerPercentage?: number | null;
  promoterPercentage?: number | null;
  paymentStatus: "pending" | "verified" | "failed";
  paymentMethod?: string | null;
  withMaterial?: boolean;
  remark?: string | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const packageCourseSubscriptionSchema: Schema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", default: null },
    targetPackageId: { type: Schema.Types.ObjectId, ref: "Package", default: null },
    packageId: { type: Schema.Types.ObjectId, ref: "PackageCourseEbookPrice", required: true },
    customerShippingId: { type: Schema.Types.ObjectId, ref: "CustomerShipping", default: null },
    trackingId: { type: Number, default: null },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    status: { type: Boolean, default: true },
    promocodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", default: null },
    promoterId: { type: Schema.Types.ObjectId, ref: "Promoter", default: null },
    referrerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    paidAmount: { type: Number, default: null },
    customerPercentage: { type: Number, default: null },
    promoterPercentage: { type: Number, default: null },
    paymentStatus: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "verified",
    },
    paymentMethod: { type: String, default: null, maxlength: 30 },
    withMaterial: { type: Boolean, default: false },
    remark: { type: String, default: null, maxlength: 1000 },
    razorpayOrderId: { type: String, default: null, maxlength: 100 },
    razorpayPaymentId: { type: String, default: null, maxlength: 100 },
    paidAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // Subscription rows are the entitlement source of truth — silent field
    // drops on an unknown key (e.g. a typo of `endAt`) would silently
    // un-entitle a paying customer. Throw on unknown fields to surface bugs
    // immediately.
    strict: "throw",
  }
);

packageCourseSubscriptionSchema.index({ promoterId: 1, createdAt: -1 });
packageCourseSubscriptionSchema.index({ promocodeId: 1 });

packageCourseSubscriptionSchema.index({ customerId: 1 });
packageCourseSubscriptionSchema.index({ courseId: 1 });
packageCourseSubscriptionSchema.index({ targetPackageId: 1 });

export const PackageCourseSubscription = mongoose.model<IPackageCourseSubscription>(
  "PackageCourseSubscription",
  packageCourseSubscriptionSchema,
  "ws_package_course_subscriptions"
);
