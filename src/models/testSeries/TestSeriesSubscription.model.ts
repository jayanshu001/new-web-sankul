import { Schema, model, Document, Types } from "mongoose";
import { PackageCourseEbookPaymentType } from "../enums";

/**
 * Provisioned access to a Test Series. Created on /verify success or via
 * admin free-grant. endAt = startAt + plan.durationDays. Active access is
 * (status: true && endAt > now).
 */
export interface ITestSeriesSubscription extends Document {
  orderId?: Types.ObjectId | null;
  customerId: Types.ObjectId;
  testSeriesId: Types.ObjectId;
  planId?: Types.ObjectId | null;
  price: number;
  startAt: Date;
  endAt: Date;
  remarks?: string | null;
  paymentType: PackageCourseEbookPaymentType;
  status: boolean;
  promocodeId?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const TestSeriesSubscriptionSchema = new Schema<ITestSeriesSubscription>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "TestSeriesOrder", default: null },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    testSeriesId: { type: Schema.Types.ObjectId, ref: "TestSeries", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "TestSeriesPrice", default: null },
    price: { type: Number, required: true, min: 0 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    remarks: { type: String, default: null },
    paymentType: {
      type: String,
      enum: Object.values(PackageCourseEbookPaymentType),
      default: PackageCourseEbookPaymentType.ONLINE,
    },
    status: { type: Boolean, default: true },
    promocodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", default: null },
  },
  { collection: "ws_test_series_subscriptions", timestamps: true }
);

TestSeriesSubscriptionSchema.index({ customerId: 1, testSeriesId: 1 });
TestSeriesSubscriptionSchema.index({ customerId: 1, status: 1, endAt: 1 });
TestSeriesSubscriptionSchema.index({ testSeriesId: 1 });
TestSeriesSubscriptionSchema.index({ endAt: 1 });

export const TestSeriesSubscription = model<ITestSeriesSubscription>(
  "TestSeriesSubscription",
  TestSeriesSubscriptionSchema
);
