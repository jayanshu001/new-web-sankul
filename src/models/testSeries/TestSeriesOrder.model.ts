import { Schema, model, Document, Types } from "mongoose";
import {
  PackageCourseEbookOrderStatus,
  PackageCourseEbookOrderType,
  PaymentMethod,
} from "../enums";

/**
 * One row per checkout attempt. Created PENDING with a Razorpay order id;
 * /payment/verify flips it COMPLETE and provisions the matching
 * TestSeriesSubscription. Mirrors EbookOrder.
 */
export interface ITestSeriesOrder extends Document {
  customerId: Types.ObjectId;
  testSeriesId: Types.ObjectId;
  planId?: Types.ObjectId | null;
  paymentMethod: PaymentMethod;
  orderType: PackageCourseEbookOrderType;
  orderPrice: number;
  // Checkout breakdown — stored so the receipt matches what the user saw.
  basePrice: number;
  discountAmount: number;
  gstAmount: number;
  handlingFee: number;
  promocodeId?: Types.ObjectId | null;
  // Promoter commission carried from order → copied onto the subscription at
  // /verify. promoterCommission is the currency amount locked in at purchase.
  promoterId?: Types.ObjectId | null;
  promoterPercentage?: number | null;
  promoterCommission?: number | null;
  // Referral trail. `referrerId` is the customer credited on a successful
  // purchase (via creditReferrer at /verify); `customerPercentage` is the
  // referral discount % the buyer received. Both null unless a referral code
  // was redeemed.
  referrerId?: Types.ObjectId | null;
  customerPercentage?: number | null;
  // Wallet ("coin") applied; debited from rewardPoints at /verify success.
  coinsUsed?: number | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  ipAddress?: string | null;
  transactionId?: string | null;
  status: PackageCourseEbookOrderStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const TestSeriesOrderSchema = new Schema<ITestSeriesOrder>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    testSeriesId: { type: Schema.Types.ObjectId, ref: "TestSeries", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "TestSeriesPrice", default: null },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: true,
    },
    orderType: {
      type: String,
      enum: Object.values(PackageCourseEbookOrderType),
      default: PackageCourseEbookOrderType.PURCHASE,
    },
    orderPrice: { type: Number, required: true, min: 0 },
    basePrice: { type: Number, required: true, default: 0 },
    discountAmount: { type: Number, required: true, default: 0 },
    gstAmount: { type: Number, required: true, default: 0 },
    handlingFee: { type: Number, required: true, default: 0 },
    promocodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", default: null },
    promoterId: { type: Schema.Types.ObjectId, ref: "Promoter", default: null },
    promoterPercentage: { type: Number, default: null },
    promoterCommission: { type: Number, default: null },
    referrerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    customerPercentage: { type: Number, default: null },
    coinsUsed: { type: Number, default: null },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    ipAddress: { type: String, default: null },
    transactionId: { type: String, default: null },
    status: {
      type: String,
      enum: Object.values(PackageCourseEbookOrderStatus),
      default: PackageCourseEbookOrderStatus.PENDING,
    },
  },
  { collection: "ws_test_series_orders", timestamps: true }
);

TestSeriesOrderSchema.index({ customerId: 1 });
TestSeriesOrderSchema.index({ testSeriesId: 1 });
TestSeriesOrderSchema.index({ razorpayOrderId: 1 });

export const TestSeriesOrder = model<ITestSeriesOrder>(
  "TestSeriesOrder",
  TestSeriesOrderSchema
);
