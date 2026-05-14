import mongoose, { Schema, Document } from "mongoose";

export interface ILiveCourseSubscription extends Document {
  customerId: mongoose.Types.ObjectId;
  liveCourseId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  startAt?: Date | null;
  endAt?: Date | null;
  status: boolean;
  // Money trail. `originalAmount` is the plan price before any discount,
  // `discountAmount` is what the promo code took off, and `paidAmount` is the
  // amount actually charged (originalAmount - discountAmount). When no promo
  // is used, originalAmount/discountAmount stay null and paidAmount === price.
  promocodeId?: mongoose.Types.ObjectId | null;
  originalAmount?: number | null;
  discountAmount?: number | null;
  paidAmount?: number | null;
  paymentStatus: "pending" | "verified" | "failed";
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const liveCourseSubscriptionSchema: Schema = new Schema(
  {
    customerId:    { type: Schema.Types.ObjectId, ref: "Customer",       required: true, index: true },
    liveCourseId:  { type: Schema.Types.ObjectId, ref: "LiveCourse",     required: true, index: true },
    planId:        { type: Schema.Types.ObjectId, ref: "LiveCoursePlan", required: true },
    startAt:       { type: Date,    default: null },
    endAt:         { type: Date,    default: null },
    status:        { type: Boolean, default: true },
    promocodeId:    { type: Schema.Types.ObjectId, ref: "PromoCode", default: null },
    originalAmount: { type: Number, default: null },
    discountAmount: { type: Number, default: null },
    paidAmount:    { type: Number,  default: null },
    paymentStatus: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "pending",
    },
    razorpayOrderId:   { type: String, default: null, maxlength: 100 },
    razorpayPaymentId: { type: String, default: null, maxlength: 100 },
    paidAt:            { type: Date,   default: null },
  },
  { timestamps: true, collection: "ws_live_course_subscriptions" }
);

liveCourseSubscriptionSchema.index({ customerId: 1, liveCourseId: 1, paymentStatus: 1, endAt: 1 });

export const LiveCourseSubscription = mongoose.model<ILiveCourseSubscription>(
  "LiveCourseSubscription",
  liveCourseSubscriptionSchema
);
