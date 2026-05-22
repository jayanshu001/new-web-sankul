import mongoose, { Schema, Document } from "mongoose";
import { PackageCourseEbookPaymentType } from "../enums";

export interface IEbookSubscription extends Document {
  orderId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  ebookId: mongoose.Types.ObjectId;
  price: number;
  startAt: Date;
  endAt: Date;
  remarks?: string | null;
  paymentType: PackageCourseEbookPaymentType;
  status: boolean;
  promocodeId?: mongoose.Types.ObjectId | null;
  promoterId?: mongoose.Types.ObjectId | null;
  referrerId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ebookSubscriptionSchema: Schema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "EbookOrder", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    ebookId: { type: Schema.Types.ObjectId, ref: "Ebook", required: true },
    price: { type: Number, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    remarks: { type: String, default: null },
    paymentType: { type: String, enum: Object.values(PackageCourseEbookPaymentType), default: PackageCourseEbookPaymentType.BACKEND },
    status: { type: Boolean, default: true },
    promocodeId: { type: Schema.Types.ObjectId, ref: "PromoCode", default: null },
    promoterId: { type: Schema.Types.ObjectId, ref: "Promoter", default: null },
    referrerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
  },
  {
    timestamps: true,
    // Entitlement row — same reasoning as PackageCourseSubscription. Silent
    // drops on `endAt` or `startAt` would lock customers out of paid ebooks
    // without anyone noticing until the support tickets arrive.
    strict: "throw",
  }
);

ebookSubscriptionSchema.index({ promoterId: 1, createdAt: -1 });

ebookSubscriptionSchema.index({ customerId: 1 });
ebookSubscriptionSchema.index({ ebookId: 1 });
ebookSubscriptionSchema.index({ endAt: 1 });

export const EbookSubscription = mongoose.model<IEbookSubscription>("EbookSubscription", ebookSubscriptionSchema, "ws_ebook_subscriptions");
