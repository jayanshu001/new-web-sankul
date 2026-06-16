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
  promoterId?: mongoose.Types.ObjectId | null;
  // Promoter commission locked in at purchase (currency). See
  // PackageCourseSubscription for the rationale.
  promoterPercentage?: number | null;
  promoterCommission?: number | null;
  // Referral trail. Set when the buyer redeemed a customer's referralCode:
  // `referrerId` is the customer credited on a successful purchase (via
  // creditReferrer), `customerPercentage` is the referral discount % the buyer
  // received. Both null for a plain or promocode purchase.
  referrerId?: mongoose.Types.ObjectId | null;
  customerPercentage?: number | null;
  originalAmount?: number | null;
  discountAmount?: number | null;
  paidAmount?: number | null;
  // Wallet ("coin") applied; debited from rewardPoints at /verify success.
  coinsUsed?: number | null;
  paymentStatus: "pending" | "verified" | "failed";
  // Physical-material fulfillment for "With Materials" plans. `withMaterial`
  // marks the order as shipping material; `customerShippingId` is the delivery
  // address (a CustomerAddress._id). Both optional — a normal online-only live
  // course leaves withMaterial:false and a null address. Mirrors the equivalent
  // fields on PackageCourseSubscription.
  withMaterial?: boolean;
  customerShippingId?: mongoose.Types.ObjectId | null;
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
    promoterId:     { type: Schema.Types.ObjectId, ref: "Promoter", default: null },
    promoterPercentage: { type: Number, default: null },
    promoterCommission: { type: Number, default: null },
    referrerId:         { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    customerPercentage: { type: Number, default: null },
    originalAmount: { type: Number, default: null },
    discountAmount: { type: Number, default: null },
    paidAmount:    { type: Number,  default: null },
    coinsUsed:     { type: Number,  default: null },
    paymentStatus: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "pending",
    },
    withMaterial:       { type: Boolean, default: false },
    customerShippingId: { type: Schema.Types.ObjectId, ref: "CustomerShipping", default: null },
    razorpayOrderId:   { type: String, default: null, maxlength: 100 },
    razorpayPaymentId: { type: String, default: null, maxlength: 100 },
    paidAt:            { type: Date,   default: null },
  },
  {
    timestamps: true,
    collection: "ws_live_course_subscriptions",
    // Entitlement row — fail loud on unknown fields so a typo in the
    // money-trail fields (originalAmount / discountAmount / paidAmount)
    // doesn't silently zero them.
    strict: "throw",
  }
);

liveCourseSubscriptionSchema.index({ customerId: 1, liveCourseId: 1, paymentStatus: 1, endAt: 1 });
liveCourseSubscriptionSchema.index({ promoterId: 1, createdAt: -1 });

export const LiveCourseSubscription = mongoose.model<ILiveCourseSubscription>(
  "LiveCourseSubscription",
  liveCourseSubscriptionSchema
);
